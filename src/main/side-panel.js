const { WebContentsView } = require('electron');
const crypto = require('crypto');
const path = require('path');
const { attachContextMenu } = require('./context-menu');

const PANEL_URL = 'roopie://sidepanel';
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const RAIL_WIDTH = 44; // アイコンレールの幅(CSSの.section-tabsと合わせる。常時表示)
const PANEL_HEADER_HEIGHT = 40; // セクション見出しの高さ(CSSの#panel-headerと合わせる)
const RESIZE_HANDLE_WIDTH = 6; // リサイズハンドル分(CSSの#resize-handleと合わせる)

const clampWidth = (w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

/**
 * ページ右(または左)のサイドパネル。Vivaldi風に、アイコンレールは常時表示。
 * - panelView: パネルUI(roopie://sidepanel、内部ページ)。レール+セクション見出し+コンテンツを描画
 * - webView:   Webパネル(登録したサイトを常駐表示する通常のWebコンテンツ)。アクティブなときだけpanelViewの上に重ねる
 * 幅は3段階: 非表示(0) / レールのみ(RAIL_WIDTH) / 展開(保存された幅)
 */
class SidePanel {
  constructor(window, { session, store, tabManager, onState }) {
    this.window = window;
    this.session = session;
    this.store = store;
    this.tabManager = tabManager;
    this.onState = onState; // 状態変更をUI/内部ページへ配信するコールバック
    this.open = true; // レール自体は既定で常時表示
    this.activeSection = null; // 展開中の組み込みセクション('bookmarks'等)。nullならレールのみ
    this.activeWebId = null;
    this.panelView = null;
    this.webView = null;
    this.normalizeStore();
  }

  normalizeStore() {
    const data = this.store.data;
    if (!Array.isArray(data.webPanels)) data.webPanels = [];
    // 旧バージョンのAIアシスタントパネルが残っていたら取り除く(機能は廃止済み)
    data.webPanels = data.webPanels.filter((p) => !p?.ai);
    if (typeof data.notes !== 'string') data.notes = '';
    data.width = Number.isFinite(data.width) ? clampWidth(data.width) : DEFAULT_WIDTH;
  }

  get webPanels() {
    return this.store.data.webPanels;
  }

  state() {
    return {
      open: this.open,
      webPanels: this.webPanels,
      activeSection: this.activeSection,
      activeWebId: this.activeWebId,
      notes: this.store.data.notes,
      width: this.store.data.width,
    };
  }

  hasExpandedPane() {
    return !!(this.activeSection || this.activeWebId);
  }

  notify() {
    this.onState?.();
  }

  // パネルUIへブロードキャストを届ける(パネルはタブ一覧に含まれないため)
  sendToPanel(channel, payload) {
    const wc = this.panelView?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  // サイドバー全体(レール込み)の表示/非表示。F4(Vivaldiと同じ)・非表示中だけツールバーに出るボタン用
  toggle() {
    this.setOpen(!this.open);
  }

  hide() {
    this.setOpen(false);
  }

  setOpen(open) {
    this.open = !!open;
    if (this.open) this.ensurePanelView();
    this.tabManager.layout();
    if (this.open) this.panelView.webContents.focus();
    this.notify();
  }

  // 表示中のパネル幅。3段階: 非表示(0) / レールのみ(RAIL_WIDTH) / 展開(保存幅、狭いウィンドウではページ側を最低半分残す)
  widthFor(totalWidth) {
    if (!this.open) return 0;
    if (!this.hasExpandedPane()) return RAIL_WIDTH;
    return Math.min(this.store.data.width, Math.floor(totalWidth / 2));
  }

  // 境界のドラッグでリサイズする(deltaXは直前イベントからの相対移動量=movementX)。
  // 右ドック時はページ側の端(パネルの左端)固定なので、ハンドルが左へ動く(deltaXが負)ほど幅は増える。
  // 左ドック時は逆にパネルの右端が可動なので、符号を反転させる
  resizeBy(deltaX) {
    if (!Number.isFinite(deltaX)) return;
    const sign = this.tabManager.sidePanelSide === 'left' ? 1 : -1;
    this.store.data.width = clampWidth(this.store.data.width + sign * deltaX);
    this.store.save();
    this.tabManager.layout();
  }

  // TabManager.layout() から呼ばれる。bounds はパネルに割り当てられた領域
  // radius はページと同じ角丸(Zen風のカード表示)
  layout(bounds, radius = 0) {
    if (!this.open || bounds.width <= 0) {
      this.panelView?.setVisible(false);
      this.webView?.setVisible(false);
      return;
    }
    this.ensurePanelView();

    // パネルUIは常に領域全体に敷く(レールは常時表示のため)。Webパネル表示中はその上にWebコンテンツを重ねる。
    // (こうするとWebコンテンツの角丸から透けるのが「額縁」ではなくパネルの背景色になる)
    this.panelView.setVisible(true);
    this.panelView.setBounds(bounds);
    this.panelView.setBorderRadius(radius);

    if (this.activeWebId && this.webView) {
      // レール(常に外側の縁)とリサイズハンドル(常にページ側との境界)の分を差し引く
      const railOnLeft = this.tabManager.sidePanelSide === 'left';
      const leftInset = railOnLeft ? RAIL_WIDTH : RESIZE_HANDLE_WIDTH;
      const rightInset = railOnLeft ? RESIZE_HANDLE_WIDTH : RAIL_WIDTH;
      const topInset = PANEL_HEADER_HEIGHT;
      this.webView.setVisible(true);
      this.webView.setBounds({
        x: bounds.x + leftInset,
        y: bounds.y + topInset,
        width: Math.max(0, bounds.width - leftInset - rightInset),
        height: Math.max(0, bounds.height - topInset),
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

  // ---- 組み込みセクション(ブックマーク/履歴/メモ/Webパネル管理/再生中) ----
  // 同じセクションをもう一度選ぶとレールのみに折りたたむ(Vivaldi同様)
  openSection(key) {
    if (this.activeSection === key && !this.activeWebId) {
      this.activeSection = null;
    } else {
      this.activeSection = key;
      this.activeWebId = null;
      this.destroyWebView();
    }
    this.tabManager.layout();
    this.notify();
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

  // 名前/URL/アイコンの変更(値はメイン側で検証。不正なら無視)
  setWebPanel(id, patch) {
    const entry = this.webPanels.find((p) => p.id === id);
    if (!entry || !patch || typeof patch !== 'object') return;
    if (typeof patch.title === 'string') {
      entry.title = patch.title.trim().slice(0, 200) || hostOf(entry.url);
    }
    if (typeof patch.url === 'string') {
      const url = normalizeUrl(patch.url);
      if (url) {
        entry.url = url;
        if (this.activeWebId === id) this.webView?.webContents.loadURL(url);
      }
    }
    if ('icon' in patch) entry.icon = normalizeWebIcon(patch.icon);
    this.store.save();
    this.notify();
  }

  // Webパネルアイコンの右クリック→編集。モーダルの表示場所を確保するため
  // ホストセクション('web'。中身は空)でパネルを広げ、手前を覆うwebViewを破棄してから
  // パネルUIにモーダル表示を指示する
  editWeb(id, field) {
    if (!this.webPanels.find((p) => p.id === id)) return;
    this.activeSection = 'web';
    this.activeWebId = null;
    this.destroyWebView();
    this.tabManager.layout();
    this.notify();
    this.sendToPanel('sidepanel:edit-web', { id, field });
  }

  // レール右クリック/「+」の「ウェブパネルを追加」。編集と同様に、パネルを広げ手前のwebViewを
  // 破棄してから、URL入力モーダルの表示をパネルUIへ指示する
  promptAddWeb() {
    this.activeSection = 'web';
    this.activeWebId = null;
    this.destroyWebView();
    this.tabManager.layout();
    this.notify();
    this.sendToPanel('sidepanel:add-web-prompt');
  }

  // 追加/編集モーダルが閉じたとき。モーダルのために広げただけのホストパネルなら畳む
  // (追加確定でそのWebパネルが開かれた場合はactiveWebIdが立っているので何もしない)
  closeEditHost() {
    if (this.activeSection !== 'web' || this.activeWebId) return;
    this.activeSection = null;
    this.tabManager.layout();
    this.notify();
  }

  // 同じWebパネルをもう一度選ぶとレールのみに折りたたむ(Vivaldi同様)
  openWeb(id) {
    if (this.activeWebId === id) {
      this.closeWeb();
      return;
    }
    const entry = this.webPanels.find((p) => p.id === id);
    if (!entry) return;
    this.activeSection = null;
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
    this.activeSection = null;
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

// Webパネルのカスタムアイコン。null は favicon に戻す。profiles.js の setIcon と同様に検証する
function normalizeWebIcon(icon) {
  if (!icon || typeof icon !== 'object') return null;
  if (icon.type === 'emoji' && typeof icon.value === 'string') {
    const value = icon.value.trim();
    return value && value.length <= 16 ? { type: 'emoji', value } : null;
  }
  if (icon.type === 'image' && typeof icon.value === 'string') {
    return icon.value.startsWith('data:image/') && icon.value.length <= 400_000
      ? { type: 'image', value: icon.value }
      : null;
  }
  return null;
}

module.exports = SidePanel;
