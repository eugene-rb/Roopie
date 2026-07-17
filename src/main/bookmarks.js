const crypto = require('crypto');

const MAX_TITLE = 60;
const START_ROOT_TITLE = 'start';

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

  // ---- 通常のブックマーク(ルート直下のフラット一覧。星ボタン/バー/管理画面用) ----
  // スタート画面のショートカット(start フォルダ以下)はここには含まない

  list() {
    return this.items.filter((b) => b.type !== 'folder' && !b.parentId);
  }

  // 全アイテム(通常のブックマーク+startフォルダ/ページ/ショートカット)。
  // 管理画面が1つのフォルダツリーとして表示するために使う
  all() {
    this.ensureStartFolder();
    return this.items;
  }

  // アイテムを別フォルダへ移動する(ルート=null / startのページフォルダなど)。
  // ブックマーク項目のみ対象(フォルダの入れ子替えはスタート画面のページ構造を壊すため不可)
  move(id, parentId) {
    const item = this.items.find((b) => b.id === id);
    if (!item || item.type !== 'bookmark') return;
    const dest = parentId ?? null;
    if (dest !== null) {
      const folder = this.items.find((b) => b.id === dest && b.type === 'folder');
      if (!folder || folder.startRoot) return; // startルート直下はページ(フォルダ)専用
    }
    if (item.parentId === dest) return;
    // ルートへ移動する場合は同一URLの重複を作らない(星ボタンのトグルが誤動作するため)
    if (dest === null && this.find(item.url)) return;
    item.parentId = dest;
    this.changed();
  }

  find(url) {
    return this.list().find((b) => b.url === url) || null;
  }

  add(url, title, favicon) {
    if (!url || this.find(url)) return;
    const item = {
      id: crypto.randomUUID(),
      type: 'bookmark',
      parentId: null,
      url,
      title: title || url,
      favicon: favicon || null,
      icon: null,
      createdAt: Date.now(),
    };
    this.items.push(item);
    this.changed();
    return item;
  }

  removeByUrl(url) {
    const item = this.find(url);
    if (item) this.remove(item.id);
  }

  remove(id) {
    const index = this.items.findIndex((b) => b.id === id);
    if (index === -1 || this.items[index].startRoot) return; // startルートは削除不可(中身ごと消えるため)
    const [removed] = this.items.splice(index, 1);
    // フォルダを削除したら中身も一緒に削除する(カスケード)
    if (removed.type === 'folder') {
      for (const child of this.items.filter((b) => b.parentId === id)) this.remove(child.id);
    }
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

  // ---- フォルダ階層(スタート画面のショートカット用) ----

  children(parentId) {
    return this.items.filter((b) => b.parentId === parentId);
  }

  // "start" フォルダ(なければ作る)。直下の各サブフォルダが「ページ」
  ensureStartFolder() {
    let root = this.items.find((b) => b.type === 'folder' && b.startRoot === true);
    if (!root) {
      root = {
        id: crypto.randomUUID(),
        type: 'folder',
        parentId: null,
        startRoot: true,
        title: START_ROOT_TITLE,
        createdAt: Date.now(),
      };
      this.items.push(root);
      // 初回は「ページ1」を1つ作っておく
      this.items.push({
        id: crypto.randomUUID(),
        type: 'folder',
        parentId: root.id,
        title: 'ページ1',
        createdAt: Date.now(),
      });
      this.changed();
    }
    return root;
  }

  startPages() {
    const root = this.ensureStartFolder();
    return this.children(root.id).filter((b) => b.type === 'folder');
  }

  addStartPage(title) {
    const root = this.ensureStartFolder();
    const page = {
      id: crypto.randomUUID(),
      type: 'folder',
      parentId: root.id,
      title: (title ?? '').trim().slice(0, MAX_TITLE) || `ページ${this.children(root.id).length + 1}`,
      createdAt: Date.now(),
    };
    this.items.push(page);
    this.changed();
    return page;
  }

  // pageId 配下に、ページ or フォルダを開くショートカットを追加する。
  // フォルダは url に file:// スキームを付けて「URLと同じように」扱う
  addShortcut(pageId, { kind, name, target, icon }) {
    if (kind !== 'url' && kind !== 'folder') return null;
    const trimmedName = (name ?? '').trim().slice(0, MAX_TITLE);
    const trimmedTarget = (target ?? '').trim();
    if (!trimmedName || !trimmedTarget) return null;

    const item = {
      id: crypto.randomUUID(),
      type: 'bookmark',
      parentId: pageId,
      url: kind === 'folder' ? `file://${trimmedTarget}` : normalizeUrl(trimmedTarget),
      title: trimmedName,
      favicon: null,
      icon: normalizeIcon(icon),
      createdAt: Date.now(),
    };
    this.items.push(item);
    this.changed();
    return item;
  }

  // ショートカット項目・ページの名前/URL/アイコンを更新する。
  // patch.kind('url'|'folder')を指定すると、編集時に種別(ページ⇔フォルダ)も切り替えられる
  updateItem(id, patch) {
    const item = this.items.find((b) => b.id === id);
    if (!item || !patch) return;
    if (typeof patch.title === 'string' && patch.title.trim()) {
      item.title = patch.title.trim().slice(0, MAX_TITLE);
    }
    if (item.type === 'bookmark') {
      const kind =
        patch.kind === 'url' || patch.kind === 'folder'
          ? patch.kind
          : item.url.startsWith('file://')
            ? 'folder'
            : 'url';
      if (typeof patch.target === 'string' && patch.target.trim()) {
        const trimmed = patch.target.trim();
        item.url = kind === 'folder' ? `file://${trimmed}` : normalizeUrl(trimmed);
      }
      if (patch.icon !== undefined) item.icon = normalizeIcon(patch.icon);
    }
    this.changed();
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

function normalizeUrl(input) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
}

// null は既定(リンク先のfavicon / フォルダアイコン / 頭文字)。side-panel.js の normalizeWebIcon と同様に検証する
function normalizeIcon(icon) {
  if (!icon || typeof icon !== 'object') return null;
  if (icon.type === 'emoji' && typeof icon.value === 'string' && icon.value.trim()) {
    return { type: 'emoji', value: icon.value.trim().slice(0, 16) };
  }
  if (icon.type === 'image' && typeof icon.value === 'string') {
    return icon.value.startsWith('data:image/') && icon.value.length <= 400_000
      ? { type: 'image', value: icon.value }
      : null;
  }
  return null;
}

module.exports = Bookmarks;
