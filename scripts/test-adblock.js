// 広告ブロックの検証(再利用可能)。実行: npx electron scripts/test-adblock.js
//
// 「YouTubeのUIが崩れがち」という報告を調査した結果、内蔵広告ブロック
// (@ghostery/adblocker-electron)のコスメティックフィルタ(ページへのCSS/スクリプトレット
// 注入)がYouTubeのPolymer製UIと衝突し、「Identifier 'JSONPath' has already been declared」や
// 「dom-repeat: Maximum call stack size exceeded」でUIが壊れることを実機で確認した
// (adblock.jsで loadCosmeticFilters=false に変更する前後をA/Bテストして特定)。
// ネットワークレベルの広告/トラッカー遮断(loadNetworkFilters)は無関係で、そのまま活かす。
// このテストは (1) 注入だけ止まっていること (2) 遮断自体は生きていること (3) 実際にYouTubeで
// 該当エラーが出ないことを固定して、再度有効化するリグレッションを防ぐ。
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

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    await browser.adblock.ready;

    check('コスメティックフィルタ(DOM/スクリプト注入)は無効', browser.adblock.blocker?.config.loadCosmeticFilters, false);
    check('ネットワークレベルの遮断は有効', browser.adblock.blocker?.config.loadNetworkFilters, true);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    // ネットワーク遮断が実際に効いているか(既知の広告ドメインへのfetchが失敗する)
    const probeTab = tm.createTab('data:text/html,<title>adblock-probe</title>');
    const fetchResult = await probeTab.view.webContents
      .executeJavaScript(`fetch('https://googleads.g.doubleclick.net/pagead/id').then(() => 'loaded').catch((e) => 'blocked')`, true)
      .catch(() => 'threw');
    check('広告ドメインへのリクエストは遮断される', fetchResult, 'blocked');

    // 実際のYouTubeページでコスメティックフィルタ由来のエラーが出ないこと
    const tab = tm.createTab('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const wc = tab.view.webContents;
    const errors = [];
    wc.on('console-message', (event) => {
      const { level, message } = event;
      const levelName = typeof level === 'number' ? ['debug', 'log', 'warning', 'error'][level] || String(level) : level;
      if (levelName === 'error') errors.push(message);
    });
    await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(15000)]);
    await sleep(10000);

    const hasCosmeticBreakage = errors.some(
      (m) => m.includes('JSONPath') || m.includes('dom-repeat') || m.includes('Maximum call stack')
    );
    check('YouTubeでコスメティックフィルタ由来のUI崩れが出ない', hasCosmeticBreakage, false);

    browser.flushAll();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
