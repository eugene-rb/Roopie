/**
 * サイトごとの権限(カメラ・マイク・現在地・通知・全画面表示)。
 *
 * 「許可」だけをサイト単位で覚え、「ブロック」は今回限り(次に要求されたらまた尋ねる)。
 * そのため保存するのは許可したホスト名の一覧だけで、拒否リストは持たない。
 * 「今回だけ許可」はディスクへ書かず、メモリ(browser.js の tempGrants)で持つ。
 *
 * **Chromium 側は権限を一切覚えない**(実測: 同じページで2回 getUserMedia を呼ぶと
 * request ハンドラも2回来る/ページ遷移後も来る)ので、記憶はすべてこちらの責任。
 */

const MAX_SITES = 500;

// 扱う権限の種類。Electronの permission 名ではなく、保存とUIで使う独自の区分
// (media は要求内容によって camera / microphone に分かれるため)
const KINDS = ['camera', 'microphone', 'geolocation', 'notifications', 'fullscreen'];

// 確認ポップアップに出す「何を求めているか」
const LABELS = {
  camera: 'カメラを使用する',
  microphone: 'マイクを使用する',
  geolocation: '現在地を知る',
  notifications: '通知を送信する',
  fullscreen: '全画面表示にする',
};

// 尋ねる対象になるホスト名(http/httpsのページだけ)。
// それ以外(file:// や roopie:// など)は null = 尋ねずに拒否する
function hostFor(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Electron の permission 名 + details から、扱う種類を割り出す。
 * 空配列 = このブラウザでは尋ねない権限(clipboard-read や midi などは従来どおり素通しで許可)。
 *
 * `ask: true`(要求の判定時)では、media の種類が空で届いたときにカメラ・マイクの両方として
 * 扱う。**実測では mediaTypes が入らないことがある**ため、空を「尋ねない」に倒すと
 * 黙って許可することになってしまう。
 */
function kindsFor(permission, details, { ask = false } = {}) {
  if (permission === 'fullscreen') return ['fullscreen'];
  if (permission === 'geolocation') return ['geolocation'];
  if (permission === 'notifications') return ['notifications'];
  if (permission === 'media') {
    // 要求は mediaTypes(配列)、チェックは mediaType(単数)で届く
    const types = Array.isArray(details?.mediaTypes)
      ? details.mediaTypes
      : details?.mediaType
        ? [details.mediaType]
        : [];
    const kinds = [];
    if (types.includes('video')) kinds.push('camera');
    if (types.includes('audio')) kinds.push('microphone');
    if (!kinds.length && ask) return ['camera', 'microphone'];
    return kinds;
  }
  return [];
}

// 保存されている許可一覧を整える(レンダラーから任意の値が来ても壊れないように)
function normalizeGrants(value) {
  const grants = {};
  for (const kind of KINDS) grants[kind] = normalizeHosts(value?.[kind]);
  return grants;
}

function normalizeHosts(value) {
  if (!Array.isArray(value)) return [];
  const hosts = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const host = item.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return [...hosts].slice(0, MAX_SITES);
}

// 許可済みかどうか。ホスト名の**完全一致**で判定する(Chromeと同じくオリジン単位)。
// 末尾一致にすると youtube.com.evil.net のような偽装ホストまで通ってしまう。
// サブドメイン(music.youtube.com など)は別のサイトとして改めて尋ねる
function isGranted(grants, kind, url) {
  const host = hostFor(url);
  return !!host && (grants?.[kind] ?? []).includes(host);
}

// 許可したホストを一覧の末尾へ(古いものから溢れさせる)
function addHost(hosts, host) {
  const list = (hosts ?? []).filter((h) => h !== host);
  if (host) list.push(host);
  return list.slice(-MAX_SITES);
}

// 1種類ぶんの許可を足した新しい一覧を返す(元のオブジェクトは変えない)
function addGrant(grants, kind, host) {
  const next = normalizeGrants(grants);
  if (KINDS.includes(kind)) next[kind] = addHost(next[kind], host);
  return next;
}

/**
 * 旧 `fullscreenAllowedSites`(全画面表示だけを持っていた頃の形)を
 * `sitePermissions.fullscreen` へ畳む。**旧キーは消すので二度と走らない**
 * =あとで取り消したホストが再び湧いてくることはない。
 * 移行したら true(呼び出し側が保存する)。
 */
function migrateSettings(data) {
  if (!data || !Array.isArray(data.fullscreenAllowedSites)) return false;
  let grants = normalizeGrants(data.sitePermissions);
  for (const host of normalizeHosts(data.fullscreenAllowedSites)) {
    grants = addGrant(grants, 'fullscreen', host);
  }
  data.sitePermissions = grants;
  delete data.fullscreenAllowedSites;
  return true;
}

module.exports = {
  hostFor,
  kindsFor,
  isGranted,
  addHost,
  addGrant,
  normalizeHosts,
  normalizeGrants,
  migrateSettings,
  KINDS,
  LABELS,
  MAX_SITES,
};
