const { app, BrowserWindow, WebContentsView, protocol, net, session: electronSession } = require('electron');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const TabManager = require('./tab-manager');
const History = require('./history');
const Bookmarks = require('./bookmarks');
const Readlist = require('./readlist');
const Downloads = require('./downloads');
const Profiles = require('./profiles');
const GoogleAccounts = require('./google-accounts');
const Gestures = require('./gestures');
const SidePanel = require('./side-panel');
const MediaPlayer = require('./media-player');
const ExtensionSupport = require('./extension-support');
const AdBlock = require('./adblock');
const Tor = require('./tor');
const Passwords = require('./passwords');
const Store = require('./store');
const windows = require('./windows');
const { defaultToolbarItems, normalizeToolbarItems } = require('./toolbar-items');
const { Keybindings } = require('./keybindings');
const LocalServers = require('./local-servers');

const PAGES_DIR = path.join(__dirname, '..', 'renderer', 'pages');
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');

const DEFAULT_SETTINGS = {
  showBookmarkBar: true,
  adblock: true,
  savePasswords: true,
  mediaDocked: false,
  mediaCorner: 'bottom-right',
  downloadPath: '', // 空ならOS既定(session.setDownloadPathを呼ばない)
  tabBarPosition: 'top', // 'top' | 'left'
  sidePanelPosition: 'right', // 'left' | 'right'
  searchEngine: 'google', // 'google' | 'duckduckgo' | 'yahoo' | 'bing' | 'ecosia' | 'startpage'
  toolbarItems: defaultToolbarItems(), // ツールバーのユーティリティ項目の表示/順序
};
const DEFAULT_THEME = { accent: '#6c8cff', background: 'auto', backgroundImage: '', customCss: '' };
const THEME_BACKGROUNDS = ['auto', 'dawn', 'day', 'dusk', 'night', 'plain', 'image'];
const MAX_CUSTOM_CSS = 50000;
const MAX_BACKGROUND_IMAGE = 4_000_000; // data URIとして保存するため大きめに許容(4MB程度)
const TAB_BAR_WIDTH = 220; // 縦タブ表示時のタブバー幅(tailwind.cssの#tab-barの幅と一致させる)

// ウィンドウの背景色(ページの周囲に見える「額縁」の色)
const FRAME_COLOR = '#16181d';
const FRAME_COLOR_INCOGNITO = '#1b1730';

/**
 * ブラウザ本体。プロファイル単位のデータと、ウィンドウの生成・状態配信を担う。
 * IPCの受付は ipc.js、メニューは menu.js に分離してある。
 */
const browser = {
  DEFAULT_SETTINGS,
  DEFAULT_THEME,
  THEME_BACKGROUNDS,
  MAX_CUSTOM_CSS,

  // プロファイル単位のデータ(全ウィンドウで共有)
  profiles: null,
  googleAccounts: null,
  history: null,
  bookmarks: null,
  readlist: null,
  downloads: null,
  settings: null,
  gestures: null,
  theme: null,
  passwords: null,

  extensions: new ExtensionSupport(),
  adblock: new AdBlock(),
  tor: new Tor(),

  // 保存確認バーで「保存する」が押されるまで、平文パスワードを一時保持する
  pendingPassword: null,

  incognitoCount: 0,
};

// ---- 内部ページ(roopie://)----

// app.ready前に宣言する必要がある
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
  for (const name of ['gesture-preload.js', 'password-preload.js', 'media-preload.js']) {
    session.registerPreloadScript({ type: 'frame', filePath: path.join(PRELOAD_DIR, name) });
  }
}

// ---- データの初期化 ----

function store(profile, key, defaultValue) {
  return new Store(browser.profiles.dataFile(profile, key), defaultValue);
}
browser.store = store;

