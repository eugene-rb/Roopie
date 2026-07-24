// タイマー機能のUIレベル検証(再利用可能)。
// 実行: npx electron scripts/test-timer-ui.js [スクショ保存先dir]
// 機能別の3画面(タイマー/アラーム/ストップウォッチ)と、フローティング表示の
// 機能別の出し分け(カウントダウン/ストップウォッチは実行中に自動、アラームは鳴動か📌のみ)を実UIで確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-timer-ui-'));
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

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// WebContentsViewは生成後のリサイズがレンダラーへすぐ伝わらないことがある(パネルを開いた直後は
// レール幅44pxのままレイアウトされてしまい、クリック座標が全部ずれる)。capturePage()を打つと
// 同期されるので、Viewの実寸と window.innerWidth が一致するまで数回叩く。UI操作の前に必ず呼ぶ
async function syncLayout(view) {
  const wc = view.webContents;
  for (let i = 0; i < 10; i++) {
    try {
      await wc.capturePage();
    } catch {
      /* 初回は UnknownVizError になることがある(次で成功する) */
    }
    const size = await js(wc, '({ w: window.innerWidth, h: window.innerHeight })');
    const bounds = view.getBounds();
    if (size.w === bounds.width && size.h === bounds.height) return;
    await sleep(200);
  }
  throw new Error('Viewの実寸とレンダラーのサイズが一致しませんでした');
}

// フローティング表示は行数で高さが変わる=クリックのたびに同期し直す必要がある
async function clickIn(view, selector) {
  await syncLayout(view);
  await clickSelector(view.webContents, selector);
}

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
}

const exists = (wc, selector) => js(wc, `!!document.querySelector(${JSON.stringify(selector)})`);
const text = (wc, selector) => js(wc, `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)`);

// レンダラーのコンソールエラーを拾う(描画は出ていても例外が出ていれば落とす)
const consoleErrors = [];
function watchConsole(wc, label) {
  wc.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(`${label}: ${e.message}`);
  });
}

