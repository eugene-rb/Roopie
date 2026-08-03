const crypto = require('crypto');
const { shell } = require('electron');
const fs = require('fs');

/**
 * ダウンロードの管理。
 * 履歴はJSONに永続化し、進行中のDownloadItemは中断/再開のためメモリ上に保持する。
 */
class Downloads {
  constructor(store, onChange) {
    this.onChange = onChange;
    this.active = new Map(); // id -> DownloadItem
    this.attachedSessions = new Set();
    this.store = store;
    this.markStaleAsInterrupted();
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store.flush();
    this.store = store;
    this.markStaleAsInterrupted();
    this.onChange?.();
  }

  // 前回終了時に進行中だったものは復元できないので中断扱いにする
  markStaleAsInterrupted() {
    for (const item of this.items) {
      if (item.state === 'progressing' || item.state === 'paused') {
        item.state = 'interrupted';
      }
    }
  }

  // プロファイルごとにセッションが変わるため、セッション単位で監視を張る
  attachSession(session) {
    if (this.attachedSessions.has(session)) return;
    this.attachedSessions.add(session);
    session.on('will-download', (_event, item) => this.track(item));
  }

  get items() {
    return this.store.data;
  }

  track(item) {
    const id = crypto.randomUUID();
    const record = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: '',
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    this.items.unshift(record);
    this.active.set(id, item);

    item.on('updated', (_e, state) => {
      record.savePath = item.getSavePath();
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      this.changed();
    });

    item.once('done', (_e, state) => {
      record.savePath = item.getSavePath();
      record.receivedBytes = item.getReceivedBytes();
      record.state = state; // completed | cancelled | interrupted
      this.active.delete(id);
      this.changed();
    });

    this.changed();
  }

  list() {
    return this.items;
  }

  pause(id) {
    this.active.get(id)?.pause();
  }

  resume(id) {
    const item = this.active.get(id);
    if (item?.canResume()) item.resume();
  }

  cancel(id) {
    this.active.get(id)?.cancel();
  }

  open(id) {
    const record = this.items.find((d) => d.id === id);
    if (record?.state === 'completed' && fs.existsSync(record.savePath)) {
      shell.openPath(record.savePath);
    }
  }

  showInFolder(id) {
    const record = this.items.find((d) => d.id === id);
    if (record?.savePath && fs.existsSync(record.savePath)) {
      shell.showItemInFolder(record.savePath);
    }
  }

  // 履歴から削除(ファイル自体は削除しない)
  remove(id) {
    const index = this.items.findIndex((d) => d.id === id);
    if (index === -1) return;
    this.active.get(id)?.cancel();
    this.items.splice(index, 1);
    this.changed();
  }

  // 進行中のものは残し、終了済みの履歴だけ消す
  clear() {
    const remaining = this.items.filter(
      (d) => d.state === 'progressing' || d.state === 'paused'
    );
    this.store.data = remaining;
    this.changed();
  }

  hasActive() {
    return this.active.size > 0;
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

module.exports = Downloads;