browser.initData = () => {
  browser.profiles = new Profiles();
  const profile = browser.profiles.active();

  // Googleアカウント一覧はプロファイル横断で共有する
  browser.googleAccounts = new GoogleAccounts(
    new Store(path.join(app.getPath('userData'), 'google-accounts.json'), []),
    () => browser.sendProfiles()
  );

  // ショートカット割り当てもブラウザ全体で共有(アプリメニューはグローバルなため)
  browser.keybindings = new Keybindings(
    new Store(path.join(app.getPath('userData'), 'keybindings.json'), {}),
    () => browser.onKeybindingsChanged?.()
  );

  // ローカルサーバー検知(マシン単位。非表示ポートの記憶にストアを使う)
  browser.localServers = new LocalServers(
    new Store(path.join(app.getPath('userData'), 'local-servers.json'), { dismissed: [] })
  );

  browser.history = new History(store(profile, 'history', []));
  browser.bookmarks = new Bookmarks(store(profile, 'bookmarks', []), () => browser.sendBookmarks());
  browser.readlist = new Readlist(store(profile, 'readlist', []), () => browser.sendReadlist());
  browser.downloads = new Downloads(store(profile, 'downloads', []), () => browser.sendDownloads());
  browser.settings = store(profile, 'settings', { ...DEFAULT_SETTINGS });
  browser.gestures = new Gestures(store(profile, 'gestures', Gestures.defaults()));
  browser.theme = store(profile, 'theme', { ...DEFAULT_THEME });
  browser.passwords = new Passwords(store(profile, 'passwords', []));
};

browser.flushAll = () => {
  browser.profiles?.store.flush();
  browser.googleAccounts?.store.flush();
  browser.history?.store.flush();
  browser.bookmarks?.store.flush();
  browser.readlist?.store.flush();
  browser.downloads?.store.flush();
  browser.settings?.flush();
  browser.gestures?.store.flush();
  browser.theme?.flush();
  browser.passwords?.store.flush();
  browser.keybindings?.store.flush();
  browser.localServers?.store.flush();
  for (const ctx of windows.all()) {
    if (!ctx.incognito) ctx.sidePanel.store.flush();
  }
};

// ---- ウィンドウ ----

// シークレット用セッション(persist: を付けない = メモリ内のみ。閉じると消える)
function createIncognitoSession() {
  return electronSession.fromPartition(`incognito-${++browser.incognitoCount}`);
}

// シークレットでは履歴を残さない(Historyと同じインターフェースの空実装)
const NULL_HISTORY = {
  add() {},
  update() {},
  list: () => [],
  remove() {},
  clear() {},
};

// シークレットのサイドパネルはディスクに書かない
function memoryStore(defaultValue) {
  return { data: defaultValue, save() {}, flush() {} };
}

// url を指定すると、そのURLのタブ1枚だけで開く(タブのドラッグ切り離し用)。
// x/yはタブを離した画面座標(ドラッグ切り離し時、その位置に新しいウィンドウを出すため)
browser.createWindow = ({ incognito = false, url, x, y } = {}) => {
  const profile = browser.profiles.active();
  const session = incognito ? createIncognitoSession() : browser.profiles.sessionFor(profile);
  const frameColor = incognito ? FRAME_COLOR_INCOGNITO : FRAME_COLOR;

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 500,
    minHeight: 300,
    ...(Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x - 100), y: Math.round(y - 20) } : {}),
    title: incognito ? 'Roopie(シークレット)' : 'Roopie',
    // ページの周囲の余白から透けて見える色。UIと同色にして「額縁」に見せる
    backgroundColor: frameColor,
    // ネイティブのタイトルバーを外し、タブバーをタイトルバーとして使う
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: frameColor, symbolColor: '#e5e7eb', height: 40 },
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerInternalProtocol(session);
  registerPagePreloads(session);
  if (!incognito) browser.downloads.attachSession(session);
  browser.applyAdblock(session);
  browser.applyDownloadPath(session);
  // Tor設定はプロファイル単位。シークレットは対象外(素の一時セッション)
  if (!incognito) browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));

  const tabManager = new TabManager(window, {
    history: incognito ? NULL_HISTORY : browser.history,
    bookmarks: browser.bookmarks,
    session,
  });
  tabManager.setOverlay(createOverlayView(session));
  tabManager.setChromeLeft(browser.settings.data.tabBarPosition === 'left' ? TAB_BAR_WIDTH : 0);
  tabManager.setSidePanelSide(browser.settings.data.sidePanelPosition === 'left' ? 'left' : 'right');
  tabManager.setSearchEngine(browser.settings.data.searchEngine);

  const sidePanel = new SidePanel(window, {
    session,
    store: incognito
      ? memoryStore({ webPanels: [], notes: '' })
      : store(profile, 'sidepanel', { webPanels: [], notes: '' }),
    tabManager,
    onState: () => browser.sendSidePanel(ctx),
  });
  tabManager.setSidePanel(sidePanel);

  const mediaPlayer = new MediaPlayer(window, {
    session,
    tabManager,
    corner: browser.settings.data.mediaCorner,
    onDrag: (corner) => {
      browser.settings.data.mediaCorner = corner;
      browser.settings.save();
    },
  });
  mediaPlayer.setDocked(browser.settings.data.mediaDocked);
  tabManager.setMediaPlayer(mediaPlayer);

  const ctx = windows.add({ window, tabManager, sidePanel, mediaPlayer, session, incognito, media: null });

  // 再生中だったタブを閉じたら、フローティングプレイヤー/サイドパネルの表示も消す
  tabManager.onTabClosed = (tab) => {
    if (ctx.media?.tabId === tab.id) {
      ctx.media = null;
      browser.sendMedia(ctx);
    }
  };

  // Googleにログインした可能性のあるタイミングでアカウントを自動検出する(シークレットでは行わない)
  if (!incognito) tabManager.onGoogleDomainVisit = (s) => browser.checkGoogleAutoRegister(s);

  // 拡張機能はシークレット(非永続セッション)では動かないので取り付けない
  if (!incognito) {
    browser.extensions.setBrowser({ tabManager, window });
    tabManager.onTabCreated = (tab) => browser.extensions.addTab(tab.view.webContents);
    tabManager.onTabSelected = (tab) => browser.extensions.selectTab(tab.view.webContents);
    browser.extensions
      .attach(session, profile.id)
      .catch((err) => console.error('拡張機能サポートの初期化に失敗:', err));
  }

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  window.webContents.once('did-finish-load', () => {
    window.webContents.send('ui:window', { incognito });
    browser.sendAllTo(ctx);
    tabManager.createTab(url || undefined);
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
};

// ページの上に重ねる透明View。プルダウンメニューをここに描画する
// (タブはネイティブViewなので、通常のHTMLドロップダウンはページの下に隠れてしまう)
function createOverlayView(session) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'internal-preload.js'),
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

