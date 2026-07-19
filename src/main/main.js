// エントリポイント。アプリのライフサイクルだけを扱う。
// ブラウザ本体は browser.js、IPCは ipc.js、メニューは menu.js。
const { app, BrowserWindow } = require('electron');
const browser = require('./browser');
const { registerIpc } = require('./ipc');
const { setupMenu } = require('./menu');
const { setupVerifyLog } = require('./verify-log');
const { setupAutoUpdater } = require('./updater');
const appState = require('./app-state');

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
  appState.init();
  setupMenu();
  // ショートカット割り当てが変わったらメニュー(アクセラレータ)を作り直し、設定画面へ配信する
  browser.onKeybindingsChanged = () => {
    setupMenu();
    browser.sendKeybindings();
  };
  // 初回起動ならイントロ、アップデート直後なら変更点を最初のタブに開く(通常は新しいタブ)。
  // 設定で「起動時に前回のタブを復元」がONなら、前回終了時のウィンドウ・タブを開き直す
  browser.openStartupWindows({ url: appState.takeStartupUrl() });
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 終了時のタブ構成を保存する(「起動時に前回のタブを復元」で使う)。
  // ウィンドウが閉じられる前に呼ぶ必要があるため、flushAllより先に行う
  browser.saveAllSessions();
  browser.flushAll();
  appState.flush();
  browser.tor.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) browser.createWindow();
});
