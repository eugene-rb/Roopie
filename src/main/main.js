const { app, BrowserWindow, WebContentsView, ipcMain, Menu, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const TabManager = require('./tab-manager');
const History = require('./history');
const Bookmarks = require('./bookmarks');
const Downloads = require('./downloads');
const Profiles = require('./profiles');
const GoogleAccounts = require('./google-accounts');
const Store = require('./store');

const PAGES_DIR = path.join(__dirname, '..', 'renderer', 'pages');
const DEFAULT_SETTINGS = { showBookmarkBar: true };

let mainWindow = null;
let tabManager = null;
let profiles = null;
let googleAccounts = null;
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
function handleInternalRequest(request) {
  const { host, pathname } = new URL(request.url);
  const relative = pathname === '/' ? `${host}.html` : pathname.slice(1);
  const filePath = path.join(PAGES_DIR, relative);
  // ディレクトリ外への参照を防ぐ
  if (!filePath.startsWith(PAGES_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }
  return net.fetch(pathToFileURL(filePath).toString());
}

// protocol.handle はセッションごとに必要(プロファイルごとにセッションが分かれるため)
function registerInternalProtocol(session) {
  if (session.protocol.isProtocolHandled('roopie')) return;
  session.protocol.handle('roopie', handleInternalRequest);
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

  profiles = new Profiles();
  const profile = profiles.active();

  // Googleアカウント一覧はプロファイル横断で共有する
  googleAccounts = new GoogleAccounts(
    new Store(path.join(app.getPath('userData'), 'google-accounts.json'), []),
    () => sendProfiles()
  );

  history = new History(store(profile, 'history', []));
  bookmarks = new Bookmarks(store(profile, 'bookmarks', []), () => sendBookmarks());
  downloads = new Downloads(store(profile, 'downloads', []), () => sendDownloads());
  settings = store(profile, 'settings', { ...DEFAULT_SETTINGS });

  const session = profiles.sessionFor(profile);
  registerInternalProtocol(session);
  downloads.attachSession(session);

  tabManager = new TabManager(mainWindow, { history, bookmarks, session });
  tabManager.setOverlay(createOverlayView(session));

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    sendAll();
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

function store(profile, key, defaultValue) {
  return new Store(profiles.dataFile(profile, key), defaultValue);
}

// ページの上に重ねる透明View。プルダウンメニューをここに描画する
// (タブはネイティブViewなので、通常のHTMLドロップダウンはページの下に隠れてしまう)
function createOverlayView(session) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'internal-preload.js'),
      session,
      transparent: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#00000000');
  view.webContents.loadURL('roopie://menu');
  return view;
}


// ---- プロファイル ----

// アクティブなプロファイルのデータ/セッションを各機能へ適用する
function applyActiveProfile({ recreateTabs } = {}) {
  const profile = profiles.active();

  history.setStore(store(profile, 'history', []));
  bookmarks.setStore(store(profile, 'bookmarks', []));
  downloads.setStore(store(profile, 'downloads', []));
  settings.flush();
  settings = store(profile, 'settings', { ...DEFAULT_SETTINGS });

  const session = profiles.sessionFor(profile);
  registerInternalProtocol(session);
  downloads.attachSession(session);
  if (recreateTabs) tabManager.switchSession(session);

  sendAll();
}

function switchProfile(id) {
  if (!profiles.switchTo(id)) return;
  applyActiveProfile({ recreateTabs: true });
}

// 共有トグルの変更は、そのプロファイルがアクティブなときだけ保存先の切り替えが必要
function setShared(id, key, shared) {
  profiles.setShared(id, key, shared);
  if (id === profiles.activeId) applyActiveProfile();
  else sendProfiles();
}

// ---- レンダラーへの状態送信 ----
function broadcast(channel, payload) {
  // 起動直後(ウィンドウ生成中)に呼ばれることがあるので存在確認する
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
  tabManager?.broadcastToInternal(channel, payload);
}

function sendBookmarks() {
  if (!bookmarks) return;
  broadcast('bookmarks:state', bookmarks.list());
  tabManager?.sendState(); // スターボタンの状態を更新
}

function sendDownloads() {
  if (!downloads) return;
  broadcast('downloads:state', {
    items: downloads.list(),
    hasActive: downloads.hasActive(),
  });
}

function sendProfiles() {
  if (!profiles) return;
  broadcast('profiles:state', {
    profiles: profiles.list(),
    activeId: profiles.activeId,
    googleAccounts: googleAccounts?.list() ?? [],
  });
}

function sendSettings() {
  if (!settings) return;
  broadcast('ui:settings', settings.data);
}

function sendAll() {
  sendProfiles();
  sendSettings();
  sendBookmarks();
  sendDownloads();
}

function toggleBookmarkBar() {
  settings.data.showBookmarkBar = !settings.data.showBookmarkBar;
  settings.save();
  sendSettings();
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
    {
      label: 'プロファイル',
      submenu: [
        {
          label: 'プロファイルと設定',
          accelerator: 'CmdOrCtrl+,',
          click: () => tabManager?.createTab('roopie://settings'),
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

// プロファイルのプルダウン: ツールバーのボタン位置(anchor)を受け取り、オーバーレイに描画させる
ipcMain.on('menu:open-profiles', (_e, anchor) => {
  if (!tabManager?.overlay || !profiles) return;
  tabManager.showOverlay(true);
  tabManager.overlay.webContents.send('menu:show', {
    profiles: profiles.list(),
    activeId: profiles.activeId,
    anchor,
  });
});
ipcMain.on('menu:close', () => tabManager?.showOverlay(false));

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

ipcMain.handle('profiles:list', () => ({
  profiles: profiles?.list() ?? [],
  activeId: profiles?.activeId ?? null,
}));
ipcMain.on('profiles:create', (_e, name) => {
  profiles?.create(name);
  sendProfiles();
});
ipcMain.on('profiles:rename', (_e, id, name) => {
  profiles?.rename(id, name);
  sendProfiles();
});
ipcMain.on('profiles:remove', (_e, id) => {
  const wasActive = profiles?.activeId === id;
  // 使用中のプロファイルを消した場合だけ、別プロファイルへ切り替えてタブを作り直す
  if (profiles?.remove(id)) applyActiveProfile({ recreateTabs: wasActive });
});
ipcMain.on('profiles:switch', (_e, id) => switchProfile(id));
ipcMain.on('profiles:set-shared', (_e, id, key, shared) => setShared(id, key, shared));

// ---- Googleアカウント ----
ipcMain.handle('google:list', () => googleAccounts?.list() ?? []);
ipcMain.on('google:add', (_e, email, label) => googleAccounts?.add(email, label));
ipcMain.on('google:remove', (_e, accountId) => {
  profiles?.forgetAccount(accountId);
  googleAccounts?.remove(accountId);
  sendProfiles();
});
ipcMain.on('google:set-enabled', (_e, profileId, accountId, enabled) => {
  profiles?.setGoogleEnabled(profileId, accountId, enabled);
  sendProfiles();
});
ipcMain.on('google:set-primary', (_e, profileId, accountId) => {
  profiles?.setGooglePrimary(profileId, accountId);
  sendProfiles();
});

// 実際にログイン中のアカウントは、そのプロファイルのセッションのCookieから取得する
ipcMain.handle('google:signed-in', async (_e, profileId) => {
  const profile = profiles?.list().find((p) => p.id === profileId);
  if (!profile) return [];
  return GoogleAccounts.signedInAccounts(profiles.sessionFor(profile));
});

// ログインはそのプロファイルのセッションで行う必要があるので、必要なら先に切り替える
ipcMain.on('google:login', (_e, profileId, accountId) => {
  const profile = profiles?.list().find((p) => p.id === profileId);
  if (!profile) return;
  const target = accountId ?? profile.google.primaryId;
  const account = target ? googleAccounts?.find(target) : null;
  if (profileId !== profiles.activeId) switchProfile(profileId);
  tabManager?.createTab(GoogleAccounts.loginUrl(account?.email));
});

ipcMain.on('google:signout', async (_e, profileId) => {
  const profile = profiles?.list().find((p) => p.id === profileId);
  if (!profile) return;
  await GoogleAccounts.signOut(profiles.sessionFor(profile));
  sendProfiles();
});

ipcMain.handle('settings:get', () => settings?.data ?? { ...DEFAULT_SETTINGS });
ipcMain.on('settings:set', (_e, key, value) => {
  if (!settings || !(key in DEFAULT_SETTINGS)) return;
  settings.data[key] = value;
  settings.save();
  sendSettings();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  profiles?.store.flush();
  googleAccounts?.store.flush();
  history?.store.flush();
  bookmarks?.store.flush();
  downloads?.store.flush();
  settings?.flush();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
