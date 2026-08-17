/**
 * Chrome拡張機能向け chrome.downloads API のメインプロセス側実装。
 *
 * electron-chrome-extensions は downloads.* を実装していない(README の対応表にも
 * 載っていない)。呼び出しても常に { noop: true } でスタブ応答が返るだけで、
 * 拡張機能(例: 右クリック画像保存系)のダウンロード機能が一切動かない原因になっていた。
 *
 * ここでは patches/electron-chrome-extensions+*.patch で download/search/cancel/erase/
 * removeFile の noop を外した上で、ElectronChromeExtensions インスタンスの
 * `ctx.router.handle()`(公開APIではないが node_modules 内部の実装として存在する)に
 * 直接ハンドラを登録することで、node_modules 自体には手を入れずに実装している。
 *
 * download() 呼び出しと session の 'will-download' イベントは、Chrome の
 * downloadId(拡張機能へすぐ返す整数)とElectronのDownloadItem(非同期に生成される)を
 * 対応付ける必要があるため、呼び出し順どおりに発火する前提のFIFOキューで紐付ける。
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Chrome拡張の chrome.downloads.DownloadItem.state に合わせる
const STATE_IN_PROGRESS = 'in_progress';
const STATE_COMPLETE = 'complete';
const STATE_INTERRUPTED = 'interrupted';

class ExtensionDownloadsAPI {
  constructor(session, ctx) {
    this.session = session;
    this.ctx = ctx;
    this.records = new Map(); // downloadId(number) -> record
    this.items = new Map(); // downloadId(number) -> Electron.DownloadItem
    this.nextId = 1;
    // download() 呼び出し順に積み、次に発火した will-download と先頭から対応付ける
    this.pendingQueue = [];

    this._onWillDownload = (_event, item) => this._handleWillDownload(item);
    session.on('will-download', this._onWillDownload);

    const router = ctx.router;
    router.handle('downloads.download', (event, details) => this._download(details));
    router.handle('downloads.search', (event, query) => this._search(query));
    router.handle('downloads.cancel', (event, id) => this._cancel(id));
    router.handle('downloads.erase', (event, query) => this._erase(query));
    router.handle('downloads.removeFile', (event, id) => this._removeFile(id));
  }

  async _download(details) {
    if (!details || !details.url) throw new Error('url is required');
    const id = this.nextId++;
    this.pendingQueue.push({
      id,
      filename: details.filename || null,
      conflictAction: details.conflictAction || 'uniquify',
    });
    try {
      this.session.downloadURL(details.url, details.headers ? { headers: details.headers } : undefined);
    } catch (err) {
      const idx = this.pendingQueue.findIndex((p) => p.id === id);
      if (idx !== -1) this.pendingQueue.splice(idx, 1);
      throw err;
    }
    // record はまだ無い('will-download' が来るまでの間、search() は見つけられなくてよい。
    // Link-Copy 等は download() 直後に search({id}) をポーリングして待つ設計になっている)
    return id;
  }

  // 保存先を決める。will-downloadで明示的にsetSavePathしないと、Electronが内部の
  // 一時ファイル名(uuid.tmp)のまま確定してしまうため、必ず自前で決定する
  _resolveSavePath(name, conflictAction) {
    const dir = app.getPath('downloads');
    const safe = path.basename(name || 'download').replace(/[\\/]/g, '_') || 'download';
    let candidate = path.join(dir, safe);
    if (conflictAction === 'overwrite' || !fs.existsSync(candidate)) return candidate;
    const ext = path.extname(safe);
    const base = safe.slice(0, safe.length - ext.length);
    for (let n = 1; ; n++) {
      candidate = path.join(dir, `${base} (${n})${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
  }

  _handleWillDownload(item) {
    const pending = this.pendingQueue.shift();
    if (!pending) return; // 拡張機能起動ではない通常のダウンロード(Roopieのdownloads.jsが別途処理)

    const { id, filename, conflictAction } = pending;
    const savePath = this._resolveSavePath(filename || item.getFilename(), conflictAction);
    try {
      item.setSavePath(savePath);
    } catch {
      /* 保存先の決定に失敗してもElectronの既定動作にフォールバックさせる */
    }

    this.items.set(id, item);
    const record = {
      id,
      url: item.getURL(),
      finalUrl: item.getURL(),
      filename: item.getSavePath() || item.getFilename(),
      mimeType: item.getMimeType(),
      state: STATE_IN_PROGRESS,
      exists: true,
      startTime: new Date().toISOString(),
      error: null,
    };
    this.records.set(id, record);

    item.on('updated', (_e, state) => {
      record.filename = item.getSavePath() || item.getFilename();
      const nextState = state === 'interrupted' ? STATE_INTERRUPTED : STATE_IN_PROGRESS;
      this._applyChange(id, record, { state: nextState });
    });

    item.once('done', (_e, state) => {
      this.items.delete(id);
      const nextState = state === 'completed' ? STATE_COMPLETE : STATE_INTERRUPTED;
      record.filename = item.getSavePath() || item.getFilename();
      record.exists = state === 'completed';
      // ElectronのDownloadItemはHTTPステータス等の詳細な中断理由を公開していないため、
      // 拡張機能へは汎用的な理由コードのみ返す(表示文言の精度より、保存成否の判定を優先)
      record.error = nextState === STATE_INTERRUPTED
        ? (state === 'cancelled' ? 'USER_CANCELED' : 'NETWORK_FAILED')
        : null;
      this._applyChange(id, record, { state: nextState });
    });
  }

  _applyChange(id, record, patch) {
    const delta = { id };
    for (const [key, value] of Object.entries(patch)) {
      const previous = key === 'state' ? undefined : record[key];
      record[key] = value;
      delta[key] = { current: value, previous };
    }
    this.ctx.router.broadcastEvent('downloads.onChanged', delta);
  }

  async _search(query = {}) {
    let list = [...this.records.values()];
    if (query.id != null) list = list.filter((r) => r.id === query.id);
    if (query.url != null) list = list.filter((r) => r.url === query.url);
    if (typeof query.limit === 'number' && query.limit > 0) list = list.slice(0, query.limit);
    return list.map((r) => ({ ...r }));
  }

  async _cancel(id) {
    this.items.get(id)?.cancel();
  }

  async _erase(query = {}) {
    const matched = await this._search(query);
    for (const r of matched) this.records.delete(r.id);
    return matched.map((r) => r.id);
  }

  async _removeFile(id) {
    const record = this.records.get(id);
    if (record?.filename && fs.existsSync(record.filename)) {
      await fs.promises.unlink(record.filename).catch(() => {});
      record.exists = false;
    }
  }

  destroy() {
    this.session.removeListener('will-download', this._onWillDownload);
  }
}

module.exports = ExtensionDownloadsAPI;
