// Tor本体(tor.exe)を取得して vendor/tor へ配置する。
// 実行:
//   node scripts/fetch-tor.js            固定バージョン(再現可能。ローカル開発向け)
//   node scripts/fetch-tor.js --latest   公式アーカイブの最新安定版(CIはこちら)
//
// Tor Project公式の "Tor Expert Bundle"(Windows x86_64)をダウンロードし、SHA256を照合してから
// 必要なファイルだけ取り出す。electron-builderの extraResources でパッケージに同梱され、
// 実行時は process.resourcesPath/tor/tor.exe として使われる。
//
// リリースのたびにCIが --latest で取り直すので、**Roopieを更新すると同梱のTorも新しくなる**。
// 最新版の解決やダウンロードに失敗したときは、下の固定バージョンに落ちる(リリースは止めない)。
//
// vendor/ はgit管理外。CI(.github/workflows/release.yml)とローカルの `npm run dist` の
// 両方で、ビルド前にこのスクリプトを走らせること。同じバージョンが既にあれば何もしない。
//
// 固定バージョンを上げるときは PINNED の version と sha256 の両方を更新する。sha256は
//   https://archive.torproject.org/tor-package-archive/torbrowser/<version>/sha256sums-signed-build.txt
// から取得する。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// 取得に失敗したときのよりどころ。Tor Browserのリリース番号(同梱されるtor本体は 0.4.9.11)
const PINNED = {
  version: '15.0.18',
  sha256: '6ac067402c7b4a3dc37887ed3754b3914b67fdc220c966190683e9ccf91abf0f',
};

const BASE = 'https://archive.torproject.org/tor-package-archive/torbrowser';
const archiveName = (version) => `tor-expert-bundle-windows-x86_64-${version}.tar.gz`;

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'tor');
const CACHE = path.join(ROOT, 'vendor', '.cache');
const MARKER = path.join(VENDOR, 'VERSION');

// 展開後の何を同梱するか。
// pluggable_transports(obfs4等、約31MB)と geoip(約25MB)と tor-gencert.exe は使わないので入れない
// (Roopieはブリッジ接続も国指定のノード選択も提供していない。geoipが無くても通常の接続には影響しない)
const KEEP = [
  { from: path.join('tor', 'tor.exe'), to: 'tor.exe' },
  { from: 'docs', to: 'docs' }, // tor/openssl/libevent等のライセンス
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// x.y.z 形式の安定版だけを見て、いちばん新しいものを返す(16.0a1 のようなalpha/betaは除く)
async function resolveLatestVersion() {
  const res = await fetch(`${BASE}/`);
  if (!res.ok) throw new Error(`一覧を取得できません (${res.status})`);
  const html = await res.text();
  const versions = [...html.matchAll(/href="(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]);
  if (!versions.length) throw new Error('安定版のバージョンが見つかりません');
  const key = (v) => v.split('.').map(Number);
  versions.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return versions[versions.length - 1];
}

// 公開されているSHA256一覧から、その版のExpert Bundleのハッシュを取り出す
async function fetchSha256(version) {
  const res = await fetch(`${BASE}/${version}/sha256sums-signed-build.txt`);
  if (!res.ok) throw new Error(`SHA256一覧を取得できません (${res.status})`);
  const line = (await res.text())
    .split('\n')
    .find((l) => l.includes(archiveName(version)));
  const hash = line?.trim().split(/\s+/)[0];
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('SHA256を読み取れません');
  return hash;
}

async function download(url, dest) {
  console.log(`ダウンロード: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロードに失敗しました (${res.status} ${res.statusText})`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function pickTarget() {
  // --ensure: 何かしら置いてあればそれを使う(ビルド直前の保険。CIが入れた最新版を巻き戻さない)
  if (process.argv.includes('--ensure') && fs.existsSync(path.join(VENDOR, 'tor.exe'))) {
    const marker = fs.existsSync(MARKER) ? fs.readFileSync(MARKER, 'utf8').split('\n')[0].trim() : '不明';
    console.log(`Tor ${marker} が既にあります(--ensure)`);
    return null;
  }
  if (!process.argv.includes('--latest')) return PINNED;
  try {
    const version = await resolveLatestVersion();
    const hash = await fetchSha256(version);
    console.log(`最新の安定版: ${version}`);
    return { version, sha256: hash };
  } catch (err) {
    // ここで止めるとTor Projectのサーバー都合でRoopieのリリース全体が止まるため、固定版に落ちる
    console.warn(`⚠ 最新版を解決できませんでした(${err.message})。固定版 ${PINNED.version} を使います`);
    return PINNED;
  }
}

(async () => {
  const target = await pickTarget();
  if (!target) return;

  // 既に同じバージョンが置いてあれば何もしない(ローカルで毎回20MB落とさないため)
  if (fs.existsSync(MARKER) && fs.readFileSync(MARKER, 'utf8').split('\n')[0].trim() === target.version) {
    console.log(`Tor ${target.version} は既に vendor/tor にあります`);
    return;
  }

  const archive = path.join(CACHE, archiveName(target.version));
  if (!fs.existsSync(archive) || sha256(archive) !== target.sha256) {
    await download(`${BASE}/${target.version}/${archiveName(target.version)}`, archive);
  }

  const actual = sha256(archive);
  if (actual !== target.sha256) {
    throw new Error(`SHA256が一致しません。\n  期待: ${target.sha256}\n  実際: ${actual}`);
  }
  console.log('SHA256を照合しました');

  // 展開(Windows 10以降とGitHub Actionsのwindows-latestには tar が入っている)。
  // Git付属のGNU tarはPATHの先頭に来ることがあり、`D:\...` を「リモートホストD」と解釈して失敗する。
  // そのため作業ディレクトリをリポジトリ直下にして、ドライブレターを含まない相対パスだけを渡す
  const work = path.join(CACHE, 'extract');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  execFileSync('tar', ['-xzf', rel(archive), '-C', rel(work)], { cwd: ROOT, stdio: 'inherit' });

  fs.rmSync(VENDOR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const item of KEEP) {
    const src = path.join(work, item.from);
    if (!fs.existsSync(src)) throw new Error(`展開結果に ${item.from} がありません`);
    fs.cpSync(src, path.join(VENDOR, item.to), { recursive: true });
  }
  fs.rmSync(work, { recursive: true, force: true });

  // 単体で起動できるか(DLL不足などをここで検出する)
  const out = execFileSync(path.join(VENDOR, 'tor.exe'), ['--version'], { encoding: 'utf8' });
  const banner = out.split('\n')[0].trim();
  console.log(banner);

  // 1行目=Tor Browserのリリース番号、2行目=tor本体のバージョン(設定画面の表示に使う)
  const torVersion = banner.match(/Tor version ([^ ]+)/)?.[1] ?? '';
  fs.writeFileSync(MARKER, `${target.version}\n${torVersion}\n`);

  const size = fs.statSync(path.join(VENDOR, 'tor.exe')).size;
  console.log(`配置完了: ${VENDOR} (tor.exe ${(size / 1024 / 1024).toFixed(1)}MB)`);
})().catch((err) => {
  console.error('NG Torの取得に失敗:', err.message);
  process.exit(1);
});
