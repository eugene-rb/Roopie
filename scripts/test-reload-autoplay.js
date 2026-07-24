// 「自分で押した再読み込み(F5)の後もページの再生が続けられる」ことの検証(再利用可能)。
// 実行: npx electron scripts/test-reload-autoplay.js
//
// 以前は webPreferences に autoplayPolicy: 'document-user-activation-required' を指定していたため、
// ユーザー操作の有無が**ドキュメント単位**でナビゲーションのたびに捨てられ、
// 自分で押した再読み込みの後ですら YouTube等が NotAllowedError で止まったままになっていた。
// 既定(no-user-gesture-required)に戻し、裏タブの勝手な再生は
//   1. 背景タブ・セッション復元タブはそもそも読み込まない(hibernated)
//   2. 読み込まれた後もそのタブへの操作があるまで再生開始の瞬間に止める(autoPauseMedia)
// の2段構えで塞ぐ。ここではその両立を確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8953;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-reload-autoplay-'));
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
const js = (wc, code) => wc.executeJavaScript(code, true);
const waitLoad = (wc, ms = 8000) => Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(ms)]);

// 読み込みと同時に、音のある(ミュートでない)audioを自動再生しようとするページ。
// 自動再生ポリシーに引っかかると play() が NotAllowedError で reject される
// audioは必ずDOMに置く(autoPauseMediaの一時停止はDOMを走査して探すため、
// new Audio() のような未挿入の要素だと検証にならない)。実際のバグ報告と同じ
// 「script実行由来の play()」で自動再生を試みる
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const AUTOPLAY_PAGE = `<!doctype html><meta charset="utf-8"><title>自動再生ページ</title><body>再生テスト
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>
  const audio = document.getElementById('a');
  window.__err = null;
  audio.play().catch((e) => { window.__err = e.name; });
  window.__state = () => ({ paused: audio.paused, err: window.__err });
</script>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(AUTOPLAY_PAGE);
    })
    .listen(PORT);

  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    // 最初のタブが出来るまで待つ
    for (let i = 0; i < 40 && ctx.tabManager.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const url = `http://localhost:${PORT}/`;

    // ---- 1. 前面で開いたタブは自動再生できる ----
    const tab = ctx.tabManager.createTab(url);
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('前面タブは自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // ---- 2. 再読み込みしても再生できる(本題) ----
    ctx.tabManager.reload();
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('再読み込み後も自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // 2回続けて再読み込みしても同じ(ユーザー操作の持ち越しに頼っていないこと)
    ctx.tabManager.reload();
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('続けて再読み込みしても自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // ---- 3. 裏で開いたタブは、そもそも読み込まれない ----
    const bg = ctx.tabManager.createTab(url, { background: true });
    await sleep(1200);
    check('裏で開いたタブは休止中(読み込まない)', bg.hibernated, true);
    check('裏で開いたタブはURLも空のまま', bg.view.webContents.getURL(), '');
    check('裏で開いてもアクティブタブは変わらない', ctx.tabManager.activeTabId, tab.id);

    // ---- 4. 裏タブへ切り替えて読み込まれても、触るまでは再生させない ----
    ctx.tabManager.switchTab(bg.id);
    await waitLoad(bg.view.webContents);
    await sleep(1200);
    check('切り替えて読み込まれても自動一時停止フラグは立ったまま', bg.autoPauseMedia, true);
    check('自動再生は止められる(ミュートはしない)', (await js(bg.view.webContents, 'window.__state()')).paused, true);
    check('ミュートはされていない', bg.view.webContents.isAudioMuted(), false);

    // ---- 5. そのタブを操作すれば、以後は普通に再生できる ----
    bg.view.webContents.sendInputEvent({ type: 'mouseDown', x: 30, y: 30, button: 'left', clickCount: 1 });
    bg.view.webContents.sendInputEvent({ type: 'mouseUp', x: 30, y: 30, button: 'left', clickCount: 1 });
    await sleep(400);
    check('操作すると自動一時停止フラグが下りる', bg.autoPauseMedia, false);

    // 操作後は再読み込みしても普通に再生できる(裏で開いたタブでも、一度触れば以後は通常扱い)
    ctx.tabManager.reload();
    await waitLoad(bg.view.webContents);
    await sleep(800);
    check('操作後は再読み込みしても再生できる', await js(bg.view.webContents, 'window.__state()'), { paused: false, err: null });

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    server.close();
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
