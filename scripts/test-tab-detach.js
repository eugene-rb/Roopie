// タブをドラッグして新しいウィンドウへ切り離す挙動の検証(再利用可能)。
// 実行: npx electron scripts/test-tab-detach.js
//
// 以前は dragend の clientY(タブバー下端+40px より下か)で判定していたため、
// ドラッグが速い/ウィンドウの外や上側へ落とすと切り離しが不発だった。
// 現在はメイン側で screen.getCursorScreenPoint() を取り直してスクリーン座標で判定する。
// ここでは判定関数の全ケースと、実際にIPC経由でウィンドウが増えるところまで確認する。
const { app, screen, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-detach-'));
app.setPath('userData', tmp);

const { shouldDetach } = require('../src/main/tab-drag');
const browser = require('../src/main/browser');
const windows = require('../src/main/windows');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 判定関数(副作用なし)----
const BOUNDS = { x: 100, y: 100, width: 1000, height: 800 };
const CHROME = 84;
const at = (x, y, reordered = false) => shouldDetach({ contentBounds: BOUNDS, chromeHeight: CHROME, point: { x, y }, reordered });

console.log('-- 切り離し判定 --');
check('ページ領域(中央)へ落とす → 切り離す', at(600, 500), true);
check('タブバーの上へ落とす → 切り離さない(並べ替えの領域)', at(600, 120), false);
check('ツールバーの上へ落とす → 切り離さない', at(600, 180), false);
check('ウィンドウの下の外へ落とす → 切り離す', at(600, 1200), true);
check('ウィンドウの上の外へ落とす(高いところ) → 切り離す', at(600, 20), true);
check('ウィンドウの左の外へ落とす → 切り離す', at(10, 400), true);
check('ウィンドウの右の外へ落とす → 切り離す', at(1500, 400), true);
check('別モニタ(負の座標)へ落とす → 切り離す', at(-800, 300), true);
check('タブバー内で並べ替え済みなら切り離さない', at(600, 900, true), false);
check('座標が取れないときは切り離さない', shouldDetach({ contentBounds: BOUNDS, chromeHeight: CHROME, point: null }), false);
check('ページ領域の境界ちょうどは切り離さない', at(600, 100 + CHROME), false);
check('境界の1px下は切り離す', at(600, 100 + CHROME + 1), true);

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(1800);

    // 2枚目のタブを開いてから切り離す(最後の1枚は切り離さない仕様)
    const tab = ctx.tabManager.createTab('https://example.com');
    await sleep(1200);
    const before = windows.all().length;
    check('前提: タブが2枚ある', ctx.tabManager.tabs.length >= 2, true);
    // 切り離しでWebContentsが作り直されない(=再読み込みされない)ことを見るための目印
    const movedWcId = tab.view.webContents.id;
    let reloads = 0;
    tab.view.webContents.on('did-start-loading', () => reloads++);
    await tab.view.webContents.executeJavaScript('window.__roopieMark = 42', true).catch(() => {});

    // ページ領域の中央にカーソルがある状態でドラッグ終了 = 切り離し
    const b = ctx.window.getContentBounds();
    const realCursor = screen.getCursorScreenPoint;
    screen.getCursorScreenPoint = () => ({ x: b.x + Math.round(b.width / 2), y: b.y + b.height - 60 });
    const sender = ctx.window.webContents;
    ipcMain.emit('tabs:drag-start', { sender }, tab.id);
    ipcMain.emit('tabs:drag-end', { sender }, tab.id, { reordered: false });
    await sleep(600);
    check('ページ領域へのドロップで新しいウィンドウが開く', windows.all().length, before + 1);
    check('元のウィンドウからタブが減る', ctx.tabManager.getTab(tab.id) ?? null, null);

    const detached = windows.all().find((c) => c !== ctx);
    const size = detached.window.getBounds();
    const origin = ctx.window.getBounds();
    check('切り離し先は元のウィンドウと同じ大きさ', [size.width, size.height], [origin.width, origin.height]);

    // 切り離しはURLで作り直さずWebContentsViewごと引き渡す(再読み込みされない)
    check('切り離し先のタブは同じタブID', !!detached.tabManager.getTab(tab.id), true);
    check('WebContentsが作り直されていない', detached.tabManager.getTab(tab.id)?.view.webContents.id, movedWcId);
    check('切り離しで再読み込みが走らない', reloads, 0);
    check(
      'ページの状態(JSの変数)が残っている',
      await detached.tabManager.getTab(tab.id).view.webContents.executeJavaScript('window.__roopieMark', true).catch(() => null),
      42
    );
    check('切り離し先でアクティブになる', detached.tabManager.activeTabId, tab.id);

    // ウィンドウの外(上側)へ落としても切り離す
    const tab2 = ctx.tabManager.createTab('https://example.org');
    await sleep(1000);
    const before2 = windows.all().length;
    screen.getCursorScreenPoint = () => ({ x: b.x + 200, y: b.y - 150 });
    ipcMain.emit('tabs:drag-start', { sender }, tab2.id);
    ipcMain.emit('tabs:drag-end', { sender }, tab2.id, { reordered: false });
    await sleep(600);
    check('ウィンドウの上の外へのドロップでも新しいウィンドウが開く', windows.all().length, before2 + 1);

    // タブバーの上(=並べ替え領域)へのドロップでは切り離さない
    const tab3 = ctx.tabManager.createTab('https://example.net');
    await sleep(1000);
    const before3 = windows.all().length;
    screen.getCursorScreenPoint = () => ({ x: b.x + 300, y: b.y + 20 });
    ipcMain.emit('tabs:drag-start', { sender }, tab3.id);
    ipcMain.emit('tabs:drag-end', { sender }, tab3.id, { reordered: true });
    await sleep(600);
    check('並べ替えではウィンドウが増えない', windows.all().length, before3);
    check('並べ替えではタブも残る', !!ctx.tabManager.getTab(tab3.id), true);

    // 最後の1枚は切り離さない(空のウィンドウを残さないため)
    for (const t of [...ctx.tabManager.tabs].slice(1)) ctx.tabManager.closeTab(t.id);
    await sleep(500);
    const lastId = ctx.tabManager.tabs[0].id;
    const before4 = windows.all().length;
    screen.getCursorScreenPoint = () => ({ x: b.x + 300, y: b.y + b.height - 60 });
    ipcMain.emit('tabs:drag-start', { sender }, lastId);
    ipcMain.emit('tabs:drag-end', { sender }, lastId, { reordered: false });
    await sleep(600);
    check('最後の1枚は切り離さない', windows.all().length, before4);
    check('最後の1枚はタブも残る', !!ctx.tabManager.getTab(lastId), true);

    screen.getCursorScreenPoint = realCursor;
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
