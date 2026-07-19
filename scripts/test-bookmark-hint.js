// 「Ctrl+D でブックマーク」の案内を出す条件の検証。
// 実行: npx electron scripts/test-bookmark-hint.js
//
// 条件: (1)2回目以降に訪れたページ (2)まだブックマークしていない (3)ページをクリック/
// スクロールしたら消える。実際のTabManagerを本物のウィンドウで動かして確かめる。
const { app, BrowserWindow, session } = require('electron');
const http = require('http');

const PORT = 8936;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><body style="height:3000px">ページ${req.url}`);
    })
    .listen(PORT);

  const TabManager = require('../src/main/tab-manager');
  const History = require('../src/main/history');
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });

  // 履歴は本物(store.data が履歴の配列)。ブックマークは登録済みかどうかだけのスタブ
  const history = new History({ data: [], save: () => {} });
  let bookmarked = new Set();
  const bookmarks = { find: (url) => (bookmarked.has(url) ? { url } : null), toggle: () => {} };
  const tabManager = new TabManager(window, { history, bookmarks, session: session.defaultSession });

  const tab = tabManager.createTab(`http://localhost:${PORT}/a`);
  const wc = tab.view.webContents;
  // 読み込みが来ないまま無言でハングしないよう上限を付ける
  const waitLoad = () =>
    Promise.race([new Promise((resolve) => wc.once('did-finish-load', resolve)), sleep(8000)]).then(() => sleep(250));
  const navigate = async (url) => {
    wc.loadURL(url);
    await waitLoad();
  };

  await waitLoad();
  check('初回訪問では案内を出さない', tab.bookmarkHint, false);
  check('履歴には1件入っている', history.has(`http://localhost:${PORT}/a`), true);

  // 別のページを挟んでから戻る = 2回目の訪問
  await navigate(`http://localhost:${PORT}/b`);
  check('別ページの初回訪問でも出さない', tab.bookmarkHint, false);
  await navigate(`http://localhost:${PORT}/a`);
  check('2回目の訪問では案内を出す', tab.bookmarkHint, true);

  // クリックすると消える
  wc.focus();
  await sleep(120);
  wc.sendInputEvent({ type: 'mouseDown', x: 200, y: 200, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 200, y: 200, button: 'left', clickCount: 1 });
  await sleep(300);
  check('クリックすると案内が消える', tab.bookmarkHint, false);

  // もう一度訪問して、今度はスクロールで消す
  await navigate(`http://localhost:${PORT}/b`);
  await navigate(`http://localhost:${PORT}/a`);
  check('また訪れると再び案内が出る', tab.bookmarkHint, true);
  wc.focus();
  await sleep(120);
  wc.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: -120, canScroll: true });
  await sleep(300);
  check('スクロールしても案内が消える', tab.bookmarkHint, false);

  // ブックマーク済みのページでは出さない
  bookmarked.add(`http://localhost:${PORT}/b`);
  await navigate(`http://localhost:${PORT}/b`);
  check('ブックマーク済みのページでは出さない', tab.bookmarkHint, false);

  // 内部ページ(新しいタブなど)でも出さない
  const internalTab = tabManager.createTab();
  await sleep(600);
  check('内部ページでは出さない', !!internalTab.bookmarkHint, false);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
