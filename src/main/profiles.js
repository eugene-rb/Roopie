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

    // 古い形式のprofiles.jsonでも動くように、足りない項目を補う
    for (const profile of this.profiles) {
      profile.shared = { ...DEFAULT_SHARED, ...profile.shared };
      profile.google = { enabled: [], primaryId: null, ...profile.google };
      delete profile.googleAccount;
    }
  }

  newProfile(name) {
    const used = this.store.data?.profiles?.length ?? 0;
    return {
      id: crypto.randomUUID(),
      name,
      color: COLORS[used % COLORS.length],
      shared: { ...DEFAULT_SHARED },
      // このプロファイルで使うGoogleアカウント(IDは google-accounts.js の一覧を参照)
      google: { enabled: [], primaryId: null },
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

  // このプロファイルでGoogleアカウントを使うかどうか
  setGoogleEnabled(profileId, accountId, enabled) {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const google = profile.google;
    const has = google.enabled.includes(accountId);

    if (enabled && !has) {
      google.enabled.push(accountId);
      // 最初に有効化したアカウントを自動でプライマリにする
      if (!google.primaryId) google.primaryId = accountId;
    } else if (!enabled && has) {
      google.enabled = google.enabled.filter((id) => id !== accountId);
      if (google.primaryId === accountId) {
        google.primaryId = google.enabled[0] ?? null;
      }
    }
    this.store.save();
  }

  // プライマリ(既定でログインするアカウント)は有効なアカウントの中からしか選べない
  setGooglePrimary(profileId, accountId) {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile || !profile.google.enabled.includes(accountId)) return;
    profile.google.primaryId = accountId;
    this.store.save();
  }

  // アカウント自体が削除されたら、全プロファイルの参照も外す
  forgetAccount(accountId) {
    for (const profile of this.profiles) {
      this.setGoogleEnabled(profile.id, accountId, false);
    }
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
