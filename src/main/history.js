const crypto = require('crypto');

const MAX_ENTRIES = 5000;

class History {
  constructor(store) {
    this.store = store;
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store?.flush();
    this.store = store;
  }

  get entries() {
    return this.store.data;
  }

  add(url, title, favicon) {
    if (!url || url.startsWith('roopie://') || url === 'about:blank') return;

    const last = this.entries[0];
    // 同じURLへの連続アクセスは1件にまとめる
    if (last && last.url === url) {
      last.title = title || last.title;
      last.favicon = favicon || last.favicon;
      last.visitedAt = Date.now();
    } else {
      this.entries.unshift({
        id: crypto.randomUUID(),
        url,
        title: title || url,
        favicon: favicon || null,
        visitedAt: Date.now(),
      });
      if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    }
    this.store.save();
  }

  // このURLを過去に訪れたことがあるか(「2回目以降の訪問」の判定に使う)
  has(url) {
    return !!url && this.entries.some((e) => e.url === url);
  }

  // 直近のタイトル/faviconの更新を反映する(ページ読み込み完了後に呼ばれる)
  update(url, title, favicon) {
    const entry = this.entries.find((e) => e.url === url);
    if (!entry) return;
    if (title) entry.title = title;
    if (favicon) entry.favicon = favicon;
    this.store.save();
  }

  list(query = '', limit = 300) {
    const q = query.trim().toLowerCase();
    const matched = q
      ? this.entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)
        )
      : this.entries;
    return matched.slice(0, limit);
  }

  remove(id) {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) return;
    this.entries.splice(index, 1);
    this.store.save();
  }

  clear() {
    this.entries.length = 0;
    this.store.save();
  }
}

module.exports = History;
