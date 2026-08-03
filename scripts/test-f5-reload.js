// F5キーが再読み込み(Ctrl+Rと同じ)として常に効くことの検証(再利用可能)。
// 実行: npx electron scripts/test-f5-reload.js
//
// F5はブラウザ標準の再読み込みキーだが、既定のショートカット設定(reload)はCtrl+Rのみ
// だったため効いていなかった。設定で変更できるCtrl+Rとは別枠で、Chrome/Edge同様に
// F5も常に再読み込みへ割り当てる(menu.jsの非表示メニュー項目。zoomInのCmdOrCtrl+=と同じ手法)。
const { app, Menu, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const { setupMenu } = require('../src/main/menu');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findItem(menu, predicate) {
  for (const item of menu.items) {
    if (predicate(item)) return item;
    if (item.submenu) {
      const found = findItem(item.submenu, predicate);
      if (found) return found;
    }
  }
  return null;
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    setupMenu();

    const menu = Menu.getApplicationMenu();
    check('アプリメニューが構築される', !!menu, true);

    const reloadItem = findItem(menu, (i) => i.label === '再読み込み');
    check('通常の再読み込み項目がある', !!reloadItem, true);
    check('既定はCtrl+R', reloadItem.accelerator, 'CmdOrCtrl+R');

    const f5Item = findItem(menu, (i) => i.accelerator === 'F5');
    check('F5の隠しショートカットがある', !!f5Item, true);
    check('F5は非表示(設定画面には出さない)', f5Item.visible, false);

    // 実際にF5クリック(=ショートカット発火相当)でタブマネージャーのreload()が呼ばれることを確認
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    let reloadCalled = false;
    const originalReload = tm.reload.bind(tm);
    tm.reload = () => {
      reloadCalled = true;
      return originalReload();
    };
    f5Item.click();
    await sleep(300);
    check('F5クリックでアクティブタブが再読み込みされる', reloadCalled, true);
    tm.reload = originalReload;

    browser.flushAll();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
