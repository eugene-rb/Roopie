// ページ側の全画面(YouTube等の全画面ボタン)の検証(再利用可能)。
// 実行: npx electron scripts/test-fullscreen.js
//
// 全画面はサイトごとの許可制。許可済みのサイトだけを全画面にし、それ以外はすぐ解除する。
// 全画面中はページがウィンドウ一杯に広がる(ツールバー・タブバー・余白が消える)ことを確かめる。
// 確認バーを出す経路そのものは scripts/test-fullscreen-permission.js で検証する。
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
// 全画面の遷移はGPU・OS任せで待ち時間が読めないため、固定待ちではなく条件が満たされるまで待つ
async function waitUntil(fn, ms = 8000) {
  const until = ms / 100;
  for (let i = 0; i < until; i++) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
}

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
  // 実アプリ(browser.js)と同じく、権限のポリシーをセッションに適用する。
  // 実アプリでは未許可のサイトに確認ポップアップを出すところを、検証では allowedHosts で答える
  const allowedHosts = new Set();
  TabManager.applyPermissionPolicy(session.defaultSession, (_wc, permission, details) => {
    if (permission !== 'fullscreen') return true;
    try {
      return allowedHosts.has(new URL(details?.requestingUrl || '').hostname);
    } catch {
      return false;
    }
  });
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, existsAnywhere: () => false, toggle: () => {} };
  const tabManager = new TabManager(window, {
    history,
    bookmarks,
    session: session.defaultSession,
    // 権限を通らずに全画面へ入る経路があったときの保険。実アプリと同じ判定を渡す
    isFullscreenGranted: (url) => {
      try {
        return allowedHosts.has(new URL(url).hostname);
      } catch {
        return false;
      }
    },
  });
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
  //    拒否されたページと許可されたページを混ぜないよう、タブを分ける。
  //
  //    【既知】この環境(chrome UIを持たない素のBrowserWindow)では、全画面へは入るのに
  //    ページ側の requestFullscreen() の Promise が解決せず、document.exitFullscreen() も
  //    効かない。そのため下の4項目は落ちる。**変更前(HEAD)から同じ**で、
  //    許可制への変更とは無関係(worktreeで基準を取って確認済み)。
  //    許可の同期/非同期・遅延の有無・先に拒否したかどうかを変えても再現する。
  //    実アプリのウィンドウを使う scripts/test-fullscreen-permission.js では
  //    ページからの要求→全画面まで通り、タブ切り替えでの解除(下の3)も効いている
  allowedHosts.add('127.0.0.1');
  const allowedTab = tabManager.createTab(`http://127.0.0.1:${PORT}/`);
  const allowedWc = allowedTab.view.webContents;
  await Promise.race([new Promise((r) => allowedWc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(400);
  const allowed = await withTimeout(allowedWc.executeJavaScript(`window.goFullscreen()`, true), 10000, '(応答なし)');
  check('許可したサイトの全画面要求は通る', allowed, 'ok');
  await waitUntil(() => tabManager.htmlFullscreenTabId === allowedTab.id);
  check('許可したサイトなら全画面になる', tabManager.htmlFullscreenTabId, allowedTab.id);
  // 全画面への遷移が終わってから比べる(遷移中はウィンドウの大きさが変わり続ける)
  await sleep(1200);
  tabManager.layout();
  const full = allowedTab.view.getBounds();
  const [winW, winH] = window.getContentSize();
  check('全画面中はページがウィンドウ一杯になる', { x: full.x, y: full.y, w: full.width, h: full.height }, { x: 0, y: 0, w: winW, h: winH });

  // Escで戻る(ページ側のfullscreenchangeを経由して解除される)
  await withTimeout(allowedWc.executeJavaScript(`document.exitFullscreen()`, true), 10000, '(応答なし)');
  await waitUntil(() => tabManager.htmlFullscreenTabId === null);
  await sleep(300); // レイアウトの反映まで一拍待つ
  check('解除すると元のレイアウトに戻る', tabManager.htmlFullscreenTabId, null);
  check('ページの位置も元に戻る', allowedTab.view.getBounds().y, normal.y);

  // 3) 全画面中にタブを切り替えたら全画面を抜ける
  //    (抜けないと、UIが消えたまま別のタブが全画面で表示され戻る手段が無くなる)
  const other = tabManager.createTab(`http://127.0.0.1:${PORT}/`);
  await Promise.race([new Promise((r) => other.view.webContents.once('did-finish-load', r)), sleep(6000)]);
  tabManager.switchTab(allowedTab.id);
  await sleep(400);
  await withTimeout(allowedWc.executeJavaScript(`window.goFullscreen()`, true), 10000, '(応答なし)');
  await waitUntil(() => tabManager.htmlFullscreenTabId === allowedTab.id);
  check('(前提)全画面に入っている', tabManager.htmlFullscreenTabId, allowedTab.id);
  tabManager.switchTab(other.id);
  await sleep(1200);
  check('タブを切り替えると全画面を抜ける', tabManager.htmlFullscreenTabId, null);
  check('切り替え先のタブはツールバーの下に置かれる', other.view.getBounds().y > 0, true);
  tabManager.closeTab(other.id);
  await sleep(300);
  allowedHosts.delete('127.0.0.1');

  // 4) 許可済みホストの判定(偽装ドメインを弾く)。許可はホスト名の完全一致で覚える
  const { isGranted, hostFor, addHost, normalizeHosts } = require('../src/main/site-permissions');
  const granted = { fullscreen: ['youtube.com'] };
  check('許可したホストは通る', isGranted(granted, 'fullscreen', 'https://youtube.com/watch?v=1'), true);
  check('種類が違えば通らない', isGranted(granted, 'camera', 'https://youtube.com/'), false);
  check('サブドメインは別サイト扱い(改めて尋ねる)', isGranted(granted, 'fullscreen', 'https://music.youtube.com/'), false);
  check('似せた別ドメインは拒否', isGranted(granted, 'fullscreen', 'https://evil-youtube.com/'), false);
  check('末尾に付けただけのドメインも拒否', isGranted(granted, 'fullscreen', 'https://youtube.com.evil.net/'), false);
  check('許可していないサイトは拒否', isGranted(granted, 'fullscreen', 'https://example.com/'), false);
  check('URLでない文字列は拒否', isGranted(granted, 'fullscreen', 'よくわからない'), false);
  check('http/https以外は尋ねずに拒否', hostFor('file:///C:/a.html'), null);
  check('内部ページも対象外', hostFor('roopie://newtab'), null);
  check('大文字のホストは小文字で扱う', hostFor('https://WWW.Example.COM/x'), 'www.example.com');
  check('同じホストを重複して覚えない', addHost(['a.com', 'b.com'], 'a.com'), ['b.com', 'a.com']);
  check('設定として来た変な値は落とす', normalizeHosts(['A.com', 5, '', null, 'a.com']), ['a.com']);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
