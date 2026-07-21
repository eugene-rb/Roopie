// タブバー上の再生/一時停止ボタン(ミュートボタンの隣に出る)の検証(再利用可能)。
// 実行: npx electron scripts/test-tab-play-button.js
// 再生中のタブにだけボタンが出て、状態(再生中/一時停止)に応じてアイコンが変わり、
// クリックしてもタブが切り替わらないこと(stopPropagation)を確認する。
const { app } = require('electron');
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
const js = (wc, code) => wc.executeJavaScript(code, true);
const fakeFrame = () => ({ isDestroyed: () => false, executeJavaScript: () => Promise.resolve() });

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);
    const silentTabId = tm.activeTabId;

    const hasBtnWhenNoMedia = await js(
      ctx.window.webContents,
      `!!document.querySelector('.tab[data-id="${silentTabId}"] .play-btn')`
    );
    check('再生していないタブには再生ボタンが出ない', hasBtnWhenNoMedia, false);

    const tab = tm.createTab('data:text/html,<title>media</title>', { background: true });
    await sleep(300);

    tm.onMediaReport(
      tab.id,
      { title: '曲', artist: 'アーティスト', playing: true, duration: 120, currentTime: 10, canPrev: false, canNext: false, hasVideo: false },
      fakeFrame()
    );
    await sleep(300);

    const stateWhilePlaying = await js(
      ctx.window.webContents,
      `(() => { const b = document.querySelector('.tab[data-id="${tab.id}"] .play-btn'); return b ? { exists: true, title: b.title } : { exists: false }; })()`
    );
    check('再生中タブに再生ボタンが出る', stateWhilePlaying.exists, true);
    check('再生中は「一時停止」ラベル', stateWhilePlaying.title, 'クリックで一時停止');

    // クリックしてもアクティブタブは変わらない(stopPropagation)
    await clickSelector(ctx.window.webContents, `.tab[data-id="${tab.id}"] .play-btn`);
    await sleep(300);
    check('再生ボタンのクリックでタブが切り替わらない', tm.activeTabId, silentTabId);

    // 一時停止状態に変わればアイコン/ラベルも切り替わる
    tm.onMediaReport(
      tab.id,
      { title: '曲', artist: 'アーティスト', playing: false, duration: 120, currentTime: 10, canPrev: false, canNext: false, hasVideo: false },
      fakeFrame()
    );
    await sleep(300);
    const stateWhilePaused = await js(
      ctx.window.webContents,
      `document.querySelector('.tab[data-id="${tab.id}"] .play-btn')?.title`
    );
    check('一時停止中は「再生」ラベルに変わる', stateWhilePaused, 'クリックで再生');

    // 再生が終わったら(要素が無くなったら)ボタンも消える
    tm.onMediaReport(tab.id, null, null);
    await sleep(300);
    const hasBtnAfterStop = await js(
      ctx.window.webContents,
      `!!document.querySelector('.tab[data-id="${tab.id}"] .play-btn')`
    );
    check('報告が無くなればボタンも消える', hasBtnAfterStop, false);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