// 設定に応じて、指定セッション(省略時は全ウィンドウ)へ適用する
browser.applyAdblock = (session) => {
  const enabled = browser.settings?.data.adblock !== false;
  const targets = session ? [session] : windows.all().map((c) => c.session);
  for (const target of targets) {
    browser.adblock
      .apply(target, enabled)
      .catch((err) => console.error('広告ブロックの適用に失敗:', err));
  }
};

// ---- Tor ----

// あるプロファイルのセッションに、そのプロファイルのTor設定を反映する。
// Tor ONならSOCKS5プロキシ経由、OFFなら直接接続に戻す。
browser.applyTorForProfile = async (profile) => {
  const session = browser.profiles.sessionFor(profile);
  if (profile.tor) {
    const proxyRules = await browser.tor.ensureRunning();
    if (proxyRules) {
      await session.setProxy({ proxyRules });
      // WebRTCによる実IPの漏洩を防ぐ(Torプロキシはトンネルできないため)
      setWebRtcPolicyForSession(session);
    } else {
      // Torを準備できなかった場合は、意図せず素の接続で通信しないよう空ルートにする
      await session.setProxy({ proxyRules: 'socks5://127.0.0.1:1' });
    }
  } else {
    await session.setProxy({ proxyRules: '' });
  }
};

// 全プロファイルのTor設定を各セッションへ適用する(Tor状態が変わったときなど)
browser.applyAllTor = async () => {
  for (const profile of browser.profiles.list()) {
    await browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));
  }
  browser.sendTor();
};

// Torプロファイルのタブは、WebRTCでローカル/公開IPを露出しないようにする
function setWebRtcPolicyForSession(session) {
  for (const ctx of windows.all()) {
    if (ctx.session !== session) continue;
    for (const tab of ctx.tabManager.tabs) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      }
    }
  }
}

browser.sendTor = () => {
  broadcast('tor:status', browser.tor.state());
};

// Torの状態変化(起動中→接続済み等)を全ウィンドウへ配信する
browser.tor.on('status', () => browser.sendTor?.());

// ---- テーマ ----

// パッチを検証してthemeストアへ適用する(実際に書き込むのはこの関数のみ)
browser.applyThemePatch = (themeStore, patch) => {
  if (!themeStore || !patch) return;
  if (typeof patch.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.accent)) {
    themeStore.data.accent = patch.accent.toLowerCase();
  }
  if (browser.THEME_BACKGROUNDS.includes(patch.background)) {
    themeStore.data.background = patch.background;
  }
  if (typeof patch.backgroundImage === 'string' && patch.backgroundImage.length <= MAX_BACKGROUND_IMAGE) {
    if (patch.backgroundImage === '' || patch.backgroundImage.startsWith('data:image/')) {
      themeStore.data.backgroundImage = patch.backgroundImage;
    }
  }
  if (typeof patch.customCss === 'string') {
    themeStore.data.customCss = patch.customCss.slice(0, browser.MAX_CUSTOM_CSS);
  }
  themeStore.save();
};

