// タイマー機能のUIレベル検証(再利用可能)。
// 実行: npx electron scripts/test-timer-ui.js [スクショ保存先dir]
// サイドパネルのタイマーセクション → 追加モーダル(種別切り替え) → 保存 → 開始 →
// パネルを閉じるとフローティング表示になる、までを実UIで確認する。
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

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
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
    const panelWc = ctx.sidePanel.panelView.webContents;

    const sectionActive = await js(panelWc, `document.getElementById('section-timers').classList.contains('active')`);
    check('タイマーセクションが表示される', sectionActive, true);

    await clickSelector(panelWc, '#timer-add-btn');
    await sleep(300);
    const modalOpen = await js(panelWc, `!document.getElementById('timer-edit').classList.contains('hidden')`);
    check('追加モーダルが開く', modalOpen, true);

    await clickSelector(panelWc, '.timer-type-btn[data-type="clock"]');
    await sleep(200);
    const clockFieldsVisible = await js(panelWc, `!document.getElementById('timer-fields-clock').classList.contains('hidden')`);
    check('時刻指定タブでフィールドが切り替わる', clockFieldsVisible, true);
    const countdownFieldsHidden = await js(panelWc, `document.getElementById('timer-fields-countdown').classList.contains('hidden')`);
    check('時刻指定タブでカウントダウン欄は隠れる', countdownFieldsHidden, true);

    await clickSelector(panelWc, '.timer-type-btn[data-type="countdown"]');
    await sleep(200);
    await js(panelWc, `document.getElementById('timer-name').value = 'UI検証タイマー'; document.getElementById('timer-name').dispatchEvent(new Event('input'))`);
    await js(panelWc, `document.getElementById('timer-h').value = '0'; document.getElementById('timer-m').value = '0'; document.getElementById('timer-s').value = '2'`);
    await shot(panelWc, 'timer-modal.png');
    await clickSelector(panelWc, '#timer-edit-apply');
    await sleep(500);

    const bundle = browser.bundleFor(ctx.profileId);
    const added = bundle.timers.list().find((t) => t.name === 'UI検証タイマー');
    check('保存で一覧に追加される', !!added, true);

    await shot(panelWc, 'timers-list.png');

    bundle.timers.start(added.id);
    await sleep(300);
    check('開始でrunningになる', bundle.timers.find(added.id).status, 'running');

    ctx.sidePanel.setOpen(false);
    await sleep(600);
    check('パネルを閉じるとフローティングタイマーが表示される', ctx.timerPanel.view?.getVisible(), true);

    // 発火(未来時刻を注入)→フローティング側もringing表示になる
    bundle.timers.tick(Date.now() + 10_000);
    await sleep(300);
    check('発火でringingになる', bundle.timers.find(added.id).status, 'ringing');
    const ringingRow = await js(
      ctx.timerPanel.view.webContents,
      `document.querySelector('.timerp-row.ringing') ? true : false`
    );
    check('フローティング側もringing表示になる', ringingRow, true);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
