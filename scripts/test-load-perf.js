// ページ読み込み速度の内訳を測る(再利用可能)。実行: npx electron scripts/test-load-perf.js
//
// 「Edge/Chromeに比べて全体的に読み込みが遅い」という報告を切り分けるための計測。
// Roopieが素のChromiumに足しているもの(webRequestベースの広告ブロック / セッション全体への
// preload 4本 / nodeIntegrationInSubFrames)を1つずつ外した条件でロードし、
// Navigation Timing の内訳(DNS/接続/TTFB/本文/DOM構築)を比べる。
//
// 条件間の差だけが意味を持つ(絶対値は回線とサイト側の状態に左右されるため)。
// 各ロードの前にHTTPキャッシュとDNSキャッシュを消し、条件をラウンドロビンで回して
// 回線の揺れが特定条件に偏らないようにしている。
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-perf-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

// 軽いページ(サブリソースもiframeもほぼ無い) / 重いページ(広告・iframe多数) / YouTube。
// preloadやサブフレーム関連のコストは重いページでしか出ないため、両方測らないと切り分けられない。
// YouTubeは「特に遅い」という報告があるので個別に見る(UAスニッフィングとDRMの影響を受ける)
const PAGES = [
  { label: '軽量(example.com)', url: 'https://example.com/' },
  { label: '重量(yahoo.co.jp)', url: 'https://www.yahoo.co.jp/' },
  { label: 'YouTube(動画)', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
];
const ROUNDS = 2;
const TIMEOUT = 30000;

// Chrome本物のUA。Electronの既定UAは "roopie/0.1.0 ... Electron/43.2.0" を含み、
// Googleのように UA を見てコードを出し分けるサイトでレガシー側に振られる恐れがある
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIMING_SCRIPT = `(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  // transferSizeが0で中身がある = キャッシュから返った
  const cached = res.filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length;
  const video = document.querySelector('video');
  return JSON.stringify({
    dns: Math.round(n.domainLookupEnd - n.domainLookupStart),
    connect: Math.round(n.connectEnd - n.connectStart),
    ttfb: Math.round(n.responseStart - n.requestStart),
    body: Math.round(n.responseEnd - n.responseStart),
    dom: Math.round(n.domContentLoadedEventEnd - n.responseEnd),
    load: Math.round(n.loadEventEnd - n.startTime),
    iframes: document.querySelectorAll('iframe').length,
    requests: res.length,
    cached,
    // YouTube用: 動画が実際に再生できる状態まで来たか(readyState>=3 = 再生可能)
    videoReady: video ? video.readyState : null,
  });
})()`;

/**
 * 1回ロードして Navigation Timing を返す。
 * @param {object} opts cold: キャッシュを毎回捨てるか, userAgent: 上書きするUA
 */
async function measure(ses, webPreferences, url, { cold = true, userAgent = null } = {}) {
  if (cold) {
    await ses.clearCache();
    await ses.clearHostResolverCache();
  }
  const win = new BrowserWindow({ width: 1280, height: 800, show: false });
  const view = new WebContentsView({ webPreferences: { ...webPreferences, session: ses } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  const wc = view.webContents;
  wc.setAudioMuted(true); // YouTube等を何度も読むので音は出さない
  if (userAgent) wc.setUserAgent(userAgent);
  try {
    const started = Date.now();
    wc.loadURL(url);
    await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(TIMEOUT)]);
    // load後にも走る遅延リソース(広告など)を拾うため少し待つ
    await sleep(2000);
    const wall = Date.now() - started;
    const raw = await wc.executeJavaScript(TIMING_SCRIPT, true).catch(() => null);
    return raw ? { ...JSON.parse(raw), wall } : null;
  } finally {
    win.destroy();
  }
}

/** 中央値(2回なら小さい方寄り)。回線の揺れによる外れ値に引きずられないようにする */
function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(samples) {
  const keys = ['dns', 'connect', 'ttfb', 'body', 'dom', 'load', 'wall', 'iframes', 'requests', 'cached', 'videoReady'];
  const out = {};
  for (const key of keys) out[key] = median(samples.map((s) => s?.[key]));
  return out;
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    await browser.adblock.ready;

    // Roopieの実際のセッション(preload登録・adblock・ジェスチャー・権限ポリシーが適用済み)を得る。
    // これらはウィンドウ生成時に張られるため、一度createWindowを通す必要がある
    const ctx = browser.createWindow();
    for (let i = 0; i < 30 && ctx.tabManager.activeTabId === null; i++) await sleep(200);
    const roopieSession = ctx.tabManager.session;
    const plainSession = session.fromPartition('perf-plain');

    const preloads = roopieSession.getPreloadScripts?.() || [];
    console.log(`セッションに登録されたpreload: ${preloads.length}本`);
    for (const p of preloads) console.log(`  - ${path.basename(p.filePath)} (${p.type})`);
    console.log(`実際に送るUA: ${roopieSession.getUserAgent()}`);

    const ROOPIE_PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true };
    const PLAIN_PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true };

    // 条件を1つずつ外して寄与を切り出す。setup/teardown はセッションの状態を戻す
    const CONDITIONS = [
      { label: 'A 素のChromium(preload無/adblock無/サブフレームNode無)', session: () => plainSession, prefs: PLAIN_PREFS },
      { label: 'B Roopie相当(全部入り・キャッシュ空)', session: () => roopieSession, prefs: ROOPIE_PREFS },
      {
        label: 'C Bから広告ブロックだけ外す',
        session: () => roopieSession,
        prefs: ROOPIE_PREFS,
        setup: () => browser.adblock.apply(roopieSession, false),
        teardown: () => browser.adblock.apply(roopieSession, true),
      },
      { label: 'D BからサブフレームNode(=全フレームpreload)だけ外す', session: () => roopieSession, prefs: PLAIN_PREFS },
      { label: 'E BのUAをChrome本物に差し替え', session: () => roopieSession, prefs: ROOPIE_PREFS, userAgent: CHROME_UA },
      // Edge/Chromeは日常使用でキャッシュもDNSも温まっている。同じ条件に寄せた比較
      { label: 'F Bのキャッシュを消さない(2回目以降の読み込み)', session: () => roopieSession, prefs: ROOPIE_PREFS, cold: false },
    ];

    const results = new Map(); // `${条件}|${ページ}` -> サンプル配列
    for (let round = 0; round < ROUNDS; round++) {
      for (const page of PAGES) {
        for (const cond of CONDITIONS) {
          if (cond.setup) await cond.setup();
          // ウォーム条件は先に1回読んでキャッシュを作ってから本番を測る
          if (cond.cold === false) await measure(cond.session(), cond.prefs, page.url, { cold: true });
          const sample = await measure(cond.session(), cond.prefs, page.url, {
            cold: cond.cold !== false,
            userAgent: cond.userAgent,
          });
          if (cond.teardown) await cond.teardown();
          const key = `${cond.label}|${page.label}`;
          if (!results.has(key)) results.set(key, []);
          results.get(key).push(sample);
          process.stdout.write('.');
        }
      }
    }
    console.log('');

    for (const page of PAGES) {
      console.log(`\n===== ${page.label} =====`);
      console.log('条件'.padEnd(54), 'DNS  接続  TTFB  本文   DOM  load  実測 iframe   req  cache 動画');
      for (const cond of CONDITIONS) {
        const s = summarize(results.get(`${cond.label}|${page.label}`) || []);
        const col = (v, w) => String(v ?? '-').padStart(w);
        console.log(
          cond.label.padEnd(54),
          col(s.dns, 3), col(s.connect, 5), col(s.ttfb, 5), col(s.body, 5),
          col(s.dom, 5), col(s.load, 5), col(s.wall, 5), col(s.iframes, 6), col(s.requests, 5),
          col(s.cached, 6), col(s.videoReady, 3)
        );
      }
    }

    // 履歴の保存コスト。History.add はページ遷移のたびに Store.save() を呼び、
    // 300ms後に JSON全体を writeFileSync する(=その間メインプロセスが止まる)。
    // webRequestベースの広告ブロックは全リクエストがメインプロセスを通るため、
    // ここで止まる時間はそのままネットワーク待ちに乗る
    const realHistory = path.join(app.getPath('appData'), 'Roopie', 'shared', 'history.json');
    if (fs.existsSync(realHistory)) {
      const data = JSON.parse(fs.readFileSync(realHistory, 'utf8'));
      const target = path.join(tmp, 'history-bench.json');
      const t0 = process.hrtime.bigint();
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
      const t1 = process.hrtime.bigint();
      const bytes = fs.statSync(target).size;
      console.log(`\n実データの履歴保存(${data.length}件 / ${(bytes / 1024 / 1024).toFixed(2)}MB): ` +
        `${(Number(t1 - t0) / 1e6).toFixed(1)}ms メインプロセスが停止`);
    }

    app.exit(0);
  } catch (err) {
    console.error('計測が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
