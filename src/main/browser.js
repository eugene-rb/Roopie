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
const Autofill = require('./autofill');
const { Widgets } = require('./widgets');
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
  // ツールバーに直接表示する拡張機能のID(Edge風。それ以外はパズルボタンのメニューから使う)
  pinnedExtensions: [],
  // 自動入力(住所・個人情報/お支払い方法)のON/OFF
  autofillAddresses: true,
  autofillCards: true,
  // スタート画面のグリッド列数・行数(Androidのホーム画面のように自由に変更可能)
  startGridCols: 6,
  startGridRows: 3,
};
const START_GRID_COLS_RANGE = [4, 10];
const START_GRID_ROWS_RANGE = [3, 8];
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
  START_GRID_COLS_RANGE,
  START_GRID_ROWS_RANGE,
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
  autofill: null,
  widgets: null,

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
  for (const name of ['gesture-preload.js', 'autofill-preload.js', 'media-preload.js']) {
    session.registerPreloadScript({ type: 'frame', filePath: path.join(PRELOAD_DIR, name) });
  }
}

// ---- データの初期化 ----

// Storeは実ファイルパスで共有する。共有トグルONの項目は複数プロファイルが同じファイルを
// 指すため、別々のStoreインスタンスを作ると書き込みが互いに巻き戻ってしまう
const storeCache = new Map(); // filePath -> Store
function store(profile, key, defaultValue) {
  const file = browser.profiles.dataFile(profile, key);
  let s = storeCache.get(file);
  if (!s) {
    s = new Store(file, defaultValue);
    storeCache.set(file, s);
  }
  return s;
}
browser.store = store;

// プロファイルごとのデータ一式(Edge挙動: 複数プロファイルのウィンドウが同時に開くため、
// アクティブ1つではなくプロファイル単位で保持する)。
// インスタンスはプロファイルにつき1つを維持し(TabManager等が参照を持つ)、
// 共有トグル変更時は setStore で保存先だけ差し替える(applyProfileStores)
const profileData = new Map(); // profileId -> bundle

browser.bundleFor = (profileId) => {
  if (!browser.profiles) return null;
  const existing = profileData.get(profileId);
  if (existing) return existing;
  const profile = browser.profiles.list().find((p) => p.id === profileId);
  if (!profile) return null;
  const bundle = {
    profileId,
    history: new History(store(profile, 'history', [])),
    bookmarks: new Bookmarks(store(profile, 'bookmarks', []), () => browser.sendBookmarksFor(profileId)),
    readlist: new Readlist(store(profile, 'readlist', []), () => browser.sendReadlistFor(profileId)),
    downloads: new Downloads(store(profile, 'downloads', []), () => browser.sendDownloadsFor(profileId)),
    settings: store(profile, 'settings', { ...DEFAULT_SETTINGS }),
    gestures: new Gestures(store(profile, 'gestures', Gestures.defaults())),
    theme: store(profile, 'theme', { ...DEFAULT_THEME }),
    passwords: new Passwords(store(profile, 'passwords', [])),
    autofill: new Autofill(store(profile, 'autofill', {})),
    widgets: new Widgets(store(profile, 'start-widgets', {})),
  };
  profileData.set(profileId, bundle);
  return bundle;
};

browser.activeBundle = () => browser.bundleFor(browser.profiles?.activeId);

// 互換ゲッター: browser.bookmarks 等は「アクティブ(=最後に選ばれた)プロファイル」の束を指す。
// ウィンドウ起点の処理は必ず ctx.profileId から bundleFor で引くこと
for (const key of [
  'history',
  'bookmarks',
  'readlist',
  'downloads',
  'settings',
  'gestures',
  'theme',
  'passwords',
  'autofill',
  'widgets',
]) {
  Object.defineProperty(browser, key, {
    get: () => browser.activeBundle()?.[key] ?? null,
    configurable: true,
  });
}

