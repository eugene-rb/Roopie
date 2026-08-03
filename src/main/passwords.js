const crypto = require('crypto');
const { safeStorage } = require('electron');

/**
 * 保存パスワードの管理。
 * パスワード本体は Electron の safeStorage(OSの資格情報ストアの鍵)で暗号化し、
 * base64文字列としてJSONに保存する。復号は必要なとき(自動入力/表示)だけ行う。
 *
 * 保存単位は「オリジン + ユーザー名」。同じ組み合わせは上書きする。
 * ストア形式: { items: [...], neverSave: [origin, ...] }
 * (旧形式の配列は読み込み時に移行する)
 */
class Passwords {
  constructor(store) {
    this.store = store;
    this.normalize();
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalize();
  }

  // 旧形式(配列のみ)から {items, neverSave} へ移行する
  normalize() {
    const d = this.store.data;
    if (Array.isArray(d)) {
      this.store.data = { items: d, neverSave: [] };
      this.store.save();
      return;
    }
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.neverSave)) d.neverSave = [];
  }

  get items() {
    return this.store.data.items;
  }

  static available() {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(password) {
    return safeStorage.encryptString(password).toString('base64');
  }

  decrypt(encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      // 別のマシン/OSユーザーで作られたデータは復号できない
      return null;
    }
  }

  find(origin, username) {
    return this.items.find((p) => p.origin === origin && p.username === username) || null;
  }

  // このオリジンに保存されているユーザー名の一覧(パスワードは含めない。ドロップダウン表示用)
  usernamesForOrigin(origin) {
    return this.items
      .filter((p) => p.origin === origin)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .map((p) => p.username);
  }

  // このオリジンに保存されている資格情報(パスワードは復号して返す)。最近使った順
  forOrigin(origin) {
    return this.items
      .filter((p) => p.origin === origin)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .map((p) => ({ username: p.username, password: this.decrypt(p.encrypted) }))
      .filter((p) => p.password !== null);
  }

  // 1件の資格情報(ドロップダウンで選択した時)。lastUsedAt を更新する
  credential(origin, username) {
    const item = this.find(origin, username);
    if (!item) return null;
    const password = this.decrypt(item.encrypted);
    if (password === null) return null;
    item.lastUsedAt = Date.now();
    this.store.save();
    return { username: item.username, password };
  }

  // 保存済みかどうか(保存バーを出すか判断するのに使う)
  matches(origin, username, password) {
    const existing = this.find(origin, username);
    return !!existing && this.decrypt(existing.encrypted) === password;
  }

  save(origin, username, password) {
    if (!Passwords.available() || !origin || !username || !password) return false;
    const encrypted = this.encrypt(password);
    const existing = this.find(origin, username);
    if (existing) {
      existing.encrypted = encrypted;
      existing.updatedAt = Date.now();
    } else {
      this.items.push({
        id: crypto.randomUUID(),
        origin,
        username,
        encrypted,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.store.save();
    return true;
  }

  // 管理画面からの編集(ユーザー名/パスワード)。ユーザー名変更が既存と重複する場合は失敗
  update(id, { username, password } = {}) {
    const item = this.items.find((p) => p.id === id);
    if (!item) return false;
    const newUsername = String(username ?? '').trim();
    if (newUsername && newUsername !== item.username) {
      if (this.find(item.origin, newUsername)) return false;
      item.username = newUsername;
    }
    if (password) item.encrypted = this.encrypt(password);
    item.updatedAt = Date.now();
    this.store.save();
    return true;
  }

  // 管理画面向けの一覧(パスワードは伏せる)
  list() {
    return this.items.map((p) => ({
      id: p.id,
      origin: p.origin,
      username: p.username,
      updatedAt: p.updatedAt,
    }));
  }

  // 「表示」ボタン用。復号できない場合は null
  reveal(id) {
    const item = this.items.find((p) => p.id === id);
    return item ? this.decrypt(item.encrypted) : null;
  }

  // CSVエクスポート用(全件復号)。呼び出し側で保存ダイアログを挟むこと
  exportAll() {
    return this.items
      .map((p) => ({ origin: p.origin, username: p.username, password: this.decrypt(p.encrypted) }))
      .filter((p) => p.password !== null);
  }

  remove(id) {
    const index = this.items.findIndex((p) => p.id === id);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.store.save();
  }

  clear() {
    this.items.length = 0;
    this.store.save();
  }

  // ---- 「このサイトでは保存しない」の除外リスト ----

  get neverSave() {
    return this.store.data.neverSave;
  }

  isExcluded(origin) {
    return this.neverSave.includes(origin);
  }

  addNeverSave(origin) {
    if (!origin || this.isExcluded(origin)) return;
    this.neverSave.push(origin);
    this.store.save();
  }

  removeNeverSave(origin) {
    const index = this.neverSave.indexOf(origin);
    if (index === -1) return;
    this.neverSave.splice(index, 1);
    this.store.save();
  }
}

module.exports = Passwords;
