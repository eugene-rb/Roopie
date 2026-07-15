const { WebContentsView } = require('electron');
const path = require('path');

const PLAYER_URL = 'roopie://mediaplayer';
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

const WIDTH = 272;
const HEIGHT = 88;
const MARGIN = 12;
const MAX_RADIUS = 14;

/**
 * 画面の四隅に常駐するフローティングのミニプレイヤー。
 * ページとは別の小さな WebContentsView(roopie://mediaplayer)として重ねる。
 * bounds をプレイヤーの大きさだけに絞ることで、それ以外の領域はページの操作を妨げない。
 */
class MediaPlayer {
  constructor(window, { session, tabManager, corner, onDrag }) {
    this.window = window;
    this.session = session;
    this.tabManager = tabManager;
    this.corner = corner || 'bottom-right'; // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    this.onDrag = onDrag; // ドラッグでコーナーが変わったときの通知(設定への保存用)
    this.view = null;
    this.state = null; // 現在の再生状態(nullなら非表示)
    this.lastArea = null;
    this.docked = false; // trueならフローティング表示せず、サイドパネル側にのみ状態を送る
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
    this.tabManager.raiseOverlay();
  }

  setDocked(docked) {
    this.docked = !!docked;
    this.tabManager.layout();
  }

  setState(state) {
    this.state = state;
    if (state && !this.docked) this.ensureView();
    this.sendToPlayer('media:state', state);
    this.tabManager.layout();
  }

  sendToPlayer(channel, payload) {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  // TabManager.layout() から呼ばれる。area はページ全体の領域(分割前・パネル控除前)
  // panelInset は { left, right } — サイドパネルが開いている側の隅に余白を空ける
  layout(area, radius, panelInset = { left: 0, right: 0 }) {
    this.lastArea = area;
    if (!this.view) return;
    const visible = !!this.state && !this.docked;
    this.view.setVisible(visible);
    if (!visible) return;

    const bounds = this.boundsFor(this.corner, area, panelInset);
    this.view.setBounds(bounds);
    this.view.setBorderRadius(Math.min(radius || MAX_RADIUS, MAX_RADIUS));
  }

  dragStart() {
    if (!this.view) return;
    this.dragOrigin = this.view.getBounds();
  }

  boundsFor(corner, area, panelInset) {
    const rightInset = corner.includes('right') ? panelInset.right || 0 : 0;
    const leftInset = !corner.includes('right') ? panelInset.left || 0 : 0;
    const x = corner.includes('right')
      ? area.x + area.width - WIDTH - MARGIN - rightInset
      : area.x + MARGIN + leftInset;
    const y = corner.includes('bottom')
      ? area.y + area.height - HEIGHT - MARGIN
      : area.y + MARGIN;
    return { x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT };
  }

  // ドラッグ中: プレイヤー自身の中の座標系しか分からないため、
  // ドラッグ開始時のView位置を基準に、移動量(dx, dy)を都度受け取って追従させる
  dragBy(dx, dy) {
    if (!this.view || !this.lastArea || !this.dragOrigin) return;
    const area = this.lastArea;
    const x = Math.max(area.x, Math.min(this.dragOrigin.x + dx, area.x + area.width - WIDTH));
    const y = Math.max(area.y, Math.min(this.dragOrigin.y + dy, area.y + area.height - HEIGHT));
    this.view.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT });
  }

  // ドラッグ終了: 現在位置から最も近い四隅にスナップする
  dragEnd() {
    if (!this.view || !this.lastArea) return;
    const area = this.lastArea;
    const bounds = this.view.getBounds();
    const centerX = bounds.x + WIDTH / 2;
    const centerY = bounds.y + HEIGHT / 2;
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
