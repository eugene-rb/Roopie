// タブをウィンドウの外へドラッグ&ドロップして「別ウィンドウの既存タブバー」へ移す機能の検証。
// 実行: npx electron scripts/test-tab-cross-window.js
//
// HTML5 D&Dはウィンドウをまたぐと draggingId (レンダラーごとのローカル変数) が
// 相手側からは見えないため、専用MIME(application/x-roopie-tab)でtabId/windowIdを運ぶ。
// ここではその配線(preload → ipc.js の tabs:move-from-window)を実IPCで検証し、
// あわせて「移動が確定した後、元ウィンドウのdrag-endが二重に新規ウィンドウを作らない」
// ガード(ctx.tabConsumedBy)も確認する。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8942;
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
const js = (wc, code) => wc.executeJavaScript(code, true);

async function waitForActive(tm, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (tm.activeTabId !== null) return;
    await sleep(200);
  }
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

    const ctxA = browser.createWindow();
    const ctxB = browser.createWindow();
    await waitForActive(ctxA.tabManager);
    await waitForActive(ctxB.tabManager);
    await sleep(300);

    const tabA = ctxA.tabManager.createTab(`http://localhost:${PORT}/a`);
    await Promise.race([new Promise((r) => tabA.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    const tabB1 = ctxB.tabManager.createTab(`http://localhost:${PORT}/b1`);
    await Promise.race([new Promise((r) => tabB1.view.webContents.once('did-finish-load', r)), sleep(6000)]);

    check('移動前: Aは2枚(初期タブ+/a)', ctxA.tabManager.tabs.length, 2);
    check('移動前: Bは2枚(初期タブ+/b1)', ctxB.tabManager.tabs.length, 2);

    // 移動でWebContentsが作り直されない(=再読み込みされない)ことを見るための目印
    const movedWcId = tabA.view.webContents.id;
    let reloads = 0;
    tabA.view.webContents.on('did-start-loading', () => reloads++);
    await js(tabA.view.webContents, 'window.__roopieMark = 42');

    // Bの画面(実レンダラー)から「AのウィンドウID・タブIDを index 0 へ」と実IPCで送る
    // (ドロップ先の描画スロット計算まではDOM経由で検証済みのため、ここではIPCの配線に絞る)
    await js(ctxB.window.webContents, `window.roopie.moveTabFromWindow(${ctxA.window.id}, ${tabA.id}, 0)`);
    await sleep(500);

    check('Aからそのタブが消える', ctxA.tabManager.getTab(tabA.id), null);
    check('移動後もAには元の初期タブが残る', ctxA.tabManager.tabs.length, 1);
    check('Bにタブが1枚増える', ctxB.tabManager.tabs.length, 3);
    check('Bの先頭(index 0)に移ってくる', ctxB.tabManager.tabs[0].view.webContents.getURL(), `http://localhost:${PORT}/a`);
    check('移動してきたタブがBでアクティブになる', ctxB.tabManager.activeTabId, ctxB.tabManager.tabs[0].id);
    check('Bのbi1タブはそのまま残る', ctxB.tabManager.tabs.some((t) => t.view.webContents.getURL() === `http://localhost:${PORT}/b1`), true);

    // URLで作り直さずWebContentsViewごと運ぶので、タブIDもWebContentsも同じまま(再読み込みなし)
    check('タブIDが変わらない', ctxB.tabManager.tabs[0].id, tabA.id);
    check('WebContentsが作り直されていない', ctxB.tabManager.tabs[0].view.webContents.id, movedWcId);
    check('移動で再読み込みが走らない', reloads, 0);
    check('ページの状態(JSの変数)が残っている', await js(tabA.view.webContents, 'window.__roopieMark'), 42);

    // 二重処理防止ガードの確認: 元ウィンドウ(A)のtabs:drag-endが、
    // 既に移動済みの同じタブIDに対して発火しても「新しいウィンドウ」を余分に作らない
    const windowsBefore = BrowserWindow.getAllWindows().length;
    check('この時点でウィンドウは2枚', windowsBefore, 2);
    check('ガード用フラグが立っている', ctxA.tabConsumedBy, tabA.id);
    await js(
      ctxA.window.webContents,
      `window.roopie.tabDragEnd(${tabA.id}, { belowBar: true, screenX: 100, screenY: 100 })`
    );
    await sleep(400); // ipc.js側の40ms遅延より十分待つ

    check('ガードは使用後クリアされる', ctxA.tabConsumedBy, null);
    check('drag-endが二重に新しいウィンドウを作らない', BrowserWindow.getAllWindows().length, windowsBefore);
    check('Aのタブ数もそのまま', ctxA.tabManager.tabs.length, 1);

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
