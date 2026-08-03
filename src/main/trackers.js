const tldts = require('tldts');

/**
 * トラッキングCookieの分析。「今の自分がどうプロファイルされているか」をパネルに出すため、
 * セッションのCookieストアを読み、既知トラッカーの定義に照らして企業単位にまとめる。
 *
 * 判定方針(実データで検証した結果):
 * - 「Cookieのドメイン≠訪問したサイト」でのサードパーティ判定は使えない。
 *   google.com の NID や nhk.or.jp の AMCV_(Adobe)のように、最大手のトラッカーほど
 *   訪問済みドメインの一次Cookieとして入るため、その判定では取りこぼす。
 * - 代わりに既知トラッカーの定義(ドメイン + Cookie名パターン)で判定する。
 * - 「サイトをまたいで追跡できるか」は SameSite=None かどうかで見る。実測では
 *   広告系サードパーティCookieはほぼ全てが SameSite=None だった。
 */

// 企業定義。domains は登録可能ドメイン(eTLD+1)で一致、cookies はその企業が一次Cookieとして
// 置く名前のパターン(訪問済みサイト上に入るアナリティクス系を拾うため)。
// 実際に主要サイトを開いて採取したCookieを基に構成している(scripts/inspect-cookies.js --probe)。
const COMPANIES = [
  {
    name: 'Google',
    category: '広告',
    domains: ['doubleclick.net', 'googlesyndication.com', 'googletagmanager.com', 'googleadservices.com', 'google-analytics.com', 'adservice.google.com', 'app-measurement.com'],
    firstParty: [/^_ga($|_)/, /^_gid$/, /^_gcl_/, /^__gads$/, /^__gpi$/, /^_gat/],
    idDomains: ['google.com'],
    idNames: [/^NID$/, /^IDE$/, /^AEC$/, /^DSID$/, /^__Secure-3PAPISID$/, /^__Secure-3PSID$/],
    note: '検索・広告・アクセス解析。ウェブ上で最も広く分布する',
  },
  {
    name: 'Meta (Facebook)',
    category: 'SNS・広告',
    domains: ['facebook.com', 'facebook.net', 'fbcdn.net', 'instagram.com'],
    firstParty: [/^_fbp$/, /^_fbc$/],
    idNames: [/^fr$/, /^datr$/, /^_fbp$/],
    note: 'サイト埋め込みの「いいね」やピクセルから閲覧を収集',
  },
  {
    name: 'Adobe',
    category: 'アクセス解析',
    domains: ['demdex.net', 'omtrdc.net', 'everesttech.net', '2o7.net'],
    firstParty: [/^AMCVS?_/, /^s_cc$/, /^s_vi$/, /^s_sq$/, /^s_fid$/, /^mbox$/],
    idNames: [/^demdex$/, /^dpm$/],
    note: '企業サイトのアクセス解析。訪問先サイト自身のCookieとして入る',
  },
  {
    name: 'Amazon',
    category: '広告',
    domains: ['amazon-adsystem.com', 'assoc-amazon.com', 'media-amazon.com'],
    idNames: [/^ad-id$/, /^ad-privacy$/],
    note: '商品閲覧・購買に基づく広告',
  },
  {
    name: 'Microsoft',
    category: '広告',
    domains: ['bing.com', 'adnxs.com', 'msn.com', 'clarity.ms', 'bat.bing.com'],
    firstParty: [/^_uetsid$/, /^_uetvid$/, /^_clck$/, /^_clsk$/],
    idNames: [/^MUID$/, /^uuid2$/, /^XANDR_PANID$/, /^anj$/],
    note: 'Bing広告とXandr(旧AppNexus)の広告取引',
  },
  { name: 'The Trade Desk', category: '広告', domains: ['adsrvr.org'], idNames: [/^TDID$/], note: '広告の入札に使う共通ID' },
  { name: 'Criteo', category: 'リターゲティング広告', domains: ['criteo.com', 'criteo.net'], idNames: [/^uid$/, /^cto_bundle$/], note: '一度見た商品を他サイトで追いかける広告' },
  { name: 'Magnite (Rubicon)', category: '広告', domains: ['rubiconproject.com', 'casalemedia.com', 'contextweb.com'], note: '広告枠のリアルタイム取引' },
  { name: 'PubMatic', category: '広告', domains: ['pubmatic.com'], note: '広告枠のリアルタイム取引' },
  { name: 'LiveRamp', category: 'データ販売', domains: ['rlcdn.com', 'pippio.com', 'liveramp.com'], note: '複数事業者のデータを突き合わせて個人を名寄せする' },
  { name: 'Comscore', category: '視聴率調査', domains: ['scorecardresearch.com'], firstParty: [/^_scor_uid$/], note: '閲覧の統計調査' },
  { name: 'Nielsen', category: '視聴率調査', domains: ['imrworldwide.com', 'nielsen.com'], firstParty: [/^s_nr/, /^s_catvwd/], note: '閲覧の統計調査' },
  { name: 'Quantcast', category: '広告', domains: ['quantserve.com', 'quantcast.com'], note: '閲覧者の属性推定' },
  { name: 'ID5', category: '共通ID', domains: ['id5-sync.com'], note: 'Cookieに依存しない共通IDの発行' },
  { name: 'Index Exchange', category: '広告', domains: ['casalemedia.com'], note: '広告枠のリアルタイム取引' },
  { name: 'OpenX', category: '広告', domains: ['openx.net'], note: '広告枠のリアルタイム取引' },
  { name: 'Xandr', category: '広告', domains: ['adnxs.com'], note: '広告枠のリアルタイム取引' },
  { name: 'Media.net', category: '広告', domains: ['media.net'], note: '広告枠のリアルタイム取引' },
  { name: 'Smaato', category: '広告', domains: ['smaato.net'], note: 'モバイル広告' },
  { name: 'InMobi', category: '広告', domains: ['inmobi.com'], note: 'モバイル広告' },
  { name: 'Taboola', category: 'コンテンツ推薦', domains: ['taboola.com'], note: '記事下のおすすめ枠' },
  { name: 'Outbrain', category: 'コンテンツ推薦', domains: ['outbrain.com'], note: '記事下のおすすめ枠' },
  { name: 'X (Twitter)', category: 'SNS・広告', domains: ['twitter.com', 'x.com', 't.co', 'ads-twitter.com'], idNames: [/^personalization_id$/, /^guest_id_ads$/, /^guest_id_marketing$/], note: '埋め込みポストや広告タグから閲覧を収集' },
  { name: 'LinkedIn', category: 'SNS・広告', domains: ['linkedin.com', 'licdn.com'], idNames: [/^bcookie$/, /^lidc$/], note: '埋め込みタグから閲覧を収集' },
  { name: 'TikTok', category: 'SNS・広告', domains: ['tiktok.com', 'tiktokcdn.com'], firstParty: [/^_ttp$/], note: '広告ピクセルから閲覧を収集' },
  { name: 'Yahoo (広告)', category: '広告', domains: ['yahoo.com', 'yahooapis.jp', 'yimg.jp'], idNames: [/^A3$/, /^IDSYNC$/], note: '広告配信の識別' },
  { name: 'Tapad', category: 'デバイス横断追跡', domains: ['tapad.com'], note: 'PC・スマホなど複数端末を同一人物として結び付ける' },
  { name: 'Lotame', category: 'データ販売', domains: ['crwdcntrl.net'], note: '属性データの収集・販売' },
  { name: 'Nielsen Exelate', category: 'データ販売', domains: ['exelator.com'], note: '属性データの収集・販売' },
  { name: 'Adform', category: '広告', domains: ['adform.net'], note: '広告配信' },
  { name: 'Smart AdServer', category: '広告', domains: ['smartadserver.com', 'sascdn.com'], note: '広告配信' },
  { name: 'Sizmek', category: '広告', domains: ['serving-sys.com'], note: '広告配信' },
  { name: 'BidSwitch', category: '広告', domains: ['bidswitch.net'], note: '広告枠のリアルタイム取引' },
  { name: 'Beeswax', category: '広告', domains: ['bidr.io'], note: '広告枠のリアルタイム取引' },
  { name: 'StackAdapt', category: '広告', domains: ['stackadapt.com'], note: '広告配信' },
  { name: 'RTB House', category: 'リターゲティング広告', domains: ['creativecdn.com'], note: '一度見た商品を他サイトで追いかける広告' },
  { name: 'Appier', category: '広告', domains: ['appier.net'], note: '広告配信' },
  { name: 'AudienceMax', category: '広告', domains: ['a-mo.net', 'a-mx.com', 'rtb.mx', 'amx1.net'], note: '広告枠のリアルタイム取引' },
  { name: 'Rocket Fuel', category: '広告', domains: ['rfihub.com'], note: '広告配信' },
  { name: 'AdKernel', category: '広告', domains: ['adkernel.com'], note: '広告枠のリアルタイム取引' },
  { name: 'StartApp', category: '広告', domains: ['startappnetwork.com'], note: 'モバイル広告' },
  { name: 'Improve Digital', category: '広告', domains: ['360yield.com'], note: '広告枠のリアルタイム取引' },
  { name: 'DeepIntent', category: '広告', domains: ['deepintent.com'], note: '広告配信' },
  { name: 'Sportradar', category: '広告', domains: ['sportradarserving.com'], note: '広告配信' },
  { name: 'Supership', category: '広告', domains: ['socdm.com'], note: '国内向け広告配信' },
  { name: 'ログリー', category: '広告', domains: ['ladsp.com'], note: '国内向け広告配信' },
  { name: 'MicroAd', category: '広告', domains: ['microad.jp', 'microad.net'], note: '国内向け広告配信' },
  { name: 'Geniee', category: '広告', domains: ['gsspat.jp', 'genieesspv.jp'], note: '国内向け広告配信' },
  { name: 'Adot', category: '広告', domains: ['adotmob.com'], note: '広告配信' },
  { name: 'MGID', category: 'コンテンツ推薦', domains: ['mgid.com'], note: '記事下のおすすめ枠' },
  { name: 'SiteScout', category: '広告', domains: ['sitescout.com'], note: '広告配信' },
  { name: 'DataXu', category: '広告', domains: ['w55c.net'], note: '広告配信' },
  { name: 'ConnectAd', category: '広告', domains: ['connectad.io'], note: '広告配信' },
  { name: 'Zeta', category: 'データ販売', domains: ['rezync.com', 'udmserve.net'], note: '属性データの収集・販売' },
  { name: 'Bombora', category: 'データ販売', domains: ['ml314.com', 'company-target.com'], note: '企業・職種の推定データ' },
  { name: 'Chartbeat', category: 'アクセス解析', domains: ['chartbeat.com', 'chartbeat.net'], firstParty: [/^_cb$/, /^_chartbeat/, /^_cb_svref$/], note: '記事の読了状況の解析' },
  { name: 'Optimizely', category: 'A/Bテスト', domains: ['optimizely.com'], firstParty: [/^optimizely/i], note: '表示内容の出し分け試験' },
  { name: 'Hotjar', category: '行動記録', domains: ['hotjar.com'], firstParty: [/^_hj/], note: 'マウス操作やスクロールの記録' },
  { name: 'Yandex', category: 'アクセス解析', domains: ['yandex.ru', 'yandex.com', 'mc.yandex.ru'], firstParty: [/^_ym_/], note: 'アクセス解析・行動記録' },
  { name: 'Segment', category: 'データ統合', domains: ['segment.com', 'segment.io'], firstParty: [/^ajs_/], note: '各種サービスへ閲覧データを配る中継' },
  { name: 'Braze', category: 'マーケティング', domains: ['braze.com', 'appboy.com'], note: '通知・メール配信の最適化' },
  { name: 'Snap', category: 'SNS・広告', domains: ['snapchat.com', 'sc-static.net'], firstParty: [/^_scid$/], note: '広告ピクセルから閲覧を収集' },
  { name: 'Pinterest', category: 'SNS・広告', domains: ['pinterest.com', 'pinimg.com'], firstParty: [/^_pin_unauth$/, /^_pinterest_/], note: '広告タグから閲覧を収集' },
  { name: 'TripleLift', category: '広告', domains: ['3lift.com'], note: '広告枠のリアルタイム取引' },
  { name: 'Sharethrough', category: '広告', domains: ['sharethrough.com'], note: '記事に溶け込む形の広告' },
  { name: 'Teads', category: '広告', domains: ['teads.tv'], note: '動画広告の配信' },
  { name: 'GumGum', category: '広告', domains: ['gumgum.com'], note: '記事内容を解析して出す広告' },
  { name: 'Sovrn', category: '広告', domains: ['lijit.com', 'sovrn.com'], note: '広告枠のリアルタイム取引' },
  { name: 'MediaMath', category: '広告', domains: ['mathtag.com'], note: '広告配信' },
  { name: 'Amobee', category: '広告', domains: ['turn.com', 'amobee.com'], note: '広告配信' },
  { name: 'Intent IQ', category: '共通ID', domains: ['intentiq.com'], note: 'Cookieに依存しない共通IDの発行' },
  { name: 'Semasio', category: 'データ販売', domains: ['semasio.net'], note: '閲覧内容から属性を推定' },
  { name: 'Simpli.fi', category: '広告', domains: ['simpli.fi'], note: '位置情報も使う広告配信' },
  { name: 'Blis', category: '位置情報', domains: ['blismedia.com'], note: '位置情報に基づく広告' },
  { name: 'LoopMe', category: '広告', domains: ['loopme.me'], note: 'モバイル動画広告' },
  { name: 'Nexxen', category: '広告', domains: ['tremorhub.com', 'unrulymedia.com'], note: '動画広告の配信' },
  { name: 'Piano', category: 'アクセス解析', domains: ['piano.io', 'cxense.com'], note: '読者の属性推定と課金誘導' },
  { name: 'Wunderkind', category: 'マーケティング', domains: ['bounceexchange.com'], note: '離脱しそうな読者への出し分け' },
  { name: 'OneTag', category: '広告', domains: ['onetag-sys.com'], note: '広告枠のリアルタイム取引' },
  { name: 'Rich Audience', category: '広告', domains: ['richaudience.com'], note: '広告配信' },
  { name: 'Connatix', category: '広告', domains: ['connatix.com'], note: '動画広告の配信' },
  { name: 'Primis', category: '広告', domains: ['primis.tech'], note: '動画広告の配信' },
  { name: 'Adelphic', category: '広告', domains: ['ipredictive.com'], note: '広告配信' },
  { name: 'Rokt', category: '広告', domains: ['rokt.com', 'rokt-api.com'], note: '購入後に出すおすすめ広告' },
  { name: 'Nativo', category: '広告', domains: ['postrelease.com'], note: '記事に溶け込む形の広告' },
  { name: 'DAX (Global)', category: '広告', domains: ['thisisdax.com'], note: '音声・動画広告の配信' },
  { name: 'Kargo', category: '広告', domains: ['kargo.com'], note: 'モバイル広告' },
  { name: 'Yieldlab', category: '広告', domains: ['adscale.de', 'yieldlab.net'], note: '広告枠のリアルタイム取引' },
  { name: 'Intimate Merger', category: 'データ販売', domains: ['im-apps.net'], note: '国内向けの属性データ販売' },
  { name: 'SmartNews', category: '広告', domains: ['smartnews-ads.com'], note: '国内向け広告配信' },
  { name: 'LINE', category: 'SNS・広告', domains: ['line.me', 'line-scdn.net'], note: '広告タグから閲覧を収集' },
  { name: 'fluct', category: '広告', domains: ['adingo.jp'], note: '国内向け広告配信' },
  { name: 'CyberAgent', category: '広告', domains: ['adtdp.com', 'ad-m.asia'], note: '国内向け広告配信' },
  { name: 'UNICORN', category: '広告', domains: ['uncn.jp'], note: '国内向け広告配信' },
  { name: 'AdMatrix', category: '広告', domains: ['admatrix.jp'], note: '国内向け広告配信' },
  { name: 'PORTO (impact-ad)', category: '広告', domains: ['impact-ad.jp'], note: '国内向け広告配信' },
  { name: 'NTTドコモ', category: '広告', domains: ['docomo.ne.jp'], note: '会員データに基づく広告' },
  { name: 'Aralego', category: 'データ販売', domains: ['aralego.com'], note: '属性データの収集・販売' },
];

