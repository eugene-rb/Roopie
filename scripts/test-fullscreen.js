// ページ側の全画面(YouTube等の全画面ボタン)の検証(再利用可能)。
// 実行: npx electron scripts/test-fullscreen.js
//
// 許可した有名サイトだけを全画面にし、それ以外はすぐ解除する。全画面中はページが
// ウィンドウ一杯に広がる(ツールバー・タブバー・余白が消える)ことを確かめる。
const { app, BrowserWindow, session } = require('electron');
const http = require('http');

const PORT = 8940;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ページ側のPromiseが返らないことがある(全画面要求が保留のまま等)ので上限を付ける
const withTimeout = (promise, ms, fallback) => Promise.race([promise.catch((e) => String(e)), sleep(ms).then(() => fallback)]);

const PAGE = `<!doctype html><meta charset="utf-8"><title>全画面テスト</title>
<div id="box" style="width:200px;height:150px;background:#333"></div>
<script>
  window.goFullscreen = () => document.getElementById('box').requestFullscreen().then(() => 'ok', (e) => String(e));
  window.isFullscreen = () => !!document.fullscreenElement;
</script>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    })
    .listen(PORT);

  const TabManager = require('../src/main/tab-manager');
  // 実アプリ(browser.js)と同じく、全画面の許可ポリシーをセッションに適用する
  TabManager.applyFullscreenPolicy(session.defaultSession);
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, toggle: () => {} };
  const tabManager = new TabManager(window, { history, bookmarks, session: session.defaultSession });
  tabManager.chromeHeight = 84;

  const tab = tabManager.createTab(`http://localhost:${PORT}/`);
  const wc = tab.view.webContents;
  if (process.env.FS_DEBUG) {
    for (const ev of ['enter-html-full-screen', 'leave-html-full-screen']) wc.on(ev, () => console.log('[debug] wc event:', ev));
    for (const ev of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen']) window.on(ev, () => console.log('[debug] win event:', ev));
  }
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(400);

  const bounds = () => tab.view.getBounds();
  const normal = bounds();
  check('通常時はツールバーの下に置かれる', normal.y > 0, true);

  // 1) 許可していないサイト(localhost)からの全画面はすぐ解除される
  const r1 = await withTimeout(wc.executeJavaScript(`window.goFullscreen()`, true), 3000, '(応答なし)');
  check('許可していないサイトの全画面要求は拒否される', r1 !== 'ok', true);
  await sleep(1500);
  check('許可していないサイトでは全画面にしない', tabManager.htmlFullscreenTabId, null);
  check('許可していないサイトではページの位置も変わらない', bounds().y, normal.y);
  console.log('  (全画面要求の結果:', r1, ')');
  check('ページ側の全画面状態も解除される', await withTimeout(wc.executeJavaScript(`window.isFullscreen()`, true), 3000, '(応答なし)'), false);
  check('ウィンドウも全画面のまま残らない', window.isFullScreen(), false);

  // 2) 許可リストのサイトなら全画面にする。実際のYouTubeへ接続する代わりに、
  //    検証用のホストを許可リストへ足して本物の経路をそのまま通す。
  //    Chromiumは一度出した許可/拒否の判断をオリジン単位で覚えるため、別オリジン(127.0.0.1)を使う
  TabManager.FULLSCREEN_ALLOWLIST.push('127.0.0.1');
  wc.loadURL(`http://127.0.0.1:${PORT}/`);
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(400);
  const allowed = await withTimeout(wc.executeJavaScript(`window.goFullscreen()`, true), 3000, '(応答なし)');
  check('許可したサイトの全画面要求は通る', allowed, 'ok');
  await sleep(1500);
  check('許可したサイトなら全画面になる', tabManager.htmlFullscreenTabId, tab.id);
  // 全画面への遷移が終わってから比べる(遷移中はウィンドウの大きさが変わり続ける)
  await sleep(1200);
  tabManager.layout();
  const full = bounds();
  const [winW, winH] = window.getContentSize();
  check('全画面中はページがウィンドウ一杯になる', { x: full.x, y: full.y, w: full.width, h: full.height }, { x: 0, y: 0, w: winW, h: winH });

  // Escで戻る(ページ側のfullscreenchangeを経由して解除される)
  await withTimeout(wc.executeJavaScript(`document.exitFullscreen()`, true), 3000, '(応答なし)');
  await sleep(1500);
  check('解除すると元のレイアウトに戻る', tabManager.htmlFullscreenTabId, null);
  check('ページの位置も元に戻る', bounds().y, normal.y);
  TabManager.FULLSCREEN_ALLOWLIST.pop();

  // 3) ホスト名の判定(偽装ドメインを弾く)
  const { isFullscreenAllowed } = require('../src/main/tab-manager');
  // 3) ホスト名の判定
  check('youtube.comは許可', isFullscreenAllowed('https://www.youtube.com/watch?v=1'), true);
  check('サブドメインも許可', isFullscreenAllowed('https://music.youtube.com/'), true);
  check('似せた別ドメインは拒否', isFullscreenAllowed('https://evil-youtube.com/'), false);
  check('末尾に付けただけのドメインも拒否', isFullscreenAllowed('https://youtube.com.evil.net/'), false);
  check('知らないサイトは拒否', isFullscreenAllowed('https://example.com/'), false);
  check('URLでない文字列は拒否', isFullscreenAllowed('よくわからない'), false);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
