const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const TabManager = require('./tab-manager');

let mainWindow = null;
let tabManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 500,
    minHeight: 300,
    title: 'Roopie',
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // ブラウザUI(タブバー・ツールバー)をロード
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  tabManager = new TabManager(mainWindow);

  // UIの準備ができたら最初のタブを開く
  mainWindow.webContents.once('did-finish-load', () => {
    tabManager.createTab('https://www.google.com');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabManager = null;
  });

  setupMenu();
}

// キーボードショートカット(Chrome準拠)をメニューで定義
function setupMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        {
          label: '新しいタブ',
          accelerator: 'CmdOrCtrl+T',
          click: () => tabManager?.createTab(),
        },
        {
          label: 'タブを閉じる',
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActiveTab(),
        },
        { type: 'separator' },
        { label: '終了', role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', role: 'undo' },
        { label: 'やり直し', role: 'redo' },
        { type: 'separator' },
        { label: '切り取り', role: 'cut' },
        { label: 'コピー', role: 'copy' },
        { label: '貼り付け', role: 'paste' },
        { label: 'すべて選択', role: 'selectAll' },
      ],
    },
    {
      label: '表示',
      submenu: [
        {
          label: '再読み込み',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabManager?.reload(),
        },
        {
          label: '戻る',
          accelerator: 'Alt+Left',
          click: () => tabManager?.goBack(),
        },
        {
          label: '進む',
          accelerator: 'Alt+Right',
          click: () => tabManager?.goForward(),
        },
        { type: 'separator' },
        {
          label: 'アドレスバーにフォーカス',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('ui:focus-address-bar'),
        },
        {
          label: '次のタブ',
          accelerator: 'Ctrl+Tab',
          click: () => tabManager?.switchRelative(1),
        },
        {
          label: '前のタブ',
          accelerator: 'Ctrl+Shift+Tab',
          click: () => tabManager?.switchRelative(-1),
        },
        { type: 'separator' },
        {
          label: 'デベロッパーツール',
          accelerator: 'F12',
          click: () => tabManager?.toggleDevTools(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- レンダラー(UI)からのIPC ----
ipcMain.on('tabs:new', (_e, url) => tabManager?.createTab(url));
ipcMain.on('tabs:close', (_e, id) => tabManager?.closeTab(id));
ipcMain.on('tabs:switch', (_e, id) => tabManager?.switchTab(id));
ipcMain.on('tabs:navigate', (_e, input) => tabManager?.navigate(input));
ipcMain.on('tabs:back', () => tabManager?.goBack());
ipcMain.on('tabs:forward', () => tabManager?.goForward());
ipcMain.on('tabs:reload', () => tabManager?.reload());
ipcMain.on('tabs:stop', () => tabManager?.stop());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