// 「同意」「地域」など識別子ではないCookieを除くための名前パターン
const NON_ID_NAMES = [/consent/i, /gdpr/i, /privacy/i, /^usprivacy$/i, /country/i, /^lang/i, /locale/i, /timezone/i, /^tz$/i, /theme/i, /^__cf_bm$/, /^receive-cookie-deprecation$/];

// 履歴のドメインから興味カテゴリを推定するためのローカル辞書(AIは使わない)。
// 「トラッカーが推定しうる興味」をローカルの履歴だけから出すために使う
const INTEREST_RULES = [
  { label: 'ニュース・時事', match: /news|asahi|yomiuri|mainichi|nikkei|nhk|bbc|cnn|reuters|nytimes|guardian|jiji|kyodo|itmedia/ },
  { label: 'ショッピング', match: /amazon|rakuten|shopping|mercari|yahoo\.co\.jp|zozo|askul|monotaro|aliexpress|ebay|shein|uniqlo/ },
  { label: 'テクノロジー・開発', match: /github|stackoverflow|qiita|zenn|npmjs|developer|docs|gitlab|hatena|arxiv|dev\.to|mdn/ },
  { label: '金融・投資', match: /bank|mufg|smbc|mizuho|rakuten-sec|sbisec|monex|kabu|invest|coinbase|bitflyer|nikkei225|finance/ },
  { label: '動画・エンタメ', match: /youtube|netflix|nicovideo|abema|hulu|primevideo|disney|twitch|spotify|tver/ },
  { label: 'ゲーム', match: /steam|epicgames|nintendo|playstation|xbox|game|4gamer|famitsu/ },
  { label: 'SNS・コミュニティ', match: /twitter|x\.com|facebook|instagram|reddit|discord|threads|bluesky|mastodon|linkedin/ },
  { label: '旅行・交通', match: /jalan|rurubu|booking|expedia|airbnb|jorudan|navitime|ekitan|jal|ana|travel|trip/ },
  { label: '健康・医療', match: /hospital|clinic|health|medical|byoin|kusuri|epark|doctor|pharma/ },
  { label: '求人・キャリア', match: /recruit|indeed|doda|mynavi|rikunabi|wantedly|green-japan|bizreach|job/ },
  { label: '学習・教育', match: /udemy|coursera|study|school|univ|ac\.jp|edu|benesse|progate/ },
  { label: 'アダルト', match: /porn|xvideos|xhamster|dmm\.co\.jp|fanza/ },
];

