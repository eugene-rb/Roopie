// Cookieストアの実データを確認する検証スクリプト(再利用可)。
//   npx electron scripts/inspect-cookies.js
// 各プロファイルのセッションからCookieを読み、ファーストパーティ/サードパーティの内訳、
// 主要なトラッカードメイン、ID風の値の割合を表示する。UIを作らずに実データを確かめるため。
const path = require('path');
const fs = require('fs');
// --probe を付けると、使い捨てセッション(広告ブロック無し)で主要サイトを実際に開き、
// 現実のトラッカーCookieを採取する。トラッカー判定リストを実データで調整するため。
const { app, session, BrowserWindow } = require('electron');
const tldts = require('tldts');

const PROBE_SITES = [
  'https://www.nytimes.com/',
  'https://www.cnn.com/',
  'https://www.yahoo.co.jp/',
  'https://www.rakuten.co.jp/',
  'https://www.amazon.co.jp/',
];

// npx electron scripts/... で起動するとアプリ名が既定(Electron)になり別のuserDataを見てしまうため、
// 本体と同じ名前(package.jsonのname)に合わせてから userData を解決する
app.setName(require('../package.json').name);
app.setPath('userData', path.join(app.getPath('appData'), app.getName()));

app.whenReady().then(async () => {
  if (process.argv.includes('--probe')) {
    await probe();
    return app.quit();
  }
  const root = app.getPath('userData');
  console.log('userData:', root);

  let profiles = [];
  try {
    profiles = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8')).profiles || [];
  } catch {
    console.log('profiles.json が読めません');
    return app.quit();
  }

  for (const p of profiles) {
    const ses = session.fromPartition(`persist:profile-${p.id}`);
    const cookies = await ses.cookies.get({});
    console.log(`\n=== プロファイル「${p.name}」 (${p.id}) : Cookie ${cookies.length}件 ===`);
    if (!cookies.length) continue;

    // 履歴から自分が実際に訪れたサイト(ファーストパーティ)の登録可能ドメインを集める
    const visited = new Set();
    for (const key of ['history']) {
      const file = p.shared?.[key]
        ? path.join(root, 'shared', `${key}.json`)
        : path.join(root, 'profiles', p.id, `${key}.json`);
      try {
        for (const e of JSON.parse(fs.readFileSync(file, 'utf8'))) {
          const d = tldts.getDomain(e.url || '');
          if (d) visited.add(d);
        }
      } catch {}
    }
    console.log(`履歴の訪問ドメイン数: ${visited.size}`);

    const byDomain = new Map();
    for (const c of cookies) {
      const d = tldts.getDomain(c.domain.replace(/^\./, '')) || c.domain;
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(c);
    }

    console.log('--- 全ドメイン ---');
    for (const [d, list] of byDomain) {
      console.log(`  ${visited.has(d) ? '[訪問]' : '[未訪問]'} ${d}: ${list.map((c) => c.name).join(', ')}`);
    }
    console.log('--- 履歴のドメイン ---', [...visited].join(', '));

    const third = [...byDomain.entries()].filter(([d]) => !visited.has(d));
    console.log(`ドメイン数: ${byDomain.size} / うち未訪問(=3rdパーティ候補): ${third.length}`);

    // ID風(長くてランダムな値)を持つ未訪問ドメインが「実際に追跡している」候補
    const idLike = third
      .map(([d, list]) => [d, list.filter((c) => isIdLike(c.value)).length, list.length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[2] - a[2]);
    console.log(`ID風の値を持つ未訪問ドメイン: ${idLike.length}`);
    for (const [d, n, total] of idLike.slice(0, 25)) console.log(`  ${d}  ID風${n}/${total}件`);

    // 実際のCookie名の例(命名パターンの確認用)
    console.log('--- 3rdパーティCookieの名前サンプル ---');
    for (const [d, list] of third.slice(0, 15)) {
      console.log(`  ${d}: ${list.map((c) => c.name).slice(0, 6).join(', ')}`);
    }

    // Partitioned(CHIPS)やSameSiteの状況も確認する
    const partitioned = cookies.filter((c) => c.partitionKey).length;
    const sameSiteNone = cookies.filter((c) => c.sameSite === 'no_restriction').length;
    console.log(`partitionKey付き: ${partitioned} / SameSite=None: ${sameSiteNone}`);
  }

  app.quit();
});

// 広告ブロック無しの使い捨てセッションで実サイトを開き、集まったCookieを一覧する
const visitedAll = new Set(PROBE_SITES.map((u) => tldts.getDomain(u)));

async function probe() {
  const ses = session.fromPartition(`probe-${Date.now()}`);
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses } });
  for (const url of PROBE_SITES) {
    try {
      await win.loadURL(url);
      await new Promise((r) => setTimeout(r, 6000)); // 遅延読み込みのタグが動くまで待つ
      console.log(`読込完了: ${url}`);
    } catch (err) {
      console.log(`読込失敗: ${url} (${err.message})`);
    }
  }
  // trackers.js の分析結果を実データで確認する
  const trackers = require('../src/main/trackers');
  const result = await trackers.analyze(ses, {
    history: PROBE_SITES.map((url) => ({ url })),
    adblockEnabled: false,
  });
  console.log('\n=== trackers.analyze() の結果 ===');
  console.log(
    `Cookie計${result.totalCookies} / トラッカー${result.trackerCookies} / 横断可能${result.crossSiteCookies} / 識別企業${result.identifiedBy}社`
  );
  console.log('推定興味:', result.interests.map((i) => `${i.label}(${i.sites})`).join(', ') || 'なし');
  for (const c of result.companies.slice(0, 20)) {
    console.log(`  ${c.name} [${c.category}] ID${c.identifiers}/${c.cookies.length}件 ${c.domains.join(',')}`);
  }
  const unknown = new Set();
  for (const c of await ses.cookies.get({})) {
    const bare = c.domain.replace(/^\./, '');
    const d = tldts.getDomain(bare) || bare;
    if (!visitedAll.has(d) && !result.companies.some((x) => x.domains.includes(d))) unknown.add(d);
  }
  console.log(`\n未分類の3rdパーティドメイン(${unknown.size}):`, [...unknown].join(', '));

  const cookies = await ses.cookies.get({});
  console.log(`\n=== probe: Cookie ${cookies.length}件 ===`);
  const visited = new Set(PROBE_SITES.map((u) => tldts.getDomain(u)));
  const byDomain = new Map();
  for (const c of cookies) {
    const d = tldts.getDomain(c.domain.replace(/^\./, '')) || c.domain;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(c);
  }
  const sorted = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [d, list] of sorted) {
    const none = list.filter((c) => c.sameSite === 'no_restriction').length;
    console.log(
      `  ${visited.has(d) ? '[訪問]' : '[3rd] '} ${d} (${list.length}件, SameSite=None ${none}): ${list
        .map((c) => c.name)
        .slice(0, 12)
        .join(', ')}`
    );
  }
  win.destroy();
}

// 長くてエントロピーの高い値=識別子とみなす簡易判定
function isIdLike(value) {
  const v = String(value || '');
  if (v.length < 12 || v.length > 400) return false;
  if (!/[A-Za-z0-9_\-.=%]/.test(v)) return false;
  const uniq = new Set(v).size;
  return uniq >= 8 && /\d/.test(v) && /[A-Za-z]/.test(v);
}