// 任意のプロファイルのテーマを読む(アクティブでなくてもよい。設定画面のプロファイルカード用)
browser.themeFor = (profileId) => {
  const profile = browser.profiles.list().find((p) => p.id === profileId);
  if (!profile) return { ...DEFAULT_THEME };
  if (profile.id === browser.profiles.activeId) return browser.theme.data;
  const s = store(profile, 'theme', { ...DEFAULT_THEME });
  const data = { ...s.data };
  s.flush();
  return data;
};

// 任意のプロファイルのテーマを書く(アクティブなら即座にUIへ反映、そうでなければディスクにのみ保存)
browser.setThemeFor = (profileId, patch) => {
  const profile = browser.profiles.list().find((p) => p.id === profileId);
  if (!profile) return;
  if (profile.id === browser.profiles.activeId) {
    browser.applyThemePatch(browser.theme, patch);
    browser.sendTheme();
    return;
  }
  const s = store(profile, 'theme', { ...DEFAULT_THEME });
  browser.applyThemePatch(s, patch);
  s.flush();
};

// ---- Googleアカウントの自動検出 ----

// プロファイルID -> 直近に自動検出チェックした時刻(google.comへのナビゲーションの連打で
// 何度もListAccountsを叩かないようにする)
const googleCheckedAt = new Map();

// ログイン中なのに未登録のアカウントを見つけたら自動登録し、そのプロファイルで有効化する
browser.autoRegisterGoogleAccounts = async (profile) => {
  if (!browser.googleAccounts) return;
  const session = browser.profiles.sessionFor(profile);
  const detected = await GoogleAccounts.fetchSignedIn(session);
  let changed = false;

  for (const { email, name } of detected) {
    let account = browser.googleAccounts.findByEmail(email);
    if (!account) {
      account = browser.googleAccounts.add(email, name);
      changed = true;
    }
    if (!profile.google.enabled.includes(account.id)) {
      browser.profiles.setGoogleEnabled(profile.id, account.id, true);
      changed = true;
    }
    if (!profile.google.primaryId) {
      browser.profiles.setGooglePrimary(profile.id, account.id);
      changed = true;
    }
  }
  if (changed) browser.sendProfiles();
};

// タブがgoogle.com系ドメインへナビゲートしたときの自動検出(5秒スロットル)
browser.checkGoogleAutoRegister = (session) => {
  const profile = browser.profiles?.list().find((p) => browser.profiles.sessionFor(p) === session);
  if (!profile) return;
  const last = googleCheckedAt.get(profile.id) ?? 0;
  if (Date.now() - last < 5000) return;
  googleCheckedAt.set(profile.id, Date.now());
  browser.autoRegisterGoogleAccounts(profile).catch((err) => console.error('Googleアカウントの自動検出に失敗:', err));
};

// ---- ダウンロード先 ----

// 設定に応じて、指定セッション(省略時は全ウィンドウ)へダウンロード先を適用する
browser.applyDownloadPath = (session) => {
  const dir = browser.settings?.data.downloadPath;
  if (!dir) return; // 空ならElectronのOS既定のままにする
  const targets = session ? [session] : windows.all().map((c) => c.session);
  for (const target of targets) target.setDownloadPath(dir);
};

// ---- タブバーの位置(上部/左側) ----

// 設定に応じて、指定セッション(省略時は全ウィンドウ)のタブバーレイアウトを切り替える
browser.applyTabBarPosition = (session) => {
  const left = browser.settings?.data.tabBarPosition === 'left' ? TAB_BAR_WIDTH : 0;
  const targets = session ? windows.all().filter((c) => c.session === session) : windows.all();
  for (const ctx of targets) ctx.tabManager.setChromeLeft(left);
};

// ---- サイドパネルの左右位置 ----

browser.applySidePanelPosition = (session) => {
  const side = browser.settings?.data.sidePanelPosition === 'left' ? 'left' : 'right';
  const targets = session ? windows.all().filter((c) => c.session === session) : windows.all();
  for (const ctx of targets) ctx.tabManager.setSidePanelSide(side);
};

// ---- 検索エンジン ----

browser.applySearchEngine = (session) => {
  const engine = browser.settings?.data.searchEngine;
  const targets = session ? windows.all().filter((c) => c.session === session) : windows.all();
  for (const ctx of targets) ctx.tabManager.setSearchEngine(engine);
};

