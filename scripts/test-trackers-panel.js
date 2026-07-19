// サイドパネル「トラッキング」の検証(再利用可能)。
// 実行: npx electron scripts/test-trackers-panel.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、代表的なトラッカーCookieをセッションに仕込んでから
// レールのトラッキングアイコンをクリックし、パネルに描画された内容をDOMから読んで検証する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-tr-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const trackers = require('../src/main/trackers');

const shotDir = process.argv[2] || tmp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${detail}`}`);
  if (!ok) failed++;
}

// 実サイトから採取した形に合わせた代表的なCookie(scripts/inspect-cookies.js --probe の結果より)
const SEED_COOKIES = [
  { url: 'https://doubleclick.net/', name: 'IDE', value: 'AHWqTUlOr9dQ2xK7vB1nZs4', sameSite: 'no_restriction', secure: true },
  { url: 'https://google.com/', name: 'NID', value: '525=Xr7bQm2LpO9wYt3vNc8sKd', sameSite: 'no_restriction', secure: true },
  { url: 'https://criteo.com/', name: 'uid', value: 'Zk39sLpQm2Xr7bT1vNc8', sameSite: 'no_restriction', secure: true },
  { url: 'https://pubmatic.com/', name: 'KADUSERCOOKIE', value: 'B7C2A1F0-9D3E-4A55-8821', sameSite: 'no_restriction', secure: true },
  { url: 'https://rlcdn.com/', name: 'rlas3', value: 'q9Xm2Lp7Zk39sTvNc81bR', sameSite: 'no_restriction', secure: true },
  // 訪問済みサイトの一次Cookieとして入るアナリティクス(この経路も拾えるかの確認)
  { url: 'https://www.nhk.or.jp/', name: 'AMCV_02C51F6A550AFE4E0A4C98A7%40AdobeOrg', value: '1585540135|MCMID|847362519' },
  { url: 'https://www.cnn.com/', name: '_ga', value: 'GA1.2.1837462519.1718000000' },
  // 識別子ではないもの(除外されることの確認)
  { url: 'https://doubleclick.net/', name: 'ar_debug', value: '1', sameSite: 'no_restriction', secure: true },
  // トラッカーではないもの(拾われないことの確認)
  { url: 'https://example.com/', name: 'theme', value: 'dark' },
];

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    await run();
  } catch (err) {
    console.log('NG  例外:', err.stack || err.message);
    failed++;
  }
  console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
  app.exit(failed ? 1 : 0);
});

