const fs = require('fs');
const path = require('path');
const { app } = require('electron');
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

  // 設定に合わせてセッションへの適用を切り替える
  async apply(session, enabled) {
    await this.ready;
    if (!this.blocker) return;
    if (enabled && !this.enabledSessions.has(session)) {
      this.blocker.enableBlockingInSession(session);
      this.enabledSessions.add(session);
    } else if (!enabled && this.enabledSessions.has(session)) {
      this.blocker.disableBlockingInSession(session);
      this.enabledSessions.delete(session);
    }
  }
}

module.exports = AdBlock;