// ---- プロファイル ----

// アクティブなプロファイルのデータ/セッションを各機能へ適用する
browser.applyActiveProfile = ({ recreateTabs, previousProfileId } = {}) => {
  const profile = browser.profiles.active();

  browser.history.setStore(store(profile, 'history', []));
  browser.bookmarks.setStore(store(profile, 'bookmarks', []));
  browser.readlist.setStore(store(profile, 'readlist', []));
  browser.downloads.setStore(store(profile, 'downloads', []));
  browser.settings.flush();
  browser.settings = store(profile, 'settings', { ...DEFAULT_SETTINGS });
  browser.gestures.setStore(store(profile, 'gestures', Gestures.defaults()));
  browser.theme.flush();
  browser.theme = store(profile, 'theme', { ...DEFAULT_THEME });
  browser.passwords.setStore(store(profile, 'passwords', []));

  const session = browser.profiles.sessionFor(profile);
  registerInternalProtocol(session);
  registerPagePreloads(session);
  browser.downloads.attachSession(session);
  browser.extensions
    .attach(session, profile.id)
    .catch((err) => console.error('拡張機能サポートの初期化に失敗:', err));

  const normalWindows = windows.normal();

  // 離れるプロファイルの各ウィンドウのタブ構成を保存する。
  // Edgeのワークスペースのように、次に戻ってきたときに同じタブ構成で再開できるようにする
  if (recreateTabs && previousProfileId && previousProfileId !== profile.id) {
    const previousProfile = browser.profiles.list().find((p) => p.id === previousProfileId);
    if (previousProfile) {
      const snapshot = normalWindows.map((ctx) => ctx.tabManager.snapshotTabs());
      const s = store(previousProfile, 'session-tabs', []);
      s.data = snapshot;
      s.flush();
    }
  }
  const incomingTabs = recreateTabs ? store(profile, 'session-tabs', []).data : null;

  // プロファイルの切り替えはシークレット以外の全ウィンドウに適用する
  for (const [index, ctx] of normalWindows.entries()) {
    ctx.session = session;
    ctx.sidePanel.setStore(store(profile, 'sidepanel', { webPanels: [], notes: '' }));
    if (recreateTabs) {
      ctx.tabManager.switchSession(session);
      const saved = incomingTabs?.[index]?.tabs;
      if (saved?.length) ctx.tabManager.restoreTabs(saved);
      else ctx.tabManager.createTab();
      ctx.sidePanel.switchSession(session);
    }
  }
  browser.applyAdblock();
  browser.applyDownloadPath();
  browser.applyTabBarPosition();
  browser.applySidePanelPosition();
  browser.applySearchEngine();
  browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));
  browser.sendAll();
};

browser.switchProfile = (id) => {
  const previousProfileId = browser.profiles.activeId;
  if (!browser.profiles.switchTo(id)) return;
  browser.applyActiveProfile({ recreateTabs: true, previousProfileId });
};

// プロファイルのTor ON/OFFを切り替えて、そのセッションへ即時反映する
browser.setProfileTor = async (id, enabled) => {
  browser.profiles.setTor(id, enabled);
  const profile = browser.profiles.list().find((p) => p.id === id);
  if (profile) await browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));
  browser.sendProfiles();
  browser.sendTor();
};

// 共有トグルの変更は、そのプロファイルがアクティブなときだけ保存先の切り替えが必要
browser.setShared = (id, key, shared) => {
  browser.profiles.setShared(id, key, shared);
  if (id === browser.profiles.activeId) browser.applyActiveProfile();
  else browser.sendProfiles();
};

browser.toggleBookmarkBar = () => {
  browser.settings.data.showBookmarkBar = !browser.settings.data.showBookmarkBar;
  browser.settings.save();
  browser.sendSettings();
};

// ---- レンダラーへの状態送信 ----

// 1ウィンドウ内のUI・内部ページ・サイドパネルへ送る
function sendToContext(ctx, channel, payload) {
  if (ctx.window.isDestroyed()) return;
  ctx.window.webContents.send(channel, payload);
  ctx.tabManager.broadcastToInternal(channel, payload);
  ctx.sidePanel.sendToPanel(channel, payload); // パネルUIはタブ一覧に含まれないため個別に送る
}

function broadcast(channel, payload) {
  for (const ctx of windows.all()) sendToContext(ctx, channel, payload);
}

