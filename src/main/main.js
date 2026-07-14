const { app, BrowserWindow, WebContentsView, ipcMain, Menu, protocol, net, session: electronSession } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const TabManager = require('./tab-manager');
const History = require('./history');
const Bookmarks = require('./bookmarks');
const Downloads = require('./downloads');
const Profiles = require('./profiles');
const GoogleAccounts = require('./google-accounts');
const Gestures = require('./gestures');
const SidePanel = require('./side-panel');
const ExtensionSupport = require('./extension-support');
const AdBlock = require('./adblock');
const Passwords = require('./passwords');
const Store = require('./store');
const windows = require('./windows');

const PAGES_DIR = path.join(__dirname, '..', 'renderer', 'pages');
const DEFAULT_SETTINGS = { showBookmarkBar: true, adblock: true, savePasswords: true };

// テーマ(アクセントカラー / 新しいタブの背景 / カスタムCSS)
const DEFAULT_THEME = { accent: '#6c8cff', background: 'auto', customCss: '' };
const THEME_BACKGROUNDS = ['auto', 'dawn', 'day', 'dusk', 'night', 'plain'];
const MAX_CUSTOM_CSS = 50000;

// 保存確認バーで「保存する」が押されるまで、平文パスワードをここに一時保持する
let pendingPassword = null;

// プロファイル単位のデータ(全ウィンドウで共有する)
let profiles = null;
let googleAccounts = null;
let history = null;
let bookmarks = null;
let downloads = null;
let settings = null;
let gestures = null;
let theme = null;
let passwords = null;
const extensionSupport = new ExtensionSupport();
const adblock = new AdBlock();

let incognitoCount = 0;

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

// マウスジェスチャー / パスワード検出用のpreloadをセッション内の全ページに注入する
// (webPreferences.preload と併用できるので、内部ページでもジェスチャーが効く)
const pagePreloadSessions = new WeakSet();
function registerPagePreloads(session) {
  if (pagePreloadSessions.has(session)) return;
  pagePreloadSessions.add(session);
  for (const name of ['gesture-preload.js', 'password-preload.js']) {
    session.registerPreloadScript({
      type: 'frame',
      filePath: path.join(__dirname, '..', 'preload', name),
    });
  }
}

// ---- プロファイル単位のデータの初期化 ----

function store(profile, key, defaultValue) {
  return new Store(profiles.dataFile(profile, key), defaultValue);
}

function initData() {
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
  gestures = new Gestures(store(profile, 'gestures', Gestures.defaults()));
  theme = store(profile, 'theme', { ...DEFAULT_THEME });
  passwords = new Passwords(store(profile, 'passwords', []));
}

// ---- ウィンドウ ----

// シークレットウィンドウ用のセッション(persist: を付けない = メモリ内のみ)。
// ウィンドウを閉じるとCookieもキャッシュも消える。
function createIncognitoSession() {
  return electronSession.fromPartition(`incognito-${++incognitoCount}`);
}

// シークレットでは履歴を残さない(Historyと同じインターフェースの空実装)
const NULL_HISTORY = {
  add() {},
  update() {},
  list: () => [],
  remove() {},
  clear() {},
};

// シークレットのサイドパネルはディスクに書かない(メモリ内のみのストア)
function memoryStore(defaultValue) {
  return { data: defaultValue, save() {}, flush() {} };
}