browser.initData = () => {
  browser.profiles = new Profiles();

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

  browser.bundleFor(browser.profiles.activeId);
};

browser.flushAll = () => {
  browser.profiles?.store.flush();
  browser.googleAccounts?.store.flush();
  browser.keybindings?.store.flush();
  browser.localServers?.store.flush();
  for (const s of storeCache.values()) s.flush();
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
// profileId を指定するとそのプロファイルのウィンドウとして開く(Edge挙動。省略時はアクティブ)。
// restoreTabs を渡すと初期タブの代わりにそのタブ構成を復元する
browser.createWindow = ({ incognito = false, url, x, y, profileId, restoreTabs } = {}) => {
  const profile = browser.profiles.list().find((p) => p.id === profileId) ?? browser.profiles.active();
  const bundle = browser.bundleFor(profile.id);
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
  if (!incognito) bundle.downloads.attachSession(session);
  browser.applyAdblockTo(session, bundle);
  browser.applyDownloadPathTo(session, bundle);
  // Tor設定はプロファイル単位。シークレットは対象外(素の一時セッション)
  if (!incognito) browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));

  const tabManager = new TabManager(window, {
    history: incognito ? NULL_HISTORY : bundle.history,
    bookmarks: bundle.bookmarks,
    session,
  });
  tabManager.setOverlay(createOverlayView(session));
  tabManager.setChromeLeft(bundle.settings.data.tabBarPosition === 'left' ? TAB_BAR_WIDTH : 0);
  tabManager.setSidePanelSide(bundle.settings.data.sidePanelPosition === 'left' ? 'left' : 'right');
  tabManager.setSearchEngine(bundle.settings.data.searchEngine);

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
    corner: bundle.settings.data.mediaCorner,
    onDrag: (corner) => {
      bundle.settings.data.mediaCorner = corner;
      bundle.settings.save();
    },
  });
  mediaPlayer.setDocked(bundle.settings.data.mediaDocked);
  tabManager.setMediaPlayer(mediaPlayer);

  const ctx = windows.add({
    window,
    tabManager,
    sidePanel,
    mediaPlayer,
    session,
    incognito,
    profileId: profile.id,
    media: null,
  });

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
    if (restoreTabs?.length) tabManager.restoreTabs(restoreTabs);
    else tabManager.createTab(url || undefined);
  });

  // マウスの戻る/進むボタン
  window.on('app-command', (_e, command) => {
    if (command === 'browser-backward') tabManager.goBack();
    if (command === 'browser-forward') tabManager.goForward();
  });

  // そのプロファイルの最後のウィンドウを閉じるとき、タブ構成を保存する
  // (次にプロファイルを開いたとき同じタブで再開できるように。Edgeのワークスペース風)
  window.on('close', () => {
    if (incognito) return;
    if (!browser.profiles.list().some((p) => p.id === profile.id)) return; // プロファイル削除時
    const others = windows.normal().filter((c) => c !== ctx && c.profileId === profile.id);
    if (others.length) return;
    const s = store(profile, 'session-tabs', []);
    s.data = [tabManager.snapshotTabs()];
    s.flush();
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

// 1セッションへ、そのプロファイルの設定を適用する
browser.applyAdblockTo = (session, bundle) => {
  const enabled = bundle?.settings.data.adblock !== false;
  browser.adblock.apply(session, enabled).catch((err) => console.error('広告ブロックの適用に失敗:', err));
};

// 指定プロファイルの全ウィンドウ(シークレット含む)へ適用する
browser.applyAdblockFor = (profileId) => {
  const bundle = browser.bundleFor(profileId);
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) browser.applyAdblockTo(ctx.session, bundle);
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

// 任意のプロファイルのテーマを読む(設定画面のプロファイルカード用)
browser.themeFor = (profileId) => {
  return browser.bundleFor(profileId)?.theme.data ?? { ...DEFAULT_THEME };
};

// 任意のプロファイルのテーマを書く(そのプロファイルのウィンドウがあれば即座にUIへ反映)
browser.setThemeFor = (profileId, patch) => {
  const bundle = browser.bundleFor(profileId);
  if (!bundle) return;
  browser.applyThemePatch(bundle.theme, patch);
  browser.sendThemeFor(profileId);
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

// 1セッションへ、そのプロファイルのダウンロード先を適用する
browser.applyDownloadPathTo = (session, bundle) => {
  const dir = bundle?.settings.data.downloadPath;
  if (!dir) return; // 空ならElectronのOS既定のままにする
  session.setDownloadPath(dir);
};

browser.applyDownloadPathFor = (profileId) => {
  const bundle = browser.bundleFor(profileId);
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) browser.applyDownloadPathTo(ctx.session, bundle);
  }
};

// ---- タブバーの位置(上部/左側) ----

// そのプロファイルの全ウィンドウのタブバーレイアウトを切り替える
browser.applyTabBarPositionFor = (profileId) => {
  const left = browser.bundleFor(profileId)?.settings.data.tabBarPosition === 'left' ? TAB_BAR_WIDTH : 0;
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) ctx.tabManager.setChromeLeft(left);
  }
};

