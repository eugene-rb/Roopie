// 設定画面の「フォルダから読み込む」まわりの見え方の検証(再利用可能)。
// 実行: npx electron scripts/test-extensions-unpacked-ui.js [スクショ保存先dir]
//
// フォルダ選択ダイアログはネイティブなので、ここでは読み込み済みの状態を作って
// 一覧の見た目(バッジ・詳細の読み込み元・入力欄が潰れていないか)を実UIで確かめる。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-unpacked-ui-'));
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

// capturePage は表示直後だと失敗することがあるので数回試す(検証本体には影響しない)
async function shot(wc, name) {
  for (let i = 0; i < 4; i++) {
    try {
      const image = await wc.capturePage();
      const file = path.join(shotDir, name);
      fs.writeFileSync(file, image.toPNG());
      console.log(`   📸 ${file}`);
      return;
    } catch (err) {
      if (i === 3) console.log(`   (スクショ失敗: ${name} ${err.message})`);
      else await sleep(500);
    }
  }
}

function makeFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'フォルダから入れた拡張機能',
      version: '1.2.3',
      description: '設定画面の見え方の検証用',
      permissions: ['storage', 'tabs'],
      options_page: 'options.html',
    })
  );
  fs.writeFileSync(path.join(dir, 'options.html'), '<!doctype html><title>options</title>');
  return dir;
}

// 拡張機能セクションの見え方をまとめて取る
const extensionsUi = (wc) =>
  js(
    wc,
    `(() => {
      const btn = document.getElementById('extension-unpacked-btn');
      const input = document.getElementById('extension-id');
      const card = document.querySelector('#extensions-list .ext-card');
      const badge = card?.querySelector('.ext-badge');
      const titleRow = card?.querySelector('.ext-title-row');
      const name = card?.querySelector('.ext-name');
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const rows = [...(card?.querySelectorAll('.ext-details-row') ?? [])].map((row) =>
        row.querySelector('.ext-details-label')?.textContent
      );
      return {
        btnText: btn?.textContent ?? null,
        btnWidth: Math.round(r(btn)?.width ?? 0),
        inputWidth: Math.round(r(input)?.width ?? 0),
        badgeText: badge?.textContent ?? null,
        badgeVisible: badge ? r(badge).width > 0 && r(badge).height > 0 : false,
        // タイトル行が折り返していないか(名前・バッジが同じ行に並ぶか)
        titleRowHeight: Math.round(r(titleRow)?.height ?? 0),
        nameHeight: Math.round(r(name)?.height ?? 0),
        badgeOverflows: badge && titleRow ? r(badge).right > r(titleRow).right + 1 : null,
        cardOverflows: card ? card.scrollWidth > card.clientWidth : null,
        detailLabels: rows,
      };
    })()`
  );

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const ctx = browser.createWindow();
    await sleep(3500);
    console.log('   ウィンドウ生存(読み込み前):', !ctx.window.isDestroyed());

    const profile = browser.profiles.active();
    const session = browser.profiles.sessionFor(profile);
    const srcDir = makeFixture(path.join(tmp, 'src-extension'));
    await browser.extensions.loadUnpacked(session, profile.id, srcDir);
    browser.sendExtensionsFor(profile.id);
    console.log('   ウィンドウ生存(読み込み後):', !ctx.window.isDestroyed());

    const tab = ctx.tabManager.createTab('roopie://settings');
    await sleep(2500);
    const wc = tab.view.webContents;

    const before = await extensionsUi(wc);
    console.log('   詳細を開く前:', JSON.stringify(before));
    check('「フォルダから読み込む」ボタンがある', before.btnText, 'フォルダから読み込む');
    check('ボタンが潰れていない', before.btnWidth > 100, true);
    check('ID入力欄も潰れていない', before.inputWidth > 150, true);
    check('フォルダ読み込みのバッジが出る', before.badgeText, 'フォルダから読み込み');
    check('バッジが見えている', before.badgeVisible, true);
    check('タイトル行が折り返していない', before.titleRowHeight <= before.nameHeight + 4, true);
    check('バッジが行からはみ出さない', before.badgeOverflows, false);
    check('カードが横にあふれない', before.cardOverflows, false);

    // 詳細を開くと読み込み元のフォルダが出る
    await js(wc, `document.querySelector('#extensions-list .ext-details-toggle').click(); true`);
    await sleep(400);
    const after = await extensionsUi(wc);
    console.log('   詳細を開いた後:', JSON.stringify(after));
    check('詳細にID・権限・読み込み元が並ぶ', after.detailLabels, ['ID', '権限', '読み込み元']);

    // ---- 無効にしたまま同じフォルダを入れ直す(設定画面のボタン=本物のIPC経路で) ----
    // 拡張機能IDは入れ直しても変わらないので、「無効にしたもの」の一覧に残っていると
    // 次の起動でまた外れてしまう
    await js(wc, `document.querySelector('#extensions-list .ext-enable-switch input').click(); true`);
    await sleep(600);
    const bundle = browser.bundleFor(profile.id);
    check('無効にすると設定に覚える', bundle.settings.data.disabledExtensions, [
      browser.extensions.list(session)[0].id,
    ]);

    // フォルダ選択ダイアログはネイティブなので、選んだことにして差し替える
    const { dialog } = require('electron');
    const realShowOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [srcDir] });
    await js(wc, `document.getElementById('extension-unpacked-btn').click(); true`);
    await sleep(1500);
    dialog.showOpenDialog = realShowOpenDialog;

    check('入れ直すと有効に戻る', browser.extensions.list(session)[0].enabled, true);
    check('入れ直すと「無効にしたもの」から外れる', bundle.settings.data.disabledExtensions, []);
    check(
      '入れ直しても増えない',
      browser.extensions.list(session).length,
      1
    );

    fs.mkdirSync(shotDir, { recursive: true });
    await js(wc, `document.getElementById('section-extensions').scrollIntoView(); true`);
    await sleep(600);
    await shot(wc, 'extensions-unpacked.png');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
