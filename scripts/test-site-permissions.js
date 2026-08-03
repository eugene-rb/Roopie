// サイトごとの権限(カメラ・マイク・現在地・通知・全画面表示)の検証(再利用可能)。
// 実行: npx electron scripts/test-site-permissions.js [スクショ保存先dir]
//
// 一時userDataで本物のウィンドウを開き、未許可サイトからの要求にオーバーレイ
// (roopie://menu)の #perm-popup が出ること、「許可」はサイトごとに覚え、
// 「今回だけ許可」は保存せずサイトを離れたら失効し、「ブロック」は今回限りであること、
// シークレットの許可をディスクへ書かないことを確かめる。
//
// 判定そのものは browser.requestSitePermission() の戻り値で見る
// (実際の全画面遷移はGPU・OS依存で待ち時間が読めないため、最後に1度だけ通しで確認する)。
// カメラ・マイクは実機のデバイス構成に左右される(マイクが無いPCでは getUserMedia が
// NotFoundError になり権限要求まで届かない)ため、ハンドラを直接呼ぶ経路で確かめる。
const { app } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 8942;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-siteperm-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const sitePermissions = require('../src/main/site-permissions');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

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

// 返事が「操作の結果として」返ったかを見る。60秒タイムアウトでの自動拒否も false になるため、
// 待たずに返ってきたことまで確かめないと「返事を返さない不具合」を素通ししてしまう
async function answered(promise, ms = 4000) {
  const timedOut = Symbol('timeout');
  const result = await Promise.race([promise, sleep(ms).then(() => timedOut)]);
  return result === timedOut ? '返事なし(タイムアウト待ち)' : result;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>権限テスト</title>
<div id="box" style="width:200px;height:150px;background:#333"></div>
<script>
  window.goFullscreen = () => document.getElementById('box').requestFullscreen().then(() => 'ok', (e) => String(e));
  window.askNotify = () => Notification.requestPermission();
  window.hasCamera = () => navigator.mediaDevices.enumerateDevices().then((d) => d.some((x) => x.kind === 'videoinput'));
  window.askCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'ok';
    } catch (e) { return e.name; }
  };
  window.askGeo = () => new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('ok'),
      (e) => resolve('code=' + e.code),
      { timeout: 8000 }
    );
  });