function createWindow({ incognito = false } = {}) {
  const profile = profiles.active();
  const session = incognito ? createIncognitoSession() : profiles.sessionFor(profile);

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 500,
    minHeight: 300,
    title: incognito ? 'Roopie(シークレット)' : 'Roopie',
    backgroundColor: incognito ? '#1b1730' : '#16181d',
    // ネイティブのタイトルバーを外し、タブバーをタイトルバーとして使う
    // (ウィンドウ操作ボタンはOS標準のオーバーレイを右上に重ねる)
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: incognito ? '#1b1730' : '#16181d',
      symbolColor: '#e5e7eb',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerInternalProtocol(session);
  registerPagePreloads(session);
  if (!incognito) downloads.attachSession(session);
  applyAdblock(session);

  const tabManager = new TabManager(window, {
    history: incognito ? NULL_HISTORY : history,
    bookmarks,
    session,
  });
  tabManager.setOverlay(createOverlayView(session));

  const sidePanel = new SidePanel(window, {
    session,
    store: incognito
      ? memoryStore({ webPanels: [], notes: '' })
      : store(profile, 'sidepanel', { webPanels: [], notes: '' }),
    tabManager,
    onState: () => sendSidePanel(ctx),
  });
  tabManager.setSidePanel(sidePanel);

  const ctx = windows.add({ window, tabManager, sidePanel, session, incognito });

  // 拡張機能はシークレット(非永続セッション)では動かないので取り付けない
  if (!incognito) {
    extensionSupport.setBrowser({ tabManager, window });
    tabManager.onTabCreated = (tab) => extensionSupport.addTab(tab.view.webContents);
    tabManager.onTabSelected = (tab) => extensionSupport.selectTab(tab.view.webContents);
    extensionSupport
      .attach(session, profile.id)
      .catch((err) => console.error('拡張機能サポートの初期化に失敗:', err));
  }

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  window.webContents.once('did-finish-load', () => {
    window.webContents.send('ui:window', { incognito });
    sendAllTo(ctx);
    tabManager.createTab();
  });

  // マウスの戻る/進むボタン
  window.on('app-command', (_e, command) => {
    if (command === 'browser-backward') tabManager.goBack();
    if (command === 'browser-forward') tabManager.goForward();
  });

  // シークレットのセッションはウィンドウを閉じたら破棄する
  window.on('closed', () => {
    if (incognito) session.clearStorageData().catch(() => {});
  });

  return ctx;
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

// ---- 広告ブロック ----

// 設定に応じて、指定セッション(省略時は全ウィンドウ)へ広告ブロックを適用する
function applyAdblock(session) {
  const enabled = settings?.data.adblock !== false;
  const targets = session ? [session] : windows.all().map((c) => c.session);
  for (const target of targets) {
    adblock.apply(target, enabled).catch((err) => console.error('広告ブロックの適用に失敗:', err));
  }
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
  gestures.setStore(store(profile, 'gestures', Gestures.defaults()));
  theme.flush();
  theme = store(profile, 'theme', { ...DEFAULT_THEME });
  passwords.setStore(store(profile, 'passwords', []));

  const session = profiles.sessionFor(profile);
  registerInternalProtocol(session);
  registerPagePreloads(session);
  downloads.attachSession(session);
  extensionSupport
    .attach(session, profile.id)
    .catch((err) => console.error('拡張機能サポートの初期化に失敗:', err));

  // プロファイルの切り替えはシークレット以外の全ウィンドウに適用する
  for (const ctx of windows.normal()) {
    ctx.session = session;
    ctx.sidePanel.setStore(store(profile, 'sidepanel', { webPanels: [], notes: '' }));
    if (recreateTabs) {
      ctx.tabManager.switchSession(session);
      ctx.sidePanel.switchSession(session);
    }
  }
  applyAdblock();

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

// 1ウィンドウ内のUI・内部ページ・サイドパネルへ送る
function sendToContext(ctx, channel, payload) {
  if (ctx.window.isDestroyed()) return;
  ctx.window.webContents.send(channel, payload);
  ctx.tabManager.broadcastToInternal(channel, payload);
  ctx.sidePanel.sendToPanel(channel, payload); // パネルUIはタブ一覧に含まれないため個別に送る
}

function broadcast(channel, payload) {
  for (const ctx of windows.all()) {
    sendToContext(ctx, channel, payload);
  }
}

function sendBookmarks() {
  if (!bookmarks) return;
  broadcast('bookmarks:state', bookmarks.list());
  for (const ctx of windows.all()) ctx.tabManager.sendState(); // スターボタンの状態を更新
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

function sendGestures() {
  if (!gestures) return;
  const config = gestures.config();
  broadcast('gestures:state', config); // 設定画面(内部ページ)向け
  // 各タブのジェスチャーpreload向け(通常タブにも送る必要があるためbroadcastとは別)
  for (const ctx of windows.all()) {
    for (const tab of ctx.tabManager.tabs) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send('gestures:config', config);
    }
  }
}

// サイドパネルの状態はウィンドウごとに異なる
function sendSidePanel(ctx) {
  if (!ctx || ctx.window.isDestroyed()) return;
  sendToContext(ctx, 'sidepanel:state', ctx.sidePanel.state());
}

function sendTheme() {
  if (!theme) return;
  broadcast('theme:state', theme.data);
}

function sendPasswords() {
  if (!passwords) return;
  broadcast('passwords:state', passwords.list());
}

function sendAll() {
  sendProfiles();
  sendSettings();
  sendGestures();
  sendBookmarks();
  sendDownloads();
  sendTheme();
  sendPasswords();
  for (const ctx of windows.all()) sendSidePanel(ctx);
}

// 新しく開いたウィンドウにだけ現在の状態を流し込む
function sendAllTo(ctx) {
  sendToContext(ctx, 'profiles:state', {
    profiles: profiles.list(),
    activeId: profiles.activeId,
    googleAccounts: googleAccounts?.list() ?? [],
  });
  sendToContext(ctx, 'ui:settings', settings.data);
  sendToContext(ctx, 'gestures:state', gestures.config());
  sendToContext(ctx, 'bookmarks:state', bookmarks.list());
  sendToContext(ctx, 'downloads:state', {
    items: downloads.list(),
    hasActive: downloads.hasActive(),
  });
  sendToContext(ctx, 'theme:state', theme.data);
  sendSidePanel(ctx);
}

function toggleBookmarkBar() {
  settings.data.showBookmarkBar = !settings.data.showBookmarkBar;
  settings.save();
  sendSettings();
}

// ---- メニュー(キーボードショートカット) ----

// メニュー操作はフォーカス中のウィンドウに対して行う
const focusedTabs = () => windows.focused()?.tabManager ?? null;

function setupMenu() {
  const tabNumberShortcuts = Array.from({ length: 9 }, (_v, i) => ({
    label: `タブ ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    visible: false,
    click: () => focusedTabs()?.switchToIndex(i),
  }));

  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新しいタブ', accelerator: 'CmdOrCtrl+T', click: () => focusedTabs()?.createTab() },
        { label: '新しいウィンドウ', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        {
          label: '新しいシークレットウィンドウ',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow({ incognito: true }),
        },
        { type: 'separator' },
        { label: 'タブを閉じる', accelerator: 'CmdOrCtrl+W', click: () => focusedTabs()?.closeActiveTab() },
        { label: 'ウィンドウを閉じる', accelerator: 'CmdOrCtrl+Shift+W', click: () => windows.focused()?.window.close() },
        { type: 'separator' },
        { label: '印刷', accelerator: 'CmdOrCtrl+P', click: () => focusedTabs()?.activeWebContents()?.print() },
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
          click: () => windows.focused()?.window.webContents.send('ui:open-find'),
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => focusedTabs()?.reload() },
        { label: '戻る', accelerator: 'Alt+Left', click: () => focusedTabs()?.goBack() },
        { label: '進む', accelerator: 'Alt+Right', click: () => focusedTabs()?.goForward() },
        { type: 'separator' },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => focusedTabs()?.zoom(1) },
        { label: '拡大 ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => focusedTabs()?.zoom(1) },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => focusedTabs()?.zoom(-1) },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: () => focusedTabs()?.zoom(0) },
        { type: 'separator' },
        { label: '全画面表示', role: 'togglefullscreen' },
        {
          label: 'ブックマークバーを表示',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: toggleBookmarkBar,
        },
        {
          label: 'サイドパネル',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => windows.focused()?.sidePanel.toggle(),
        },
        { type: 'separator' },
        {
          label: 'アドレスバーにフォーカス',
          accelerator: 'CmdOrCtrl+L',
          click: () => windows.focused()?.window.webContents.send('ui:focus-address-bar'),
        },
        { label: '次のタブ', accelerator: 'Ctrl+Tab', click: () => focusedTabs()?.switchRelative(1) },
        { label: '前のタブ', accelerator: 'Ctrl+Shift+Tab', click: () => focusedTabs()?.switchRelative(-1) },
        ...tabNumberShortcuts,
        { type: 'separator' },
        { label: 'デベロッパーツール', accelerator: 'F12', click: () => focusedTabs()?.toggleDevTools() },
      ],
    },
    {
      label: 'ブックマーク',
      submenu: [
        {
          label: 'このページをブックマーク',
          accelerator: 'CmdOrCtrl+D',
          click: () => focusedTabs()?.toggleBookmarkForActiveTab(),
        },
        {
          label: 'ブックマークマネージャ',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => focusedTabs()?.createTab('roopie://bookmarks'),
        },
      ],
    },
    {
      label: '履歴',
      submenu: [
        {
          label: '履歴を表示',
          accelerator: 'CmdOrCtrl+H',
          click: () => focusedTabs()?.createTab('roopie://history'),
        },
        {
          label: 'ダウンロード',
          accelerator: 'CmdOrCtrl+J',
          click: () => focusedTabs()?.createTab('roopie://downloads'),
        },
      ],
    },
    {
      label: 'プロファイル',
      submenu: [
        {
          label: 'プロファイルと設定',
          accelerator: 'CmdOrCtrl+,',
          click: () => focusedTabs()?.createTab('roopie://settings'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC(送信元のウィンドウに対して処理する) ----

const ctxOf = (e) => windows.contextFor(e.sender);
const tabsOf = (e) => ctxOf(e)?.tabManager ?? null;

ipcMain.on('tabs:new', (e, url) => tabsOf(e)?.createTab(url || undefined));
ipcMain.on('tabs:close', (e, id) => tabsOf(e)?.closeTab(id));
ipcMain.on('tabs:switch', (e, id) => tabsOf(e)?.switchTab(id));
ipcMain.on('tabs:move', (e, id, toIndex) => tabsOf(e)?.moveTab(id, toIndex));
ipcMain.on('tabs:navigate', (e, input) => tabsOf(e)?.navigate(input));
ipcMain.on('tabs:back', (e) => tabsOf(e)?.goBack());
ipcMain.on('tabs:forward', (e) => tabsOf(e)?.goForward());
ipcMain.on('tabs:reload', (e) => tabsOf(e)?.reload());
ipcMain.on('tabs:stop', (e) => tabsOf(e)?.stop());
ipcMain.on('tabs:zoom', (e, direction) => tabsOf(e)?.zoom(direction));

ipcMain.on('window:new', () => createWindow());
ipcMain.on('window:new-incognito', () => createWindow({ incognito: true }));

ipcMain.on('ui:chrome-height', (e, height) => tabsOf(e)?.setChromeHeight(height));
ipcMain.on('ui:toggle-bookmark-bar', toggleBookmarkBar);

// プロファイルのプルダウン: ツールバーのボタン位置(anchor)を受け取り、オーバーレイに描画させる
ipcMain.on('menu:open-profiles', (e, anchor) => {
  const tabManager = tabsOf(e);
  if (!tabManager?.overlay || !profiles) return;
  tabManager.showOverlay(true);
  tabManager.overlay.webContents.send('menu:show', {
    profiles: profiles.list(),
    activeId: profiles.activeId,
    anchor,
  });
});
ipcMain.on('menu:close', (e) => tabsOf(e)?.showOverlay(false));

ipcMain.on('find:start', (e, text, options) => tabsOf(e)?.find(text, options));
ipcMain.on('find:stop', (e) => tabsOf(e)?.stopFind());

ipcMain.on('bookmarks:toggle-current', (e) => tabsOf(e)?.toggleBookmarkForActiveTab());
ipcMain.on('bookmarks:remove', (_e, id) => bookmarks?.remove(id));
ipcMain.on('bookmarks:rename', (_e, id, title) => bookmarks?.rename(id, title));
ipcMain.handle('bookmarks:list', () => bookmarks?.list() ?? []);

// シークレットウィンドウの内部ページからは履歴を参照させない
ipcMain.handle('history:list', (e, query) =>
  ctxOf(e)?.incognito ? [] : history?.list(query) ?? []
);
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
ipcMain.on('google:login', (e, profileId, accountId) => {
  const profile = profiles?.list().find((p) => p.id === profileId);
  if (!profile) return;
  const target = accountId ?? profile.google.primaryId;
  const account = target ? googleAccounts?.find(target) : null;
  if (profileId !== profiles.activeId) switchProfile(profileId);
  tabsOf(e)?.createTab(GoogleAccounts.loginUrl(account?.email));
});

ipcMain.on('google:signout', async (_e, profileId) => {
  const profile = profiles?.list().find((p) => p.id === profileId);
  if (!profile) return;
  await GoogleAccounts.signOut(profiles.sessionFor(profile));
  sendProfiles();
});

// ---- サイドパネル ----
const panelOf = (e) => ctxOf(e)?.sidePanel ?? null;

ipcMain.on('sidepanel:toggle', (e) => panelOf(e)?.toggle());
ipcMain.handle('sidepanel:state', (e) => panelOf(e)?.state() ?? null);
ipcMain.on('sidepanel:add-web', (e, url) => panelOf(e)?.addWeb(url));
ipcMain.on('sidepanel:remove-web', (e, id) => panelOf(e)?.removeWeb(id));
ipcMain.on('sidepanel:open-web', (e, id) => panelOf(e)?.openWeb(id));
ipcMain.on('sidepanel:close-web', (e) => panelOf(e)?.closeWeb());
ipcMain.on('sidepanel:reload-web', (e) => panelOf(e)?.reloadWeb());
ipcMain.on('sidepanel:set-notes', (e, text) => panelOf(e)?.setNotes(text));

// ---- パスワード ----
// ページのpreloadがログイン送信を検出したら、未保存のときだけUIに確認バーを出す
ipcMain.on('passwords:captured', (e, { origin, username, password } = {}) => {
  const ctx = ctxOf(e);
  if (!passwords || !ctx || ctx.incognito) return; // シークレットでは保存しない
  if (!origin || !username || !password) return;
  if (settings?.data.savePasswords === false) return;
  if (!Passwords.available()) return;
  if (passwords.matches(origin, username, password)) return; // 同じ内容なら何も出さない

  const existing = passwords.find(origin, username);
  pendingPassword = { origin, username, password };
  ctx.window.webContents.send('passwords:prompt', {
    origin,
    username,
    isUpdate: !!existing, // 既存の別パスワード = 更新の確認
  });
});

// 保存確認バーの「保存する」
ipcMain.on('passwords:confirm-save', () => {
  if (!pendingPassword) return;
  const { origin, username, password } = pendingPassword;
  pendingPassword = null;
  passwords?.save(origin, username, password);
  sendPasswords();
});
ipcMain.on('passwords:dismiss', () => {
  pendingPassword = null;
});

// シークレットでは自動入力もしない
ipcMain.handle('passwords:for-origin', (e, origin) => {
  if (ctxOf(e)?.incognito) return [];
  if (settings?.data.savePasswords === false) return [];
  return passwords?.forOrigin(origin) ?? [];
});

ipcMain.handle('passwords:list', () => passwords?.list() ?? []);
ipcMain.handle('passwords:reveal', (_e, id) => passwords?.reveal(id) ?? null);
ipcMain.handle('passwords:available', () => Passwords.available());
ipcMain.on('passwords:remove', (_e, id) => {
  passwords?.remove(id);
  sendPasswords();
});
ipcMain.on('passwords:clear', () => {
  passwords?.clear();
  sendPasswords();
});

// ---- 拡張機能 ----
ipcMain.handle('extensions:install', async (_e, extensionId) => {
  const profile = profiles.active();
  const ext = await extensionSupport.install(profiles.sessionFor(profile), profile.id, extensionId);
  return { id: ext.id, name: ext.name, version: ext.version };
});
ipcMain.handle('extensions:list', () =>
  extensionSupport.list(profiles.sessionFor(profiles.active()))
);

// ---- テーマ ----
ipcMain.handle('theme:get', () => theme?.data ?? { ...DEFAULT_THEME });
ipcMain.on('theme:set', (_e, patch) => {
  if (!theme || !patch) return;
  if (typeof patch.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.accent)) {
    theme.data.accent = patch.accent.toLowerCase();
  }
  if (THEME_BACKGROUNDS.includes(patch.background)) {
    theme.data.background = patch.background;
  }
  if (typeof patch.customCss === 'string') {
    theme.data.customCss = patch.customCss.slice(0, MAX_CUSTOM_CSS);
  }
  theme.save();
  sendTheme();
});

// ---- マウスジェスチャー ----
ipcMain.handle('gestures:config', () => gestures?.config() ?? null);
ipcMain.on('gestures:set', (_e, config) => {
  gestures?.update(config);
  sendGestures();
});
ipcMain.on('gestures:reset', () => {
  gestures?.reset();
  sendGestures();
});

// ジェスチャーpreloadからのアクション実行要求(送信元のタブに対して実行する)
ipcMain.on('gestures:perform', (e, action) => {
  const tabManager = tabsOf(e);
  if (!gestures?.data.enabled || !tabManager) return;
  const wc = e.sender;
  switch (action) {
    case 'back':
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case 'forward':
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      break;
    case 'reload':
      wc.reload();
      break;
    case 'closeTab': {
      const tab = tabManager.tabs.find((t) => t.view.webContents === wc);
      if (tab) tabManager.closeTab(tab.id);
      break;
    }
    case 'newTab':
      tabManager.createTab();
      break;
    case 'nextTab':
      tabManager.switchRelative(1);
      break;
    case 'prevTab':
      tabManager.switchRelative(-1);
      break;
  }
});

ipcMain.handle('settings:get', () => settings?.data ?? { ...DEFAULT_SETTINGS });
ipcMain.on('settings:set', (_e, key, value) => {
  if (!settings || !(key in DEFAULT_SETTINGS)) return;
  settings.data[key] = value;
  settings.save();
  if (key === 'adblock') applyAdblock();
  sendSettings();
});

app.whenReady().then(() => {
  initData();
  setupMenu();
  createWindow();
});

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
  gestures?.store.flush();
  theme?.flush();
  passwords?.store.flush();
  for (const ctx of windows.all()) {
    if (!ctx.incognito) ctx.sidePanel.store.flush();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
