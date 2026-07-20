const crypto = require('crypto');

// Googleのログイン状態が共有されるドメイン。ここを訪れたらログイン中アカウントを見に行く
const GOOGLE_DOMAINS = [
  'google.com',
  'google.co.jp',
  'youtube.com',
  'gmail.com',
  'googlemail.com',
  'googleusercontent.com',
];

function isGoogleDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return GOOGLE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false; // 不正なURLは無視
  }
}

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

// GoogleのListAccounts API(Chromiumが内部で使うのと同じもの)は、ページの文脈を持たない
// 素のリクエスト(Sec-Fetch-Site: none / Origin無し)だと「不正な形式」扱いでHTTP 400を返す。
// Cookieを正しく送っていても拒否されるため、代わりにページ自身がすでに描画している
// 「Google アカウント: 名前 (メール)」ボタンのaria-label/titleをDOM越しに読む(追加の通信は発生しない)
const DETECT_SCRIPT = `(() => {
  const els = [...document.querySelectorAll('a,button,div,span')].filter((el) => {
    const label = (el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '');
    return label.includes('@') || /account|アカウント/i.test(label);
  }).slice(0, 15);
  return els.map((el) => ({ aria: el.getAttribute('aria-label'), title: el.getAttribute('title') }));
})()`;

// "Google アカウント: 太郎 (taro@gmail.com)" のような文字列からメール+名前を取り出す
function parseAccountLabel(label) {
  if (!label) return null;
  const emailMatch = label.match(/\(([^()\s]+@[^()\s]+)\)/);
  if (!emailMatch) return null;
  const nameMatch = label.match(/:\s*([\s\S]+?)\s*\(/);
  return {
    email: emailMatch[1],
    name: nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : '',
  };
}

/**
 * 指定タブ(Googleドメインを開いているwebContents)のDOMから、
 * 現在ログイン中として表示されているアカウント(メール+表示名)を読み取る。
 * ページが実際に表示しているアカウントは1つだけなので、複数アカウント同時ログインのうち
 * そのページで表示中の1件のみ返す(ListAccounts APIのような全件取得はできない)。
 */
async function detectFromWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) return [];
  try {
    const candidates = await webContents.executeJavaScript(DETECT_SCRIPT, true);
    for (const candidate of candidates ?? []) {
      const found = parseAccountLabel(candidate.aria) || parseAccountLabel(candidate.title);
      if (found) return [found];
    }
    return [];
  } catch {
    // ページ側の都合(遷移中・破棄済みなど)で読めなくても、次の訪問でまた試すので無視してよい
    return [];
  }
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
module.exports.isGoogleDomain = isGoogleDomain;
module.exports.detectFromWebContents = detectFromWebContents;
module.exports.parseAccountLabel = parseAccountLabel;
module.exports.signOut = signOut;
module.exports.loginUrl = loginUrl;
module.exports.normalizeEmail = normalizeEmail;
