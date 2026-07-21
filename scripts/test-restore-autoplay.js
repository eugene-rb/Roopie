// セッション復元(前回のタブ構成を復元)や休止タブの復帰でも、フォーカスしていない
// タブが勝手に音を鳴らし始めないことの検証(再利用可能)。実行: npx electron scripts/test-restore-autoplay.js
//
// restoreTabs()はフォーカスするタブ以外を background:true で開くようにしてあるため、
// tab-manager.jsのautoMuted機構(裏で開いたタブは作成時ミュート、そのタブへの実操作で解除)が
// そのまま効く。ここでは複数タブを復元し、指定したタブだけが素の状態で開き、
// それ以外は不活性化+ミュートされたままであることを確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8948;
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

    // ---- セッション復元(起動時に前回のタブ構成を戻す)----
    tm.restoreTabs([
      { url: `http://localhost:${PORT}/a`, active: false },
      { url: `http://localhost:${PORT}/b`, active: true },
      { url: `http://localhost:${PORT}/c`, active: false },
    ]);
    await sleep(300);

    check('復元後は3タブ+元の初期タブ', tm.tabs.length, 4);
    const [, tabA, tabB, tabC] = tm.tabs;
    check('指定したタブ(b)がアクティブになる', tm.activeTabId, tabB.id);

    // アクティブにしたタブ(b)は普通に読み込まれ、自動ミュートもされない
    await Promise.race([new Promise((r) => tabB.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    check('アクティブなタブは休止扱いにならない', tabB.hibernated, false);
    check('アクティブなタブは自動ミュートされない', tabB.view.webContents.isAudioMuted(), false);

    // フォーカスしなかったタブ(a, c)は不活性化+ミュートされたまま
    check('非アクティブのタブ(a)は休止中', tabA.hibernated, true);
    check('非アクティブのタブ(a)はミュートされている', tabA.view.webContents.isAudioMuted(), true);
    check('非アクティブのタブ(c)は休止中', tabC.hibernated, true);
    check('非アクティブのタブ(c)はミュートされている', tabC.view.webContents.isAudioMuted(), true);

    // 後からタブaへ切り替えて中身をクリックすれば、そこで初めてミュートが解ける
    tm.switchTab(tabA.id);
    await Promise.race([new Promise((r) => tabA.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(300);
    check('切り替えて読み込んだだけではミュート解除されない', tabA.view.webContents.isAudioMuted(), true);
    clickAt(tabA.view.webContents, 10, 10);
    await sleep(200);
    check('中身をクリックするとミュートが解ける', tabA.view.webContents.isAudioMuted(), false);

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
