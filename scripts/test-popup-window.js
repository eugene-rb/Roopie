// Googleログインのような「サイズ指定付きの window.open」がポップアップウィンドウで開くことの検証。
// 実行: npx electron scripts/test-popup-window.js
//
// タブとして開き直すと window.opener / window.close() が切れて認証が終わらないため、
// ・window(BrowserWindow)が増えてタブは増えないこと
// ・開いた側と同じセッション(=ログイン中のCookie)であること
// ・opener へ postMessage が返り、ポップアップが自分で閉じられること
// ・features 無しの window.open / target=_blank は従来どおりタブのままであること
// を確かめる。
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// 実ユーザーのプロファイル(キャッシュ)を触らないよう、使い捨てのuserDataで動かす
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-popup-')));

// browser.js はready前にrequireする(protocol.registerSchemesAsPrivilegedのため)
const browser = require('../src/main/browser');
const windows = require('../src/main/windows');
const { registerIpc } = require('../src/main/ipc');
const popupWindow = require('../src/main/popup-window');
const TabManager = require('../src/main/tab-manager');

const PORT = 8937;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPENER = `<!doctype html><meta charset="utf-8"><title>元</title>
<script>window.addEventListener('message', (e) => { document.title = 'GOT:' + e.data; });</script>`;
// 認証ページ相当: openerへ結果を返して自分で閉じる
const CLOSER = `<!doctype html><meta charset="utf-8"><title>認証</title>
<script>window.opener.postMessage('token', '*'); setTimeout(() => window.close(), 200);</script>`;
// 開きっぱなしのポップアップ(大きさ・セッション・中のリンクを見る用)
const STAY = `<!doctype html><meta charset="utf-8"><title>そのまま</title>
<a id="link" href="http://localhost:${PORT}/other" target="_blank">リンク</a>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url === '/close') res.end(CLOSER);
      else if (req.url === '/stay') res.end(STAY);
      else if (req.url === '/other') res.end('<!doctype html><meta charset="utf-8"><title>先</title>先');
      else res.end(OPENER);
    })
    .listen(PORT);

  const main = new BrowserWindow({ show: true, width: 900, height: 700 });
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, existsAnywhere: () => false, toggle: () => {} };
  const tabManager = new TabManager(main, { history, bookmarks, session: session.defaultSession });
  const popups = () => BrowserWindow.getAllWindows().filter((w) => w !== main && !w.isDestroyed());

  // ---- 判定そのもの(Shift+クリックはdispositionが同じ'new-window'でもfeaturesが空) ----
  check('サイズ指定付きはポップアップ', popupWindow.isPopupRequest({ disposition: 'new-window', features: 'width=500,height=600' }), true);
  check('popup=yes はポップアップ', popupWindow.isPopupRequest({ disposition: 'new-window', features: 'popup=yes' }), true);
  check('features無し(Shift+クリック)はポップアップにしない', popupWindow.isPopupRequest({ disposition: 'new-window', features: '' }), false);
  check('通常のタブはポップアップにしない', popupWindow.isPopupRequest({ disposition: 'foreground-tab', features: '' }), false);

  const tab = tabManager.createTab(`http://localhost:${PORT}/`);
  const wc = tab.view.webContents;
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  check('リンク元のページが読み込まれる', wc.getURL(), `http://localhost:${PORT}/`);

  // ---- サイズ指定付き window.open → ポップアップウィンドウ ----
  await wc.executeJavaScript(`window.open('http://localhost:${PORT}/stay', 'oauth', 'width=500,height=600,left=120,top=80'), 0`, true);
  await sleep(800);
  check('ポップアップウィンドウが1枚開く', popups().length, 1);
  check('タブは増えない', tabManager.tabs.length, 1);
  const popup = popups()[0];
  if (!popup) {
    server.close();
    console.log('ポップアップが開かなかったため以降を中止');
    app.exit(1);
    return;
  }
  check('開いた側と同じセッション(ログイン状態が渡る)', popup.webContents.session === session.defaultSession, true);
  check('window.opener が生きている', await popup.webContents.executeJavaScript('!!window.opener', true), true);
  check('内部preloadを持たない', await popup.webContents.executeJavaScript('typeof window.roopie', true), 'undefined');
  const size = await popup.webContents.executeJavaScript('[innerWidth, innerHeight]', true);
  check('features のサイズが中身の大きさになる', size, [500, 600]);
  const pos = popup.getPosition();
  check('features の位置が使われる', pos, [120, 80]);

  // ポップアップの中のリンクは親ウィンドウのタブで開く
  await popup.webContents.executeJavaScript(`document.getElementById('link').click(), 0`, true);
  await sleep(600);
  check('ポップアップ内のリンクは親のタブで開く', tabManager.tabs.length, 2);
  check('ポップアップは増えない', popups().length, 1);
  popup.close();
  await sleep(300);

  // ---- opener への往復と自分で閉じること(認証の本番と同じ流れ) ----
  await wc.executeJavaScript(`window.open('http://localhost:${PORT}/close', 'oauth2', 'width=480,height=640'), 0`, true);
  await sleep(1200);
  check('openerへpostMessageが返る', await wc.executeJavaScript('document.title', true), 'GOT:token');
  check('ポップアップは自分で閉じられる', popups().length, 0);

  // ---- features無しは従来どおりタブ ----
  const before = tabManager.tabs.length;
  await wc.executeJavaScript(`window.open('http://localhost:${PORT}/other', '_blank'), 0`, true);
  await sleep(600);
  check('features無しのwindow.openはタブで開く', tabManager.tabs.length, before + 1);
  check('ウィンドウは増えない', popups().length, 0);

  // ---- 実際のブラウザウィンドウ(chrome UI・プロファイル付き)でも同じように開く ----
  registerIpc();
  browser.initData();
  const ctx = browser.createWindow({ url: `http://localhost:${PORT}/` });
  for (let i = 0; i < 40 && ctx.tabManager.activeTabId === null; i++) await sleep(200);
  const realTab = ctx.tabManager.getTab(ctx.tabManager.activeTabId);
  const realWc = realTab.view.webContents;
  if (!realWc.getURL()) await Promise.race([new Promise((r) => realWc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);

  const others = () => BrowserWindow.getAllWindows().filter((w) => w !== main && w !== ctx.window && !w.isDestroyed());
  await realWc.executeJavaScript(`window.open('http://localhost:${PORT}/stay', 'oauth3', 'width=420,height=520'), 0`, true);
  await sleep(900);
  check('実ウィンドウからもポップアップが開く', others().length, 1);
  check('実ウィンドウのタブは増えない', ctx.tabManager.tabs.length, 1);
  const realPopup = others()[0];
  if (realPopup) {
    check('ウィンドウのプロファイルのセッションを使う', realPopup.webContents.session === ctx.session, true);
    check('右クリックが開いた側のウィンドウを引ける', windows.contextFor(realPopup.webContents) === ctx, true);
    check('アプリメニューは出さない', realPopup.isMenuBarVisible(), false);

    // 開いた側のタブを閉じてもポップアップは残る(Chrome/Edgeと同じ)
    ctx.tabManager.createTab(`http://localhost:${PORT}/other`);
    await sleep(300);
    ctx.tabManager.closeTab(realTab.id);
    await sleep(600);
    check('開いた側のタブを閉じてもポップアップは残る', others().length, 1);
    realPopup.close();
    await sleep(300);
  }

  // ---- シークレットウィンドウのポップアップは、親ウィンドウと一緒に閉じる ----
  // (最後のシークレットウィンドウが閉じるとセッションが消されるため、残してはいけない)
  const priv = browser.createWindow({ incognito: true, url: `http://localhost:${PORT}/` });
  for (let i = 0; i < 40 && priv.tabManager.activeTabId === null; i++) await sleep(200);
  const privWc = priv.tabManager.getTab(priv.tabManager.activeTabId).view.webContents;
  if (!privWc.getURL()) await Promise.race([new Promise((r) => privWc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);
  const privPopups = () =>
    BrowserWindow.getAllWindows().filter((w) => w !== main && w !== ctx.window && w !== priv.window && !w.isDestroyed());
  await privWc.executeJavaScript(`window.open('http://localhost:${PORT}/stay', 'p', 'width=420,height=520'), 0`, true);
  await sleep(900);
  check('シークレットからもポップアップが開く', privPopups().length, 1);
  check('シークレットのセッションを使う', privPopups()[0]?.webContents.session === priv.session, true);
  priv.window.close();
  await sleep(800);
  check('シークレットウィンドウを閉じるとポップアップも閉じる', privPopups().length, 0);

  // ---- 実物のGoogleログイン画面(--online のときだけ。ネットワークが要る) ----
  if (process.argv.includes('--online')) {
    const tabWc = ctx.tabManager.getTab(ctx.tabManager.activeTabId).view.webContents;
    await tabWc.executeJavaScript(
      `window.open('https://accounts.google.com/', 'google', 'width=500,height=620'), 0`,
      true
    );
    await sleep(6000);
    const online = others()[0];
    check('accounts.google.comがポップアップで開く', !!online, true);
    if (online) {
      const info = await online.webContents.executeJavaScript('[location.host, document.title]', true);
      console.log(`    ポップアップの中身: ${JSON.stringify(info)}`);
      check('ポップアップがGoogleのページを表示している', info[0].endsWith('google.com'), true);
      online.close();
      await sleep(300);
    }
  }

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
