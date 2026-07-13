const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const Store = require('./store');

// プロファイルごとに「共有する/しない」を選べる項目。
// Cookie・ログインセッションはプロファイル機能の本質なので常に分離する(トグルなし)。
const SHARABLE_KEYS = ['bookmarks', 'history', 'downloads', 'settings'];

const DEFAULT_SHARED = {
  bookmarks: false,
  history: false,
  downloads: false,
  settings: false,
};

const COLORS = ['#6c8cff', '#4bbf8a', '#ffb454', '#e5709b', '#a78bfa', '#4dc4d9'];

class Profiles {
  constructor() {
    this.root = app.getPath('userData');
    this.store = new Store(path.join(this.root, 'profiles.json'), null);

    if (!this.store.data?.profiles?.length) {
      const first = this.newProfile('個人');
      this.store.data = { profiles: [first], activeId: first.id };
      this.store.flush();
    }
  }

  newProfile(name) {
    const used = this.store.data?.profiles?.length ?? 0;
    return {
      id: crypto.randomUUID(),
      name,
      color: COLORS[used % COLORS.length],
      shared: { ...DEFAULT_SHARED },
      createdAt: Date.now(),
    };
  }

  get profiles() {
    return this.store.data.profiles;
  }

  get activeId() {
    return this.store.data.activeId;
  }

  active() {
    return this.profiles.find((p) => p.id === this.activeId) ?? this.profiles[0];
  }

  list() {
    return this.profiles;
  }

  create(name) {
    const profile = this.newProfile(name?.trim() || '新しいプロファイル');
    this.profiles.push(profile);
    this.store.save();
    return profile;
  }

  rename(id, name) {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile || !name?.trim()) return;
    profile.name = name.trim();
    this.store.save();
  }

  // 最後の1つは削除できない。データディレクトリとセッションも消す。
  remove(id) {
    if (this.profiles.length <= 1) return false;
    const index = this.profiles.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.profiles.splice(index, 1);
    if (this.activeId === id) {
      this.store.data.activeId = this.profiles[0].id;
    }
    this.store.flush();

    fs.rmSync(path.join(this.root, 'profiles', id), { recursive: true, force: true });
    session.fromPartition(partitionFor(id)).clearStorageData();
    return true;
  }

  switchTo(id) {
    if (!this.profiles.some((p) => p.id === id) || id === this.activeId) return false;
    this.store.data.activeId = id;
    this.store.flush();
    return true;
  }

  setShared(id, key, shared) {
    if (!SHARABLE_KEYS.includes(key)) return;
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;
    profile.shared[key] = !!shared;
    this.store.save();
  }

  // 共有ONなら全プロファイル共通のファイル、OFFならプロファイル専用のファイルを使う
  dataFile(profile, key) {
    return profile.shared[key]
      ? path.join(this.root, 'shared', `${key}.json`)
      : path.join(this.root, 'profiles', profile.id, `${key}.json`);
  }

  sessionFor(profile) {
    return session.fromPartition(partitionFor(profile.id));
  }
}

function partitionFor(id) {
  return `persist:profile-${id}`;
}

module.exports = Profiles;
module.exports.SHARABLE_KEYS = SHARABLE_KEYS;
