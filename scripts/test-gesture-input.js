// マウスジェスチャーの検出(メインプロセス側 = src/main/gesture-input.js)の検証。
// 実行: npx electron scripts/test-gesture-input.js
//
// 前半は sendInputEvent による自動検証(配線・パターン・対象View・軌跡・スクロール)。
// 後半は「ページが重いときでもジェスチャーが効くか」の手動検証。ここだけは実マウスが要る:
// sendInputEvent はメイン側で作った合成イベントなので、メイン側の見張りに届くのは当たり前で、
// 「OSからの実入力がレンダラー停止中もメインへ届く」ことの証明にならないため。
//
// 手動パートの手順(ウィンドウ左側のページ):
//   1. 赤いボタンを左クリック(1秒後から8秒間ページが固まる)
//   2. すぐに右ボタンを押しながら左へドラッグして離す → [手動] 左ペイン: パターン "L" が出ればOK
//   3. 固まっている間に右クリック(動かさずに)→ contextMenu が出ること(抑止の誤爆がないこと)
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const path = require('path');
const http = require('http');

const PORT = 8947;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- browser.js の差し替え ----
// gesture-input.js は実行時に require('./browser') して、プロファイルのジェスチャー設定と
// アクション実行(ipc.js が browser.performGesture に載せる)を引く。
// ブラウザ本体を丸ごと起動しないで済むよう、モジュールキャッシュに偽物を入れておく
const performed = []; // [アクション, ジェスチャーを受けたView名]
const viewNames = new Map(); // webContents -> 名前
const MAPPINGS = { L: 'back', R: 'forward', UD: 'reload', DR: 'closeTab', D: 'newTab', DU: 'scrollBottom' };
const fakeBrowser = {
  profiles: { activeId: 'default' },
  bundleFor: () => ({ gestures: { data: { enabled: true, mappings: MAPPINGS } } }),
  performGesture: (wc, action) => performed.push([action, viewNames.get(wc) ?? '?']),
};
const browserPath = require.resolve('../src/main/browser');
require.cache[browserPath] = { id: browserPath, filename: browserPath, loaded: true, exports: fakeBrowser };

const gestureInput = require('../src/main/gesture-input');

// ---- 合成マウスイベントで右ドラッグを作る ----
async function drag(wc, points, { release = true } = {}) {
  const [x0, y0] = points[0];
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', x: x0, y: y0, clickCount: 1 });
  let prev = points[0];
  for (const [x, y] of points.slice(1)) {
    // 実際のマウスは細かく動くので、区間を分割して送る(方向の確定は移動量20pxごと)
    const steps = Math.max(1, Math.round(Math.hypot(x - prev[0], y - prev[1]) / 10));
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(prev[0] + ((x - prev[0]) * i) / steps),
        y: Math.round(prev[1] + ((y - prev[1]) * i) / steps),
        modifiers: ['rightbuttondown'],
      });
    }
    prev = [x, y];
  }
  if (release) wc.sendInputEvent({ type: 'mouseUp', button: 'right', x: prev[0], y: prev[1], clickCount: 1 });
  await sleep(120);
}

