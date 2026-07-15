const { WebContentsView } = require('electron');
const path = require('path');
const { attachContextMenu } = require('./context-menu');
const { searchUrl, DEFAULT_ENGINE } = require('./search-engines');

const NEW_TAB_URL = 'roopie://newtab';
const INTERNAL_SCHEME = 'roopie:';
const DEFAULT_CHROME_HEIGHT = 84;

// Zen Browser風のレイアウト: ページを角丸のカードとして浮かせ、周囲に余白(額縁)を作る
const CONTENT_MARGIN = 8;
const CONTENT_RADIUS = 10;
const ZOOM_LEVELS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];

const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

let nextTabId = 1;

/**
 * WebContentsView を使ってタブを管理するクラス。
 * 各タブは独立した WebContentsView としてメインウィンドウに載せ、
 * アクティブなタブだけを表示する。
 */
class TabManager {
  constructor(window, { history, bookmarks, session }) {
    this.window = window;
    this.history = history;
    this.bookmarks = bookmarks;
    this.session = session; // アクティブなプロファイルのセッション
    this.tabs = []; // { id, view, isInternal, favicon }
    this.activeTabId = null;
    this.splitTabId = null; // 画面分割で並べて表示しているタブ(nullなら分割なし)
    this.splitDirection = 'row'; // 'row'(左右) | 'column'(上下)
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.chromeLeft = 0; // タブバーを左側(縦)表示にしたときの左オフセット
    this.sidePanelSide = 'right'; // サイドパネルを表示する側('left' | 'right')
    this.searchEngine = DEFAULT_ENGINE; // アドレスバーでURLでない入力をしたときの検索エンジン
    this.overlay = null; // メニュー等を表示する、常にタブより手前のView

    for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      window.on(event, () => this.layout());
    }
  }

  createTab(url = NEW_TAB_URL) {
    const id = nextTabId++;
    const isInternal = isInternalUrl(url);
    const view = new WebContentsView({
      webPreferences: {
        // 通常のWebページにはpreloadを渡さない(内部ページのみIPCを使える)
        preload: isInternal ? INTERNAL_PRELOAD : undefined,
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // hasInternalPreload はタブ生成時に固定される(preloadは後から変えられない)
    const tab = { id, view, isInternal, hasInternalPreload: isInternal, favicon: null };
    this.tabs.push(tab);
    this.window.contentView.addChildView(view);

    this.attachEvents(tab);
    this.onTabCreated?.(tab); // 拡張機能システム等への通知
    view.webContents.loadURL(url);
    this.switchTab(id);
    this.raiseOverlay(); // 新しいタブを載せた後もメニューが手前に来るようにする
    return tab;
  }

  // サイドパネル(レイアウト時に幅と領域を問い合わせる)
  setSidePanel(sidePanel) {
    this.sidePanel = sidePanel;
    this.layout();
  }

  // フローティングのミニプレイヤー
  setMediaPlayer(mediaPlayer) {
    this.mediaPlayer = mediaPlayer;
    this.layout();
  }

  // オーバーレイ(メニュー用の透明View)を登録する
  setOverlay(view) {
    this.overlay = view;
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    this.layout();
  }

  // 子Viewは後から追加したものが手前に来るため、追加し直して最前面へ戻す
  raiseOverlay() {
    if (!this.overlay || this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.overlay);
  }

  showOverlay(visible) {
    if (!this.overlay) return;
    if (visible) this.raiseOverlay();
    this.overlay.setVisible(visible);
    if (visible) this.overlay.webContents.focus();
    else this.activeWebContents()?.focus();
  }

  attachEvents(tab) {
    const wc = tab.view.webContents;
    const update = () => this.sendState();

    wc.on('page-title-updated', (_e, title) => {
      this.history.update(wc.getURL(), title);
      this.sendState();
    });
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('did-navigate-in-page', update);

    wc.on('did-navigate', (_e, url) => {
      tab.favicon = null;
      tab.isInternal = isInternalUrl(url);
      if (!tab.isInternal) this.history.add(url, wc.getTitle());
      this.sendState();

      // Googleにログインした可能性があるタイミングでアカウント一覧を確認する
      try {
        if (/(^|\.)google\.com$/.test(new URL(url).hostname)) {
          this.onGoogleDomainVisit?.(this.session);
        }
      } catch {
        // 不正なURLは無視
      }
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[favicons.length - 1] || null;
      this.history.update(wc.getURL(), null, tab.favicon);
      this.sendState();
    });

    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 (ABORTED) はユーザー操作による中断なので無視する
      if (isMainFrame && code !== -3) {
        console.error(`読み込み失敗: ${url} (${code} ${description})`);
      }
    });

    // ページ内検索の結果をUIへ
    wc.on('found-in-page', (_e, result) => {
      this.window.webContents.send('find:result', {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    // 内部ページ(roopie://)はpreloadを持つタブでしか動かせないため、
    // 通常タブから内部ページへ遷移しようとした場合は新しいタブで開く。
    // (逆方向の内部ページ→通常ページは同じタブで遷移できる。preloadは
    //  roopie:以外ではAPIを公開しないため安全)
    wc.on('will-navigate', (event, url) => {
      if (isInternalUrl(url) && !tab.hasInternalPreload) {
        event.preventDefault();
        this.createTab(url);
      }
    });

    // target="_blank" 等のリンクは新しいタブで開く
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });

    attachContextMenu(wc, this);
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    if (id === this.splitTabId) this.splitTabId = null;

    const [tab] = this.tabs.splice(index, 1);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.onTabClosed?.(tab);

    if (this.tabs.length === 0) {
      // プロファイル切り替え中は、全タブを閉じた直後に新しいタブを開くので閉じない
      if (!this.isSwitchingProfile) this.window.close();
      return;
    }

    if (this.activeTabId === id) {
      if (this.splitTabId && this.getTab(this.splitTabId)) {
        // 分割中に主ペインを閉じた場合は、相方のペインを主ペインへ昇格させる
        const promoted = this.splitTabId;
        this.splitTabId = null;
        this.switchTab(promoted);
      } else {
        const next = this.tabs[Math.min(index, this.tabs.length - 1)];
        this.switchTab(next.id);
      }
    } else {
      this.updateVisibility();
      this.layout();
      this.sendState();
    }
  }

  closeActiveTab() {
    if (this.activeTabId !== null) this.closeTab(this.activeTabId);
  }

  switchTab(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    // 分割相手のタブをそのままアクティブにした場合は、同じ内容が重複するので分割を解除する
    if (id === this.splitTabId) this.splitTabId = null;
    this.activeTabId = id;
    this.updateVisibility();
    this.layout();
    tab.view.webContents.focus();
    this.onTabSelected?.(tab);
    this.sendState();
  }

  updateVisibility() {
    for (const t of this.tabs) {
      t.view.setVisible(t.id === this.activeTabId || t.id === this.splitTabId);
    }
  }

  // ---- 画面分割 ----

  // アクティブなタブの隣に、別のタブを並べて表示する
  splitWith(id, direction) {
    if (id === this.activeTabId || !this.getTab(id)) return;
    this.splitTabId = id;
    this.splitDirection = direction === 'column' ? 'column' : 'row';
    this.updateVisibility();
    this.layout();
    this.sendState();
  }

  toggleSplitDirection() {
    if (!this.splitTabId) return;
    this.splitDirection = this.splitDirection === 'row' ? 'column' : 'row';
    this.layout();
    this.sendState();
  }

  closeSplit() {
    if (!this.splitTabId) return;
    this.splitTabId = null;
    this.updateVisibility();
    this.layout();
    this.sendState();
  }

  switchRelative(offset) {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const next = (index + offset + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[next].id);
  }

  switchToIndex(index) {
    // Ctrl+9 は Chrome と同じく「最後のタブ」
    const tab = index >= 8 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (tab) this.switchTab(tab.id);
  }

  // ドラッグ&ドロップによる並べ替え(タブバーから呼ばれる)
  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    const to = Math.max(0, Math.min(toIndex, this.tabs.length - 1));
    if (from === to) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.sendState();
  }

  // アドレスバー入力: URLらしければURLとして、それ以外は設定した検索エンジンで検索
  navigate(input) {
    const url = toUrl(input, this.searchEngine);
    const tab = this.getTab(this.activeTabId);
    if (!tab) return;
    // 内部ページはpreloadを持つタブでしか動かせない
    if (isInternalUrl(url) && !tab.hasInternalPreload) {
      this.createTab(url);
      return;
    }
    tab.view.webContents.loadURL(url);
  }

  goBack() {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward() {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload() {
    this.activeWebContents()?.reload();
  }

  stop() {
    this.activeWebContents()?.stop();
  }

  toggleDevTools() {
    this.activeWebContents()?.toggleDevTools();
  }

  // ---- ズーム ----
  zoom(direction) {
    const wc = this.activeWebContents();
    if (!wc) return;
    if (direction === 0) {
      wc.setZoomLevel(0);
    } else {
      const current = wc.getZoomLevel();
      const levels = direction > 0 ? ZOOM_LEVELS : [...ZOOM_LEVELS].reverse();
      const next = levels.find((l) => (direction > 0 ? l > current + 0.01 : l < current - 0.01));
      if (next !== undefined) wc.setZoomLevel(next);
    }
    this.sendState();
  }

  // ---- ページ内検索 ----
  find(text, options = {}) {
    const wc = this.activeWebContents();
    if (!wc || !text) return;
    wc.findInPage(text, { forward: options.forward !== false, findNext: !!options.findNext });
  }

  stopFind() {
    this.activeWebContents()?.stopFindInPage('clearSelection');
  }

  // ---- ブックマーク ----
  toggleBookmarkForActiveTab() {
    const tab = this.getTab(this.activeTabId);
    if (!tab || tab.isInternal) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!url) return;
    this.bookmarks.toggle(url, wc.getTitle() || url, tab.favicon);
  }

  // プロファイル切り替え: セッションが変わるので全タブを作り直す
  // タブは閉じるだけ。新しいタブの生成は呼び出し側に任せる
  // (Edgeのワークスペースのように、プロファイルごとのタブ構成を復元できるようにするため)
  switchSession(session) {
    this.isSwitchingProfile = true;
    this.session = session;
    this.splitTabId = null;
    for (const id of this.tabs.map((t) => t.id)) {
      this.closeTab(id);
    }
    this.isSwitchingProfile = false;
  }

  // 現在開いているタブのURLとアクティブなタブを記録する(プロファイル切り替え前に呼ぶ)
  snapshotTabs() {
    return {
      tabs: this.tabs.map((tab) => ({
        url: tab.view.webContents.getURL(),
        active: tab.id === this.activeTabId,
      })),
    };
  }

  // snapshotTabs() で記録した構成を再現する(URLからの再読み込みで復元する)
  restoreTabs(entries) {
    let activeId = null;
    for (const entry of entries ?? []) {
      if (!entry?.url) continue;
      const tab = this.createTab(entry.url);
      if (entry.active) activeId = tab.id;
    }
    if (activeId) this.switchTab(activeId);
  }

  setChromeHeight(height) {
    if (!Number.isFinite(height) || height === this.chromeHeight) return;
    this.chromeHeight = height;
    this.layout();
  }

  // タブバーを左側(縦)表示にしたときの左オフセット(0なら通常の上部表示)
  setChromeLeft(left) {
    if (!Number.isFinite(left) || left === this.chromeLeft) return;
    this.chromeLeft = left;
    this.layout();
  }

  // サイドパネルを表示する側を切り替える('left' | 'right')
  setSidePanelSide(side) {
    const next = side === 'left' ? 'left' : 'right';
    if (next === this.sidePanelSide) return;
    this.sidePanelSide = next;
    this.layout();
  }

  setSearchEngine(engineId) {
    this.searchEngine = engineId || DEFAULT_ENGINE;
  }

  // 全画面表示のときは余白なし(ページを画面いっぱいに出す)
  get margin() {
    return this.window.isFullScreen() ? 0 : CONTENT_MARGIN;
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const m = this.margin;
    const radius = m ? CONTENT_RADIUS : 0;

    // ページ・サイドパネルを載せる領域(周囲に余白を残す。縦タブ時は左側にも余白を空ける)
    const areaX = m + this.chromeLeft;
    const areaY = this.chromeHeight;
    const areaWidth = Math.max(0, width - m * 2 - this.chromeLeft);
    const areaHeight = Math.max(0, height - this.chromeHeight - m);

    const panelWidth = this.sidePanel?.widthFor(areaWidth) ?? 0;
    // パネルがあるときは、ページとの間にも余白を入れて2枚のカードに見せる
    const gap = panelWidth ? m : 0;
    const pageAreaWidth = Math.max(0, areaWidth - panelWidth - gap);
    const panelOnLeft = this.sidePanelSide === 'left';
    // パネルを左に置く場合はページ領域をその分右へ押し出す
    const pageX = panelOnLeft ? areaX + panelWidth + gap : areaX;
    const panelX = panelOnLeft ? areaX : areaX + areaWidth - panelWidth;

    const activeView = this.getTab(this.activeTabId)?.view;
    const splitView = this.splitTabId ? this.getTab(this.splitTabId)?.view : null;

    if (activeView) {
      if (splitView) {
        // 2ペインの間にも余白を入れて、それぞれ独立したカードに見せる
        if (this.splitDirection === 'column') {
          const paneHeight = Math.max(0, (areaHeight - m) / 2);
          activeView.setBounds({ x: pageX, y: areaY, width: pageAreaWidth, height: paneHeight });
          splitView.setBounds({
            x: pageX,
            y: areaY + paneHeight + m,
            width: pageAreaWidth,
            height: Math.max(0, areaHeight - paneHeight - m),
          });
        } else {
          const paneWidth = Math.max(0, (pageAreaWidth - m) / 2);
          activeView.setBounds({ x: pageX, y: areaY, width: paneWidth, height: areaHeight });
          splitView.setBounds({
            x: pageX + paneWidth + m,
            y: areaY,
            width: Math.max(0, pageAreaWidth - paneWidth - m),
            height: areaHeight,
          });
        }
        splitView.setBorderRadius(radius);
      } else {
        activeView.setBounds({ x: pageX, y: areaY, width: pageAreaWidth, height: areaHeight });
      }
      activeView.setBorderRadius(radius);
    }

    // オーバーレイ(メニュー)は余白も含めた全域を覆う(外側クリックで閉じるため)。
    // 縦タブ時はタブバー部分を除く(そこは常設のHTML UIなので覆う必要がない)
    this.overlay?.setBounds({
      x: this.chromeLeft,
      y: this.chromeHeight,
      width: Math.max(0, width - this.chromeLeft),
      height: Math.max(0, height - this.chromeHeight),
    });

    this.sidePanel?.layout(
      {
        x: panelX,
        y: areaY,
        width: panelWidth,
        height: areaHeight,
      },
      radius
    );

    // ミニプレイヤーはページ全体の領域を基準に置く(分割の影響は受けない)。
    // サイドパネルが開いている側の隅は、パネルとの間にも余白を空ける
    this.mediaPlayer?.layout({ x: areaX, y: areaY, width: areaWidth, height: areaHeight }, radius, {
      left: panelWidth && panelOnLeft ? panelWidth + m : 0,
      right: panelWidth && !panelOnLeft ? panelWidth + m : 0,
    });
  }

  // 内部ページ(履歴・ダウンロード等)を開いているタブへ通知を送る
  broadcastToInternal(channel, payload) {
    for (const tab of this.tabs) {
      if (tab.isInternal && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send(channel, payload);
      }
    }
  }

  getTab(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  activeWebContents() {
    return this.getTab(this.activeTabId)?.view.webContents || null;
  }

  // タブの状態をUI(レンダラー)へ送信
  sendState() {
    if (this.window.isDestroyed()) return;
    const state = {
      activeTabId: this.activeTabId,
      splitTabId: this.splitTabId,
      splitDirection: this.splitDirection,
      tabs: this.tabs.map((t) => {
        const wc = t.view.webContents;
        const url = wc.getURL();
        return {
          id: t.id,
          title: wc.getTitle() || '新しいタブ',
          // 新しいタブページではアドレスバーを空にする(Chromeと同じ挙動)
          url: isNewTabUrl(url) ? '' : url,
          favicon: t.favicon,
          isInternal: t.isInternal,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          isBookmarked: !t.isInternal && !!this.bookmarks.find(url),
          zoomLevel: wc.getZoomLevel(),
        };
      }),
    };
    this.window.webContents.send('tabs:state', state);
  }
}

function isInternalUrl(url) {
  return typeof url === 'string' && url.startsWith(INTERNAL_SCHEME);
}

// roopie:// はstandardスキームのため、読み込み後は末尾に "/" が付く
function isNewTabUrl(url) {
  return url === NEW_TAB_URL || url === `${NEW_TAB_URL}/`;
}

// 入力文字列をURLに変換(URLでなければ設定した検索エンジンで検索するURLにする)
function toUrl(input, engineId) {
  const text = String(input).trim();
  if (/^(https?|file|roopie|about):/i.test(text)) return text;
  // スペースを含まず、ドットかlocalhostを含むならURLとみなす
  if (!/\s/.test(text) && (/\./.test(text) || /^localhost(:\d+)?/.test(text))) {
    return `https://${text}`;
  }
  return searchUrl(engineId, text);
}

module.exports = TabManager;
module.exports.NEW_TAB_URL = NEW_TAB_URL;
