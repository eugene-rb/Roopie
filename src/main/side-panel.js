const { WebContentsView } = require('electron');
const crypto = require('crypto');
const path = require('path');
const { attachContextMenu } = require('./context-menu');

const PANEL_URL = 'roopie://sidepanel';
const PANEL_WIDTH = 360;
const WEB_HEADER_HEIGHT = 44; // Webパネル表示中に上部へ残すヘッダーの高さ

const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

/**
 * ページ右側のサイドパネル。
 * - panelView: パネルUI(roopie://sidepanel、内部ページ)
 * - webView:   Webパネル(登録したサイトを常駐表示する通常のWebコンテンツ)
 * Webパネル表示中は panelView をヘッダー分だけ残して縮め、下に webView を置く。
 */
class SidePanel {
  constructor(window, { session, store, tabManager, onState }) {
    this.window = window;
    this.session = session;
    this.store = store;
    this.tabManager = tabManager;
    this.onState = onState; // 状態変更をUI/内部ページへ配信するコールバック
    this.open = false;
    this.activeWebId = null;
    this.panelView = null;
    this.webView = null;
    this.normalizeStore();
  }

  normalizeStore() {
    const data = this.store.data;
    if (!Array.isArray(data.webPanels)) data.webPanels = [];
    if (typeof data.notes !== 'string') data.notes = '';
  }

  get webPanels() {
    return this.store.data.webPanels;
  }

  state() {
    return {
      open: this.open,
      webPanels: this.webPanels,
      activeWebId: this.activeWebId,
      notes: this.store.data.notes,
    };
  }

  notify() {
    this.onState?.();
  }

  // パネルUIへブロードキャストを届ける(パネルはタブ一覧に含まれないため)
  sendToPanel(channel, payload) {
    const wc = this.panelView?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setOpen(open) {
    this.open = !!open;
    if (this.open) this.ensurePanelView();
    this.tabManager.layout();
    if (this.open) this.panelView.webContents.focus();
    this.notify();
  }

  // 表示中のパネル幅。狭いウィンドウではページ側を最低半分残す
  widthFor(totalWidth) {
    if (!this.open) return 0;
    return Math.min(PANEL_WIDTH, Math.floor(totalWidth / 2));
  }

  // TabManager.layout() から呼ばれる。bounds はパネルに割り当てられた領域
  // radius はページと同じ角丸(Zen風のカード表示)
  layout(bounds, radius = 0) {
    if (!this.open || bounds.width <= 0) {
      this.panelView?.setVisible(false);
      this.webView?.setVisible(false);
      return;
    }

    // パネルUIは常に領域全体に敷く。Webパネル表示中はその上にWebコンテンツを重ねる。
    // (こうするとWebコンテンツの角丸から透けるのが「額縁」ではなくパネルの背景色になる)
    this.panelView.setVisible(true);
    this.panelView.setBounds(bounds);
    this.panelView.setBorderRadius(radius);

    if (this.activeWebId && this.webView) {
      this.webView.setVisible(true);
      this.webView.setBounds({
        x: bounds.x,
        y: bounds.y + WEB_HEADER_HEIGHT,
        width: bounds.width,
        height: Math.max(0, bounds.height - WEB_HEADER_HEIGHT),
      });
      this.webView.setBorderRadius(radius);
    } else {
      this.webView?.setVisible(false);
    }
  }

  ensurePanelView() {
    if (this.panelView) return;
    this.panelView = new WebContentsView({
      webPreferences: {
        preload: INTERNAL_PRELOAD,
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window.contentView.addChildView(this.panelView);
    this.panelView.webContents.loadURL(PANEL_URL);
    this.tabManager.raiseOverlay();
  }

  // ---- Webパネル ----

  addWeb(input) {
    const url = normalizeUrl(input);
    if (!url) return;
    const entry = { id: crypto.randomUUID(), url, title: hostOf(url), favicon: null };
    this.webPanels.push(entry);
    this.store.save();
    this.openWeb(entry.id); // 追加したらすぐ表示する(notifyも行われる)
  }

  removeWeb(id) {
    const index = this.webPanels.findIndex((p) => p.id === id);
    if (index === -1) return;
    this.webPanels.splice(index, 1);
    this.store.save();
    if (this.activeWebId === id) {
      this.closeWeb(); // notifyを含む
    } else {
      this.notify();
    }
  }

  openWeb(id) {
    const entry = this.webPanels.find((p) => p.id === id);
    if (!entry) return;
    this.activeWebId = id;
    this.ensureWebView();
    this.webView.webContents.loadURL(entry.url);
    this.tabManager.layout();
    this.notify();
  }

  // Webパネルを閉じてパネルメニューに戻る(webViewは破棄して解放する)
  closeWeb() {
    this.activeWebId = null;
    this.destroyWebView();
    this.tabManager.layout();
    this.notify();
  }

  reloadWeb() {
    this.webView?.webContents.reload();
  }

  ensureWebView() {
    if (this.webView) return;
    this.webView = new WebContentsView({
      webPreferences: {
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const wc = this.webView.webContents;

    // タイトル・faviconを登録済みパネルへ反映する(次回以降の表示に使う)
    wc.on('page-title-updated', (_e, title) => this.updateActiveEntry({ title }));
    wc.on('page-favicon-updated', (_e, favicons) =>
      this.updateActiveEntry({ favicon: favicons[favicons.length - 1] || null })
    );

    // パネル内から開くリンクは通常のタブで開く
    wc.setWindowOpenHandler(({ url }) => {
      this.tabManager.createTab(url);
      return { action: 'deny' };
    });
    attachContextMenu(wc, this.tabManager);

    this.window.contentView.addChildView(this.webView);
    this.tabManager.raiseOverlay();
  }

  updateActiveEntry(patch) {
    const entry = this.webPanels.find((p) => p.id === this.activeWebId);
    if (!entry) return;
    Object.assign(entry, patch);
    this.store.save();
    this.notify();
  }

  destroyWebView() {
    if (!this.webView) return;
    this.window.contentView.removeChildView(this.webView);
    this.webView.webContents.close();
    this.webView = null;
  }

  destroyPanelView() {
    if (!this.panelView) return;
    this.window.contentView.removeChildView(this.panelView);
    this.panelView.webContents.close();
    this.panelView = null;
  }

  // ---- メモ ----
  setNotes(text) {
    this.store.data.notes = String(text ?? '');
    this.store.save();
    // 打鍵ごとに呼ばれ、入力元のページで完結するのでnotifyしない
  }

  // ---- プロファイル切り替え ----

  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalizeStore();
  }

  // セッションが変わるのでViewを作り直す
  switchSession(session) {
    this.session = session;
    const wasOpen = this.open;
    this.activeWebId = null;
    this.destroyWebView();
    this.destroyPanelView();
    if (wasOpen) {
      this.ensurePanelView();
      this.tabManager.layout();
    }
    this.notify();
  }
}

function normalizeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  const url = /^https?:/i.test(text) ? text : `https://${text}`;
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

module.exports = SidePanel;
