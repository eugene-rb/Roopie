const crypto = require('crypto');
const { safeStorage } = require('electron');

/**
 * 保存パスワードの管理。
 * パスワード本体は Electron の safeStorage(OSの資格情報ストアの鍵)で暗号化し、
 * base64文字列としてJSONに保存する。復号は必要なとき(自動入力/表示)だけ行う。
 *
 * 保存単位は「オリジン + ユーザー名」。同じ組み合わせは上書きする。
 */
class Passwords {
  constructor(store) {
    this.store = store;
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store?.flush();
    this.store = store;
  }

  get items() {
    return this.store.data;
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

  // このオリジンに保存されている資格情報(パスワードは復号して返す)
  forOrigin(origin) {
    return this.items
      .filter((p) => p.origin === origin)
      .map((p) => ({ username: p.username, password: this.decrypt(p.encrypted) }))
      .filter((p) => p.password !== null);
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
}

module.exports = Passwords;
