// F11(OS全画面)中にタブバー/ツールバーを隠し、マウスが上端に近づいた間だけ
// 表示することの検証(再利用可能)。実行: npx electron scripts/test-fullscreen-chrome.js
//
// 実際のOSカーソル位置は動かせないため、screen.getCursorScreenPoint を差し替えて
// 「上端に近い/離れている」を再現し、ポーリング(80ms間隔)による表示切り替えを確かめる。
const { app, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
async function waitUntil(fn, timeoutMs = 8000, stepMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

app.whenReady().then(async () => {
  const originalGetCursor = screen.getCursorScreenPoint;
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const tab = tm.getTab(tm.activeTabId);
    const normalY = tab.view.getBounds().y;
    check('通常時はツールバーの下に置かれる', normalY > 0, true);
    check('通常時はチェックウォッチが動いていない', tm._fullscreenPollTimer, null);

    // ---- F11(OS全画面)に入る: 最初は隠れた状態(ページが画面いっぱい) ----
    ctx.window.setFullScreen(true);
    const enteredFullscreen = await waitUntil(() => ctx.window.isFullScreen());
    await sleep(200);
    check('全画面に入る', enteredFullscreen, true);
    check('監視ポーリングが始まる', tm._fullscreenPollTimer !== null, true);
    check('入った直後はタブバーが隠れ、ページが画面いっぱいになる', tab.view.getBounds().y, 0);

    // ---- カーソルが上端に近い、と偽装 → 表示される ----
    const bounds = ctx.window.getBounds();
    screen.getCursorScreenPoint = () => ({ x: bounds.x + 10, y: bounds.y + 2 });
    await sleep(250); // ポーリング(80ms)が数回まわるのを待つ
    check('上端にカーソルが近づくとタブバーが再表示される', tm.fullscreenChromeRevealed, true);
    check('表示中はページがツールバー分だけ下がる', tab.view.getBounds().y, tm.chromeHeight);

    // ---- カーソルが十分離れた、と偽装 → また隠れる ----
    screen.getCursorScreenPoint = () => ({ x: bounds.x + 10, y: bounds.y + tm.chromeHeight + 200 });
    await sleep(250);
    check('離れると再び隠れる', tm.fullscreenChromeRevealed, false);
    check('隠れるとページがまた画面いっぱいになる', tab.view.getBounds().y, 0);

    // ---- F11を解除 → 監視も止まり、通常レイアウトに戻る ----
    screen.getCursorScreenPoint = originalGetCursor;
    ctx.window.setFullScreen(false);
    const leftFullscreen = await waitUntil(() => !ctx.window.isFullScreen());
    await sleep(200);
    check('全画面を解除する', leftFullscreen, true);
    check('監視ポーリングが止まる', tm._fullscreenPollTimer, null);
    check('隠したフラグもリセットされる', tm.fullscreenChromeRevealed, false);
    check('解除すると通常レイアウトに戻る', tab.view.getBounds().y, normalY);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    screen.getCursorScreenPoint = originalGetCursor;
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