async function shot(wc, name) {
  const image = await wc.capturePage();
  const file = path.join(shotDir, name);
  fs.writeFileSync(file, image.toPNG());
  console.log(`   📸 ${file}`);
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(1500);

    ctx.sidePanel.setOpen(true);
    ctx.sidePanel.openSection('timers');
    await sleep(800);
    await syncLayout(ctx.sidePanel.panelView);
    const panelWc = ctx.sidePanel.panelView.webContents;
    watchConsole(panelWc, 'サイドパネル');
    const bundle = browser.bundleFor(ctx.profileId);

    const sectionActive = await js(panelWc, `document.getElementById('section-timers').classList.contains('active')`);
    check('タイマーセクションが表示される', sectionActive, true);

    // ---- タイマー(カウントダウン): プリセットで即スタート → 進捗リングのカード ----
    check('既定はタイマー画面', await js(panelWc, `!document.getElementById('tv-countdown').classList.contains('hidden')`), true);
    await clickSelector(panelWc, '.timer-preset'); // 先頭 = 1分
    await sleep(600);
    const preset = bundle.timers.list().find((t) => t.type === 'countdown');
    check('プリセットでタイマーが作られる', preset?.durationMs, 60_000);
    check('プリセットは押した瞬間に走り出す', preset?.status, 'running');
    check('実行中は進捗リングのカードで表示される', await exists(panelWc, '.cd-card .cd-ring-prog'), true);
    await shot(panelWc, 'timer-countdown.png');

    // 「+1分」で残りが伸びる
    const before = bundle.timers.list().find((t) => t.id === preset.id).remainingMs;
    await clickSelector(panelWc, '.cd-controls .timer-flat-btn:last-child');
    await sleep(400);
    const after = bundle.timers.list().find((t) => t.id === preset.id).remainingMs;
    check('「+1分」で残り時間が約60秒増える', after - before > 55_000 && after - before < 65_000, true);

    // 📌ピンでフローティング固定フラグが立つ
    await clickSelector(panelWc, '.cd-corner .timer-pin-btn');
    await sleep(400);
    check('📌でフローティング固定になる', bundle.timers.find(preset.id).float, true);
    await clickSelector(panelWc, '.cd-corner .timer-pin-btn');
    await sleep(400);
    check('もう一度押すと固定が外れる', bundle.timers.find(preset.id).float, false);

    // フローティング表示のON/OFF(フロート側の「格納」で消えたあと戻せる口)
    check('既定はフローティング表示ON', await js(panelWc, `document.getElementById('timer-float-toggle').classList.contains('on')`), true);
    await clickSelector(panelWc, '#timer-float-toggle');
    await sleep(500);
    check('OFFにすると格納設定になる', bundle.settings.data.timerDocked, true);
    check('格納中はフロートが消える', ctx.timerPanel.view?.getVisible() ?? false, false);
    await clickSelector(panelWc, '#timer-float-toggle');
    await sleep(500);
    check('ONに戻せる', bundle.settings.data.timerDocked, false);

    // ---- アラーム: 時刻とON/OFFスイッチ ----
    await clickSelector(panelWc, '.timer-tab[data-tt="clock"]');
    await sleep(300);
    check('アラーム画面へ切り替わる', await js(panelWc, `!document.getElementById('tv-clock').classList.contains('hidden')`), true);
    await clickSelector(panelWc, '#alarm-add-btn');
    await sleep(300);
    check('アラーム追加モーダルが開く', await js(panelWc, `!document.getElementById('timer-edit').classList.contains('hidden')`), true);
    check('アラームでは時刻欄が出る', await js(panelWc, `!document.getElementById('timer-fields-clock').classList.contains('hidden')`), true);
    check('アラームではカウントダウン欄は隠れる', await js(panelWc, `document.getElementById('timer-fields-countdown').classList.contains('hidden')`), true);
    await js(panelWc, `document.getElementById('timer-name').value = '検証アラーム'`);
    await js(panelWc, `document.getElementById('timer-clock-time').value = '07:30'`);
    await clickSelector(panelWc, '#timer-edit-apply');
    await sleep(500);
    const alarm = bundle.timers.list().find((t) => t.type === 'clock');
    check('アラームが保存される', alarm?.clockTime, { hour: 7, minute: 30 });
    check('アラーム行に時刻が出る', await text(panelWc, '.alarm-time'), '07:30');
    check('未設定のアラームはOFF表示', await js(panelWc, `document.querySelector('.timer-switch').classList.contains('on')`), false);

    await clickSelector(panelWc, '.timer-switch');
    await sleep(500);
    check('スイッチONで予約(running)になる', bundle.timers.find(alarm.id).status, 'running');
    check('スイッチの見た目もONになる', await js(panelWc, `document.querySelector('.timer-switch').classList.contains('on')`), true);
    await shot(panelWc, 'timer-alarm.png');

    // ---- ストップウォッチ: 大きい表示とラップ ----
    await clickSelector(panelWc, '.timer-tab[data-tt="stopwatch"]');
    await sleep(300);
    check('ストップウォッチ画面へ切り替わる', await js(panelWc, `!document.getElementById('tv-stopwatch').classList.contains('hidden')`), true);
    check('1台も無いときは 00:00.00 を出す', await text(panelWc, '.sw-time'), '00:00.00');
    await clickSelector(panelWc, '.sw-btn.start');
    await sleep(700);
    const sw = bundle.timers.list().find((t) => t.type === 'stopwatch');
    check('スタートで作られて走り出す', sw?.status, 'running');
    check('1/100秒まで表示する', /^\d{2}:\d{2}\.\d{2}$/.test(await text(panelWc, '.sw-time')), true);
    await clickSelector(panelWc, '.sw-controls .sw-btn'); // 左 = ラップ
    await sleep(400);
    check('ラップが記録される', bundle.timers.find(sw.id).laps.length, 1);
    check('ラップ一覧に行が出る(実行中の現在ラップ+記録1件)', await js(panelWc, `document.querySelectorAll('.sw-lap').length`), 2);
    await shot(panelWc, 'timer-stopwatch.png');

    // ---- フローティング表示 ----
    ctx.sidePanel.setOpen(false);
    await sleep(700);
    check('パネルを閉じるとフローティング表示になる', ctx.timerPanel.view?.getVisible(), true);
    await syncLayout(ctx.timerPanel.view);
    const fWc = ctx.timerPanel.view.webContents;
    watchConsole(fWc, 'フローティング');
    check('カウントダウンの行が出る', await exists(fWc, `.timerp-row[data-type="countdown"]`), true);
    check('カウントダウンは進捗リング付き', await exists(fWc, `.timerp-row[data-type="countdown"] .timerp-ring-prog`), true);
    check('ストップウォッチの行が出る', await exists(fWc, `.timerp-row[data-type="stopwatch"]`), true);
    check('ストップウォッチにはラップボタンが付く', await exists(fWc, `.timerp-row[data-type="stopwatch"] .timerp-lap`), true);
    check('予約中のアラームは自動フロートしない', await exists(fWc, `.timerp-row[data-type="clock"]`), false);
    await shot(fWc, 'timerp-per-type.png');

    // 行がはみ出す(=スクロールが要る)と下の行がクリックできなくなるため、高さの計算が合っているか見る
    const fit = await js(
      fWc,
      `(() => { const el = document.getElementById('timerp-rows'); return el.scrollHeight <= el.clientHeight; })()`
    );
    check('全ての行が見切れずに収まる(ROW_HEIGHTとCSSが一致)', fit, true);

    // フロート上のラップボタンが効く
    await clickIn(ctx.timerPanel.view, `.timerp-row[data-type="stopwatch"] .timerp-lap`);
    await sleep(400);
    check('フロートのラップボタンで記録が増える', bundle.timers.find(sw.id).laps.length, 2);

    // フロート上で一時停止しても行は消えない(消えると再開できなくなる)
    await clickIn(ctx.timerPanel.view, `.timerp-row[data-type="stopwatch"] .timerp-circle`);
    await sleep(500);
    check('フロートで一時停止できる', bundle.timers.find(sw.id).status, 'paused');
    check('一時停止しても行は残る', await exists(fWc, `.timerp-row[data-type="stopwatch"]`), true);

    // 📌で固定した予約中アラームはフロートする
    bundle.timers.update(alarm.id, { float: true });
    await sleep(500);
    check('📌したアラームはフロートする', await exists(fWc, `.timerp-row[data-type="clock"]`), true);
    check('予約中アラームはベル表示(誤操作で消さない)', await exists(fWc, `.timerp-circle.alarm`), true);
    bundle.timers.update(alarm.id, { float: false });
    await sleep(300);

    // 発火 → 鳴動表示
    bundle.timers.tick(Date.now() + 24 * 3600_000);
    await sleep(500);
    check('発火でringingになる', bundle.timers.find(alarm.id).status, 'ringing');
    check('鳴動中のアラームはフロートに出る', await exists(fWc, `.timerp-row[data-type="clock"].ringing`), true);
    await shot(fWc, 'timerp-ringing.png');
    await clickIn(ctx.timerPanel.view, `.timerp-row[data-type="clock"] .timerp-circle`);
    await sleep(500);
    check('フロートから鳴動を止められる', bundle.timers.find(alarm.id).status !== 'ringing', true);

    check('レンダラーのコンソールエラーが無い', consoleErrors, []);
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
