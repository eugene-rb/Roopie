const crypto = require('crypto');

class Bookmarks {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.onChange?.();
  }

  get items() {
    return this.store.data;
  }

  list() {
    return this.items;
  }

  find(url) {
    return this.items.find((b) => b.url === url) || null;
  }

  add(url, title, favicon) {
    if (!url || this.find(url)) return;
    this.items.push({
      id: crypto.randomUUID(),
      url,
      title: title || url,
      favicon: favicon || null,
      createdAt: Date.now(),
    });
    this.changed();
  }

  removeByUrl(url) {
    const index = this.items.findIndex((b) => b.url === url);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.changed();
  }

  remove(id) {
    const index = this.items.findIndex((b) => b.id === id);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.changed();
  }

  rename(id, title) {
    const item = this.items.find((b) => b.id === id);
    if (!item || !title) return;
    item.title = title;
    this.changed();
  }

  // ブックマーク済みなら解除、未登録なら追加(スターボタン用)
  toggle(url, title, favicon) {
    if (this.find(url)) this.removeByUrl(url);
    else this.add(url, title, favicon);
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

module.exports = Bookmarks;