// ---- サイドパネルの左右位置 ----

browser.applySidePanelPositionFor = (profileId) => {
  const side = browser.bundleFor(profileId)?.settings.data.sidePanelPosition === 'left' ? 'left' : 'right';
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) ctx.tabManager.setSidePanelSide(side);
  }
};

// ---- 検索エンジン ----

browser.applySearchEngineFor = (profileId) => {
  const engine = browser.bundleFor(profileId)?.settings.data.searchEngine;
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) ctx.tabManager.setSearchEngine(engine);
  }
};

// ---- プロファイル ----

// 共有トグル変更などで、そのプロファイルの保存先を作り直して各所へ反映する
// (インスタンスは維持し、setStoreで差し替えるのでTabManager等の参照はそのまま生きる)
browser.applyProfileStores = (profileId) => {
  const bundle = profileData.get(profileId);
  const profile = browser.profiles.list().find((p) => p.id === profileId);
  if (!bundle || !profile) return;

  bundle.history.setStore(store(profile, 'history', []));
  bundle.bookmarks.setStore(store(profile, 'bookmarks', []));
  bundle.readlist.setStore(store(profile, 'readlist', []));
  bundle.downloads.setStore(store(profile, 'downloads', []));
  bundle.settings = store(profile, 'settings', { ...DEFAULT_SETTINGS });
  bundle.gestures.setStore(store(profile, 'gestures', Gestures.defaults()));
  bundle.theme = store(profile, 'theme', { ...DEFAULT_THEME });
  bundle.passwords.setStore(store(profile, 'passwords', []));
  bundle.autofill.setStore(store(profile, 'autofill', {}));
  bundle.widgets.setStore(store(profile, 'start-widgets', {}));

  for (const ctx of windows.normal()) {
    if (ctx.profileId === profileId) {
      ctx.sidePanel.setStore(store(profile, 'sidepanel', { webPanels: [], notes: '' }));
    }
  }
  browser.applyAdblockFor(profileId);
  browser.applyDownloadPathFor(profileId);
  browser.applyTabBarPositionFor(profileId);
  browser.applySidePanelPositionFor(profileId);
  browser.applySearchEngineFor(profileId);
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) browser.sendAllTo(ctx);
  }
};

// Edge挙動: プロファイルの切り替え=そのプロファイルの新しいウィンドウを開く。
// 既存のウィンドウは元のプロファイルのまま残る(複数プロファイルの同時利用)。
// そのプロファイルのウィンドウがまだ無ければ、前回閉じたときのタブ構成を復元する
browser.switchProfile = (id, { url } = {}) => {
  const profile = browser.profiles.list().find((p) => p.id === id);
  if (!profile) return null;
  browser.profiles.switchTo(id); // 新しいウィンドウの既定プロファイルとして記憶

  const hasWindow = windows.normal().some((c) => c.profileId === id);
  const saved = !hasWindow && !url ? store(profile, 'session-tabs', []).data?.[0]?.tabs : null;
  const ctx = browser.createWindow({ profileId: id, url, restoreTabs: saved?.length ? saved : null });
  browser.sendProfiles();
  return ctx;
};

