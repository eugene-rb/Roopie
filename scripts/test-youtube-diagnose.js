// ユーザー報告「YouTubeのUIが崩れがち」の原因調査用(使い捨てではなく再利用できる形にしておく)。
// 実行: npx electron scripts/test-youtube-diagnose.js
// 実際のYouTube動画ページを開き、(1)何もしない通常状態としばらく、
// (2)F11全画面中にマウスが上端付近をうろつく状況を再現し、
// そのタブのコンソールエラー・レンダラークラッシュ・リサイズ回数を記録して報告する。
const { app, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NUMERIC_LEVELS = ['debug', 'log', 'warning', 'error'];

app.whenReady().then(async () => {
  const originalGetCursor = screen.getCursorScreenPoint;
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const tab = tm.createTab('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const wc = tab.view.webContents;

    const events = [];
    wc.on('console-message', (event) => {
      const { level, message, lineNumber, sourceId } = event;
      const levelName = typeof level === 'number' ? NUMERIC_LEVELS[level] || String(level) : level;
      if (levelName === 'error' || levelName === 'warning') {
        events.push(`[console:${levelName}] ${message} (${sourceId}:${lineNumber})`);
      }
    });
    wc.on('render-process-gone', (_ev, details) => {
      events.push(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`);
    });
    wc.on('unresponsive', () => events.push('[unresponsive]'));

    let resizeCount = 0;
    const seenBounds = [];
    const origSetBounds = tab.view.setBounds.bind(tab.view);
    tab.view.setBounds = (b) => {
      resizeCount++;
      seenBounds.push(b);
      return origSetBounds(b);
    };

    console.log('--- フェーズ1: 読み込み待ち ---');
    await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(15000)]);
    await sleep(5000); // 動画が実際に再生され始めるまで少し待つ

    console.log(`フェーズ1終了時点のエラー/警告件数: ${events.length}`);
    console.log(`フェーズ1終了時点のリサイズ回数: ${resizeCount}`);

    console.log('--- フェーズ2: 何もしない通常状態を10秒観察 ---');
    const beforeIdle = events.length;
    const resizeBeforeIdle = resizeCount;
    await sleep(10000);
    console.log(`通常状態中の新規エラー/警告: ${events.length - beforeIdle}件`);
    console.log(`通常状態中のリサイズ回数: ${resizeCount - resizeBeforeIdle}`);

    console.log('--- フェーズ3: F11全画面 + マウスが上端付近をうろつく状況を再現 ---');
    const beforeFs = events.length;
    const resizeBeforeFs = resizeCount;
    ctx.window.setFullScreen(true);
    for (let i = 0; i < 50 && !ctx.window.isFullScreen(); i++) await sleep(100);
    const bounds = ctx.window.getBounds();
    // 上端ギリギリと、隠れるラインのすぐ外側を素早く行き来させる(ユーザーが上端付近で
    // マウスを動かしたときに近い状況。F11のタブバー自動表示/非表示のポーリングは80ms間隔)
    for (let i = 0; i < 20; i++) {
      const nearTop = i % 2 === 0;
      screen.getCursorScreenPoint = () => ({
        x: bounds.x + 10,
        y: nearTop ? bounds.y + 2 : bounds.y + tm.chromeHeight + 200,
      });
      await sleep(90);
    }
    screen.getCursorScreenPoint = originalGetCursor;
    await sleep(500);
    ctx.window.setFullScreen(false);
    for (let i = 0; i < 50 && ctx.window.isFullScreen(); i++) await sleep(100);
    await sleep(1000);

    console.log(`F11中の新規エラー/警告: ${events.length - beforeFs}件`);
    console.log(`F11中のリサイズ回数: ${resizeCount - resizeBeforeFs}`);

    console.log('\n=== 収集したエラー/警告/クラッシュ一覧 ===');
    if (events.length === 0) {
      console.log('(なし)');
    } else {
      for (const e of events) console.log(e);
    }

    console.log('\n=== 合計リサイズ回数 ===', resizeCount);
    console.log('=== 最後の3件のbounds ===', seenBounds.slice(-3));

    browser.flushAll();
    app.exit(0);
  } catch (err) {
    screen.getCursorScreenPoint = originalGetCursor;
    console.error('NG 調査スクリプトが例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
