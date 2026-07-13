const { WebContentsView } = require('electron');

// タブバー(40px) + ツールバー(44px) = UI領域の高さ
const CHROME_HEIGHT = 84;
const NEW_TAB_URL = 'https://www.google.com';

let nextTabId = 1;

/**
 * WebContentsView を使ってタブを管理するクラス。
 * 各タブは独立した WebContentsView としてメインウィンドウに載せ、
 * アクティブなタブだけを表示する。
 */
class TabManager {
  constructor(window) {
    this.window = window;
    this.tabs = []; // { id, view }
    this.activeTabId = null;

    window.on('resize', () => this.layout());
    window.on('maximize', () => this.layout());
    window.on('unmaximize', () => this.layout());
  }

  createTab(url = NEW_TAB_URL) {
    const id = nextTabId++;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const tab = { id, view };
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

    wc.on('page-title-updated', update);
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[favicons.length - 1] || null;
      this.sendState();
    });

    // target="_blank" 等のリンクは新しいタブで開く
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    const [tab] = this.tabs.splice(index, 1);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();

    if (this.tabs.length === 0) {
      // 最後のタブを閉じたら新しいタブを開く(Chromeはウィンドウを閉じるが、まずは安全側で)
      this.createTab();
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

  // アドレスバー入力: URLらしければURLとして、それ以外はGoogle検索
  navigate(input) {
    const wc = this.activeWebContents();
    if (!wc) return;
    wc.loadURL(toUrl(input));
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

  layout() {
    const active = this.getTab(this.activeTabId);
    if (!active) return;
    const [width, height] = this.window.getContentSize();
    active.view.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
      height: Math.max(0, height - CHROME_HEIGHT),
    });
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
        return {
          id: t.id,
          title: wc.getTitle() || '新しいタブ',
          url: wc.getURL(),
          favicon: t.favicon || null,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
        };
      }),
    };
    this.window.webContents.send('tabs:state', state);
  }
}

// 入力文字列をURLに変換(URLでなければGoogle検索URLにする)
function toUrl(input) {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^about:/i.test(text)) return text;
  // スペースを含まず、ドットかlocalhostを含むならURLとみなす
  if (!/\s/.test(text) && (/\./.test(text) || /^localhost(:\d+)?/.test(text))) {
    return `https://${text}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

module.exports = TabManager;