// プロファイルの削除: そのプロファイルのウィンドウも閉じる(Edgeと同じ)。
// 全ウィンドウが無くなったら、残ったアクティブプロファイルのウィンドウを開く
browser.removeProfile = (id) => {
  if (!browser.profiles.remove(id)) return;
  const targets = windows.normal().filter((c) => c.profileId === id);
  for (const ctx of targets) ctx.window.close();
  profileData.delete(id);
  if (!windows.normal().length) browser.createWindow({ profileId: browser.profiles.activeId });
  browser.sendProfiles();
};

// プロファイルのTor ON/OFFを切り替えて、そのセッションへ即時反映する
browser.setProfileTor = async (id, enabled) => {
  browser.profiles.setTor(id, enabled);
  const profile = browser.profiles.list().find((p) => p.id === id);
  if (profile) await browser.applyTorForProfile(profile).catch((err) => console.error('Torの適用に失敗:', err));
  browser.sendProfiles();
  browser.sendTor();
};

// 共有トグルの変更: そのプロファイルのデータ束が生成済みなら保存先を差し替える
browser.setShared = (id, key, shared) => {
  browser.profiles.setShared(id, key, shared);
  browser.applyProfileStores(id);
  browser.sendProfiles();
};

// フォーカス中のウィンドウのプロファイル設定を切り替える(アプリメニューから)
browser.toggleBookmarkBar = () => {
  const ctx = windows.focused();
  const bundle = browser.bundleFor(ctx?.profileId ?? browser.profiles.activeId);
  if (!bundle) return;
  bundle.settings.data.showBookmarkBar = !bundle.settings.data.showBookmarkBar;
  bundle.settings.save();
  browser.sendSettingsFor(bundle.profileId);
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

// 指定プロファイルのウィンドウ(そのプロファイルで開いたシークレット含む)だけに送る
function broadcastProfile(profileId, channel, payload) {
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) sendToContext(ctx, channel, payload);
  }
}

function profilesPayload(ctx) {
  return {
    // 拡張機能アイコン(<browser-action-list>)がプロファイルごとのセッションを
    // 指し示せるよう、partition名も一緒に送る
    profiles: browser.profiles.list().map((p) => ({ ...p, partition: browser.profiles.partitionFor(p) })),
    // 「使用中」はウィンドウごとに異なる(Edge挙動)。送信先ウィンドウのプロファイルを入れる
    activeId: ctx?.profileId ?? browser.profiles.activeId,
    googleAccounts: browser.googleAccounts?.list() ?? [],
  };
}

function downloadsPayload(bundle) {
  return { items: bundle.downloads.list(), hasActive: bundle.downloads.hasActive() };
}

browser.sendBookmarksFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (!bundle) return;
  broadcastProfile(profileId, 'bookmarks:state', bundle.bookmarks.list());
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) ctx.tabManager.sendState(); // スターボタンの状態を更新
  }
};

browser.sendReadlistFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (bundle) broadcastProfile(profileId, 'readlist:state', bundle.readlist.list());
};

browser.sendDownloadsFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (bundle) broadcastProfile(profileId, 'downloads:state', downloadsPayload(bundle));
};

browser.sendProfiles = () => {
  if (!browser.profiles) return;
  for (const ctx of windows.all()) sendToContext(ctx, 'profiles:state', profilesPayload(ctx));
};

