// セッション復元(前回のタブ構成を復元)で、フォーカスしなかったタブが勝手に音を出さないことの検証(再利用可能)。
// 実行: npx electron scripts/test-restore-autoplay.js
//
// restoreTabs()はフォーカスするタブ以外を background:true で開くため、それらは
// **選ぶまでそもそも読み込まれない**(hibernated)= 見ていないタブから音が出ることはない。
// 選んだ後はユーザーが見ているタブなので、Chrome同様そのまま再生させる
// (2026-07-25まではここでも一時停止していたが、自分で開いたタブが1秒鳴ってから止まるのは
//  かえって不自然なので廃止した。裏タブの保護は「読み込まない」ことだけで足りる)。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8952;
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
const js = (wc, code) => wc.executeJavaScript(code, false);

// YouTubeなど実サイトと同じ「ページ自身のスクリプトが読み込み時にplay()を呼ぶ」形を再現する
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const AUTOPLAY_PAGE = (label) => `<!doctype html><meta charset="utf-8"><title>ページ${label}</title>
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>document.getElementById('a').play().catch(() => {});</script>`;

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(AUTOPLAY_PAGE(req.url));
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

    // アクティブにしたタブ(b)は普通に読み込まれ、自動再生もそのまま通る
    await Promise.race([new Promise((r) => tabB.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    check('アクティブなタブは休止扱いにならない', tabB.hibernated, false);
    check('アクティブなタブは自動再生できる', await js(tabB.view.webContents, `!document.getElementById('a').paused`), true);

    // フォーカスしなかったタブ(a, c)は不活性化されたまま(まだ読み込まれてすらいない)。
    // 読み込まれていない = 音が出ようがないので、これが裏タブの保護そのもの
    check('非アクティブのタブ(a)は休止中', tabA.hibernated, true);
    check('非アクティブのタブ(c)は休止中', tabC.hibernated, true);
    check('非アクティブのタブ(a)はURLも空のまま', tabA.view.webContents.getURL(), '');
    check('非アクティブのタブ(c)はURLも空のまま', tabC.view.webContents.getURL(), '');

    // 後からタブaへ切り替える → ここで初めて読み込まれ、以後は普通のタブとして再生できる
    tm.switchTab(tabA.id);
    await Promise.race([new Promise((r) => tabA.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    check('切り替えると読み込まれる', tabA.hibernated, false);
    check('切り替えた後は普通に再生できる', await js(tabA.view.webContents, `!document.getElementById('a').paused`), true);
    check('ミュートはされていない', tabA.view.webContents.isAudioMuted(), false);

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
