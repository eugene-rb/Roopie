const { WebContentsView, Menu } = require('electron');
const path = require('path');

const PANEL_URL = 'roopie://timerpanel';
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

const WIDTH = 280;
const ROW_HEIGHT = 46;
const TOOLS_HEIGHT = 30;
const MARGIN = 12;
const MAX_HEIGHT = 320; // これを超える件数はパネル内でスクロール
const MAX_RADIUS = 14;

/**
 * 画面の四隅に常駐するフローティングのタイマー表示。media-player.jsと同じ骨格だが、
 * 単一の再生状態ではなく「実行中/鳴動中のタイマー」の配列をリスト表示する点が異なる。
 * サイドパネルの「タイマー」セクションが開いていれば隠れるが、鳴動中(ringing)は
 * docked/一時非表示より優先して必ず表示する(音を止められないまま実行される事故を防ぐ)。
 */
class TimerPanel {
  constructor(window, { session, tabManager, corner, onDrag }) {
    this.window = window;
    this.session = session;
    this.tabManager = tabManager;
    this.corner = corner || 'top-right';
    this.onDrag = onDrag;
    this.view = null;
    this.timers = [];
    this.lastArea = null;
    this.docked = false;
    this.tempHidden = false;
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
        // 鳴動中はユーザー操作無しで音を鳴らす必要があるため、自動再生制限を外す
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    this.view.setBackgroundColor('#00000000');
    this.window.contentView.addChildView(this.view);
    this.view.webContents.loadURL(PANEL_URL);
    this.view.webContents.on('context-menu', () => {
      Menu.buildFromTemplate([{ label: '一時的に非表示', click: () => this.hideTemporarily() }]).popup({
        window: this.window,
      });
    });
    this.tabManager.raiseOverlay();
  }

  hideTemporarily() {
    this.tempHidden = true;
    this.tabManager.layout();
  }

  setDocked(docked) {
    this.docked = !!docked;
    this.tabManager.layout();
  }

  setState(timers) {
    this.timers = timers || [];
    const hasRinging = this.timers.some((t) => t.ringing);
    if (this.tempHidden && !hasRinging) this.tempHidden = false;
    const hasActive = this.timers.some((t) => t.status === 'running' || t.ringing);
    if (hasActive && !this.docked) this.ensureView();
    this.sendToPanel('timer:state', this.timers);
    this.tabManager.layout();
  }

  sendToPanel(channel, payload) {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  // 発火の瞬間に呼ばれる。docked中でも必ず表示・音を鳴らす(この直前のsetStateで
  // this.timersは既に発火後の状態=ringingを含む形に更新済み)
  ring(timer) {
    this.ensureView();
    this.tempHidden = false;
    this.sendToPanel('timer:ring', timer);
    this.tabManager.layout();
  }

  // グレース満了/キャンセルで鳴動が収まったことをレンダラーへ知らせる(表示上の演出用。
  // 実際の状態遷移はTimers側で完結しており、直後のsetStateで最終状態が届く)
  ringClear(fireId) {
    this.sendToPanel('timer:ring-clear', fireId);
  }

  // TabManager.layout() から呼ばれる。area はページ全体の領域、panelInset はサイドパネルが
  // 開いている側の隅に余白を空けるための値
  layout(area, radius, panelInset = { left: 0, right: 0 }) {
    this.lastArea = area;
    if (!this.view) return;
    const visibleTimers = this.timers.filter((t) => t.status === 'running' || t.ringing);
    const hasRinging = visibleTimers.some((t) => t.ringing);
    const timersSectionOpen = !!this.tabManager.sidePanel?.open && this.tabManager.sidePanel.activeSection === 'timers';
    const visible = visibleTimers.length > 0 && (hasRinging || (!this.docked && !this.tempHidden && !timersSectionOpen));
    this.view.setVisible(visible);
    if (!visible) return;

    const rows = Math.max(1, visibleTimers.length);
    const height = Math.min(MAX_HEIGHT, TOOLS_HEIGHT + rows * ROW_HEIGHT);
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
    const y = corner.includes('bottom') ? area.y + area.height - height - MARGIN : area.y + MARGIN;
    return { x: Math.round(x), y: Math.round(y), width: WIDTH, height: Math.round(height) };
  }

  // ドラッグ中: 開始時のView位置(可変サイズ)を基準に、移動量(dx, dy)を都度受け取って追従させる
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

module.exports = TimerPanel;