</script>`;

// 権限の要求(ページの代わりにハンドラを直接叩く)
const ask = (wc, permission, url, extra) =>
  browser.requestSitePermission(wc, permission, { requestingUrl: url, isMainFrame: true, ...extra });

// 確認ポップアップの状態(オーバーレイ側)。オーバーレイ自体が見えているかも併せて返す
const overlayOf = (ctx) => ctx.tabManager.overlay.webContents;
async function permState(ctx) {
  const state = await js(
    overlayOf(ctx),
    `(() => {
       const el = document.getElementById('perm-popup');
       const r = el.getBoundingClientRect();
       const cs = getComputedStyle(el);
       return {
         hidden: el.classList.contains('hidden'),
         text: document.querySelector('.perm-title').textContent,
         items: [...document.querySelectorAll('#perm-items .perm-item')].map((row) => ({
           kind: row.dataset.kind,
           label: row.textContent.trim(),
         })),
         buttons: [...document.querySelectorAll('.perm-actions .btn')].map((b) => b.textContent),
         left: Math.round(r.left),
         top: Math.round(r.top),
         right: Math.round(r.right),
         bottom: Math.round(r.bottom),
         width: Math.round(r.width),
         bg: cs.backgroundColor,
         radius: cs.borderTopLeftRadius,
         shadow: cs.boxShadow,
         winW: window.innerWidth,
         winH: window.innerHeight,
       };
     })()`
  );
  return { ...state, overlayVisible: ctx.tabManager.overlayVisible };
}

// 「その中身のポップアップが**出ている**」ことを見る。閉じているときも中身は残るので、
// items だけを比べると前の要求の残骸を掴んでしまう
async function checkPrompt(name, ctx, expectedItems) {
  const state = await permState(ctx);
  const ok = !state.hidden && JSON.stringify(state.items) === JSON.stringify(expectedItems);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify({ hidden: state.hidden, items: state.items })} (期待: ${JSON.stringify(expectedItems)})`}`);
  if (!ok) failed++;
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// セレクタの中心を実クリックする(信頼済みイベント)
async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
  await sleep(400);
}

const loadTab = async (tabManager, url) => {
  const tab = tabManager.createTab(url);
  await Promise.race([new Promise((r) => tab.view.webContents.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);
  return tab;
};

const navigate = async (wc, url) => {
  wc.loadURL(url);
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(300);
};

app.whenReady().then(async () => {
  const server = http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    })
    .listen(PORT);

  try {
    // 0) 旧設定(全画面表示だけを持っていた頃の形)からの移行。純関数なので先に確かめる
    const legacy = { fullscreenAllowedSites: ['old.example', 'OLD.example'], other: 1 };
    check('旧 fullscreenAllowedSites を移行する', sitePermissions.migrateSettings(legacy), true);
    check('全画面表示の許可として引き継ぐ', legacy.sitePermissions.fullscreen, ['old.example']);
    check('ほかの種類は空で埋める', legacy.sitePermissions.camera, []);
    check('旧キーは消す(取り消したホストが復活しない)', 'fullscreenAllowedSites' in legacy, false);
    check('二度目の移行は何もしない', sitePermissions.migrateSettings(legacy), false);

    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const uiWc = ctx.window.webContents;
    await sleep(2000);

    const url = `http://127.0.0.1:${PORT}/`;
    const tab = await loadTab(ctx.tabManager, url);
    const wc = tab.view.webContents;
    const grants = () => browser.bundleFor(ctx.profileId).settings.data.sitePermissions;
    const fsSites = () => grants().fullscreen;

    check('初期状態では何も許可していない', grants(), {
      camera: [],
      microphone: [],
      geolocation: [],
      notifications: [],
      fullscreen: [],
    });
    check('未許可なので全画面にはできない', ctx.tabManager.isFullscreenGranted(url), false);

    // 1) 未許可サイト → 確認ドロップダウンが出る → 「許可」でサイトごとに記憶する
    const firstAsk = ask(wc, 'fullscreen', url);
    await sleep(800);
    const asking = await permState(ctx);
    console.log('   確認ポップアップ:', JSON.stringify(asking));
    check('確認ポップアップが出る', asking.hidden, false);
    check('オーバーレイが前面に出る', asking.overlayVisible, true);
    check('要求元のホストを表示する', asking.text, '127.0.0.1 が次の許可を求めています');
    check('何を求めているかを表示する', asking.items, [{ kind: 'fullscreen', label: '全画面表示にする' }]);
    check('3択(許可 / 今回だけ / ブロック)を出す', asking.buttons, ['許可', '今回だけ許可', 'ブロック']);

    // ---- Edge風の見た目・位置(CSSが未整備だと透明・素のボタン並びになる) ----
    check('ポップアップ幅は320px', asking.width, 320);
    checkThat('背景が透明でない(CSSが当たっている)', asking.bg !== 'rgba(0, 0, 0, 0)' && asking.bg !== 'transparent', asking.bg);
    checkThat('角丸が付いている', asking.radius !== '0px', asking.radius);
    checkThat('影が付いている', asking.shadow !== 'none', asking.shadow);
    checkThat('ページ領域の中に収まる', asking.left >= 0 && asking.right <= asking.winW && asking.bottom <= asking.winH, asking);
    // アドレスバーのサイト情報アイコンの真下(左端合わせ)にぶら下がる
    const iconLeft = await js(uiWc, `Math.round(document.getElementById('address-icon').getBoundingClientRect().left)`);
    checkThat(
      'サイト情報アイコンの直下(左端合わせ)に出る',
      Math.abs(asking.left - (iconLeft - ctx.tabManager.chromeLeft)) <= 1,
      { popup: asking.left, icon: iconLeft, chromeLeft: ctx.tabManager.chromeLeft }
    );
    checkThat('ツールバーのすぐ下に出る', asking.top <= 12, asking.top);
    await shot(overlayOf(ctx), 'site-permission-popup.png');

    await clickSelector(overlayOf(ctx), '#perm-allow');
    check('「許可」で全画面要求が通る', await firstAsk, true);
    check('許可したサイトを記憶する', fsSites(), ['127.0.0.1']);
    check('返事の後は確認ポップアップを閉じる', (await permState(ctx)).hidden, true);
    check('返事の後はオーバーレイも畳む', ctx.tabManager.overlayVisible, false);
    check('保険の判定も許可済みになる', ctx.tabManager.isFullscreenGranted(url), true);

    // 2) 記憶したサイトは二度目以降そのまま通す(ポップアップを出さない)
    check('二度目は尋ねずに許可', await ask(wc, 'fullscreen', url), true);
    check('二度目は確認ポップアップを出さない', (await permState(ctx)).hidden, true);
    check('種類は独立している(全画面の許可は通知に及ばない)', grants().notifications, []);

    // 3) 別ホストは別サイト扱い。「ブロック」は記憶しない(次はまた尋ねる)
    const otherUrl = `http://localhost:${PORT}/`;
    await loadTab(ctx.tabManager, otherUrl);
    const otherWc = ctx.tabManager.getTab(ctx.tabManager.activeTabId).view.webContents;
    const blockAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('許可済みでない別ホストには尋ねる', (await permState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#perm-block');
    check('「ブロック」で全画面要求は拒否される', await blockAsk, false);
    check('ブロックは記憶しない(一覧は増えない)', fsSites(), ['127.0.0.1']);

    const askAgain = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('ブロックした後もまた尋ねる(今回限り)', (await permState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#perm-block');
    await askAgain;

    // 3-b) ポップアップを消す経路はすべて返事を返す(返さないとページが60秒待たされる)
    //     ① 外側クリック ② Escape ③ ほかのポップアップ(プロファイルメニュー)に置き換わる
    const outsideAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('(前提)確認ポップアップが出ている', (await permState(ctx)).hidden, false);
    const winH = (await permState(ctx)).winH;
    clickAt(overlayOf(ctx), 10, winH - 10);
    check('外側クリックはブロック扱いで返事を返す', await answered(outsideAsk), false);
    await sleep(400);
    check('外側クリックでポップアップが閉じる', (await permState(ctx)).hidden, true);

    const escapeAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('(前提)確認ポップアップが出ている', (await permState(ctx)).hidden, false);
    overlayOf(ctx).sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    overlayOf(ctx).sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    check('Escapeもブロック扱いで返事を返す', await answered(escapeAsk), false);
    await sleep(400);
    check('Escapeでポップアップが閉じる', (await permState(ctx)).hidden, true);

    const replacedAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('(前提)確認ポップアップが出ている', (await permState(ctx)).hidden, false);
    await clickSelector(uiWc, '#workspace-btn'); // プロファイルメニューを開く
    check('別のメニューに置き換わってもブロックで返す', await answered(replacedAsk), false);
    await sleep(400);
    const replaced = await permState(ctx);
    check('置き換わった後は確認ポップアップが消える', replaced.hidden, true);
    check('置き換えたメニューの方は開いたまま', await js(overlayOf(ctx), `!document.getElementById('menu').classList.contains('hidden')`), true);
    clickAt(overlayOf(ctx), 10, winH - 10); // プロファイルメニューを閉じる
    await sleep(400);

    // 3-c) 縦タブ(タブバーが左)でもアンカーの真下に出る。
    //     アンカーはウィンドウ座標で届き、オーバーレイは左へ chromeLeft ぶんずれているので、
    //     その補正が抜けているとここだけ 220px 右にずれる(横タブでは差が出ない)
    const tabBarBundle = browser.bundleFor(ctx.profileId);
    tabBarBundle.settings.data.tabBarPosition = 'left';
    tabBarBundle.settings.save();
    browser.sendSettingsFor(ctx.profileId); // クロームUI側(#toolbar が右へずれる)
    browser.applyTabBarPositionFor(ctx.profileId); // メイン側(chromeLeft)
    await sleep(1000);
    check('(前提)縦タブではオーバーレイが右へずれる', ctx.tabManager.chromeLeft, 220);
    const verticalAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(1000);
    const vertical = await permState(ctx);
    const vIconLeft = await js(uiWc, `Math.round(document.getElementById('address-icon').getBoundingClientRect().left)`);
    checkThat(
      '縦タブでもサイト情報アイコンの直下に出る',
      Math.abs(vertical.left - (vIconLeft - ctx.tabManager.chromeLeft)) <= 1,
      { popup: vertical.left, icon: vIconLeft, chromeLeft: ctx.tabManager.chromeLeft }
    );
    checkThat('3択に増えてもページ領域に収まる', vertical.bottom <= vertical.winH, vertical);
    await clickSelector(overlayOf(ctx), '#perm-block');
    await answered(verticalAsk);
    tabBarBundle.settings.data.tabBarPosition = 'top';
    tabBarBundle.settings.save();
    browser.sendSettingsFor(ctx.profileId);
    browser.applyTabBarPositionFor(ctx.profileId);
    await sleep(800);

    // 4) 見えていないタブからの要求は尋ねずに拒否する
    const background = ctx.tabManager.createTab(`http://192.0.2.1:${PORT}/`, { background: true });
    check('裏のタブからの要求は尋ねずに拒否', await ask(background.view.webContents, 'fullscreen', `http://192.0.2.1:${PORT}/`), false);
    check('裏のタブでは確認ポップアップも出さない', (await permState(ctx)).hidden, true);

    // 5) 返事の前にページを移動したら取り下げる(ポップアップも閉じる)
    const pendingAsk = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(800);
    check('(前提)確認ポップアップが出ている', (await permState(ctx)).hidden, false);
    otherWc.loadURL(`http://localhost:${PORT}/?moved`);
    check('ページを移動したら要求を取り下げる', await pendingAsk, false);
    await sleep(400);
    check('取り下げたら確認ポップアップも閉じる', (await permState(ctx)).hidden, true);
    check('取り下げたらオーバーレイも畳む', ctx.tabManager.overlayVisible, false);
    await sleep(600);

    // 6) カメラとマイクは別々に覚える(media の要求は種類に分けて尋ねる)。
    //    要求元のタブが見えていないと尋ねずに拒否されるので、127.0.0.1 のタブへ戻してから
    const otherTabId = ctx.tabManager.activeTabId;
    ctx.tabManager.switchTab(tab.id);
    await sleep(600);
    const camAsk = ask(wc, 'media', url, { mediaTypes: ['video'] });
    await sleep(800);
    await checkPrompt('カメラだけを尋ねる', ctx, [{ kind: 'camera', label: 'カメラを使用する' }]);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    check('カメラの要求が通る', await camAsk, true);
    check('カメラを記憶する', grants().camera, ['127.0.0.1']);
    check('カメラを許可してもマイクは許可しない', grants().microphone, []);

    // 6-b) 通しの確認: ページ自身の getUserMedia でも、数秒待たせてから「許可」でカメラが開く。
    //      (要求を保留している間にデバイスの取得が落ちないことを見る。マイクが無い実機でも
    //       カメラがあれば確かめられる)
    if (await js(wc, 'window.hasCamera()')) {
      browser.bundleFor(ctx.profileId).settings.data.sitePermissions.camera = [];
      const liveCam = js(wc, 'window.askCamera()');
      await sleep(1400);
      await checkPrompt('ページからのカメラ要求でもポップアップが出る', ctx, [
        { kind: 'camera', label: 'カメラを使用する' },
      ]);
      await clickSelector(overlayOf(ctx), '#perm-allow');
      check('数秒待たせてから許可してもカメラが開く', await answered(liveCam, 12000), 'ok');
      check('通しでもカメラを記憶する', grants().camera, ['127.0.0.1']);
    } else {
      console.log('   (カメラの無い環境なので、ページからの通しは省略)');
    }

    const bothAsk = ask(wc, 'media', url, { mediaTypes: ['video', 'audio'] });
    await sleep(800);
    await checkPrompt('カメラ済みなら残りのマイクだけ尋ねる', ctx, [
      { kind: 'microphone', label: 'マイクを使用する' },
    ]);
    await clickSelector(overlayOf(ctx), '#perm-block');
    check('片方をブロックすると要求全体が通らない', await bothAsk, false);
    check('ブロックしたマイクは記憶しない', grants().microphone, []);

    // 種類が空で届くことがある(実測)。その場合はカメラ・マイクの両方として尋ねる
    ctx.tabManager.switchTab(otherTabId); // localhost のタブへ戻す
    await sleep(600);
    const vagueAsk = ask(otherWc, 'media', otherUrl, {});
    await sleep(800);
    await checkPrompt('種類が空の media は両方を尋ねる', ctx, [
      { kind: 'camera', label: 'カメラを使用する' },
      { kind: 'microphone', label: 'マイクを使用する' },
    ]);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    check('まとめて許可すると要求が通る', await vagueAsk, true);
    check(
      '両方まとめて記憶する',
      [grants().camera, grants().microphone],
      [['127.0.0.1', 'localhost'], ['localhost']]
    );

    // 7) 「今回だけ許可」: 保存せず、そのタブがサイトを離れたら失効する
    const onceAsk = ask(otherWc, 'geolocation', otherUrl);
    await sleep(800);
    await checkPrompt('現在地も尋ねる', ctx, [{ kind: 'geolocation', label: '現在地を知る' }]);
    await clickSelector(overlayOf(ctx), '#perm-once');
    check('「今回だけ許可」で要求が通る', await onceAsk, true);
    check('「今回だけ許可」は保存しない', grants().geolocation, []);
    check('同じタブの同じサイトでは尋ねずに通す', await ask(otherWc, 'geolocation', otherUrl), true);
    check('尋ねていないので確認ポップアップも出ない', (await permState(ctx)).hidden, true);

    await navigate(otherWc, `http://localhost:${PORT}/?same-site`);
    check('同じサイト内の移動では効いたまま', await ask(otherWc, 'geolocation', otherUrl), true);

    await navigate(otherWc, `http://127.0.0.1:${PORT}/?left-site`);
    const expiredAsk = ask(otherWc, 'geolocation', otherUrl);
    await sleep(900);
    check('別のサイトへ移ると失効してまた尋ねる', (await permState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#perm-block');
    check('失効後の要求は素通ししない', await answered(expiredAsk), false);
    await navigate(otherWc, otherUrl);

    // 8) 同時に来た要求は順番待ちにする(2件目が黙って消えない)
    const queued1 = ask(otherWc, 'notifications', otherUrl);
    const queued2 = ask(otherWc, 'fullscreen', otherUrl);
    await sleep(900);
    await checkPrompt('先の要求だけを出す', ctx, [{ kind: 'notifications', label: '通知を送信する' }]);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    check('先の要求が通る', await answered(queued1), true);
    await sleep(900);
    await checkPrompt('返事の後で次の要求を出す', ctx, [{ kind: 'fullscreen', label: '全画面表示にする' }]);
    await clickSelector(overlayOf(ctx), '#perm-block');
    check('後の要求にも返事が返る', await answered(queued2), false);
    check('許可したのは先の要求だけ', [grants().notifications, fsSites()], [['localhost'], ['127.0.0.1']]);

    // 9) ページ自身が求める経路の通し(通知と現在地はこの環境でも実際に要求が飛ぶ)
    await navigate(otherWc, `http://localhost:${PORT}/?live-ask`);
    browser.bundleFor(ctx.profileId).settings.data.sitePermissions.notifications = [];
    const liveNotify = js(otherWc, 'window.askNotify()');
    await sleep(1200);
    await checkPrompt('ページからの通知の要求でもポップアップが出る', ctx, [
      { kind: 'notifications', label: '通知を送信する' },
    ]);
    await clickSelector(overlayOf(ctx), '#perm-block');
    check('ブロックするとページ側も denied になる', await answered(liveNotify, 6000), 'denied');

    const liveGeo = js(otherWc, 'window.askGeo()');
    await sleep(1200);
    await checkPrompt('ページからの現在地の要求でもポップアップが出る', ctx, [
      { kind: 'geolocation', label: '現在地を知る' },
    ]);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    check('許可した現在地を記憶する', grants().geolocation, ['localhost']);
    await answered(liveGeo, 9000); // 実際の測位はこの環境では失敗する(位置情報サービスなし)

    // 10) シークレットの許可はディスクへ書かない(そのウィンドウのセッション限り)
    const inc = browser.createWindow({ incognito: true });
    await sleep(2500);
    const incUrl = `http://localhost:${PORT}/`; // 通常ウィンドウでは全画面表示を許可していないホスト
    const incTab = await loadTab(inc.tabManager, incUrl);
    const incAsk = ask(incTab.view.webContents, 'fullscreen', incUrl);
    await sleep(800);
    check('シークレットでも尋ねる', (await permState(inc)).hidden, false);
    await clickSelector(overlayOf(inc), '#perm-allow');
    check('シークレットでも「許可」は通る', await incAsk, true);
    check('シークレットの許可は保存しない', fsSites(), ['127.0.0.1']);
    check('シークレットのウィンドウでは許可済み扱い', inc.tabManager.isFullscreenGranted(incUrl), true);
    check('通常ウィンドウへは持ち込まない', ctx.tabManager.isFullscreenGranted(incUrl), false);
    inc.window.close();
    await sleep(800);

    // 閉じたらシークレットのセッションごと消える。次に開いたシークレットへ許可を残さない
    const inc2 = browser.createWindow({ incognito: true });
    await sleep(2500);
    const inc2Tab = await loadTab(inc2.tabManager, incUrl);
    const inc2Ask = ask(inc2Tab.view.webContents, 'fullscreen', incUrl);
    await sleep(900);
    check('次に開いたシークレットでは改めて尋ねる', (await permState(inc2)).hidden, false);
    await clickSelector(overlayOf(inc2), '#perm-block');
    check('前のシークレットの許可は引き継がない', await answered(inc2Ask), false);
    inc2.window.close();
    await sleep(500);

    // 11) 通しの確認: ページ自身の requestFullscreen → ポップアップ → 「許可」で実際に全画面になる
    const liveUrl = `http://127.0.0.1:${PORT}/?live`;
    browser.bundleFor(ctx.profileId).settings.data.sitePermissions.fullscreen = [];
    const liveTab = await loadTab(ctx.tabManager, liveUrl);
    js(liveTab.view.webContents, `window.goFullscreen()`).catch(() => {});
    await sleep(1400);
    check('ページからの要求でも確認ポップアップが出る', (await permState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    await sleep(2000);
    check('「許可」を押すと実際に全画面になる', ctx.tabManager.htmlFullscreenTabId, liveTab.id);
    check('通しでもサイトを記憶する', fsSites(), ['127.0.0.1']);
    await shot(uiWc, 'site-permission-fullscreen.png');

    // 12) 全画面表示中に許可を取り消しても、表示中の全画面は途中で壊れない
    //     (ページ側とウィンドウ側の全画面状態が食い違うと、戻る手段が無くなる)
    const bundle = browser.bundleFor(ctx.profileId);
    bundle.settings.data.sitePermissions.fullscreen = [];
    bundle.settings.save();
    browser.sendSettingsFor(ctx.profileId);
    await sleep(800);
    check('取り消しても表示中の全画面は続く', ctx.tabManager.htmlFullscreenTabId, liveTab.id);
    check('ページ側とウィンドウ側の状態が食い違わない', ctx.window.isFullScreen(), true);
    // 全画面から抜ける。この環境では document.exitFullscreen() の反映が不安定なため、
    // 確実に抜けられるタブ切り替え(全画面中に切り替えると抜ける仕様)で戻す
    ctx.tabManager.createTab('roopie://newtab');
    await sleep(1500);
    check('抜けたあとは通常表示に戻る', ctx.tabManager.htmlFullscreenTabId, null);
    ctx.tabManager.switchTab(liveTab.id);
    await sleep(800);
    const afterRevoke = ask(liveTab.view.webContents, 'fullscreen', liveUrl);
    await sleep(800);
    check('取り消した後はまた尋ねる', (await permState(ctx)).hidden, false);
    await clickSelector(overlayOf(ctx), '#perm-allow');
    await afterRevoke;

    // 13) 設定画面(サイトの権限)から種類ごとに取り消せる
    const settingsTab = await loadTab(ctx.tabManager, 'roopie://settings');
    const settingsWc = settingsTab.view.webContents;
    await sleep(1500);
    const kinds = await js(
      settingsWc,
      `[...document.querySelectorAll('#permission-kinds .perm-kind')].map((el) => el.dataset.kind)`
    );
    check('5種類ぶんの一覧が並ぶ', kinds, ['camera', 'microphone', 'geolocation', 'notifications', 'fullscreen']);
    const listedFs = await js(
      settingsWc,
      `[...document.querySelectorAll('#permission-kinds .perm-kind[data-kind="fullscreen"] .row .title')].map((n) => n.textContent)`
    );
    check('設定画面に許可済みサイトが並ぶ', listedFs, ['127.0.0.1']);
    const listedCam = await js(
      settingsWc,
      `[...document.querySelectorAll('#permission-kinds .perm-kind[data-kind="camera"] .row .title')].map((n) => n.textContent)`
    );
    check('カメラの許可も種類ごとに並ぶ', listedCam, ['127.0.0.1', 'localhost']);
    const heading = await js(
      settingsWc,
      `(() => {
         const el = document.querySelector('#permission-kinds .perm-kind[data-kind="camera"] .perm-kind-name');
         const cs = getComputedStyle(el);
         return { text: el.textContent, weight: Number(cs.fontWeight), size: cs.fontSize };
       })()`
    );
    check('種類の見出しに件数を出す', heading.text, 'カメラ(2)');
    checkThat('見出しのCSSが当たっている(太字)', heading.weight >= 600, heading);
    // タブのViewには sendInputEvent が届かないため、ここはDOMのclickで押す
    await js(
      settingsWc,
      `document.querySelector('#permission-kinds .perm-kind[data-kind="fullscreen"] .row .row-btn').click()`
    );
    await sleep(800);
    check('設定画面から取り消せる', fsSites(), []);
    check('取り消すと未許可に戻る', ctx.tabManager.isFullscreenGranted(liveUrl), false);
    check('ほかの種類は残る', grants().camera, ['127.0.0.1', 'localhost']);

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