/**
 * セッションのCookieを分析して、企業単位のプロファイリング状況を返す。
 * @param {Electron.Session} session 対象プロファイルのセッション
 * @param {object} options history: 履歴エントリの配列(興味推定に使う), adblockEnabled: 広告ブロックの状態
 */
async function analyze(session, { history = [], adblockEnabled = false } = {}) {
  let cookies = [];
  try {
    cookies = await session.cookies.get({});
  } catch {
    cookies = [];
  }

  const visitedSites = new Set();
  for (const entry of history) {
    const domain = tldts.getDomain(entry?.url || '');
    if (domain) visitedSites.add(domain);
  }

  const byCompany = new Map();
  let trackerCookies = 0;
  let crossSiteCookies = 0;
  let maxExpires = 0;

  for (const cookie of cookies) {
    const bare = String(cookie.domain || '').replace(/^\./, '');
    const domain = tldts.getDomain(bare) || bare;
    const match = matchCompany(domain, cookie.name);
    if (!match) continue;

    const { company, viaFirstParty } = match;
    trackerCookies += 1;
    // SameSite=None は他サイトへの埋め込みでも送られる = サイトをまたいだ追跡が可能
    const crossSite = cookie.sameSite === 'no_restriction';
    if (crossSite) crossSiteCookies += 1;
    if (cookie.expirationDate) maxExpires = Math.max(maxExpires, cookie.expirationDate);

    let entry = byCompany.get(company.name);
    if (!entry) {
      entry = {
        name: company.name,
        category: company.category,
        note: company.note,
        cookies: [],
        domains: new Set(),
        crossSite: 0,
        identifiers: 0,
        // 訪問済みサイトの一次Cookieとして入っていた場合、そのサイト名を出す
        // (「このサイトはこの会社に閲覧を渡している」と言えるのはこのケースだけ)
        onSites: new Set(),
        longestExpires: 0,
      };
      byCompany.set(company.name, entry);
    }
    entry.domains.add(domain);
    if (crossSite) entry.crossSite += 1;
    if (viaFirstParty && visitedSites.has(domain)) entry.onSites.add(domain);
    if (cookie.expirationDate) entry.longestExpires = Math.max(entry.longestExpires, cookie.expirationDate);

    const identifier = isIdentifier(cookie, company);
    if (identifier) entry.identifiers += 1;
    entry.cookies.push({
      name: cookie.name,
      domain: bare,
      identifier,
      crossSite,
      // 値そのものは出さない。識別子であることと、長さだけ分かれば足りる
      preview: maskValue(cookie.value),
      expires: cookie.expirationDate ? Math.round(cookie.expirationDate * 1000) : null,
      session: !cookie.expirationDate,
    });
  }

  const companies = [...byCompany.values()]
    .map((c) => ({
      ...c,
      domains: [...c.domains].sort(),
      onSites: [...c.onSites].sort(),
      cookies: c.cookies.sort((a, b) => Number(b.identifier) - Number(a.identifier) || a.name.localeCompare(b.name)),
      longestExpires: c.longestExpires ? Math.round(c.longestExpires * 1000) : null,
    }))
    .sort((a, b) => b.identifiers - a.identifiers || b.cookies.length - a.cookies.length || a.name.localeCompare(b.name));

  return {
    adblockEnabled,
    totalCookies: cookies.length,
    trackerCookies,
    crossSiteCookies,
    identifiedBy: companies.filter((c) => c.identifiers > 0).length,
    longestExpires: maxExpires ? Math.round(maxExpires * 1000) : null,
    companies,
    interests: inferInterests(visitedSites),
    visitedSites: visitedSites.size,
  };
}

