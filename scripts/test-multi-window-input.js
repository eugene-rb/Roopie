// 複数ウィンドウで同時入力が複数タブに届く問題を再現・検証
// 実行: npx electron scripts/test-multi-window-input.js
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-multi-input-'));
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

    // 各タブに inputEvent リスナーを設定
    let tab1InputCount = 0;
    let tab2InputCount = 0;

    tab1.view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key.toLowerCase() === 'a') {
        tab1InputCount++;
        console.log(`  tab1 received input event`);
      }
    });

    tab2.view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key.toLowerCase() === 'a') {
        tab2InputCount++;
        console.log(`  tab2 received input event`);
      }
    });

    // ---- テスト1: ウィンドウ1をフォーカス、入力 ----
    console.log('\n=== Test 1: Window 1 focused, send input ===');
    ctx1.window.focus();
    await sleep(300);
    tab1InputCount = 0;
    tab2InputCount = 0;

    // ウィンドウ1に入力イベント送信
    console.log('Sending key "A" to window 1...');
    tab1.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    await sleep(200);

    check('Only tab1 received input', tab1InputCount + tab2InputCount, 1);
    check('tab1 received input', tab1InputCount, 1);
    check('tab2 NOT received input', tab2InputCount, 0);

    // ---- テスト2: ウィンドウ2をフォーカス、入力 ----
    console.log('\n=== Test 2: Window 2 focused, send input ===');
    ctx2.window.focus();
    await sleep(300);
    tab1InputCount = 0;
    tab2InputCount = 0;

    console.log('Sending key "A" to window 2...');
    tab2.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    await sleep(200);

    check('Only tab2 received input', tab1InputCount + tab2InputCount, 1);
    check('tab1 NOT received input', tab1InputCount, 0);
    check('tab2 received input', tab2InputCount, 1);

    // ---- テスト3: ウィンドウ1→2へ切り替え直後、素早く入力 ----
    console.log('\n=== Test 3: Switch focus window1->2, input immediately ===');
    ctx1.window.focus();
    await sleep(200);
    ctx2.window.focus();
    await sleep(100); // 短い遅延（完全に切り替わる前に入力）

    tab1InputCount = 0;
    tab2InputCount = 0;
    console.log('Sending key "A" immediately after focus switch...');
    tab2.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    await sleep(200);

    check('Only tab2 received input (focus switch race)', tab1InputCount + tab2InputCount, 1);
    check('tab2 received input (focus switch race)', tab2InputCount, 1);
    check('tab1 NOT received input (focus switch race)', tab1InputCount, 0);

    console.log(failed === 0 ? '\n全て成功 - 複数入力問題なし' : `\n${failed}件失敗 - 複数ウィンドウで入力受取`);
  } catch (err) {
    console.error('検証中にエラー:', err);
    failed++;
  } finally {
    app.exit(failed === 0 ? 0 : 1);
  }
});

app.on('window-all-closed', () => {});