function profilesPayload() {
  return {
    // 拡張機能アイコン(<browser-action-list>)がプロファイルごとのセッションを
    // 指し示せるよう、partition名も一緒に送る
    profiles: browser.profiles.list().map((p) => ({ ...p, partition: browser.profiles.partitionFor(p) })),
    activeId: browser.profiles.activeId,
    googleAccounts: browser.googleAccounts?.list() ?? [],
  };
}

function downloadsPayload() {
  return { items: browser.downloads.list(), hasActive: browser.downloads.hasActive() };
}

browser.sendBookmarks = () => {
  if (!browser.bookmarks) return;
  broadcast('bookmarks:state', browser.bookmarks.list());
  for (const ctx of windows.all()) ctx.tabManager.sendState(); // スターボタンの状態を更新
};

browser.sendReadlist = () => {
  if (!browser.readlist) return;
  broadcast('readlist:state', browser.readlist.list());
};

browser.sendDownloads = () => {
  if (!browser.downloads) return;
  broadcast('downloads:state', downloadsPayload());
};

browser.sendProfiles = () => {
  if (!browser.profiles) return;
  broadcast('profiles:state', profilesPayload());
};

browser.sendSettings = () => {
  if (!browser.settings) return;
  // 全ての利用側が正しい形の配列を受け取れるよう、配信前に正規化して保持する
  browser.settings.data.toolbarItems = normalizeToolbarItems(browser.settings.data.toolbarItems);
  broadcast('ui:settings', browser.settings.data);
};

browser.sendKeybindings = () => {
  if (!browser.keybindings) return;
  broadcast('keybindings:state', browser.keybindings.config());
};

browser.sendGestures = () => {
  if (!browser.gestures) return;
  const config = browser.gestures.config();
  broadcast('gestures:state', config); // 設定画面(内部ページ)向け
  // 各タブのジェスチャーpreload向け(通常タブにも送る必要があるためbroadcastとは別)
  for (const ctx of windows.all()) {
    for (const tab of ctx.tabManager.tabs) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send('gestures:config', config);
    }
  }
};

// サイドパネルの状態はウィンドウごとに異なる
browser.sendSidePanel = (ctx) => {
  if (!ctx || ctx.window.isDestroyed()) return;
  sendToContext(ctx, 'sidepanel:state', ctx.sidePanel.state());
};

browser.sendTheme = () => {
  if (!browser.theme) return;
  broadcast('theme:state', browser.theme.data);
};

browser.sendPasswords = () => {
  if (!browser.passwords) return;
  broadcast('passwords:state', browser.passwords.list());
};

browser.sendExtensions = () => {
  if (!browser.profiles) return;
  const session = browser.profiles.sessionFor(browser.profiles.active());
  broadcast('extensions:state', browser.extensions.list(session));
};

// メディア再生状態はウィンドウごとに異なる。フローティングプレイヤーとサイドパネルの
// 「再生中」セクションの両方へ届ける(サイドパネルはsendToContext経由で自動的に届く)
browser.sendMedia = (ctx) => {
  if (!ctx || ctx.window.isDestroyed()) return;
  sendToContext(ctx, 'media:state', ctx.media);
  ctx.mediaPlayer.setState(ctx.media);
};

// 「サイドパネルに格納」設定の変更を全ウィンドウのプレイヤーへ反映する
browser.applyMediaDocked = () => {
  const docked = browser.settings?.data.mediaDocked === true;
  for (const ctx of windows.all()) ctx.mediaPlayer.setDocked(docked);
};

browser.sendAll = () => {
  browser.sendProfiles();
  browser.sendSettings();
  browser.sendGestures();
  browser.sendBookmarks();
  browser.sendDownloads();
  browser.sendTheme();
  browser.sendPasswords();
  browser.sendExtensions();
  browser.sendTor();
  for (const ctx of windows.all()) browser.sendSidePanel(ctx);
};

// 新しく開いたウィンドウにだけ現在の状態を流し込む
browser.sendAllTo = (ctx) => {
  sendToContext(ctx, 'profiles:state', profilesPayload());
  sendToContext(ctx, 'ui:settings', browser.settings.data);
  sendToContext(ctx, 'gestures:state', browser.gestures.config());
  sendToContext(ctx, 'bookmarks:state', browser.bookmarks.list());
  sendToContext(ctx, 'readlist:state', browser.readlist.list());
  sendToContext(ctx, 'downloads:state', downloadsPayload());
  sendToContext(ctx, 'theme:state', browser.theme.data);
  sendToContext(ctx, 'tor:status', browser.tor.state());
  browser.sendSidePanel(ctx);
};

module.exports = browser;
