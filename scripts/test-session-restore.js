// 「起動時に前回のタブを復元する」の検証(再利用可能)。
// 実行: npx electron scripts/test-session-restore.js
//
// 終了時のタブ構成の保存(browser.saveAllSessions)と、起動時の復元
// (browser.openStartupWindows)を、実際のウィンドウ・タブで確かめる。
// 設定がOFFなら復元せず、ONなら複数ウィンドウ分も復元することを見る。
const { app } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
// browser.js は app ready より前に protocol.registerSchemesAsPrivileged を呼ぶ
const browser = require('../src/main/browser');
const windows = require('../src/main/windows');

const PORT = 8942;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 実ユーザーのデータを触らないよう、使い捨てのuserDataで動かす
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-session-test-'));
app.setPath('userData', tempUserData);

const url = (p) => `http://localhost:${PORT}${p}`;

// ウィンドウのタブURL一覧(内部ページは 'roopie' とだけ表す)
function tabUrlsOf(ctx) {
  return ctx.tabManager.tabs.map((t) => {
    const u = t.view.webContents.getURL();
    return u.startsWith('roopie://') ? 'roopie' : u;
  });
}

async function openTabs(ctx, paths) {
  for (const p of paths) {
    const tab = ctx.tabManager.createTab(url(p));
    await Promise.race([new Promise((r) => tab.view.webContents.once('did-finish-load', r)), sleep(6000)]);
  }
}

function closeAllWindows() {
  for (const ctx of [...windows.all()]) ctx.window.destroy();
}

// 全ウィンドウを閉じるとElectronの既定でアプリが終了してしまうので、検証中は止める
app.on('window-all-closed', () => {});

process.on('uncaughtException', (e) => { console.log('[例外]', e && e.stack ? e.stack.slice(0, 600) : String(e)); app.exit(1); });
process.on('unhandledRejection', (e) => { console.log('[未処理のreject]', e && e.stack ? e.stack.slice(0, 600) : String(e)); });

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>ページ${req.url}</title>本文`);
    })
    .listen(PORT);

  browser.initData();
  const profile = browser.profiles.active();
  const settings = browser.bundleFor(profile.id).settings;

  // ---- 1. 既定はOFF(これまでの挙動を変えない) ----
  check('既定では復元しない', browser.DEFAULT_SETTINGS.restoreTabsOnStart, false);

  // ---- 2. OFFのまま終了 → 起動しても復元しない ----
  settings.data.restoreTabsOnStart = false;
  const first = browser.createWindow();
  await sleep(1200);
  await openTabs(first, ['/a', '/b']);
  check('タブを開いた(新しいタブ+2枚)', first.tabManager.tabs.length, 3);

  browser.saveAllSessions();
  closeAllWindows();
  await sleep(600);

  const restoredCount0 = browser.openStartupWindows({});
  await sleep(1500);
  check('OFFなら復元しない', restoredCount0, 0);
  check('新しいウィンドウは1枚', windows.normal().length, 1);
  check('タブは新しいタブ1枚だけ', tabUrlsOf(windows.normal()[0]), ['roopie']);
  closeAllWindows();
  await sleep(600);

  // ---- 3. ONにして終了 → 起動時に復元する ----
  settings.data.restoreTabsOnStart = true;
  const w1 = browser.createWindow();
  await sleep(1200);
  await openTabs(w1, ['/x', '/y']);
  // 2枚目のウィンドウも開いておく(複数ウィンドウが復元されるか)
  const w2 = browser.createWindow();
  await sleep(1200);
  await openTabs(w2, ['/z']);
  check('2枚目のウィンドウを開いた', windows.normal().length, 2);

  browser.saveAllSessions();
  closeAllWindows();
  await sleep(800);

  const restoredCount = browser.openStartupWindows({});
  await sleep(2500);
  check('ONなら前回のウィンドウ数だけ復元する', restoredCount, 2);
  check('復元後のウィンドウ数', windows.normal().length, 2);

  const all = windows.normal().map((ctx) => tabUrlsOf(ctx));
  check(
    '1枚目のタブが復元される',
    all.some((urls) => urls.includes(url('/x')) && urls.includes(url('/y'))),
    true
  );
  check(
    '2枚目のタブが復元される',
    all.some((urls) => urls.includes(url('/z'))),
    true
  );
  closeAllWindows();
  await sleep(600);

  // ---- 4. 復元と同時にイントロ/変更点のページも開く ----
  const restoredWithIntro = browser.openStartupWindows({ url: 'roopie://welcome' });
  await sleep(2500);
  check('復元しつつイントロも開く', restoredWithIntro, 2);
  const introWindow = windows.normal()[0];
  const introUrls = introWindow.tabManager.tabs.map((t) => t.view.webContents.getURL());
  check(
    '1枚目に復元タブとイントロが両方ある',
    introUrls.some((u) => u.startsWith('roopie://welcome')) && introUrls.some((u) => u.includes('/x')),
    true
  );
  check(
    'イントロが前面(最後に開いたタブがアクティブ)',
    introWindow.tabManager.getTab(introWindow.tabManager.activeTabId)?.view.webContents.getURL().startsWith('roopie://welcome'),
    true
  );
  closeAllWindows();
  await sleep(600);

  // ---- 5. シークレットウィンドウは保存しない ----
  settings.data.restoreTabsOnStart = true;
  const normalWin = browser.createWindow();
  await sleep(1200);
  await openTabs(normalWin, ['/keep']);
  const incognitoWin = browser.createWindow({ incognito: true });
  await sleep(1200);
  await openTabs(incognitoWin, ['/secret']);

  browser.saveAllSessions();
  closeAllWindows();
  await sleep(800);

  browser.openStartupWindows({});
  await sleep(2000);
  const restoredUrls = windows.normal().flatMap((ctx) => tabUrlsOf(ctx));
  check('通常ウィンドウのタブは復元される', restoredUrls.includes(url('/keep')), true);
  check('シークレットのタブは復元されない', restoredUrls.includes(url('/secret')), false);
  closeAllWindows();
  await sleep(500);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
