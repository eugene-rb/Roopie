// ホイールクリック(中クリック)/Ctrl+クリックで開くタブが「裏で」開くことの検証。
// 実行: npx electron scripts/test-background-tab.js
//
// Chromiumはこの操作を setWindowOpenHandler に disposition='background-tab' として渡す。
// 実際のTabManagerを本物のBrowserWindowで動かし、リンクを中クリックして
// アクティブタブが変わらないこと(=見ているページから離れないこと)を確かめる。
const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const path = require('path');

const PORT = 8935;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>リンク元</title>
<a id="link" href="http://localhost:${PORT}/other" style="position:absolute;left:20px;top:20px">リンク</a>`;

// 実クリックでdispositionを出させる(合成イベントではChromiumがユーザー操作と見なさない)。
// クリック前にフォーカスを与えないと、ウィンドウが背面のときに入力が届かないことがある
async function clickLink(wc, button) {
  wc.focus();
  await sleep(120);
  const rect = await wc.executeJavaScript(
    `(() => { const r = document.getElementById('link').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
  );
  const base = { x: rect.x, y: rect.y, button, clickCount: 1 };
  wc.sendInputEvent({ ...base, type: 'mouseDown' });
  wc.sendInputEvent({ ...base, type: 'mouseUp' });
}

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(req.url === '/other' ? '<!doctype html><meta charset="utf-8"><title>リンク先</title>別のページ' : PAGE);
    })
    .listen(PORT);

  const TabManager = require('../src/main/tab-manager');
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });
  // TabManagerは履歴・ブックマークを直接触るので最小限のスタブを渡す
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, existsAnywhere: () => false, toggle: () => {} };
  const tabManager = new TabManager(window, { history, bookmarks, session: session.defaultSession });

  const first = tabManager.createTab(`http://localhost:${PORT}/`);
  // 読み込みが来ないまま無言でハングしないよう上限を付ける
  await Promise.race([
    new Promise((resolve) => first.view.webContents.once('did-finish-load', resolve)),
    sleep(8000),
  ]);
  check('リンク元のページが読み込まれる', first.view.webContents.getURL(), `http://localhost:${PORT}/`);
  await sleep(200);
  check('最初のタブがアクティブ', tabManager.activeTabId, first.id);

  // ホイールクリック(中クリック)→ 裏で開く
  await clickLink(first.view.webContents, 'middle');
  await sleep(600);
  check('ホイールクリックでタブが増える', tabManager.tabs.length, 2);
  check('ホイールクリックではアクティブタブが変わらない(裏で開く)', tabManager.activeTabId, first.id);
  const opened = tabManager.tabs[1];
  if (!opened) {
    console.log('中クリックでタブが開かなかったため以降を中止');
    server.close();
    app.exit(1);
    return;
  }
  check('裏で開いたタブは非表示', opened.view.getVisible(), false);
  // 大きさが 0x0 のままだと、幅0のビューポートで読み込まれてレイアウトが崩れる
  const openedBounds = opened.view.getBounds();
  check('裏で開いたタブにもページと同じ大きさが与えられる', openedBounds.width > 100 && openedBounds.height > 100, true);
  // 裏で開いたタブは、実際にそのタブへ移るまで読み込まない(不活性化)
  check('裏で開いた直後はまだ読み込まない', opened.view.webContents.getURL(), '');
  check('休止扱いになっている', opened.hibernated, true);
  check('復元用のURLを覚えている', opened.hibernatedUrl.endsWith('/other'), true);

  // 通常の左クリック+target=_blank相当(スクリプトのwindow.open)→ 手前で開く
  await first.view.webContents.executeJavaScript(`window.open('http://localhost:${PORT}/other', '_blank')`, true);
  await sleep(600);
  check('window.openで開いたタブは手前に来る', tabManager.activeTabId, tabManager.tabs[2].id);

  // 裏のタブへは手動で切り替えられる → その時点で初めて読み込まれる
  tabManager.switchTab(opened.id);
  await Promise.race([new Promise((r) => opened.view.webContents.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);
  check('裏のタブへ切り替えられる', tabManager.activeTabId, opened.id);
  check('切り替えたタブが表示される', opened.view.getVisible(), true);
  check('切り替えを機にURLが読み込まれる', opened.view.webContents.getURL().endsWith('/other'), true);
  check('休止フラグも解除される', opened.hibernated, false);
  // 表に出したらページ側のビューポートも正しい大きさになっている
  const viewport = await Promise.race([
    opened.view.webContents.executeJavaScript('[window.innerWidth, window.innerHeight]', true),
    sleep(4000).then(() => [0, 0]),
  ]);
  check('表に出したタブのビューポートが0でない', viewport[0] > 100 && viewport[1] > 100, true);

  // ---- 休止中タブの仮タイトル(このハーネスはchrome UIのHTMLを読み込んでいないため、
  //      DOMではなくtabs:stateの送信内容そのものを見る) ----
  let lastState = null;
  const originalSend = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, payload) => {
    if (channel === 'tabs:state') lastState = payload;
    return originalSend(channel, payload);
  };
  const dormant = tabManager.createTab(`http://localhost:${PORT}/other`, { background: true });
  await sleep(300);
  const dormantState = lastState?.tabs.find((t) => t.id === dormant.id);
  check('休止中タブはホスト名を仮タイトルに使う', dormantState?.title, 'localhost');
  window.webContents.send = originalSend;

  // ---- 内部ページは裏で開いても休止させない ----
  const internalBg = tabManager.createTab('roopie://newtab', { background: true });
  await sleep(300);
  check('内部ページは裏で開いても休止しない', internalBg.hibernated, false);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