async function run() {
  registerIpc();
  browser.initData();

  // 興味推定に使う履歴を仕込む(ニュース・ショッピング・開発が出るはず)
  const bundle = browser.activeBundle();
  for (const url of [
    'https://www.nhk.or.jp/news/',
    'https://www.cnn.com/',
    'https://www.amazon.co.jp/',
    'https://www.rakuten.co.jp/',
    'https://github.com/',
    'https://stackoverflow.com/',
  ]) {
    bundle.history.add(url, url);
  }

  const ctx = browser.createWindow();
  await sleep(2500);

  for (const cookie of SEED_COOKIES) {
    try {
      await ctx.session.cookies.set({ ...cookie, expirationDate: Date.now() / 1000 + 400 * 86400 });
    } catch (err) {
      console.log(`   Cookie設定失敗: ${cookie.name} (${err.message})`);
    }
  }

  // --- メイン側の分析ロジック ---
  const data = await trackers.analyze(ctx.session, {
    history: bundle.history.list(),
    adblockEnabled: true,
  });
  const names = data.companies.map((c) => c.name);
  check('Googleを検出', names.includes('Google'), names.join(','));
  check('Criteoを検出', names.includes('Criteo'), names.join(','));
  check('PubMaticを検出', names.includes('PubMatic'), names.join(','));
  check('LiveRampを検出', names.includes('LiveRamp'), names.join(','));
  check('Adobeを一次Cookie名から検出', names.includes('Adobe'), names.join(','));
  check('トラッカー以外(theme)は数えない', data.trackerCookies === SEED_COOKIES.length - 1, `${data.trackerCookies}`);
  check('横断可能(SameSite=None)を数える', data.crossSiteCookies === 6, `${data.crossSiteCookies}`);
  check('識別企業が5社', data.identifiedBy === 5, `${data.identifiedBy}`);
  const dc = data.companies.find((c) => c.name === 'Google');
  check('ar_debugは識別子にしない', dc && !dc.cookies.find((c) => c.name === 'ar_debug').identifier, JSON.stringify(dc?.cookies));
  check('Cookieの値そのものは返さない', !JSON.stringify(data).includes('AHWqTUlOr9dQ2xK7vB1nZs4'));
  const interests = data.interests.map((i) => i.label);
  check('興味を履歴から推定', interests.includes('ニュース・時事') && interests.includes('ショッピング'), interests.join(','));

  // --- パネルUI ---
  ctx.sidePanel.openSection('trackers');
  await sleep(1200);
  const panelWc = ctx.sidePanel.panelView.webContents;

  const ui = await js(
    panelWc,
    `(() => {
      const body = document.getElementById('trackers-body');
      return {
        header: document.getElementById('panel-header-title').textContent,
        sectionActive: document.getElementById('section-trackers').classList.contains('active'),
        railActive: !!document.querySelector('.section-tab[data-section="trackers"].active'),
        headline: body.querySelector('.tr-headline')?.textContent || '',
        shield: body.querySelector('.tr-shield')?.textContent || '',
        stats: [...body.querySelectorAll('.tr-stat-value')].map((e) => e.textContent),
        companies: [...body.querySelectorAll('.tr-company-name')].map((e) => e.textContent),
        tags: [...body.querySelectorAll('.tr-tag')].map((e) => e.textContent),
        badges: body.querySelectorAll('.tr-badge').length,
        detailsHidden: [...body.querySelectorAll('.tr-detail')].every((e) => e.classList.contains('hidden')),
      };
    })()`
  );
  console.log('   UI:', JSON.stringify(ui, null, 1));

  check('ヘッダーが「トラッキング」', ui.header === 'トラッキング', ui.header);
  check('セクションが表示中', ui.sectionActive && ui.railActive);
  check('見出しに企業数', ui.headline.includes('5社'), ui.headline);
  check('広告ブロックONの表示', ui.shield.includes('広告ブロックが有効'), ui.shield);
  check('企業一覧を描画', ui.companies.length === data.companies.length, ui.companies.join(','));
  check('興味タグを描画', ui.tags.length > 0, ui.tags.join(','));
  check('詳細は既定で閉じている', ui.detailsHidden);

  // 企業行をクリックすると詳細(Cookie一覧)が開く
  await js(panelWc, `document.querySelector('.tr-company-head').click()`);
  await sleep(300);
  const opened = await js(
    panelWc,
    `(() => {
      const d = document.querySelector('.tr-detail');
      return { hidden: d.classList.contains('hidden'), cookies: d.querySelectorAll('.tr-cookie').length, badges: d.querySelectorAll('.tr-badge').length };
    })()`
  );
  check('クリックで詳細が開く', !opened.hidden && opened.cookies > 0, JSON.stringify(opened));
  check('識別子バッジが付く', opened.badges > 0, JSON.stringify(opened));

  // 検証の本体はDOM。パネルのViewはcapturePageが失敗することがあるので任意扱いにする
  try {
    const file = path.join(shotDir, 'trackers-panel.png');
    fs.writeFileSync(file, (await panelWc.capturePage()).toPNG());
    console.log(`   📸 ${file}`);
  } catch (err) {
    console.log(`   (スクショは取得できず: ${err.message})`);
  }

  // --- 削除 ---
  const removed = await trackers.forgetCompany(ctx.session, 'Criteo');
  const after = await trackers.analyze(ctx.session, { history: [], adblockEnabled: true });
  check('企業単位の削除', removed > 0 && !after.companies.some((c) => c.name === 'Criteo'), `removed=${removed}`);

  await trackers.forgetAll(ctx.session);
  const cleared = await trackers.analyze(ctx.session, { history: [], adblockEnabled: true });
  check('一括削除でトラッカーが0件', cleared.trackerCookies === 0, `${cleared.trackerCookies}`);
  const rest = await ctx.session.cookies.get({});
  check('トラッカー以外は残る', rest.some((c) => c.name === 'theme'), rest.map((c) => c.name).join(','));
}
