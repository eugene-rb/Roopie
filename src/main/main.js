const { app, BrowserWindow, ipcMain, Menu, protocol, net, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const TabManager = require('./tab-manager');
const History = require('./history');
const Bookmarks = require('./bookmarks');
const Downloads = require('./downloads');
const Store = require('./store');

const PAGES_DIR = path.join(__dirname, '..', 'renderer', 'pages');

let mainWindow = null;
let tabManager = null;
let history = null;
let bookmarks = null;
let downloads = null;
let settings = null;

// 内部ページ用スキーム(roopie://newtab など)。app.ready前に宣言する必要がある。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'roopie',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// roopie://<host>/<path> を src/renderer/pages 配下のファイルへ解決する
function registerInternalProtocol() {
  protocol.handle('roopie', (request) => {
    const { host, pathname } = new URL(request.url);
    const relative = pathname === '/' ? `${host}.html` : pathname.slice(1);
    const filePath = path.join(PAGES_DIR, relative);
    // ディレクトリ外への参照を防ぐ
    if (!filePath.startsWith(PAGES_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

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

  history = new History();
  bookmarks = new Bookmarks(() => sendBookmarks());
  downloads = new Downloads(session.defaultSession, () => sendDownloads());
  settings = new Store('settings.json', { showBookmarkBar: true });

  tabManager = new TabManager(mainWindow, { history, bookmarks });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('ui:settings', settings.data);
    sendBookmarks();
    sendDownloads();
    tabManager.createTab();
  });

  // マウスの戻る/進むボタン
  mainWindow.on('app-command', (_e, command) => {
    if (command === 'browser-backward') tabManager?.goBack();
    if (command === 'browser-forward') tabManager?.goForward();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabManager = null;
  });

  setupMenu();
}

function sendBookmarks() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const items = bookmarks.list();
  mainWindow.webContents.send('bookmarks:state', items);
  tabManager?.broadcastToInternal('bookmarks:state', items);
  tabManager?.sendState(); // スターボタンの状態を更新
}

function sendDownloads() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = { items: downloads.list(), hasActive: downloads.hasActive() };
  mainWindow.webContents.send('downloads:state', state);
  tabManager?.broadcastToInternal('downloads:state', state);
}

function toggleBookmarkBar() {
  settings.data.showBookmarkBar = !settings.data.showBookmarkBar;
  settings.save();
  mainWindow?.webContents.send('ui:settings', settings.data);
}

// キーボードショートカット(Chrome準拠)をメニューで定義
function setupMenu() {
  const tabNumberShortcuts = Array.from({ length: 9 }, (_v, i) => ({
    label: `タブ ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    visible: false,
    click: () => tabManager?.switchToIndex(i),
  }));

  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新しいタブ', accelerator: 'CmdOrCtrl+T', click: () => tabManager?.createTab() },
        { label: 'タブを閉じる', accelerator: 'CmdOrCtrl+W', click: () => tabManager?.closeActiveTab() },
        { type: 'separator' },
        { label: '印刷', accelerator: 'CmdOrCtrl+P', click: () => tabManager?.activeWebContents()?.print() },
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
        { type: 'separator' },
        {
          label: 'ページ内を検索',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('ui:open-find'),
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => tabManager?.reload() },
        { label: '戻る', accelerator: 'Alt+Left', click: () => tabManager?.goBack() },
        { label: '進む', accelerator: 'Alt+Right', click: () => tabManager?.goForward() },
        { type: 'separator' },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => tabManager?.zoom(1) },
        { label: '拡大 ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => tabManager?.zoom(1) },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => tabManager?.zoom(-1) },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: () => tabManager?.zoom(0) },
        { type: 'separator' },
        { label: '全画面表示', role: 'togglefullscreen' },
        {
          label: 'ブックマークバーを表示',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: toggleBookmarkBar,
        },
        { type: 'separator' },
        {
          label: 'アドレスバーにフォーカス',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('ui:focus-address-bar'),
        },
        { label: '次のタブ', accelerator: 'Ctrl+Tab', click: () => tabManager?.switchRelative(1) },
        { label: '前のタブ', accelerator: 'Ctrl+Shift+Tab', click: () => tabManager?.switchRelative(-1) },
        ...tabNumberShortcuts,
        { type: 'separator' },
        { label: 'デベロッパーツール', accelerator: 'F12', click: () => tabManager?.toggleDevTools() },
      ],
    },
    {
      label: 'ブックマーク',
      submenu: [
        {
          label: 'このページをブックマーク',
          accelerator: 'CmdOrCtrl+D',
          click: () => tabManager?.toggleBookmarkForActiveTab(),
        },
        {
          label: 'ブックマークマネージャ',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => tabManager?.createTab('roopie://bookmarks'),
        },
      ],
    },
    {
      label: '履歴',
      submenu: [
        {
          label: '履歴を表示',
          accelerator: 'CmdOrCtrl+H',
          click: () => tabManager?.createTab('roopie://history'),
        },
        {
          label: 'ダウンロード',
          accelerator: 'CmdOrCtrl+J',
          click: () => tabManager?.createTab('roopie://downloads'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- ブラウザUI(レンダラー)からのIPC ----
ipcMain.on('tabs:new', (_e, url) => tabManager?.createTab(url || undefined));
ipcMain.on('tabs:close', (_e, id) => tabManager?.closeTab(id));
ipcMain.on('tabs:switch', (_e, id) => tabManager?.switchTab(id));
ipcMain.on('tabs:navigate', (_e, input) => tabManager?.navigate(input));
ipcMain.on('tabs:back', () => tabManager?.goBack());
ipcMain.on('tabs:forward', () => tabManager?.goForward());
ipcMain.on('tabs:reload', () => tabManager?.reload());
ipcMain.on('tabs:stop', () => tabManager?.stop());
ipcMain.on('tabs:zoom', (_e, direction) => tabManager?.zoom(direction));

ipcMain.on('ui:chrome-height', (_e, height) => tabManager?.setChromeHeight(height));
ipcMain.on('ui:toggle-bookmark-bar', toggleBookmarkBar);

ipcMain.on('find:start', (_e, text, options) => tabManager?.find(text, options));
ipcMain.on('find:stop', () => tabManager?.stopFind());

ipcMain.on('bookmarks:toggle-current', () => tabManager?.toggleBookmarkForActiveTab());
ipcMain.on('bookmarks:remove', (_e, id) => bookmarks?.remove(id));
ipcMain.on('bookmarks:rename', (_e, id, title) => bookmarks?.rename(id, title));
ipcMain.handle('bookmarks:list', () => bookmarks?.list() ?? []);

ipcMain.handle('history:list', (_e, query) => history?.list(query) ?? []);
ipcMain.on('history:remove', (_e, id) => history?.remove(id));
ipcMain.on('history:clear', () => history?.clear());

ipcMain.handle('downloads:list', () => downloads?.list() ?? []);
ipcMain.on('downloads:open', (_e, id) => downloads?.open(id));
ipcMain.on('downloads:show-in-folder', (_e, id) => downloads?.showInFolder(id));
ipcMain.on('downloads:pause', (_e, id) => downloads?.pause(id));
ipcMain.on('downloads:resume', (_e, id) => downloads?.resume(id));
ipcMain.on('downloads:cancel', (_e, id) => downloads?.cancel(id));
ipcMain.on('downloads:remove', (_e, id) => downloads?.remove(id));
ipcMain.on('downloads:clear', () => downloads?.clear());

app.whenReady().then(() => {
  registerInternalProtocol();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  history?.store.flush();
  bookmarks?.store.flush();
  downloads?.store.flush();
  settings?.flush();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
