const { WebContentsView, Menu } = require('electron');
const path = require('path');

const PLAYER_URL = 'roopie://mediaplayer';
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

const WIDTH = 272;
const ROW_HEIGHT = 64;
const TOOLS_HEIGHT = 26;
const MARGIN = 12;
const MAX_HEIGHT = 320; // これを超える件数はパネル内でスクロール
const MAX_RADIUS = 14;

/**
 * 画面の四隅に常駐するフローティングのミニプレイヤー。timer-panel.jsと同じ骨格で、
 * 単一の再生状態ではなく「再生中/一時停止中のタブ」の配列をリスト表示する
 * (タブごとにミュート・フローティング表示の要否を独立して扱える)。
 * ページとは別の小さな WebContentsView(roopie://mediaplayer)として重ねる。
 */
class MediaPlayer {
  constructor(window, { session, tabManager, corner, onDrag }) {
    this.window = window;
    this.session = session;
    this.tabManager = tabManager;
    this.corner = corner || 'bottom-right'; // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    this.onDrag = onDrag; // ドラッグでコーナーが変わったときの通知(設定への保存用)
    this.view = null;
    this.mediaList = []; // 現在の再生状態一覧(タブごと)
    this.lastArea = null;
    this.tempHidden = false; // 右クリック「一時的に非表示」中(全タブぶんまとめて)
  }

  ensureView() {
    if (this.view) return;
    this.view = new WebContentsView({
      webPreferences: {
        preload: INTERNAL_PRELOAD,
        session: this.session,
        transparent: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.view.setBackgroundColor('#00000000');
    this.window.contentView.addChildView(this.view);
    this.view.webContents.loadURL(PLAYER_URL);
    this.view.webContents.on('context-menu', () => {
      Menu.buildFromTemplate([
        { label: '一時的に非表示', click: () => this.hideTemporarily() },
      ]).popup({ window: this.window });
    });
    this.tabManager.raiseOverlay();
  }

  hideTemporarily() {
    this.tempHidden = true;
    this.tabManager.layout();
  }

  setState(mediaList) {
    this.mediaList = mediaList || [];
    // 再生中のタブが1つも無くなったら「一時的に非表示」を解除する
    if (this.tempHidden && this.mediaList.length === 0) this.tempHidden = false;
    if (this.mediaList.some((m) => !m.docked) && this.mediaList.length > 0) this.ensureView();
    this.tabManager.layout();
  }

  sendToPlayer(channel, payload) {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  // 実際にフローティング表示すべき行(タブ単位のdocked上書き・再生中のタブが画面に
  // 見えている間(アクティブ or 分割相手)はページ内で操作できるため除く)。
  // アクティブタブの切り替えだけでも中身が変わるため、layout()のたびに描画し直す
  visibleRows() {
    return this.mediaList.filter(
      (m) => !m.docked && m.tabId !== this.tabManager.activeTabId && m.tabId !== this.tabManager.splitTabId
    );
  }

  // TabManager.layout() から呼ばれる。area はページ全体の領域(分割前・パネル控除前)
  // panelInset は { left, right } — サイドパネルが開いている側の隅に余白を空ける
  layout(area, radius, panelInset = { left: 0, right: 0 }) {
    this.lastArea = area;
    if (!this.view) return;
    const rows = this.visibleRows();
    this.sendToPlayer('media:state', rows);
    const visible = rows.length > 0 && !this.tempHidden;
    this.view.setVisible(visible);
    if (!visible) return;

    const height = Math.min(MAX_HEIGHT, TOOLS_HEIGHT + rows.length * ROW_HEIGHT);
    const bounds = this.boundsFor(this.corner, area, panelInset, height);
    this.view.setBounds(bounds);
    this.view.setBorderRadius(Math.min(radius || MAX_RADIUS, MAX_RADIUS));
  }

  dragStart() {
    if (!this.view) return;
    this.dragOrigin = this.view.getBounds();
  }

  boundsFor(corner, area, panelInset, height) {
    const rightInset = corner.includes('right') ? panelInset.right || 0 : 0;
    const leftInset = !corner.includes('right') ? panelInset.left || 0 : 0;
    const x = corner.includes('right')
      ? area.x + area.width - WIDTH - MARGIN - rightInset
      : area.x + MARGIN + leftInset;
    const y = corner.includes('bottom')
      ? area.y + area.height - height - MARGIN
      : area.y + MARGIN;
    return { x: Math.round(x), y: Math.round(y), width: WIDTH, height: Math.round(height) };
  }

  // ドラッグ中: プレイヤー自身の中の座標系しか分からないため、
  // ドラッグ開始時のView位置を基準に、移動量(dx, dy)を都度受け取って追従させる
  dragBy(dx, dy) {
    if (!this.view || !this.lastArea || !this.dragOrigin) return;
    const area = this.lastArea;
    const { width, height } = this.dragOrigin;
    const x = Math.max(area.x, Math.min(this.dragOrigin.x + dx, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(this.dragOrigin.y + dy, area.y + area.height - height));
    this.view.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  }

  // ドラッグ終了: 現在位置から最も近い四隅にスナップする
  dragEnd() {
    if (!this.view || !this.lastArea) return;
    const area = this.lastArea;
    const bounds = this.view.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const horizontal = centerX - area.x < area.width / 2 ? 'left' : 'right';
    const vertical = centerY - area.y < area.height / 2 ? 'top' : 'bottom';
    this.corner = `${vertical}-${horizontal}`;
    this.dragOrigin = null;
    this.onDrag?.(this.corner);
    this.tabManager.layout();
  }

  destroy() {
    if (!this.view) return;
    this.window.contentView.removeChildView(this.view);
    this.view.webContents.close();
    this.view = null;
  }
}

module.exports = MediaPlayer;
