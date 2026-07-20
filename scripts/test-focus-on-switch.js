// ウィンドウ切り替え/タブ切り替え時のフォーカス検証 + オーバーレイ表示中は奪わないことの確認。
// 実行: npx electron scripts/test-focus-on-switch.js
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-focus-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${actual} (期待: ${expected})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const ctx1 = browser.createWindow();
    await sleep(1200);
    const ctx2 = browser.createWindow();
    await sleep(1200);

    const tab1 = ctx1.tabManager.getTab(ctx1.tabManager.activeTabId);
    const tab2 = ctx2.tabManager.getTab(ctx2.tabManager.activeTabId);

    // ---- ウィンドウ切り替え(通常) ----
    ctx1.window.focus();
    await sleep(500);
    check('win1へ切替後、tab1コンテンツへフォーカス', tab1.view.webContents.isFocused(), true);

    ctx2.window.focus();
    await sleep(500);
    check('win2へ戻した後、tab2コンテンツへフォーカス', tab2.view.webContents.isFocused(), true);

    // ---- タブ切り替え(同一ウィンドウ内、既存動作の維持確認) ----
    ctx2.tabManager.createTab('data:text/html,<body>tab2b</body>');
    await sleep(400);
    const tab2b = ctx2.tabManager.getTab(ctx2.tabManager.activeTabId);
    check('新規タブ作成直後にフォーカス', tab2b.view.webContents.isFocused(), true);
    ctx2.tabManager.switchTab(tab2.id);
    await sleep(300);
    check('switchTabで元タブへフォーカス', tab2.view.webContents.isFocused(), true);

    // ---- オーバーレイ(メニュー)表示中はウィンドウ再フォーカスで奪わない ----
    ctx2.tabManager.showOverlay(true);
    await sleep(200);
    check('オーバーレイ表示直後にオーバーレイへフォーカス', ctx2.tabManager.overlay.webContents.isFocused(), true);
    ctx1.window.focus();
    await sleep(300);
    ctx2.window.focus();
    await sleep(400);
    check('オーバーレイ表示中のウィンドウ再フォーカスでオーバーレイのフォーカスを維持', ctx2.tabManager.overlay.webContents.isFocused(), true);
    ctx2.tabManager.showOverlay(false);
    await sleep(300);
    check('オーバーレイを閉じたらタブへフォーカスが戻る', tab2.view.webContents.isFocused(), true);

    console.log(failed === 0 ? '\n全て成功' : `\n${failed}件失敗`);
  } catch (err) {
    console.error('検証中にエラー:', err);
    failed++;
  } finally {
    app.exit(failed === 0 ? 0 : 1);
  }
});

app.on('window-all-closed', () => {});
