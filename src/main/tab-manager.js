const { WebContentsView } = require('electron');
const path = require('path');
const { attachContextMenu } = require('./context-menu');

const NEW_TAB_URL = 'roopie://newtab';
const INTERNAL_SCHEME = 'roopie:';
const DEFAULT_CHROME_HEIGHT = 84;
const ZOOM_LEVELS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];

const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

let nextTabId = 1;

/**
 * WebContentsView を使ってタブを管理するクラス。
 * 各タブは独立した WebContentsView としてメインウィンドウに載せ、
 * アクティブなタブだけを表示する。
 */
class TabManager {
  constructor(window, { history, bookmarks }) {
    this.window = window;
    this.history = history;
    this.bookmarks = bookmarks;
    this.tabs = []; // { id, view, isInternal, favicon }
    this.activeTabId = null;
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;

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
    view.webContents.loadURL(url);
    this.switchTab(id);
    return tab;
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

    const [tab] = this.tabs.splice(index, 1);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();

    if (this.tabs.length === 0) {
      this.window.close();
      return;
    }

    if (this.activeTabId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.switchTab(next.id);
    } else {
      this.sendState();
    }
  }

  closeActiveTab() {
    if (this.activeTabId !== null) this.closeTab(this.activeTabId);
  }

  switchTab(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    this.activeTabId = id;
    for (const t of this.tabs) {
      t.view.setVisible(t.id === id);
    }
    this.layout();
    tab.view.webContents.focus();
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

  // アドレスバー入力: URLらしければURLとして、それ以外はGoogle検索
  navigate(input) {
    const url = toUrl(input);
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

  setChromeHeight(height) {
    if (!Number.isFinite(height) || height === this.chromeHeight) return;
    this.chromeHeight = height;
    this.layout();
  }

  layout() {
    const active = this.getTab(this.activeTabId);
    if (!active || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    active.view.setBounds({
      x: 0,
      y: this.chromeHeight,
      width,
      height: Math.max(0, height - this.chromeHeight),
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

// 入力文字列をURLに変換(URLでなければGoogle検索URLにする)
function toUrl(input) {
  const text = String(input).trim();
  if (/^(https?|file|roopie|about):/i.test(text)) return text;
  // スペースを含まず、ドットかlocalhostを含むならURLとみなす
  if (!/\s/.test(text) && (/\./.test(text) || /^localhost(:\d+)?/.test(text))) {
    return `https://${text}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

module.exports = TabManager;
module.exports.NEW_TAB_URL = NEW_TAB_URL;