// ドメイン一致(その企業のドメインのCookie)か、名前一致(訪問先サイトに置かれた解析Cookie)で判定する
function matchCompany(domain, name) {
  for (const company of COMPANIES) {
    if (company.domains.includes(domain)) return { company, viaFirstParty: false };
    if (company.idDomains?.includes(domain) && company.idNames?.some((re) => re.test(name))) {
      return { company, viaFirstParty: false };
    }
  }
  for (const company of COMPANIES) {
    if (company.firstParty?.some((re) => re.test(name))) return { company, viaFirstParty: true };
  }
  return null;
}

// 個人を識別しうる値かどうか。同意状態や地域設定などは除く
function isIdentifier(cookie, company) {
  const name = String(cookie.name || '');
  if (NON_ID_NAMES.some((re) => re.test(name))) return false;
  if (company.idNames?.some((re) => re.test(name))) return true;
  const value = String(cookie.value || '');
  if (value.length < 10 || value.length > 400) return false;
  // 英数字が混ざり、文字の種類が多い = ランダムな識別子とみなす
  return new Set(value).size >= 8 && /\d/.test(value) && /[A-Za-z]/.test(value);
}

function maskValue(value) {
  const v = String(value || '');
  if (v.length <= 8) return '*'.repeat(v.length);
  return `${v.slice(0, 4)}…${v.slice(-2)} (${v.length}文字)`;
}