// 実アプリで手動確認するときと同じページを使う
// (単体で配信するなら: node scripts/serve-test-page.js test-heavy-page.html 8947)
const PAGE = require('fs').readFileSync(path.join(__dirname, 'test-heavy-page.html'));

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  server.on('error', (err) => {
    console.error(`テスト用サーバを起動できません(${err.message})。前回の検証ウィンドウが残っていないか確認してください`);
    app.exit(1);
  });
  server.listen(PORT);

  const ses = session.defaultSession;
  gestureInput.enableForSession(ses);

  const win = new BrowserWindow({ width: 1100, height: 700, show: true });
  const [cw, ch] = win.getContentSize();

  // 分割ペインを模した2つのView(ジェスチャーが「操作したペイン」に効くかを見る)
  const makeView = (name, x, width) => {
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        // 検証中はウィンドウが背面に回りがちなので、フレーム生成を止めさせない
        // (スムーススクロールの確認がスロットルに巻き込まれる)
        backgroundThrottling: false,
        // 実アプリではセッション全体に登録される。ここでは直接指定して同じ状態にする
        preload: path.join(__dirname, '..', 'src', 'preload', 'gesture-preload.js'),
      },
    });
    win.contentView.addChildView(view);
    view.setBounds({ x, y: 0, width, height: ch });
    viewNames.set(view.webContents, name);
    view.webContents.loadURL(`http://127.0.0.1:${PORT}/`);
    return view;
  };
  const left = makeView('左ペイン', 0, Math.floor(cw / 2));
  const right = makeView('右ペイン', Math.floor(cw / 2), cw - Math.floor(cw / 2));
  await Promise.all([left, right].map((v) => new Promise((r) => v.webContents.once('did-finish-load', r))));
  await sleep(300);

  // ---- 自動検証 ----
  console.log('--- 自動検証(sendInputEvent) ---');

  await drag(left.webContents, [[200, 300], [60, 300]]);
  check('左方向のジェスチャーでアクションが実行される', performed.at(-1), ['back', '左ペイン']);

  await drag(right.webContents, [[200, 300], [340, 300]]);
  check('右ペインのジェスチャーは右ペインに効く', performed.at(-1), ['forward', '右ペイン']);

  await drag(left.webContents, [[200, 200], [200, 320], [340, 320]]);
  check('2方向(下→右)のパターンが確定する', performed.at(-1), ['closeTab', '左ペイン']);

  const before = performed.length;
  await drag(left.webContents, [[200, 300], [205, 303]]);
  check('わずかな移動ではジェスチャーにならない', performed.length, before);

  // 軌跡(ページ側の描画)。押しっぱなしのまま確認する
  await drag(left.webContents, [[200, 200], [200, 340]], { release: false });
  const trail = await left.webContents.executeJavaScript(
    'document.querySelectorAll(\'div[style*="2147483647"]\').length', true
  );
  check('ドラッグ中はページに軌跡とラベルが出る(2要素)', trail, 2);
  const labelText = await left.webContents.executeJavaScript(
    '[...document.querySelectorAll("div")].map((d) => d.textContent).filter((t) => t.includes("↓")).at(-1) ?? ""', true
  );
  check('ラベルにアクション名が出る', labelText.includes('新しいタブ'), true);
  left.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', x: 200, y: 340, clickCount: 1 });
  await sleep(150);
  const afterEnd = await left.webContents.executeJavaScript(
    'document.querySelectorAll(\'div[style*="2147483647"]\').length', true
  );
  check('離すと軌跡が消える', afterEnd, 0);

  // スクロール系はページ側で実行される
  await left.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
  // スムーススクロールはフレームの生成に乗るので、少し余裕をもって待つ
  const waitScroll = async (wc) => {
    let y = 0;
    for (let i = 0; i < 25 && y <= 100; i++) {
      await sleep(100);
      y = await wc.executeJavaScript('window.scrollY', true);
    }
    return y;
  };
  // まずページ側の実行部分(preload)だけを直接確かめる
  const instant = await left.webContents.executeJavaScript('window.scrollTo(0, 500); window.scrollY', true);
  check('テスト用ページがそもそもスクロールできる', instant, 500);
  await left.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
  await left.webContents.executeJavaScript('window.scrollTo({ top: 1200, behavior: "smooth" })', true);
  check('スムーススクロールが進む(検証環境の確認)', (await waitScroll(left.webContents)) > 100, true);
  await left.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
  left.webContents.send('gestures:trail', { type: 'scroll', action: 'scrollBottom' });
  check('preloadがスクロールを実行できる', (await waitScroll(left.webContents)) > 100, true);

  await left.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
  await sleep(200);
  await drag(left.webContents, [[200, 200], [200, 340], [200, 200]]); // 下→上 = scrollBottom
  check('スクロール系のアクションがジェスチャーで実行される', (await waitScroll(left.webContents)) > 100, true);

  console.log(failed === 0 ? '自動検証: すべてOK' : `自動検証: ${failed}件 NG`);

  // ---- 手動検証 ----
  console.log('');
  console.log('--- 手動検証(実マウスが必要) ---');
  console.log('1) 左ペインの赤いボタンを左クリック(1秒後から8秒間ページが固まる)');
  console.log('2) すぐ右ボタンを押しながら左へドラッグして離す → [手動] にパターンが出ればOK');
  console.log('3) 固まっている間に、動かさずに右クリック → メニューが出ればOK(抑止の誤爆なし)');
  console.log('4) 固まりが解けた後、ジェスチャーの直後にメニューが出ないことも確認する');

  for (const [name, view] of [['左ペイン', left], ['右ペイン', right]]) {
    const wc = view.webContents;
    wc.on('console-message', (e) => {
      if (String(e.message).startsWith('page:')) console.log(`[page:${name}] ${e.message}`);
    });
    wc.on('context-menu', () => console.log(`     ↑ ${name}: 右クリックメニューが開いた`));
    let downAt = 0, downX = 0, downY = 0, maxDist = 0, doneBefore = 0;
    wc.on('input-event', (_e, input) => {
      if (input.type === 'mouseDown' && input.button === 'right') {
        downAt = Date.now();
        downX = input.x;
        downY = input.y;
        maxDist = 0;
        doneBefore = performed.length;
        return;
      }
      if (!downAt) return;
      if (input.type === 'mouseMove') {
        maxDist = Math.max(maxDist, Math.hypot(input.x - downX, input.y - downY));
      } else if (input.type === 'mouseUp' && input.button === 'right') {
        const action = performed.length > doneBefore ? performed.at(-1)[0] : 'なし';
        const kind = maxDist >= 10 ? `ジェスチャー(移動${Math.round(maxDist)}px)` : '単なる右クリック';
        console.log(`[手動] ${name}: ${kind} ${Date.now() - downAt}ms / 実行 ${action}`);
        downAt = 0;
      }
    });
  }
});

app.on('window-all-closed', () => app.quit());