browser.sendSettingsFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (!bundle) return;
  // 全ての利用側が正しい形の配列を受け取れるよう、配信前に正規化して保持する
  bundle.settings.data.toolbarItems = normalizeToolbarItems(bundle.settings.data.toolbarItems);
  broadcastProfile(profileId, 'ui:settings', bundle.settings.data);
};

browser.sendKeybindings = () => {
  if (!browser.keybindings) return;
  broadcast('keybindings:state', browser.keybindings.config());
};

browser.sendGesturesFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (!bundle) return;
  const config = bundle.gestures.config();
  broadcastProfile(profileId, 'gestures:state', config); // 設定画面(内部ページ)向け
  // 各タブのジェスチャーpreload向け(通常タブにも送る必要があるためbroadcastとは別)
  for (const ctx of windows.all()) {
    if (ctx.profileId !== profileId) continue;
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

browser.sendThemeFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (bundle) broadcastProfile(profileId, 'theme:state', bundle.theme.data);
};

browser.sendPasswordsFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (bundle) broadcastProfile(profileId, 'passwords:state', bundle.passwords.list());
};

browser.sendAutofillFor = (profileId) => {
  const bundle = profileData.get(profileId);
  if (!bundle) return;
  broadcastProfile(profileId, 'autofill:state', {
    addresses: bundle.autofill.listAddresses(),
    cards: bundle.autofill.listCards(),
  });
};

browser.sendExtensionsFor = (profileId) => {
  const profile = browser.profiles?.list().find((p) => p.id === profileId);
  if (!profile) return;
  const session = browser.profiles.sessionFor(profile);
  broadcastProfile(profileId, 'extensions:state', browser.extensions.list(session));
};

// メディア再生状態はウィンドウごとに異なる。フローティングプレイヤーとサイドパネルの
// 「再生中」セクションの両方へ届ける(サイドパネルはsendToContext経由で自動的に届く)
browser.sendMedia = (ctx) => {
  if (!ctx || ctx.window.isDestroyed()) return;
  sendToContext(ctx, 'media:state', ctx.media);
  ctx.mediaPlayer.setState(ctx.media);
};

// 「サイドパネルに格納」設定の変更を、そのプロファイルのウィンドウのプレイヤーへ反映する
browser.applyMediaDockedFor = (profileId) => {
  const docked = browser.bundleFor(profileId)?.settings.data.mediaDocked === true;
  for (const ctx of windows.all()) {
    if (ctx.profileId === profileId) ctx.mediaPlayer.setDocked(docked);
  }
};

browser.sendAll = () => {
  for (const ctx of windows.all()) browser.sendAllTo(ctx);
  browser.sendKeybindings();
};

// 1つのウィンドウに、そのウィンドウのプロファイルの状態一式を流し込む
browser.sendAllTo = (ctx) => {
  const bundle = browser.bundleFor(ctx.profileId) ?? browser.activeBundle();
  if (!bundle) return;
  const profile = browser.profiles.list().find((p) => p.id === bundle.profileId);
  bundle.settings.data.toolbarItems = normalizeToolbarItems(bundle.settings.data.toolbarItems);
  sendToContext(ctx, 'profiles:state', profilesPayload(ctx));
  sendToContext(ctx, 'ui:settings', bundle.settings.data);
  if (profile) {
    sendToContext(ctx, 'extensions:state', browser.extensions.list(browser.profiles.sessionFor(profile)));
  }
  sendToContext(ctx, 'gestures:state', bundle.gestures.config());
  sendToContext(ctx, 'bookmarks:state', bundle.bookmarks.list());
  sendToContext(ctx, 'readlist:state', bundle.readlist.list());
  sendToContext(ctx, 'downloads:state', downloadsPayload(bundle));
  sendToContext(ctx, 'theme:state', bundle.theme.data);
  sendToContext(ctx, 'passwords:state', bundle.passwords.list());
  sendToContext(ctx, 'tor:status', browser.tor.state());
  browser.sendSidePanel(ctx);
};

module.exports = browser;
