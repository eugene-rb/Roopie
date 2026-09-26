const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

// hitomi.la のページ用スクリプトは gold-usergeneratedcontent.net から配信される。
// それ以外の外部スクリプトを止める。汎用フィルタと同じエンジンに足し、
// Electron の webRequest リスナを二重登録しない。
const HITOMI_FILTERS = [
  '*$script,third-party,domain=hitomi.la',
  '@@||gold-usergeneratedcontent.net^$script,domain=hitomi.la',
];

function isHitomi(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      (parsed.hostname === 'hitomi.la' || parsed.hostname.endsWith('.hitomi.la'));
  } catch {
    return false;
  }
}

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
    this.desiredSessions = new Set();
    ipcMain.on('adblock:hitomi-enabled', (event) => {
      event.returnValue = this.desiredSessions.has(event.sender.session);
    });
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
      // コスメティックフィルタ(ページへのCSS/スクリプトレット注入)はYouTubeのPolymer製UIと
      // 衝突し、スクリプトの二重宣言やdom-repeatのスタックオーバーフローでUIが崩れることがある
      // (実機検証で確認)。ネットワークレベルの広告/トラッカー遮断はそのまま有効にし、注入だけ止める
      this.blocker.config.loadCosmeticFilters = false;
      this.blocker.updateFromDiff({ added: HITOMI_FILTERS });
    } catch (err) {
      console.error('広告ブロックエンジンの初期化に失敗:', err.message);
    }
  }

  // 設定に合わせてセッションへの適用を切り替える。
  // ghosteryはセッション有効化のたびに「グローバルな」IPCハンドラ2つを登録するため、
  // 複数セッション(複数プロファイルの同時利用/シークレット)では二重登録エラーになる。
  // 有効化前に外して登録し直させ、無効化後は残っているセッションのハンドラを復旧する
  async apply(session, enabled) {
    if (enabled) this.desiredSessions.add(session);
    else this.desiredSessions.delete(session);
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed() && wc.session === session && isHitomi(wc.getURL())) {
        wc.send('adblock:hitomi-state', enabled);
      }
    }
    await this.ready;
    if (!this.blocker) return;
    // 初期化中に設定が複数回変わっても、最後の状態だけを反映する。
    enabled = this.desiredSessions.has(session);
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
