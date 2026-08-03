// タブグループの純粋な計算部分(TabManagerから切り出してテストしやすくしたもの)。
// グループそのものの持ち方(配列・タブへの割り当て)は tab-manager.js 側にある。

// グループの色。名前で持ちCSS側で実際の色にする(テーマを変えても破綻しないため)
const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

// 「co.jp」「com.au」のように、実質トップレベル扱いになる2階層目のラベル。
// 公開サフィックスリスト(PSL)を丸ごと持つのは重いので、日本語圏で当たる範囲に絞る
const SECOND_LEVEL = new Set([
  'co', 'ne', 'or', 'ac', 'go', 'ed', 'gr', 'lg', 'com', 'net', 'org', 'edu', 'gov', 'mil', 'int',
]);

// URL → まとめる単位のドメイン(docs.google.com と mail.google.com は同じ google.com)。
// 判定できないもの(内部ページ・file: など)は null
function registrableDomain(url) {
  let hostname;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    hostname = parsed.hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;
  // IPアドレスはそのまま1つの単位として扱う
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return hostname;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  // 「例: www.example.co.jp」= ccTLD(2文字)+ よくある2階層目 のときだけ3ラベル取る
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * ドメインごとの自動仕分けの計画を立てる。
 * @param {Array<{id:number,url:string}>} tabs 対象のタブ(順序はタブバーの並び)
 * @param {{minTabs?:number}} options minTabs=そのドメインが何タブ以上ならグループにするか
 * @returns {Array<{name:string, tabIds:number[]}>} 最初に現れた順のグループ計画
 */
function planDomainGroups(tabs, { minTabs = 2 } = {}) {
  const byDomain = new Map(); // ドメイン -> タブIDの配列(Mapは挿入順を保つ)
  for (const tab of tabs ?? []) {
    const domain = registrableDomain(tab.url);
    if (!domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(tab.id);
  }
  const plan = [];
  for (const [name, tabIds] of byDomain) {
    if (tabIds.length < minTabs) continue;
    plan.push({ name, tabIds });
  }
  return plan;
}

// 既存のグループと重ならない色を順番に選ぶ(全色使い切ったら先頭へ戻る)
function nextGroupColor(usedColors = []) {
  const free = GROUP_COLORS.find((c) => !usedColors.includes(c));
  return free ?? GROUP_COLORS[usedColors.length % GROUP_COLORS.length];
}

module.exports = { GROUP_COLORS, registrableDomain, planDomainGroups, nextGroupColor };
