// タブをウィンドウ間で移しても「新しいタブに化けない」「再読み込みされない(再生が続く)」ことの検証。
// 実行: npx electron scripts/test-tab-move-live.js
//
// 以前はURLだけ引き継いで元を閉じ・移動先で開き直していたため、
//   (1) まだ読み込んでいないタブ(裏で開いた/セッション復元した休止中のタブ)は
//       getURL() が空のまま渡り、移動先で「新しいタブ」に化けた
//   (2) 必ず再読み込みになるので、YouTube等の再生が止まった
// 現在は WebContentsView ごとウィンドウを載せ替える(webContents は生き続ける)。
const { app, screen, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8943;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-move-live-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const windows = require('../src/main/windows');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

async function waitForActive(tm, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (tm.activeTabId !== null) return;
    await sleep(200);
  }
}
const waitLoad = (wc, ms = 6000) => Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(ms)]);

// 読み込み完了イベントを取り逃しても待てるように、URLが入るまでポーリングする
async function waitUrl(getWc, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = getWc()?.getURL();
    if (url) return url;
    await sleep(150);
  }
  return getWc()?.getURL() ?? '';
}

// 再生し続けるページ。canvasのストリームを<video>で流す
// (自動再生ポリシーの影響を受けずに「再生中のvideo要素」を作れる。currentTimeが進み続ける)
const PLAYER_PAGE = `<!doctype html><meta charset="utf-8"><title>再生ページ</title><body>再生中
<canvas id="c" width="32" height="32"></canvas><video id="v" muted playsinline></video>
<script>
  window.__t0 = performance.now();
  const g = document.getElementById('c').getContext('2d');
  let n = 0;
  setInterval(() => { g.fillStyle = (n++ % 2) ? '#0f0' : '#00f'; g.fillRect(0, 0, 32, 32); }, 40);
  const v = document.getElementById('v');
  v.srcObject = document.getElementById('c').captureStream(25);
  v.play();
  window.__videoTime = () => v.currentTime;
  window.__playing = () => !v.paused && !v.ended;
</script>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(req.url.startsWith('/play') ? PLAYER_PAGE : `<!doctype html><meta charset="utf-8"><title>ページ${req.url}</title>本文`);
    })
    .listen(PORT);

  try {
    registerIpc();
    browser.initData();

    const ctxA = browser.createWindow();
    const ctxB = browser.createWindow();
    await waitForActive(ctxA.tabManager);
    await waitForActive(ctxB.tabManager);
    await sleep(300);

    // ---- 1. 再生中のタブを別ウィンドウのタブバーへ移す ----
    console.log('-- 再生中のタブを別ウィンドウへ移す --');
    const playing = ctxA.tabManager.createTab(`http://localhost:${PORT}/play`);
    await waitLoad(playing.view.webContents);
    await sleep(800);

    const wcId = playing.view.webContents.id;
    let reloads = 0;
    playing.view.webContents.on('did-start-loading', () => reloads++);
    const t0Before = await js(playing.view.webContents, 'window.__t0');
    const timeBefore = await js(playing.view.webContents, 'window.__videoTime()');

    await js(ctxB.window.webContents, `window.roopie.moveTabFromWindow(${ctxA.window.id}, ${playing.id}, 0)`);
    await sleep(900);

    check('移動先(B)の先頭に来る', ctxB.tabManager.tabs[0]?.id, playing.id);
    check('元(A)からは消える', ctxA.tabManager.getTab(playing.id), null);
    check('WebContentsが作り直されていない', ctxB.tabManager.tabs[0]?.view.webContents.id, wcId);
    check('再読み込みが走らない', reloads, 0);
    check('ページが読み込み直されていない(t0が同じ)', await js(playing.view.webContents, 'window.__t0'), t0Before);
    check('再生が止まっていない(再生位置が進んでいる)', (await js(playing.view.webContents, 'window.__videoTime()')) > timeBefore, true);
    check('videoは再生中のまま', await js(playing.view.webContents, 'window.__playing()'), true);
    check('移動先のViewツリーに載っている', ctxB.window.contentView.children.includes(playing.view), true);
    check('元のViewツリーからは外れている', ctxA.window.contentView.children.includes(playing.view), false);
    check('移動先でアクティブになる', ctxB.tabManager.activeTabId, playing.id);

    // ---- 2. まだ読み込んでいない(休止中の)タブを移しても「新しいタブ」に化けない ----
    console.log('-- 休止中のタブを別ウィンドウへ移す --');
    const dormantUrl = `http://localhost:${PORT}/dormant`;
    const dormant = ctxA.tabManager.createTab(dormantUrl, { background: true, initialTitle: '休止ページ' });
    await sleep(300);
    check('前提: 休止中でURLはまだ空', [dormant.hibernated, dormant.view.webContents.getURL()], [true, '']);

    await js(ctxB.window.webContents, `window.roopie.moveTabFromWindow(${ctxA.window.id}, ${dormant.id}, 0)`);
    await sleep(400);
    await waitLoad(dormant.view.webContents);
    await sleep(300);

    check('移動先(B)の先頭に来る', ctxB.tabManager.tabs[0]?.id, dormant.id);
    check('「新しいタブ」に化けていない', ctxB.tabManager.tabs[0]?.view.webContents.getURL(), dormantUrl);

    // ---- 3. ページ領域へのドロップ(新しいウィンドウへ切り離し)でも同じ ----
    console.log('-- 再生中のタブを新しいウィンドウへ切り離す --');
    const detachTab = ctxB.tabManager.createTab(`http://localhost:${PORT}/play`);
    await waitLoad(detachTab.view.webContents);
    await sleep(800);

    const detachWcId = detachTab.view.webContents.id;
    let detachReloads = 0;
    detachTab.view.webContents.on('did-start-loading', () => detachReloads++);
    const detachT0 = await js(detachTab.view.webContents, 'window.__t0');
    const detachTime = await js(detachTab.view.webContents, 'window.__videoTime()');

    const bounds = ctxB.window.getContentBounds();
    const realCursor = screen.getCursorScreenPoint;
    screen.getCursorScreenPoint = () => ({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + bounds.height - 60 });
    const before = windows.all().length;
    ipcMain.emit('tabs:drag-start', { sender: ctxB.window.webContents }, detachTab.id);
    ipcMain.emit('tabs:drag-end', { sender: ctxB.window.webContents }, detachTab.id, { reordered: false });
    await sleep(900);
    screen.getCursorScreenPoint = realCursor;

    const detachedCtx = windows.all().find((c) => c !== ctxA && c !== ctxB);
    check('新しいウィンドウが開く', windows.all().length, before + 1);
    check('切り離し先に同じタブがある', !!detachedCtx?.tabManager.getTab(detachTab.id), true);
    check('WebContentsが作り直されていない', detachedCtx?.tabManager.getTab(detachTab.id)?.view.webContents.id, detachWcId);
    check('再読み込みが走らない', detachReloads, 0);
    check('ページが読み込み直されていない(t0が同じ)', await js(detachTab.view.webContents, 'window.__t0'), detachT0);
    check('再生が止まっていない(再生位置が進んでいる)', (await js(detachTab.view.webContents, 'window.__videoTime()')) > detachTime, true);
    check('videoは再生中のまま', await js(detachTab.view.webContents, 'window.__playing()'), true);
    check('切り離し先のViewツリーに載っている', detachedCtx?.window.contentView.children.includes(detachTab.view), true);

    // 切り離したタブが真っ白にならず描画されているかを目視用のスクショで残す
    // (BrowserWindow.capturePage はUI側のwebContentsしか撮らないので、タブのViewを直接撮る)
    const shotDir = process.argv[2] || tmp;
    detachedCtx.window.focus();
    for (let i = 0; i < 5; i++) {
      try {
        const image = await detachTab.view.webContents.capturePage();
        const file = path.join(shotDir, 'tab-move-live.png');
        fs.writeFileSync(file, image.toPNG());
        console.log(`   📸 ${file} (${image.getSize().width}x${image.getSize().height})`);
        break;
      } catch (err) {
        if (i === 4) console.log(`   (スクショ失敗: ${err.message})`);
        await sleep(500);
      }
    }

    // ---- 4. 最後の1枚を別ウィンドウへ渡すと、空になった元ウィンドウは閉じる ----
    console.log('-- 最後の1枚を渡すと元のウィンドウは閉じる --');
    const lastId = detachedCtx.tabManager.tabs[0].id;
    check('前提: 切り離し先は1枚だけ', detachedCtx.tabManager.tabs.length, 1);
    await js(ctxA.window.webContents, `window.roopie.moveTabFromWindow(${detachedCtx.window.id}, ${lastId}, 0)`);
    await sleep(900);
    check('タブはAへ移る', ctxA.tabManager.tabs[0]?.id, lastId);
    check('タブは生きたまま(破棄されていない)', detachTab.view.webContents.isDestroyed(), false);
    check('空になった元のウィンドウは閉じる', windows.all().some((c) => c === detachedCtx), false);

    // ---- 5. プロファイルが違うウィンドウへはViewを移せないので、URLだけ引き継ぐ ----
    console.log('-- 別プロファイルのウィンドウへ移す(URL引き継ぎにフォールバック) --');
    const p2 = browser.profiles.create('検証プロファイル');
    const ctxP2 = browser.createWindow({ profileId: p2.id });
    await waitForActive(ctxP2.tabManager);
    await sleep(500);

    const crossUrl = `http://localhost:${PORT}/cross`;
    const crossTab = ctxA.tabManager.createTab(crossUrl);
    await waitLoad(crossTab.view.webContents);
    await sleep(300);
    check('前提: セッションが違うので引き取れない', ctxP2.tabManager.canAdopt(crossTab), false);

    await js(ctxP2.window.webContents, `window.roopie.moveTabFromWindow(${ctxA.window.id}, ${crossTab.id}, 0)`);
    await sleep(400);
    const crossMoved = await waitUrl(() => ctxP2.tabManager.tabs[0]?.view.webContents);
    check('別プロファイルへも移せる', ctxP2.tabManager.tabs.length >= 2, true);
    check('URLが引き継がれる(「新しいタブ」に化けない)', crossMoved, crossUrl);
    check('元(A)からは消える', ctxA.tabManager.getTab(crossTab.id), null);

    // 休止中(URL未読み込み)のタブでも、hibernatedUrlから引き継げる
    const crossDormantUrl = `http://localhost:${PORT}/cross-dormant`;
    const crossDormant = ctxA.tabManager.createTab(crossDormantUrl, { background: true });
    await sleep(300);
    await js(ctxP2.window.webContents, `window.roopie.moveTabFromWindow(${ctxA.window.id}, ${crossDormant.id}, 0)`);
    await sleep(400);
    const crossDormantMoved = await waitUrl(() => ctxP2.tabManager.tabs[0]?.view.webContents);
    check('休止中でもURLが引き継がれる', crossDormantMoved, crossDormantUrl);

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    server.close();
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
