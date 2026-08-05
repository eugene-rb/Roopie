// README / ドキュメント用のスクリーンショットを生成する(再利用可能)。
// 実行: npx electron scripts/gen-screenshots.js [出力dir]   既定の出力先: docs/img
//
// 一時userDataで本物の browser.js を動かすので、実際のプロファイルは汚れない。
// タブはWebContentsView(別レイヤー)なので webContents.capturePage() ではクロームUIしか写らない。
// ウィンドウ全体を1枚に収めるため desktopCapturer(DWMのウィンドウキャプチャ)で撮る。
const { app, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-shots-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const OUT_DIR = process.argv[2] || path.join(__dirname, '..', 'docs', 'img');
const SIZE = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// スクショに写すサイト(ログイン不要・見た目が安定しているものだけ)
const SITES = [
  'https://ja.wikipedia.org/wiki/Chromium',
  'https://github.com/',
  'https://developer.mozilla.org/ja/',
];

// ウィンドウを1枚のPNGにする。desktopCapturer が空を返したときは
// クロームUIだけの capturePage に落として、少なくとも壊れた画像を残さない
async function shot(ctx, name) {
  const win = ctx.window;
  win.show();
  win.focus();
  await sleep(900);
  const bounds = win.getBounds();
  const sf = screen.getDisplayMatching(bounds).scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: Math.round(bounds.width * sf), height: Math.round(bounds.height * sf) },
  });
  const src = sources.find((s) => s.id === win.getMediaSourceId());
  let png;
  if (src && !src.thumbnail.isEmpty()) {
    png = src.thumbnail.toPNG();
  } else {
    console.log(`!! ${name}: desktopCapturerが空 → クロームUIのみで代替`);
    png = (await win.webContents.capturePage()).toPNG();
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), png);
  console.log(`OK  ${name}.png (${Math.round(png.length / 1024)}KB)`);
}

// スタート画面と各パネルが空だと「使われていないアプリ」に見えるので、
// ウィンドウを開く前に見本のショートカット・ウィジェット・ブックマークを入れておく
function seed(profileId) {
  const bundle = browser.bundleFor(profileId);
  const page = bundle.bookmarks.startPages()[0];

  const shortcuts = [
    ['GitHub', 'https://github.com/'],
    ['Wikipedia', 'https://ja.wikipedia.org/'],
    ['MDN', 'https://developer.mozilla.org/ja/'],
    ['YouTube', 'https://www.youtube.com/'],
    ['Gmail', 'https://mail.google.com/'],
    ['カレンダー', 'https://calendar.google.com/'],
    ['X', 'https://x.com/'],
    ['Notion', 'https://www.notion.so/'],
  ].map(([name, target]) => bundle.bookmarks.addShortcut(page.id, { kind: 'url', name, target }));

  bundle.widgets.setLayout(
    page.id,
    shortcuts.filter(Boolean).map((s) => ({ type: 'shortcut', refId: s.id }))
  );
  bundle.widgets.addWidget(page.id, 'calendar');
  bundle.widgets.addWidget(page.id, 'notepad');

  for (const [title, url] of [
    ['Chromium - Wikipedia', 'https://ja.wikipedia.org/wiki/Chromium'],
    ['MDN Web Docs', 'https://developer.mozilla.org/ja/'],
    ['GitHub', 'https://github.com/'],
    ['Electron', 'https://www.electronjs.org/'],
    ['Tor Project', 'https://www.torproject.org/'],
  ]) {
    bundle.bookmarks.add(url, title, null);
  }
  return page;
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    // 撮影しているPCで動いているローカルサーバーがスタート画面に出るので、公開する画像には写さない
    if (browser.localServers) browser.localServers.detect = () => [];
    const profileId = browser.profiles.active().id;
    seed(profileId);

    const ctx = browser.createWindow();
    ctx.window.setBounds({ x: 60, y: 40, ...SIZE });
    const tabs = ctx.tabManager;
    await sleep(2500);

    // 1) スタート画面(ショートカット + ウィジェット)。タブバーにも実在サイトを並べる
    for (const url of SITES) tabs.createTab(url, { background: true });
    await sleep(8000);
    await shot(ctx, '01-start');

    // 2) 実ページ + サイドパネル(ブックマーク)
    const bySite = (part) => tabs.tabs.find((t) => String(tabs.tabUrl(t) || '').includes(part));
    const wiki = bySite('wikipedia');
    if (wiki) tabs.switchTab(wiki.id);
    await sleep(1500);
    ctx.sidePanel.openSection('bookmarks');
    await sleep(2500);
    await shot(ctx, '02-sidepanel');

    // 3) 画面分割(左右)
    ctx.sidePanel.setOpen(false);
    const mdn = bySite('developer.mozilla');
    if (mdn) tabs.splitWith(mdn.id, 'row');
    await sleep(2500);
    await shot(ctx, '03-split');

    // 4) プロファイルと設定(項目ごとの共有トグル)
    tabs.closeSplit();
    tabs.createTab('roopie://settings');
    await sleep(3000);
    await shot(ctx, '04-settings');

    // 5) トラッキング分析(企業単位)。広告が多いサイトを裏で開いてCookieを集めてから撮る
    for (const url of ['https://www.itmedia.co.jp/', 'https://weathernews.jp/']) {
      tabs.createTab(url, { background: true });
    }
    await sleep(10000);
    if (wiki) tabs.switchTab(wiki.id);
    // openSection は表示中の中身を変えるだけなので、閉じているときは先に開く
    ctx.sidePanel.setOpen(true);
    ctx.sidePanel.openSection('trackers');
    await sleep(4000);
    await shot(ctx, '05-trackers');

    // 6) 外観はプロファイル単位。ライト + グラデーションの見本
    browser.setThemeFor(profileId, {
      windowMode: 'light',
      windowStyle: 'gradient',
      windowGradientStops: ['#dbe7ff', '#f6e6ff'],
      windowGradientAngle: 120,
    });
    ctx.sidePanel.openSection('trackers'); // 開いている中身を畳んでレールだけに戻す
    if (wiki) tabs.switchTab(wiki.id);
    await sleep(2500);
    await shot(ctx, '06-theme-light');

    // 7) liquidglass。クロームの帯だけでなく内部ページの面もガラスになる。
    //    カードが並ぶ設定画面が一番よく分かる。面の重ね色は --tint 経由なので、
    //    ライトでは黒側へ反転して面が消えないことを見るためダーク・ライト両方を撮る
    ctx.sidePanel.setOpen(true);
    ctx.sidePanel.openSection('bookmarks');
    tabs.createTab('roopie://settings');
    for (const windowMode of ['dark', 'light']) {
      browser.setThemeFor(profileId, { windowMode, windowStyle: 'glass' });
      await sleep(2500);
      await shot(ctx, `07-theme-glass-${windowMode}`);
    }

    console.log('出力先:', OUT_DIR);
  } catch (err) {
    console.error('失敗:', err);
  } finally {
    setTimeout(() => app.exit(0), 800);
  }
});
