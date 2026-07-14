// エントリポイント。アプリのライフサイクルだけを扱う。
// ブラウザ本体は browser.js、IPCは ipc.js、メニューは menu.js。
const { app, BrowserWindow } = require('electron');
const browser = require('./browser');
const { registerIpc } = require('./ipc');
const { setupMenu } = require('./menu');

registerIpc();

app.whenReady().then(() => {
  browser.initData();
  setupMenu();
  browser.createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => browser.flushAll());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) browser.createWindow();
});
