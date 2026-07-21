// 起動時のセッション復元で、フォーカスしなかったタブが読み込まれる前から
// URLではなく実際のタイトル・faviconを表示できることの検証(再利用可能)。
// 実行: npx electron scripts/test-restore-title-favicon.js
//
// restoreTabs()で開くタブは実際に選ぶまで読み込まない(不活性化)ため、以前は
// URLのホスト名を仮タイトルにしていた。snapshotTabs()が記録するタイトル/faviconの
// 実データをそのままrestoreTabs()経由でcreateTab()へ渡し、読み込まなくても
// タブバーの見た目がアクティブなタブと揃うようにした。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8955;
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

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        if (req.url === '/favicon.ico') {
          res.writeHead(200, { 'content-type': 'image/x-icon' });
          res.end('x');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>特集記事${req.url}</title><link rel="icon" href="/favicon.ico">本文`);
      })
      .listen(PORT);

    // ---- 1回目の「セッション」: 実際にタブを開いてタイトル/faviconを確定させる ----
    const ctx1 = browser.createWindow();
    const tm1 = ctx1.tabManager;
    for (let i = 0; i < 30 && tm1.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const tabA = tm1.createTab(`http://localhost:${PORT}/a`);
    await Promise.race([new Promise((r) => tabA.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    const tabB = tm1.createTab(`http://localhost:${PORT}/b`);
    await Promise.race([new Promise((r) => tabB.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    tm1.switchTab(tabB.id); // bをアクティブにした状態でスナップショットを取る

    const snapshot = tm1.snapshotTabs();
    const savedA = snapshot.tabs.find((t) => t.url.endsWith('/a'));
    check('スナップショットに実際のタイトルが入る', savedA.title, `特集記事/a`);
    check('スナップショットに実際のfaviconが入る', savedA.favicon, `http://localhost:${PORT}/favicon.ico`);

    // ---- 2回目の「起動」: 保存済みの構成を別ウィンドウで復元する ----
    const ctx2 = browser.createWindow();
    const tm2 = ctx2.tabManager;
    for (let i = 0; i < 30 && tm2.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    tm2.restoreTabs(snapshot.tabs);
    await sleep(300);

    const restoredA = tm2.tabs.find((t) => t.hibernatedUrl?.endsWith('/a') || t.view.webContents.getURL().endsWith('/a'));
    check('復元されたタブは休止中(読み込んでいない)', restoredA.hibernated, true);
    check('URLはまだ空(読み込んでいない証拠)', restoredA.view.webContents.getURL(), '');

    let lastState = null;
    ctx2.window.webContents.send = ((orig) => (channel, payload) => {
      if (channel === 'tabs:state') lastState = payload;
      return orig(channel, payload);
    })(ctx2.window.webContents.send.bind(ctx2.window.webContents));
    tm2.sendState();
    const restoredAState = lastState.tabs.find((t) => t.id === restoredA.id);
    check('読み込まなくてもタイトルはURLではなく実タイトル', restoredAState.title, `特集記事/a`);
    check('読み込まなくてもfaviconが出る', restoredAState.favicon, `http://localhost:${PORT}/favicon.ico`);

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
