// 休止中(まだ読み込んでいない)タブが、同じオリジンの履歴からfaviconを仮表示できることの検証
// (再利用可能)。実行: npx electron scripts/test-dormant-favicon.js
//
// 「タブバーのアイコンが表示できてる時とできてないときがある」という報告を調査した結果、
// バックグラウンドで開いた/復元でフォーカスしなかったタブは実際に選ぶまで読み込まれない
// (今セッションで入れた不活性化)ため favicon が null のまま(文字アイコンで代替)になり、
// アクティブなタブとの見た目の差がそう見えていたことが判明。history.js の直近の履歴から
// 同じオリジンのfaviconを探して仮表示するようにした(実際に読み込まれれば正しいものに置き換わる)。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8954;
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
        res.end(`<!doctype html><meta charset="utf-8"><title>ページ${req.url}</title><link rel="icon" href="/favicon.ico">本文`);
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    // 履歴が無い状態(初回訪問)で裏に開くと、まだ何のfaviconも推測できない
    const firstVisitBg = tm.createTab(`http://localhost:${PORT}/first`, { background: true });
    check('初訪問オリジンの休止タブはfaviconを推測できない', firstVisitBg.favicon, null);

    // 一度そのオリジンを訪れて履歴にfaviconを残す
    const fg = tm.createTab(`http://localhost:${PORT}/visited`);
    await Promise.race([new Promise((r) => fg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    check('訪問済みタブには実際のfaviconが付く', fg.favicon, `http://localhost:${PORT}/favicon.ico`);

    // 同じオリジンの別ページを裏で開くと、休止中でも履歴のfaviconを仮表示する
    const bg = tm.createTab(`http://localhost:${PORT}/another-page`, { background: true });
    check('休止中タブでも同じオリジンなら履歴のfaviconを仮表示する', bg.favicon, `http://localhost:${PORT}/favicon.ico`);
    check('休止中のまま(読み込んではいない)', bg.hibernated, true);

    // 実際に読み込まれても、そのままの値(=正しいfavicon)であり続ける
    tm.switchTab(bg.id);
    await Promise.race([new Promise((r) => bg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    check('切り替えて読み込んだ後もfaviconは正しいまま', bg.favicon, `http://localhost:${PORT}/favicon.ico`);

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
