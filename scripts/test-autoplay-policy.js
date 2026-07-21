// バックグラウンドで開いたタブ(ホイールクリック等)がユーザーの見ていない/まだ触れていない間に
// 勝手に音を鳴らし始めないことの検証(再利用可能)。実行: npx electron scripts/test-autoplay-policy.js
//
// 検証の結果、Electronの autoplayPolicy: 'document-user-activation-required' は
// メインプロセスからの loadURL() による遷移(=タブの新規作成やタブ復帰)には効かず、
// 実際のサイト(http/https)では自動再生を止められないことが分かった
// (data: URLでは効くが、これは実運用では起きないケース)。
// そのため、裏で開いたタブは作成時にミュートしておき、そのタブ自身への実際の操作
// (クリック・キー入力)があった時点で初めて解除する方式(tab.autoMuted)で確実に抑える。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8947;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>ページ${req.url}</title>本文`);
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);
    const initialActiveId = tm.activeTabId;

    // ホイールクリック相当: background:true で裏に開いたタブは作成直後からミュートされる
    const bg = tm.createTab(`http://localhost:${PORT}/bg`, { background: true });
    check('裏で開いた直後からミュートされる', bg.view.webContents.isAudioMuted(), true);
    check('自動ミュート中フラグが立つ', bg.autoMuted, true);
    check('裏で開いてもアクティブタブは変わらない', tm.activeTabId, initialActiveId);

    // タブへ切り替えて読み込ませても、ページ自身への操作がなければミュートのまま
    tm.switchTab(bg.id);
    await Promise.race([new Promise((r) => bg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(300);
    check('切り替えて読み込んだだけではミュート解除されない', bg.view.webContents.isAudioMuted(), true);

    // そのタブの中身へ実際に触れる(クリック)と、そこで初めてミュートが解ける
    clickAt(bg.view.webContents, 10, 10);
    await sleep(200);
    check('タブの中身をクリックするとミュートが解ける', bg.view.webContents.isAudioMuted(), false);
    check('自動ミュートフラグも下りる', bg.autoMuted, false);

    // 比較用: 裏で開かず(前面で)普通に作ったタブは自動ミュートしない
    const fg = tm.createTab(`http://localhost:${PORT}/fg`);
    check('前面で開いたタブは自動ミュートしない', fg.view.webContents.isAudioMuted(), false);
    check('前面タブに自動ミュートフラグは立たない', fg.autoMuted, false);

    // 手動でミュートボタンを押した場合は、自動ミュートの管理から外れる
    // (裏で別タブを開いて手動ミュート→そのままクリックしても再生し始めたりしない)
    const bg2 = tm.createTab(`http://localhost:${PORT}/bg2`, { background: true });
    tm.toggleMute(bg2.id); // ミュート→解除(手動操作)
    tm.toggleMute(bg2.id); // 解除→再ミュート
    check('手動トグル後は自動ミュート管理から外れる', bg2.autoMuted, false);
    check('手動操作の結果どおりミュートされている', bg2.view.webContents.isAudioMuted(), true);

    server.close();
    browser.flushAll();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
