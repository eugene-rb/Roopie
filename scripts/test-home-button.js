// 再読み込みボタンの右のホームボタン(スタート画面に戻る)の検証(再利用可能)。
// 実行: npx electron scripts/test-home-button.js
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8956;
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

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 });
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>ページ</title>本文');
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const hasHomeBtn = await js(ctx.window.webContents, `!!document.getElementById('home-btn')`);
    check('ホームボタンが再読み込みボタンの右に存在する', hasHomeBtn, true);
    const order = await js(
      ctx.window.webContents,
      `[...document.getElementById('toolbar').children].map((el) => el.id)`
    );
    const reloadIndex = order.indexOf('reload-btn');
    const homeIndex = order.indexOf('home-btn');
    check('ホームボタンは再読み込みボタンの直後', homeIndex, reloadIndex + 1);

    // 別ページへ移動してから、ホームボタンでスタート画面に戻る
    tm.navigate(`http://localhost:${PORT}/`);
    await Promise.race([new Promise((r) => tm.activeWebContents().once('did-finish-load', r)), sleep(6000)]);
    await sleep(300);
    check('別ページへ移動済み', tm.activeWebContents().getURL().startsWith(`http://localhost:${PORT}`), true);

    await clickSelector(ctx.window.webContents, '#home-btn');
    await Promise.race([new Promise((r) => tm.activeWebContents().once('did-finish-load', r)), sleep(6000)]);
    await sleep(300);
    check('クリックでスタート画面(roopie://newtab)に戻る', tm.activeWebContents().getURL(), 'roopie://newtab/');

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