// 履歴のドメインからローカル辞書で興味カテゴリを推定する(外部送信もAIも使わない)
function inferInterests(visitedSites) {
  const counts = new Map();
  for (const site of visitedSites) {
    for (const rule of INTEREST_RULES) {
      if (rule.match.test(site)) counts.set(rule.label, (counts.get(rule.label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, sites]) => ({ label, sites }));
}

// 指定企業のCookieをすべて削除する
async function forgetCompany(session, companyName) {
  const company = COMPANIES.find((c) => c.name === companyName);
  if (!company) return 0;
  return removeMatching(session, (cookie, domain) => {
    if (company.domains.includes(domain)) return true;
    if (company.idDomains?.includes(domain) && company.idNames?.some((re) => re.test(cookie.name))) return true;
    return company.firstParty?.some((re) => re.test(cookie.name)) === true;
  });
}

// 既知トラッカーのCookieをすべて削除する
async function forgetAll(session) {
  return removeMatching(session, (cookie, domain) => !!matchCompany(domain, cookie.name));
}

async function removeMatching(session, predicate) {
  let cookies = [];
  try {
    cookies = await session.cookies.get({});
  } catch {
    return 0;
  }
  let removed = 0;
  for (const cookie of cookies) {
    const bare = String(cookie.domain || '').replace(/^\./, '');
    const domain = tldts.getDomain(bare) || bare;
    if (!predicate(cookie, domain)) continue;
    // Cookieの削除はURL指定。domainが先頭ドットなら全サブドメインに効く形で組み立てる
    const url = `${cookie.secure ? 'https' : 'http'}://${bare}${cookie.path || '/'}`;
    try {
      await session.cookies.remove(url, cookie.name);
      removed += 1;
    } catch {
      // 消せないものは飛ばす(URLが再構成できないCookieなど)
    }
  }
  return removed;
}

module.exports = { analyze, forgetCompany, forgetAll, COMPANIES };
