const crypto = require('crypto');

const MAX_TITLE = 200;

/**
 * リードリスト(「後で読む」)。ブラウザ全体で1つの一覧をプロファイル単位で保持する。
 * bookmarks と同じく browser レベルの単一インスタンスにして、全ウィンドウで整合させる
 * (ウィンドウごとに別インスタンスにすると、保存したページが別ウィンドウの保存で消える)。
 */
class Readlist {
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

  // 追加。既存URLは先頭へ移動して未読に戻す(「もう一度読みたい」意図)
  add(url, title, favicon) {
    if (!url) return null;
    const index = this.items.findIndex((e) => e.url === url);
    if (index !== -1) {
      const [entry] = this.items.splice(index, 1);
      if (title) entry.title = title.slice(0, MAX_TITLE);
      if (favicon) entry.favicon = favicon;
      entry.read = false;
      entry.addedAt = Date.now();
      this.items.unshift(entry);
      this.changed();
      return entry;
    }
    const entry = {
      id: crypto.randomUUID(),
      url,
      title: (title || url).slice(0, MAX_TITLE),
      favicon: favicon || null,
      read: false,
      addedAt: Date.now(),
    };
    this.items.unshift(entry);
    this.changed();
    return entry;
  }

  remove(id) {
    const index = this.items.findIndex((e) => e.id === id);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.changed();
  }

  setRead(id, read) {
    const entry = this.items.find((e) => e.id === id);
    if (!entry) return;
    entry.read = !!read;
    this.changed();
  }

  // 既読の項目をまとめて削除する
  clearRead() {
    const kept = this.items.filter((e) => !e.read);
    if (kept.length === this.items.length) return;
    this.store.data = kept;
    this.changed();
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

module.exports = Readlist;
