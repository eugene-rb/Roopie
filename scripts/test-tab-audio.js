// タブのスピーカーアイコン(音声再生中の表示+クリックでミュート切替)の検証(再利用可能)。
// 実行: npx electron scripts/test-tab-audio.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、AudioContextで実際に音を鳴らして
// audio-state-changed → tabs:state → DOMのスピーカーアイコンまでを実UIで確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// capturePageはVizプロセスの一過性エラーで失敗することがあるため、失敗しても検証全体は止めない
async function shot(wc, name) {
  try {
    const image = await wc.capturePage();
    const file = path.join(shotDir, name);
    fs.writeFileSync(file, image.toPNG());
    console.log(`   📸 ${file}`);
  } catch (err) {
    console.log(`   (スクショ失敗・無視: ${name} => ${err.message})`);
  }
}

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

// tab.isAudible が true になるまで待つ(AudioStreamMonitorの検出には少し時間がかかる)
async function waitForAudible(tabManager, tabId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (tabManager.getTab(tabId)?.isAudible) return true;
    await sleep(200);
  }
  return false;
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    // 初期タブは index.html の did-finish-load 後に非同期で作られる
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    // 音を出さない通常タブには、そもそもアイコンが出ないことを確認
    const silentTabId = tm.activeTabId;
    const hasIconWhenSilent = await js(
      ctx.window.webContents,
      `!!document.querySelector('.tab[data-id="${silentTabId}"] .audio-btn')`
    );
    check('無音タブにはスピーカーアイコンが出ない', hasIconWhenSilent, false);

    // バックグラウンドで音を鳴らすタブを作る(background:trueでアクティブは変えない)
    const tab = tm.createTab('data:text/html,<title>audio</title>', { background: true });
    await sleep(300);
    const wc = tab.view.webContents;
    // AudioContextのautoplay制限を避けるため、先に信頼済みクリックでユーザー操作扱いにしておく
    clickAt(wc, 10, 10);
    await sleep(100);
    const ctxState = await js(
      wc,
      `(() => {
        window.__ctx = new (window.AudioContext || window.webkitAudioContext)();
        window.__osc = window.__ctx.createOscillator();
        window.__osc.frequency.value = 440;
        window.__osc.connect(window.__ctx.destination);
        window.__osc.start();
        return window.__ctx.state;
      })()`
    );
    console.log(`   AudioContext.state = ${ctxState}`);

    const becameAudible = await waitForAudible(tm, tab.id);
    check('オシレーター再生でisAudibleがtrueになる', becameAudible, true);
    check('バックグラウンド再生でもアクティブタブは変わらない', tm.activeTabId, silentTabId);

    await sleep(200); // sendState()のIPC反映を待つ
    const iconState = await js(
      ctx.window.webContents,
      `(() => { const b = document.querySelector('.tab[data-id="${tab.id}"] .audio-btn'); return b ? { exists: true, muted: b.classList.contains('muted') } : { exists: false }; })()`
    );
    check('再生中タブにスピーカーアイコンが出る', iconState.exists, true);
    check('再生中(未ミュート)は muted クラスなし', iconState.muted, false);
    await shot(ctx.window.webContents, 'audio-playing.png');

    // スピーカーアイコンをクリック → ミュート。クリックがタブ切り替えへ伝播しないことも確認
    await clickSelector(ctx.window.webContents, `.tab[data-id="${tab.id}"] .audio-btn`);
    await sleep(400);
    check('クリック後もアクティブタブは変わらない(stopPropagation)', tm.activeTabId, silentTabId);
    check('クリックでwebContentsがミュートされる', wc.isAudioMuted(), true);
    const iconAfterMute = await js(
      ctx.window.webContents,
      `document.querySelector('.tab[data-id="${tab.id}"] .audio-btn')?.classList.contains('muted')`
    );
    check('ミュート後は muted クラスが付く', iconAfterMute, true);
    await shot(ctx.window.webContents, 'audio-muted.png');

    // もう一度クリック → ミュート解除
    await clickSelector(ctx.window.webContents, `.tab[data-id="${tab.id}"] .audio-btn`);
    await sleep(400);
    check('再クリックでミュート解除', wc.isAudioMuted(), false);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
