// プロファイル切り替え(Edge挙動)のUIレベル検証(再利用可能)。
// 実行: npx electron scripts/test-profile-switch-ui.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、ワークスペースピルとプロファイルメニューを
// sendInputEvent(信頼済みクリック)で操作して、切り替え=新ウィンドウ/既存維持を確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const windows = require('../src/main/windows');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

async function shot(wc, name) {
  const image = await wc.capturePage();
  const file = path.join(shotDir, name);
  fs.writeFileSync(file, image.toPNG());
  console.log(`   📸 ${file}`);
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// セレクタの中心座標を取ってクリック(その要素が属するwebContentsに送る)
async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
}

// メニュー(オーバーレイ)内のプロファイル行をクリック
async function clickProfileRow(overlayWc, name) {
  const pos = await js(
    overlayWc,
    `(() => {
      const row = [...document.querySelectorAll('#items .menu-item')].find((b) => b.querySelector('.name')?.textContent === ${JSON.stringify(name)});
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  );
  if (!pos) throw new Error(`プロファイル行が見つかりません: ${name}`);
  clickAt(overlayWc, pos.x, pos.y);
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const p1 = browser.profiles.active(); // 「個人」
    const p2 = browser.profiles.create('仕事');

    // ウィンドウ1(個人)
    const ctx1 = browser.createWindow();
    await sleep(2000);
    const pill1 = await js(ctx1.window.webContents, `document.getElementById('workspace-name').textContent`);
    check('ウィンドウ1のピルは「個人」', pill1, p1.name);
    await shot(ctx1.window.webContents, 'w1-before.png');

    // ピルをクリック → プロファイルメニューが開く
    await clickSelector(ctx1.window.webContents, '#workspace-btn');
    await sleep(500);
    const overlay1 = ctx1.tabManager.overlay.webContents;
    const menuOpen = await js(overlay1, `!document.getElementById('menu').classList.contains('hidden')`);
    check('ピルのクリックでメニューが開く', menuOpen, true);
    const rowNames = await js(overlay1, `[...document.querySelectorAll('#items .menu-item .name')].map((n) => n.textContent)`);
    check('メニューに両プロファイル', rowNames.sort(), [p1.name, p2.name].sort());
    await shot(overlay1, 'w1-menu.png');

    // 「仕事」をクリック → 新しいウィンドウが開き、既存はそのまま(Edge挙動)
    await clickProfileRow(overlay1, '仕事');
    await sleep(2500);
    check('ウィンドウが2枚になる', windows.normal().length, 2);
    const ctx2 = windows.normal().find((c) => c !== ctx1);
    check('新ウィンドウは「仕事」', ctx2?.profileId, p2.id);
    check('既存ウィンドウは開いたまま', ctx1.window.isDestroyed(), false);
    check('既存ウィンドウは「個人」のまま', ctx1.profileId, p1.id);
    const pill1After = await js(ctx1.window.webContents, `document.getElementById('workspace-name').textContent`);
    check('ウィンドウ1のピル表示は「個人」のまま', pill1After, p1.name);
    const pill2 = await js(ctx2.window.webContents, `document.getElementById('workspace-name').textContent`);
    check('ウィンドウ2のピルは「仕事」', pill2, p2.name);
    await shot(ctx1.window.webContents, 'w1-after.png');
    await shot(ctx2.window.webContents, 'w2.png');

    // 🔍 ウィンドウ2のメニューでは「仕事」に✓(使用中はウィンドウごと)
    await clickSelector(ctx2.window.webContents, '#workspace-btn');
    await sleep(500);
    const overlay2 = ctx2.tabManager.overlay.webContents;
    const checkedName = await js(
      overlay2,
      `[...document.querySelectorAll('#items .menu-item')].find((b) => b.querySelector('.check'))?.querySelector('.name')?.textContent ?? null`
    );
    check('🔍 ウィンドウ2の「使用中」✓は仕事', checkedName, p2.name);
    await shot(overlay2, 'w2-menu.png');

    // 🔍 ウィンドウ2から「個人」へ切り替え → 個人のウィンドウがもう1枚(計3枚)
    await clickProfileRow(overlay2, p1.name);
    await sleep(2500);
    check('🔍 既にウィンドウがあるプロファイルへの切り替えも新ウィンドウ', windows.normal().length, 3);
    const ctx3 = windows.normal().find((c) => c !== ctx1 && c !== ctx2);
    check('🔍 3枚目は「個人」', ctx3?.profileId, p1.id);

    // 🔍 タブ構成の保存と復元: 個人のウィンドウ(2枚)を閉じ、最後の1枚のタブ構成が復元される
    ctx3.tabManager.createTab(); // 2タブにしておく
    await sleep(800);
    ctx1.window.close();
    await sleep(400);
    ctx3.window.close(); // 個人の最後のウィンドウ → ここでsession-tabs保存
    await sleep(600);
    check('🔍 個人のウィンドウが無くなった', windows.normal().length, 1);

    await clickSelector(ctx2.window.webContents, '#workspace-btn');
    await sleep(500);
    await clickProfileRow(ctx2.tabManager.overlay.webContents, p1.name);
    await sleep(2500);
    const ctx4 = windows.normal().find((c) => c !== ctx2);
    check('🔍 個人を開き直すと新ウィンドウ', ctx4?.profileId, p1.id);
    check('🔍 前回のタブ構成(2タブ)を復元', ctx4?.tabManager.tabs.length, 2);
    await shot(ctx4.window.webContents, 'w4-restored.png');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
