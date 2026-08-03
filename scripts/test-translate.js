// 翻訳機能の検証(再利用可能)。
// 実行: npx electron scripts/test-translate.js [スクショ保存先dir]
//
// 1) translate.js: 言語の判定(純関数)と、まとめ訳し・キャッシュ・小分けの通信回数
// 2) ページ翻訳: 本物のウィンドウで英語のページを訳し、元に戻せること、
//    動的に増えた文も訳すこと、訳し直しの無限ループにならないこと
// 3) UI: アドレスバーの翻訳アイコンとオーバーレイ(roopie://menu)の #translate-popup
// 4) 選択テキストの翻訳
//
// ネットワーク(translate.googleapis.com)を使うので、オフラインでは 1) の純関数以外は落ちる。
const { app } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 8947;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-translate-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const translate = require('../src/main/translate');
const pageTranslate = require('../src/main/page-translate');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

// 訳文の要求の回数を数える(自分の書き込みで訳し直しが走り続けないことを見る)。
// ipc.js は呼び出しのたびにプロパティを引くので、ここで差し替えれば数えられる
let textsCalls = 0;
let failTexts = false; // 失敗時の挙動(中途半端な画面を残さない)を見るための細工
const originalHandleTexts = pageTranslate.handleTexts;
pageTranslate.handleTexts = (...args) => {
  textsCalls++;
  if (failTexts) return Promise.resolve({ ok: false, error: 'テスト用の失敗' });
  return originalHandleTexts(...args);
};

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
function checkThat(name, ok, detail) {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// 条件が満たされるまで待つ(翻訳はネットワーク越しなので固定待ちにしない)
async function waitFor(condition, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await condition()) return true;
    await sleep(250);
  }
  return false;
}

const overlayOf = (ctx) => ctx.tabManager.overlay.webContents;

// 翻訳のドロップダウンの状態(オーバーレイ側)
async function trState(ctx) {
  const state = await js(
    overlayOf(ctx),
    `(() => {
       const el = document.getElementById('translate-popup');
       const r = el.getBoundingClientRect();
       const cs = getComputedStyle(el);
       return {
         hidden: el.classList.contains('hidden'),
         title: document.getElementById('tr-title').textContent,
         source: document.getElementById('tr-source').textContent,
         target: document.getElementById('tr-target').value,
         buttons: [...document.querySelectorAll('.tr-actions .btn')]
           .filter((b) => !b.classList.contains('hidden'))
           .map((b) => b.textContent),
         selectionOriginal: document.getElementById('tr-selection-original').textContent,
         selectionResult: document.getElementById('tr-selection-result').textContent,
         left: Math.round(r.left),
         top: Math.round(r.top),
         right: Math.round(r.right),
         bottom: Math.round(r.bottom),
         bg: cs.backgroundColor,
         radius: cs.borderTopLeftRadius,
         winW: window.innerWidth,
         winH: window.innerHeight,
       };
     })()`
  );
  return state;
}

// ドロップダウンが出るべき左端。アイコンの左端合わせだが、右端がページ領域から
// はみ出す分だけ左へ寄る(menu.js の position() と同じ計算)
const TR_WIDTH = 332;
const TR_MARGIN = 8;
function expectedPopupLeft(iconLeft, ctx, overlayWidth) {
  const base = iconLeft - ctx.tabManager.chromeLeft;
  return Math.max(TR_MARGIN, Math.min(base, overlayWidth - TR_WIDTH - TR_MARGIN));
}

// アドレスバーの翻訳アイコン(ツールバー側)
async function iconState(uiWc) {
  return js(
    uiWc,
    `(() => {
       const el = document.getElementById('translate-btn');
       return { hidden: el.classList.contains('hidden'), active: el.classList.contains('active') };
     })()`
  );
}

