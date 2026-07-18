// エントリポイント。アプリのライフサイクルだけを扱う。
// ブラウザ本体は browser.js、IPCは ipc.js、メニューは menu.js。
const { app, BrowserWindow } = require('electron');
const browser = require('./browser');
const { registerIpc } = require('./ipc');
const { setupMenu } = require('./menu');
const { setupVerifyLog } = require('./verify-log');
const { setupAutoUpdater } = require('./updater');

// 二重起動を防ぐ(2つ目のインスタンスはプロファイルのキャッシュ等を壊すため)。
// 既に起動中なら、そのインスタンスのウィンドウを前面に出して終了する。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    } else {
      browser.createWindow();
    }
  });
}

registerIpc();
setupVerifyLog();

app.whenReady().then(() => {
  browser.initData();
  setupMenu();
  // ショートカット割り当てが変わったらメニュー(アクセラレータ)を作り直し、設定画面へ配信する
  browser.onKeybindingsChanged = () => {
    setupMenu();
    browser.sendKeybindings();
  };
  browser.createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  browser.flushAll();
  browser.tor.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) browser.createWindow();
});
