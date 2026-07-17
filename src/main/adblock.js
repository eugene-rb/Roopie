const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

/**
 * 内蔵広告ブロック(@ghostery/adblocker-electron)。
 * ElectronのwebRequest APIで広告・トラッカーのリクエストを遮断する。
 *
 * 背景: Electronは拡張機能の chrome.webRequest ブロッキングと
 * chrome.declarativeNetRequest を実装していないため、uBlock Originは動かない。
 * その代替としてEasyList等のフィルタを内蔵エンジンで適用する(Phase 2の検証結果)。
 */
class AdBlock {
  constructor() {
    this.blocker = null;
    this.enabledSessions = new Set();
    this.ready = this.init();
  }

  async init() {
    try {
      // フィルタはダウンロード後にキャッシュされ、オフラインでも前回分が使われる
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: path.join(app.getPath('userData'), 'adblock-engine.bin'),
        read: fs.promises.readFile,
        write: fs.promises.writeFile,
      });
    } catch (err) {
      console.error('広告ブロックエンジンの初期化に失敗:', err.message);
    }
  }

  // 設定に合わせてセッションへの適用を切り替える。
  // ghosteryはセッション有効化のたびに「グローバルな」IPCハンドラ2つを登録するため、
  // 複数セッション(複数プロファイルの同時利用/シークレット)では二重登録エラーになる。
  // 有効化前に外して登録し直させ、無効化後は残っているセッションのハンドラを復旧する
  async apply(session, enabled) {
    await this.ready;
    if (!this.blocker) return;
    if (enabled && !this.enabledSessions.has(session)) {
      ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
      ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
      this.blocker.enableBlockingInSession(session);
      this.enabledSessions.add(session);
    } else if (!enabled && this.enabledSessions.has(session)) {
      this.blocker.disableBlockingInSession(session); // グローバルハンドラも外れる
      this.enabledSessions.delete(session);
      const remaining = [...this.enabledSessions][0];
      const context = remaining ? this.blocker.contexts.get(remaining) : null;
      if (context) {
        ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', context.onInjectCosmeticFilters);
        ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', context.onIsMutationObserverEnabled);
      }
    }
  }
}

module.exports = AdBlock;
