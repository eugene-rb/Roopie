// 履歴・ダウンロードのドロップダウン(Edge風)のUIレベル検証(再利用可能)。
// 実行: npx electron scripts/test-history-downloads-dropdown.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、ツールバーの履歴/ダウンロードアイコンを
// sendInputEvent(信頼済みクリック)で操作して、オーバーレイにドロップダウンが
// 正しく開く/閉じる/操作できることを確認する。雛形は test-profile-switch-ui.js。
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

// capturePage()はこの環境でViz(GPU)プロセスが落ちて例外になることがある(検証環境固有の
// 既知の不安定さで、機能の正しさとは無関係)。DOM側のアサーションが本体なので、スクショの
// 失敗ではテスト全体を止めない
async function shot(wc, name) {
  try {
    const image = await wc.capturePage();
    const file = path.join(shotDir, name);
    fs.writeFileSync(file, image.toPNG());
    console.log(`   📸 ${file}`);
  } catch (err) {
    console.log(`   ⚠ スクショ失敗(GPU起因の可能性。DOMアサーションには影響しない): ${name} — ${err.message}`);
  }
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

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(2000);
    const overlay = ctx.tabManager.overlay.webContents;

    // ドロップダウンに中身が出ることを確認するため、履歴とダウンロードのテストデータを注入する
    const bundle = browser.bundleFor(ctx.profileId);
    bundle.history.add('https://example.com/', 'Example Site', null);
    bundle.downloads.items.unshift({
      id: 'test-download-1',
      filename: 'test.pdf',
      url: 'https://example.com/test.pdf',
      savePath: 'C:\\Downloads\\test.pdf',
      state: 'completed',
      receivedBytes: 1024,
      totalBytes: 1024,
      startedAt: Date.now(),
    });

    // ---- 履歴のドロップダウン ----
    await clickSelector(ctx.window.webContents, '#history-btn');
    await sleep(500);
    const historyOpen = await js(overlay, `!document.getElementById('history-popup').classList.contains('hidden')`);
    check('履歴ボタンのクリックでドロップダウンが開く', historyOpen, true);
    const historyRowTitle = await js(overlay, `document.querySelector('#history-list .row .title')?.textContent ?? null`);
    check('履歴ドロップダウンに追加したエントリが出る', historyRowTitle, 'Example Site');
    await shot(overlay, 'history-dropdown.png');

    // 履歴を消去 → 空状態になる
    await clickSelector(overlay, '#history-clear');
    await sleep(300);
    const historyEmpty = await js(overlay, `!!document.querySelector('#history-list .empty-state')`);
    check('履歴を消去すると空状態になる', historyEmpty, true);

    // 外側クリックで閉じる(バックドロップ)
    await clickAt(overlay, 5, 5);
    await sleep(300);
    const historyClosedAfterOutsideClick = await js(overlay, `document.getElementById('history-popup').classList.contains('hidden')`);
    check('外側クリックで履歴ドロップダウンが閉じる', historyClosedAfterOutsideClick, true);

    // ---- ダウンロードのドロップダウン ----
    await clickSelector(ctx.window.webContents, '#downloads-btn');
    await sleep(500);
    const downloadsOpen = await js(overlay, `!document.getElementById('downloads-popup').classList.contains('hidden')`);
    check('ダウンロードボタンのクリックでドロップダウンが開く', downloadsOpen, true);
    const downloadsRowTitle = await js(overlay, `document.querySelector('#downloads-list .row .title')?.textContent ?? null`);
    check('ダウンロードドロップダウンに追加したエントリが出る', downloadsRowTitle, 'test.pdf');
    await shot(overlay, 'downloads-dropdown.png');

    // 「すべて表示」で roopie://downloads がタブとして開き、ドロップダウンは閉じる
    await clickSelector(overlay, '#downloads-manage');
    await sleep(800);
    const downloadsClosedAfterManage = await js(overlay, `document.getElementById('downloads-popup').classList.contains('hidden')`);
    check('「すべて表示」でダウンロードドロップダウンが閉じる', downloadsClosedAfterManage, true);
    const activeTabUrl = ctx.tabManager.activeWebContents()?.getURL();
    check('「すべて表示」で roopie://downloads を開く', activeTabUrl?.replace(/\/$/, ''), 'roopie://downloads');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
