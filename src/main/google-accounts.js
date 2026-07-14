const crypto = require('crypto');
const { net } = require('electron');

// Chromiumが使うのと同じエンドポイント。セッションのCookieからログイン中のアカウントを取得する
const LIST_ACCOUNTS_URL =
  'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard';

/**
 * ブラウザ全体で保持するGoogleアカウントの一覧(プロファイル横断)。
 * どのアカウントをどのプロファイルで有効にするかは Profiles 側が持つ。
 */
class GoogleAccounts {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
  }

  get items() {
    return this.store.data;
  }

  list() {
    return this.items;
  }

  find(id) {
    return this.items.find((a) => a.id === id) ?? null;
  }

  findByEmail(email) {
    const normalized = normalizeEmail(email);
    return this.items.find((a) => normalizeEmail(a.email) === normalized) ?? null;
  }

  // 既に同じメールアドレスがあれば追加せず既存を返す
  add(email, label) {
    const address = (email ?? '').trim();
    if (!address.includes('@')) return null;

    const existing = this.findByEmail(address);
    if (existing) return existing;

    const account = {
      id: crypto.randomUUID(),
      email: address,
      label: (label ?? '').trim(),
      addedAt: Date.now(),
    };
    this.items.push(account);
    this.changed();
    return account;
  }

  remove(id) {
    const index = this.items.findIndex((a) => a.id === id);
    if (index === -1) return;
    this.items.splice(index, 1);
    this.changed();
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

/**
 * 指定セッションで実際にGoogleにログイン中のアカウント(メール+表示名)を返す。
 * 先頭がGoogleの言う「既定のアカウント(authuser=0)」。
 */
async function fetchSignedIn(session) {
  try {
    const response = await net.fetch(LIST_ACCOUNTS_URL, { session });
    if (!response.ok) return [];
    const data = JSON.parse(await response.text());
    // ["gaia.l.a.r", [["gaia.l.a", index, name, email, ...], ...]]
    const rows = Array.isArray(data?.[1]) ? data[1] : [];
    return rows
      .map((row) => ({ email: row[3], name: row[2] }))
      .filter((a) => typeof a.email === 'string' && a.email.includes('@'));
  } catch {
    // 未ログイン・オフライン・仕様変更時は「取得できなかった」として扱う
    return [];
  }
}

// メールアドレスの一覧だけが欲しい場合(設定画面の「ログイン中」表示用)
async function signedInAccounts(session) {
  return (await fetchSignedIn(session)).map((a) => a.email);
}

// セッションからGoogleのログイン情報(Cookie)を削除する = ログアウト
async function signOut(session) {
  for (const domain of ['.google.com', '.youtube.com']) {
    for (const cookie of await session.cookies.get({ domain })) {
      const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      await session.cookies.remove(url, cookie.name).catch(() => {});
    }
  }
}

// メールアドレスを指定すると、Googleのログイン画面にそのアカウントが入力済みで表示される
function loginUrl(email) {
  const params = new URLSearchParams({ continue: 'https://www.google.com/' });
  if (email) {
    params.set('Email', email);
    return `https://accounts.google.com/AccountChooser?${params}`;
  }
  return `https://accounts.google.com/ServiceLogin?${params}`;
}

function normalizeEmail(email) {
  return (email ?? '').trim().toLowerCase();
}

module.exports = GoogleAccounts;
module.exports.signedInAccounts = signedInAccounts;
module.exports.fetchSignedIn = fetchSignedIn;
module.exports.signOut = signOut;
module.exports.loginUrl = loginUrl;
module.exports.normalizeEmail = normalizeEmail;