// そのURLを開いたときに提案するか(タブを1枚使って確かめる)
async function offerStateFor(ctx, url) {
  const tab = await loadTab(ctx.tabManager, url);
  await sleep(1400); // page-info(DOMContentLoaded + load)を待つ
  return tab.translate?.state ?? 'none';
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// セレクタの中心を実クリックする(信頼済みイベント)
async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
     })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  // 隠れている要素は矩形が0になり、(0,0)を押して「何も起きない」だけになる。
  // 押せなかったことを見逃さないよう、ここで止める
  if (!pos.width || !pos.height) throw new Error(`要素が隠れていて押せません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
  await sleep(400);
}

const loadTab = async (tabManager, url) => {
  const tab = tabManager.createTab(url);
  await Promise.race([new Promise((r) => tab.view.webContents.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);
  return tab;
};

// 英語のページ。段落は分けておく(テキストノードごとに訳されることを確かめる)
const PAGE = `<!doctype html><meta charset="utf-8"><title>Translate test</title>
<body>
  <h1 id="head">Good morning</h1>
  <p id="p1">This is a small test page.</p>
  <p id="p2">The weather is nice today.</p>
  <p id="p3">Price: 1,200 円</p>
  <p id="clock">0</p>
  <div id="later"></div>
  <script>
    // 動的に増える文(MutationObserverで訳されるか)
    window.addLater = (text) => {
      const p = document.createElement('p');
      p.className = 'added';
      p.textContent = text;
      document.getElementById('later').appendChild(p);
    };
    // 自分で書き換え続ける要素(訳し直しの無限ループを誘発する)
    let n = 0;
    window.startClock = () => setInterval(() => { document.getElementById('clock').textContent = String(++n); }, 200);
  </script>
</body>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      if (req.url.startsWith('/ja')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><title>日本語</title><p>これは日本語のページです。翻訳は提案しません。</p>');
        return;
      }
      // 言語を宣言した英語のページ(「常に翻訳」「この言語は翻訳しない」の判定に使う)
      if (req.url.startsWith('/en')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>English</title>${PAGE}`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    })
    .listen(PORT);

  try {
    // ---- 1) 言語の判定(純関数。ネットワーク不要) ----
    check('日本語の宣言があれば提案しない', translate.looksForeign('ja', 'ja', ''), false);
    check('英語の宣言なら提案する', translate.looksForeign('ja', 'en-US', ''), true);
    check('宣言が無ければ本文の文字で判定(英文)', translate.looksForeign('ja', '', 'This is a fairly long English sentence for detection.'), true);
    check(
      '宣言が無くても日本語の本文は提案しない',
      translate.looksForeign('ja', '', 'これは日本語で書かれた十分な長さの本文です。判定に使います。'),
      false
    );
    check('本文が短すぎるときは提案しない', translate.looksForeign('ja', '', 'Hi'), false);
    check('中国語のページは日本語と別扱い', translate.looksForeign('ja', 'zh-CN', ''), true);
    check('簡体と繁体も別扱い', translate.looksForeign('zh-TW', 'zh-CN', ''), true);
    check('地域つきの同じ言語は提案しない', translate.looksForeign('en', 'en-GB', ''), false);
    check('知らない言語コードは既定(日本語)へ丸める', translate.normalizeLang('klingon'), 'ja');
    check('地域つきは基本の言語へ丸める', translate.normalizeLang('en-US'), 'en');
    check('言語名は日本語で返す', translate.langName('en'), '英語');

    // ---- 1-b) まとめ訳し・キャッシュ・小分け(通信回数を数える) ----
    //
    // 訳文の取得は**ページのセッションではなく翻訳専用のセッション**で行う。
    // 拡張機能が webRequest を張ったセッションへメインプロセスから投げると
    // アプリごと落ちるため(「翻訳するとRoopieが終了する」の原因)。
    // 回数はその専用セッションの fetch を包んで数える
    const { session: electronSession } = require('electron');
    const ses = electronSession.fromPartition('roopie-test-page');
    const fetchSession = await translate.fetchSessionFor(ses);
    checkThat('通信はページのセッションでは行わない', fetchSession !== ses, fetchSession === ses);
    const spy = { calls: 0, bodies: [] };
    const realFetch = fetchSession.fetch.bind(fetchSession);
    fetchSession.fetch = (url, init) => {
      spy.calls++;
      spy.bodies.push(String(init?.body ?? ''));
      return realFetch(url, init);
    };

    // 経路(プロキシ)は引き継ぐ。Torのプロファイルの文面がTorの外へ出ないための要件
    check('DIRECTはそのまま直結', translate.proxyRulesOf('DIRECT'), '');
    check('SOCKS5を引き継ぐ形に直す', translate.proxyRulesOf('SOCKS5 127.0.0.1:9050'), 'socks5://127.0.0.1:9050');
    check('HTTPプロキシも直す', translate.proxyRulesOf('PROXY 10.0.0.1:8080; DIRECT'), 'http://10.0.0.1:8080');
    const torLike = electronSession.fromPartition('roopie-test-tor');
    await torLike.setProxy({ proxyRules: 'socks5://127.0.0.1:9050' });
    const torFetchSession = await translate.fetchSessionFor(torLike);
    checkThat(
      'Torなどのプロキシを使うプロファイルでは翻訳の通信も同じプロキシを通る',
      /SOCKS5 127\.0\.0\.1:9050/i.test(await torFetchSession.resolveProxy('https://translate.googleapis.com/')),
      await torFetchSession.resolveProxy('https://translate.googleapis.com/')
    );
    const first = await translate.translateTexts(['Good morning', 'Thank you very much'], {
      targetLang: 'ja',
      session: ses,
    });
    check('2文をまとめて1回の通信で訳す', spy.calls, 1);
    checkThat('英語から日本語に訳す', first.texts.every((t) => /[぀-ヿ一-鿿]/.test(t)), first.texts);
    check('検出した言語を返す', first.source, 'en');

    spy.calls = 0;
    const second = await translate.translateTexts(['Good morning'], { targetLang: 'ja', session: ses });
    check('同じ文はキャッシュから返す(通信しない)', spy.calls, 0);
    check('キャッシュでも同じ訳文になる', second.texts[0], first.texts[0]);

    spy.calls = 0;
    const many = Array.from({ length: 150 }, (_, i) => `This is sentence number ${i + 1}.`);
    const batched = await translate.translateTexts(many, { targetLang: 'ja', session: ses });
    checkThat('本数が多いときは小分けにする', spy.calls >= 3, spy.calls);
    checkThat(
      '小分けにしても取りこぼさない',
      batched.texts.length === 150 && batched.texts.every((t) => t && t.length > 0),
      batched.texts.filter((t) => !t).length
    );
    checkThat(
      '1回の要求は上限を超えない',
      spy.bodies.every((b) => (b.match(/(^|&)q=/g) ?? []).length <= translate.MAX_SEGMENTS),
      spy.bodies.map((b) => (b.match(/(^|&)q=/g) ?? []).length)
    );

    spy.calls = 0;
    const empty = await translate.translateTexts(['', '   '], { targetLang: 'ja', session: ses });
    check('空の文だけなら通信しない', spy.calls, 0);
    check('空の文はそのまま返す', empty.texts, ['', '   ']);

    // ---- 2) 本物のウィンドウでページ翻訳 ----
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const uiWc = ctx.window.webContents;
    await sleep(2000);

    const url = `http://127.0.0.1:${PORT}/`;
    const tab = await loadTab(ctx.tabManager, url);
    const wc = tab.view.webContents;
    const text = (id) => js(wc, `document.getElementById(${JSON.stringify(id)}).textContent`);
    const settings = () => browser.bundleFor(ctx.profileId).settings.data;
    await sleep(1200); // page-info(読み込み後)を待つ

    // 読めない言語のページなので提案する。ドロップダウンは自動で開く(Edgeと同じ)
    check('読めない言語のページは提案中になる', tab.translate?.state, 'offer');
    check('アドレスバーの翻訳アイコンを出す', await iconState(uiWc), { hidden: false, active: false });
    const offer = await trState(ctx);
    console.log('   提案のドロップダウン:', JSON.stringify(offer));
    check('提案のドロップダウンが自動で開く', offer.hidden, false);
    check('Edgeと同じ問いかけを出す', offer.title, 'このページを翻訳しますか?');
    check('翻訳先は設定の言語(既定は日本語)', offer.target, 'ja');
    check('Edgeと同じボタンを出す', offer.buttons, ['翻訳', '今は実行しない']);
    checkThat('ポップアップのCSSが当たっている', offer.bg !== 'rgba(0, 0, 0, 0)' && offer.radius !== '0px', offer);
    const iconLeft = await js(uiWc, `Math.round(document.getElementById('translate-btn').getBoundingClientRect().left)`);
    checkThat(
      '翻訳アイコンの直下(左端合わせ。右端に収まらない分だけ左へ寄る)に出る',
      Math.abs(offer.left - expectedPopupLeft(iconLeft, ctx, offer.winW)) <= 1,
      { popup: offer.left, icon: iconLeft, chromeLeft: ctx.tabManager.chromeLeft }
    );
    checkThat('ページ領域の中に収まる', offer.left >= 0 && offer.right <= offer.winW && offer.bottom <= offer.winH, offer);
    await shot(overlayOf(ctx), 'translate-offer.png');

    // 「翻訳」を押すと訳文に差し替わる
    const original = { head: await text('head'), p1: await text('p1') };
    check('(前提)訳す前は英語のまま', original.head, 'Good morning');
    await clickSelector(overlayOf(ctx), '#tr-run');
    await waitFor(() => tab.translate?.state === 'done', 20000);
    check('翻訳が終わると done になる', tab.translate?.state, 'done');
    check('検出した言語を覚える', tab.translate?.source, 'en');
    checkThat('見出しが訳文に変わる', /[぀-ヿ一-鿿]/.test(await text('head')), await text('head'));
    checkThat('段落も訳文に変わる', /[぀-ヿ一-鿿]/.test(await text('p1')), await text('p1'));
    check('翻訳アイコンが点灯する', await iconState(uiWc), { hidden: false, active: true });
    const done = await trState(ctx);
    check('訳し終わりをドロップダウンに反映する', done.title, 'このページは翻訳されました');
    check('訳し終わりは元に戻すボタンを出す', done.buttons, ['元の言語を表示', '完了']);
    check('翻訳元の言語名を出す', done.source, '英語');
    await shot(overlayOf(ctx), 'translate-done.png');

    // 数字だけの段落は訳さない(送っても意味が無く、前後の空白も崩れる)
    check('数字だけの文はそのまま', await text('clock'), '0');

    // 「元の言語を表示」で原文へ戻す(逆翻訳ではなく控えた原文の書き戻し)
    await clickSelector(overlayOf(ctx), '#tr-undo');
    await waitFor(async () => (await text('head')) === original.head, 8000);
    check('原文に戻る(一字も変わらない)', [await text('head'), await text('p1')], [original.head, original.p1]);
    // 戻した後もアイコンは残す(Edgeと同じ。そこからまた訳せる)
    check('戻しても提案中に戻る', tab.translate?.state, 'offer');
    check('戻してもアイコンは残る(消灯する)', await iconState(uiWc), { hidden: false, active: false });
    await sleep(400);

    // ---- 3) 後から増えた文と、訳し直しの無限ループ ----
    await clickSelector(uiWc, '#translate-btn'); // アイコンからドロップダウンを開く
    await sleep(600);
    check('アイコンのクリックでも開く', (await trState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#tr-run');
    await waitFor(() => tab.translate?.state === 'done', 20000);
    await js(wc, `window.addLater('The dog is running in the park.')`);
    await waitFor(async () => /[぀-ヿ一-鿿]/.test(await js(wc, `document.querySelector('.added').textContent`)), 15000);
    checkThat(
      '後から増えた文も訳す',
      /[぀-ヿ一-鿿]/.test(await js(wc, `document.querySelector('.added').textContent`)),
      await js(wc, `document.querySelector('.added').textContent`)
    );

    // 自分で書き換え続ける要素(数字)があっても、訳す要求は増え続けない
    await js(wc, 'window.startClock()');
    await sleep(1500);
    const callsBefore = textsCalls;
    await sleep(3000);
    check('自分の書き込みで訳し直しが無限に走らない', textsCalls - callsBefore, 0);

    // ---- 4) 失敗しても中途半端な画面を残さない ----
    ctx.tabManager.createTab(url); // 別のタブで、訳文の取得だけ必ず失敗させる
    await sleep(2500);
    const failTab = ctx.tabManager.getTab(ctx.tabManager.activeTabId);
    const failWc = failTab.view.webContents;
    const failOriginal = await js(failWc, `document.getElementById('head').textContent`);
    failTexts = true;
    require('../src/main/page-translate').start(ctx, failTab.id);
    await waitFor(() => failTab.translate?.state === 'error', 15000);
    failTexts = false;
    check('失敗は error として伝わる', failTab.translate?.state, 'error');
    check('失敗したページは原文のまま', await js(failWc, `document.getElementById('head').textContent`), failOriginal);
    await clickSelector(uiWc, '#translate-btn');
    await sleep(600);
    const errorState = await trState(ctx);
    check('失敗をドロップダウンに出す', errorState.title, 'このページを翻訳できませんでした');
    check('失敗したときは再試行を出す', errorState.buttons, ['再試行', '今は実行しない']);
    await clickSelector(overlayOf(ctx), '#tr-cancel');
    await sleep(400);
    ctx.tabManager.closeTab(failTab.id);
    await sleep(600);

    // ---- 5) 選択テキストの翻訳(右クリックメニューから) ----
    const selectionWc = ctx.tabManager.activeWebContents();
    pageTranslate.translateSelection(ctx, selectionWc, 'Good evening, everyone.');
    await waitFor(async () => !(await trState(ctx)).hidden, 15000);
    const selection = await trState(ctx);
    check('選択テキストの翻訳もドロップダウンに出す', selection.title, '選択したテキストの翻訳');
    check('原文をそのまま見せる', selection.selectionOriginal, 'Good evening, everyone.');
    checkThat('訳文を出す', /[぀-ヿ一-鿿]/.test(selection.selectionResult), selection.selectionResult);
    check('コピーと閉じるを出す', selection.buttons, ['コピー', '閉じる']);
    await shot(overlayOf(ctx), 'translate-selection.png');
    await clickSelector(overlayOf(ctx), '#tr-cancel');
    await sleep(400);

    // ---- 5-b) ドロップダウンが開いている間にサイトの権限を尋ねられたら、そちらに譲る ----
    //      (両方描くとアドレスバーの下で重なって読めなくなる)
    const permTab = ctx.tabManager.getTab(ctx.tabManager.activeTabId);
    await clickSelector(uiWc, '#translate-btn');
    await sleep(600);
    check('(前提)翻訳のドロップダウンが開いている', (await trState(ctx)).hidden, false);
    const permAsk = browser.requestSitePermission(permTab.view.webContents, 'notifications', {
      requestingUrl: url,
      isMainFrame: true,
    });
    await sleep(900);
    check('権限の確認に置き換わる', await js(overlayOf(ctx), `!document.getElementById('perm-popup').classList.contains('hidden')`), true);
    check('翻訳のドロップダウンは畳む(重ねない)', (await trState(ctx)).hidden, true);
    await clickSelector(overlayOf(ctx), '#perm-block');
    await permAsk;
    await sleep(400);

    // ---- 6) 提案しない設定(サイト / 言語 / 常に翻訳) ----
    check('日本語のページでは提案しない', await offerStateFor(ctx, `http://127.0.0.1:${PORT}/ja`), 'none');
    check('日本語のページでは翻訳アイコンも出さない', (await iconState(uiWc)).hidden, true);

    // 「このサイトは翻訳しない」。**訳し終えたページから選んだ場合**も、原文へ戻して
    // アイコンごと引っ込める(戻すだけだと「提案中」に戻ってアイコンが残る)
    const neverTab = await loadTab(ctx.tabManager, `${url}?again`);
    await sleep(1200);
    await clickSelector(uiWc, '#translate-btn');
    await sleep(600);
    await clickSelector(overlayOf(ctx), '#tr-run');
    await waitFor(() => neverTab.translate?.state === 'done', 25000);
    check('(前提)訳し終えている', neverTab.translate?.state, 'done');
    await clickSelector(uiWc, '#translate-btn');
    await sleep(600);
    await clickSelector(overlayOf(ctx), '#tr-more');
    await sleep(300);
    await clickSelector(overlayOf(ctx), '#tr-never-site');
    await sleep(800);
    check('「このサイトは翻訳しない」を覚える', settings().translateNeverSites, ['127.0.0.1']);
    check('訳し終えたページから選んでも原文に戻る', await js(neverTab.view.webContents, `document.getElementById('head').textContent`), 'Good morning');
    check('選んだ後は状態を消す', neverTab.translate?.state ?? 'none', 'none');
    check('選んだ後はアイコンも引っ込める', (await iconState(uiWc)).hidden, true);
    check('覚えたサイトでは提案しない', await offerStateFor(ctx, `${url}?blocked`), 'none');
    settings().translateNeverSites = [];

    // 「この言語は翻訳しない」(宣言のあるページで効く)
    settings().translateNeverLangs = ['en'];
    check('提案しない言語のページでは提案しない', await offerStateFor(ctx, `http://127.0.0.1:${PORT}/en`), 'none');
    settings().translateNeverLangs = [];

    // 「この言語のページを常に翻訳する」= 尋ねずに訳す
    settings().translateAlwaysLangs = ['en'];
    const alwaysTab = await loadTab(ctx.tabManager, `http://127.0.0.1:${PORT}/en`);
    await waitFor(() => alwaysTab.translate?.state === 'done', 25000);
    check('常に翻訳する言語は尋ねずに訳す', alwaysTab.translate?.state, 'done');
    checkThat(
      '尋ねずに訳したページも訳文になる',
      /[぀-ヿ一-鿿]/.test(await js(alwaysTab.view.webContents, `document.getElementById('head').textContent`)),
      await js(alwaysTab.view.webContents, `document.getElementById('head').textContent`)
    );
    settings().translateAlwaysLangs = [];

    // 提案そのものを切る
    settings().translateAutoOffer = false;
    check('提案を切ると提案しない', await offerStateFor(ctx, `${url}?nooffer`), 'none');
    settings().translateAutoOffer = true;

    // ---- 7) 設定画面(翻訳) ----
    settings().translateNeverSites = ['example.com'];
    settings().translateNeverLangs = ['fr'];
    settings().translateAlwaysLangs = ['de'];
    browser.sendSettingsFor(ctx.profileId);
    const settingsTab = await loadTab(ctx.tabManager, 'roopie://settings');
    const settingsWc = settingsTab.view.webContents;
    await sleep(1800);
    check(
      '設定画面に翻訳先の言語が並ぶ',
      await js(settingsWc, `document.getElementById('translate-target').options.length > 10`),
      true
    );
    check(
      '設定画面の翻訳先は今の設定を指す',
      await js(settingsWc, `document.getElementById('translate-target').value`),
      'ja'
    );
    check(
      '除外リストを3本出す',
      await js(settingsWc, `[...document.querySelectorAll('#translate-lists .perm-kind')].map((el) => el.dataset.list)`),
      ['translateAlwaysLangs', 'translateNeverLangs', 'translateNeverSites']
    );
    check(
      '言語は日本語名で並べる',
      await js(
        settingsWc,
        `[...document.querySelectorAll('#translate-lists .perm-kind[data-list="translateAlwaysLangs"] .title')].map((n) => n.textContent)`
      ),
      ['ドイツ語']
    );
    // タブのViewには sendInputEvent が届かないため、ここはDOMのclickで押す
    await js(
      settingsWc,
      `document.querySelector('#translate-lists .perm-kind[data-list="translateNeverSites"] .row-btn').click()`
    );
    await sleep(800);
    check('設定画面から削除できる', settings().translateNeverSites, []);
    check('ほかのリストは残る', [settings().translateNeverLangs, settings().translateAlwaysLangs], [['fr'], ['de']]);
    await shot(settingsWc, 'translate-settings.png');
    settings().translateNeverLangs = [];
    settings().translateAlwaysLangs = [];

    // ---- 8) シークレット: 訳せるが「覚える」系は残さない ----
    const inc = browser.createWindow({ incognito: true });
    await sleep(2500);
    const incTab = await loadTab(inc.tabManager, `${url}?incognito`);
    await sleep(1400);
    check('シークレットでも提案する', incTab.translate?.state, 'offer');
    const incPopup = await trState(inc);
    check('シークレットでもドロップダウンは出る', incPopup.hidden, false);
    check(
      'シークレットでは「…」を出さない(覚えないため)',
      await js(overlayOf(inc), `document.getElementById('tr-more').classList.contains('hidden')`),
      true
    );
    await clickSelector(overlayOf(inc), '#tr-run');
    await waitFor(() => incTab.translate?.state === 'done', 25000);
    check('シークレットでも訳せる', incTab.translate?.state, 'done');
    // 翻訳先を変えても設定に書かない
    pageTranslate.start(inc, incTab.id, 'en');
    await sleep(800);
    check('シークレットの選択は設定に残さない', settings().translateTargetLang, 'ja');
    inc.window.close();
    await sleep(800);

    // ---- 9) 縦タブでもアンカーの真下に出る(オーバーレイのずれ補正) ----
    const bundle = browser.bundleFor(ctx.profileId);
    bundle.settings.data.tabBarPosition = 'left';
    bundle.settings.save();
    browser.sendSettingsFor(ctx.profileId);
    browser.applyTabBarPositionFor(ctx.profileId);
    await sleep(1000);
    check('(前提)縦タブではオーバーレイが右へずれる', ctx.tabManager.chromeLeft, 220);
    await loadTab(ctx.tabManager, `${url}?vertical`);
    await sleep(1200);
    await clickSelector(uiWc, '#translate-btn');
    await sleep(700);
    const vertical = await trState(ctx);
    const vIconLeft = await js(uiWc, `Math.round(document.getElementById('translate-btn').getBoundingClientRect().left)`);
    checkThat(
      '縦タブでも翻訳アイコンの直下に出る(オーバーレイのずれを補正する)',
      Math.abs(vertical.left - expectedPopupLeft(vIconLeft, ctx, vertical.winW)) <= 1,
      { popup: vertical.left, icon: vIconLeft, chromeLeft: ctx.tabManager.chromeLeft }
    );
    await clickSelector(overlayOf(ctx), '#tr-cancel');
    bundle.settings.data.tabBarPosition = 'top';
    bundle.settings.save();
    browser.sendSettingsFor(ctx.profileId);
    browser.applyTabBarPositionFor(ctx.profileId);
    await sleep(800);

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    server.close();
    app.exit(1);
  }
});

// 初回は UnknownVizError になることがあるので数回試す(検証本体には影響しない)
async function shot(wc, name) {
  for (let i = 0; i < 4; i++) {
    try {
      const image = await wc.capturePage();
      fs.writeFileSync(path.join(shotDir, name), image.toPNG());
      console.log(`   📸 ${path.join(shotDir, name)}`);
      return;
    } catch (err) {
      if (i === 3) console.log(`   (スクショ失敗: ${name} ${err.message})`);
      await sleep(400);
    }
  }
}

app.on('window-all-closed', () => {});
