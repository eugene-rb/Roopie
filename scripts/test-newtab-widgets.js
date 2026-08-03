// スタート画面ウィジェット・グリッドサイズ設定のE2E検証(再利用可能)。
// 実行: npx electron scripts/test-newtab-widgets.js
// src/renderer/pages を静的配信し、stub-internal-preload.js で roopieInternal を差し替えて
// newtab.html を実際に描画。追加メニュー→各ウィジェットの描画・設定・自動保存、
// および設定画面のグリッド列数・行数のライブ反映を検証する。
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'src', 'renderer', 'pages');
const PORT = 8933;

// 第1引数にディレクトリを渡すと、検証は行わず「見た目の確認用スクショ」だけを撮って終わる。
// 非表示ウィンドウは合成が進まず capturePage に前のフレームが写るため、撮るときだけ実表示で起動する
// (実表示ではアニメーションの進み方が変わり切り替え系の検証が落ちるので兼用しない。
//  disableHardwareAcceleration を足すと逆に capturePage が UnknownVizError になるので付けない)
const SHOT_DIR = process.argv[2] || null;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      const file = path.join(PAGES_DIR, path.basename(new URL(req.url, 'http://x').pathname) || 'newtab.html');
      try {
        const body = fs.readFileSync(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'text/plain' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })
    .listen(PORT);

  const win = new BrowserWindow({
    show: !!SHOT_DIR,
    width: 1000,
    height: 800,
    webPreferences: { preload: path.join(__dirname, 'stub-internal-preload.js') },
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  // ショートカット/ウィジェットの追加は右クリックメニューから(アイコンは無い)。
  // #clockは常に存在し、既存アイテム/検索欄/他のポップアップのどれにも該当しない安全な右クリック先
  const rightClickToAdd = () =>
    js(
      `document.getElementById('clock').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }))`
    );
  await win.loadURL(`http://localhost:${PORT}/newtab.html`);
  await sleep(400);

  // スクショモード: フォルダの展開表示とタイルだけを撮って終わる。
  // 2枚目以降は前のフレームが写ることがあるため、見せたい絵(展開表示)から先に撮る
  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    // 起動直後は合成器がまだ用意できておらず capturePage が UnknownVizError で落ちるので、
    // 撮れるまで少し待ちながら試す
    const capture = async (name) => {
      const file = path.join(SHOT_DIR, name);
      for (let i = 0; i < 20; i++) {
        try {
          fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
          console.log(`スクショ: ${file}`);
          return;
        } catch {
          await sleep(500);
        }
      }
      console.log(`スクショ失敗: ${file}`);
    };
    await js(`window.roopieInternal.__setShortcuts('shots', [
      { id: 'i1', type: 'bookmark', title: 'Gmail', url: 'https://mail.google.com', favicon: null, icon: { type: 'emoji', value: '✉️' } },
      { id: 'i2', type: 'bookmark', title: 'カレンダー', url: 'https://calendar.google.com', favicon: null, icon: { type: 'emoji', value: '📅' } },
      { id: 'i3', type: 'bookmark', title: 'Drive', url: 'https://drive.google.com', favicon: null, icon: { type: 'emoji', value: '📁' } },
      { id: 'i4', type: 'bookmark', title: 'Keep', url: 'https://keep.google.com', favicon: null, icon: { type: 'emoji', value: '📝' } },
      { id: 'i5', type: 'bookmark', title: 'Maps', url: 'https://maps.google.com', favicon: null, icon: { type: 'emoji', value: '🗺️' } },
      { id: 'i6', type: 'bookmark', title: 'Photos', url: 'https://photos.google.com', favicon: null, icon: null },
    ])`);
    await js(`window.roopieInternal.__setShortcuts('p1', [
      { id: 's1', type: 'bookmark', title: 'YouTube', url: 'https://youtube.com', favicon: null, icon: { type: 'emoji', value: '📺' } },
      { id: 's2', type: 'bookmark', title: 'X', url: 'https://x.com', favicon: null, icon: null },
      { id: 'shots', type: 'folder', title: 'Google' },
      { id: 's3', type: 'bookmark', title: 'ニコニコ', url: 'https://nicovideo.jp', favicon: null, icon: null },
    ])`);
    await sleep(800);
    await js(`document.querySelector('[data-grid-key="s:shots"]').click()`);
    await sleep(1200); // 開くアニメーション+背景ぼかしの描画が終わるまで待つ(合成が済む前に撮ると前の絵が写る)
    console.log(`フォルダ展開: ${await js(`!!document.querySelector('.folder-view')`)}`);
    await capture('folder-view.png');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(600);
    await capture('start-page.png');
    server.close();
    app.exit(0);
    return;
  }

  // 初期状態: ショートカット1件
  check('グリッドにショートカット', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 1);

  // 追加メニュー(右クリック): ショートカット+4ウィジェット
  await rightClickToAdd();
  await sleep(100);
  check('追加メニューの項目数(ショートカット/フォルダ+4ウィジェット)', await js(`document.querySelectorAll('.grid-popup-item').length`), 6);

  // 天気を追加 → 場所検索UI → 候補選択 → 天気表示
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('天気')).click()`);
  await sleep(300);
  check('天気ウィジェット追加', await js(`!!document.querySelector('.widget-weather')`), true);
  check('場所検索UIが出る', await js(`!!document.querySelector('.widget-weather .widget-input')`), true);
  await js(`(() => { const w = document.querySelector('.widget-weather'); w.querySelector('.widget-input').value = '東京'; [...w.querySelectorAll('.widget-btn')].find((b) => b.textContent === '検索').click(); })()`);
  await sleep(250);
  await js(`document.querySelector('.widget-weather .widget-setup-result').click()`);
  await sleep(300);
  check('現在気温が表示される', await js(`document.querySelector('.widget-weather .weather-temp')?.textContent`), '28°');
  check('3日分の予報', await js(`document.querySelectorAll('.widget-weather .weather-day').length`), 3);
  check('タイトルが地名になる', await js(`document.querySelector('.widget-weather .widget-title')?.textContent`), '東京');

  // ノートパッド: 入力→自動保存(デバウンス500ms)
  await rightClickToAdd();
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('ノート')).click()`);
  await sleep(300);
  check('ノートパッド追加', await js(`!!document.querySelector('.notepad-textarea')`), true);
  await js(`(() => { const t = document.querySelector('.notepad-textarea'); t.value = 'テストメモ'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(700);
  const noteSaved = await js(`window.roopieInternal.__stubState().configCalls.some((c) => c.patch.text === 'テストメモ')`);
  check('ノートの自動保存', noteSaved, true);

  // カレンダー: 今日の強調と月送り
  await rightClickToAdd();
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('カレンダー')).click()`);
  await sleep(300);
  check('カレンダー追加', await js(`!!document.querySelector('.widget-calendar .cal-grid')`), true);
  check('今日が強調される', await js(`document.querySelector('.widget-calendar .cal-day.today')?.textContent`), String(new Date().getDate()));
  const monthLabel = await js(`document.querySelector('.widget-calendar .cal-head span').textContent`);
  await js(`[...document.querySelectorAll('.widget-calendar .cal-nav')].at(-1).click()`);
  await sleep(100);
  const nextLabel = await js(`document.querySelector('.widget-calendar .cal-head span').textContent`);
  check('月送りで表示が変わる', monthLabel !== nextLabel, true);

  // ニュース: プリセット追加→表示→フェイクRSSの記事(新しい順)
  await rightClickToAdd();
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('ニュース')).click()`);
  await sleep(300);
  check('ニュース追加(設定UI)', await js(`!!document.querySelector('.widget-news .widget-setup')`), true);
  check('フィードが無いうちは「表示する」を押せない', await js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.startsWith('表示する')).disabled`), true);

  const pickPreset = (label) =>
    js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
  await pickPreset('NHK');
  await sleep(100);
  check('追加したフィードが一覧に出る', await js(`document.querySelectorAll('.widget-news .widget-feed-row').length`), 1);
  check('一覧はURLでなく名前で表示される', await js(`document.querySelector('.widget-news .widget-feed-row span').textContent`), 'NHKニュース');
  check(
    '追加済みの定番ボタンは押せなくなる(✓表示)',
    await js(`(() => { const b = [...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.includes('NHK')); return b.disabled && b.textContent.startsWith('✓'); })()`),
    true
  );

  // 一覧が潰れずに見えていること(以前は他の要素にflex-shrinkで押し潰され高さ数pxだった)
  const listVisible = await js(`(() => {
    const list = document.querySelector('.widget-news .widget-setup-results').getBoundingClientRect();
    const row = document.querySelector('.widget-news .widget-feed-row').getBoundingClientRect();
    return { listH: list.height, rowH: row.height };
  })()`);
  check('フィード一覧が行の高さぶん確保される', listVisible.listH >= listVisible.rowH && listVisible.rowH > 8, true);

  // 入りきらない中身は .widget-setup ごとスクロールして全部見られる
  const scrollInfo = await js(`(() => {
    const setup = document.querySelector('.widget-news .widget-setup');
    setup.scrollTop = setup.scrollHeight;
    const done = [...setup.querySelectorAll('.widget-btn')].find((b) => b.textContent.startsWith('表示する'));
    const sr = setup.getBoundingClientRect();
    const dr = done.getBoundingClientRect();
    return { scrollable: setup.scrollHeight > setup.clientHeight, scrolled: setup.scrollTop > 0, doneInside: dr.bottom <= sr.bottom + 0.5 && dr.top >= sr.top - 0.5 };
  })()`);
  check('設定UIがスクロールできる', scrollInfo.scrollable && scrollInfo.scrolled, true);
  check('最後までスクロールすると「表示する」が見える', scrollInfo.doneInside, true);
  await js(`document.querySelector('.widget-news .widget-setup').scrollTop = 0`);

  // 重複・不正URLは黙って無視せず理由を出す
  const typeAndAdd = (value) =>
    js(`(() => { const w = document.querySelector('.widget-news'); w.querySelector('.widget-input').value = ${JSON.stringify(value)}; [...w.querySelectorAll('.widget-btn')].find((b) => b.textContent === '追加').click(); })()`);
  await typeAndAdd('nhk.or.jp/rss');
  await sleep(80);
  check('URL形式が不正なときはエラーを表示', await js(`!!document.querySelector('.widget-news .widget-setup-error')`), true);
  await typeAndAdd('https://www.nhk.or.jp/rss/news/cat0.xml');
  await sleep(80);
  check('重複追加は増やさない', await js(`document.querySelectorAll('.widget-news .widget-feed-row').length`), 1);
  check('重複追加のときもエラーを表示', await js(`document.querySelector('.widget-news .widget-setup-error')?.textContent`), 'そのフィードは追加済みです');

  // ✕で削除するとプルダウンに戻る
  await pickPreset('CNN');
  await sleep(80);
  check('2件目を追加できる', await js(`document.querySelectorAll('.widget-news .widget-feed-row').length`), 2);
  await js(`[...document.querySelectorAll('.widget-news .widget-feed-row')].at(-1).querySelector('.widget-btn').click()`);
  await sleep(80);
  check('✕でフィードを削除できる', await js(`document.querySelectorAll('.widget-news .widget-feed-row').length`), 1);
  check(
    '削除した定番のボタンはまた押せるようになる',
    await js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.includes('CNN')).disabled`),
    false
  );

  await js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.startsWith('表示する')).click()`);
  await sleep(300);
  check('記事が表示される', await js(`document.querySelectorAll('.widget-news .news-item').length`), 2);
  check('新しい記事が先頭', await js(`document.querySelector('.widget-news .news-item')?.textContent`), '記事2のタイトル');

  // ウィジェットメニューから削除
  await js(`document.querySelector('.widget-calendar .widget-menu-btn').click()`);
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('削除')).click()`);
  await sleep(300);
  check('カレンダー削除', await js(`!!document.querySelector('.widget-calendar')`), false);

  // グリッド全体: ショートカット1 + 天気 + ノート + ニュース = 4
  check('最終的なグリッド項目数', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 4);

  // ---- グリッドのアイコンサイズ設定(手動設定は最大サイズのみ。列数・行数はウィンドウの
  // 大きさから自動計算し、アイコン自体の大きさはウィンドウをリサイズしても変わらない) ----
  const gridVar = (name) => js(`getComputedStyle(document.getElementById('quick-links')).getPropertyValue('${name}').trim()`);

  const defaultCell = parseFloat(await gridVar('--cell'));
  check('既定のアイコンサイズ(96px)がそのままセルサイズになる', defaultCell, 96);
  const defaultCols = Number(await gridVar('--grid-cols'));
  check('既定の列数が正の整数', Number.isInteger(defaultCols) && defaultCols > 0, true);

  // グリッド全体の横幅は「700pxとウィンドウ幅の小さいほう」に収まる(この幅に入る列数を計算しているため)
  const gridWidth = await js(`document.getElementById('quick-links').getBoundingClientRect().width`);
  const gridInnerW = await js(`window.innerWidth`);
  const gridTargetW = Math.min(700, gridInnerW - 48);
  check('グリッド全体の横幅が目安幅(min(700px, ウィンドウ幅-48))以下', gridWidth <= gridTargetW, true);
  check('グリッドが目安幅を概ね使い切る(1セル分以上余らせない)', gridWidth > gridTargetW - (96 + 14), true);

  // アイコンサイズを最大(160px)に変更 → セルサイズはウィンドウ幅に関係なくそのまま反映され、
  // 同じ横幅に収まる列数はアイコンが大きくなった分だけ減る
  await js(`window.roopieInternal.__setSettings({ startIconSize: 160 })`);
  await sleep(150);
  check('アイコンサイズの変更がそのままセルサイズに反映される', parseFloat(await gridVar('--cell')), 160);
  const bigCols = Number(await gridVar('--grid-cols'));
  check('アイコンが大きくなると列数は減る', bigCols < defaultCols, true);

  // アイコンを大きくした狭い画面でも時計が画面外にはみ出ない(行数縮小→--newtab-shift緩和の安全弁)
  const clockTop = await js(`document.getElementById('clock').getBoundingClientRect().top`);
  check('時計が画面上端で欠けない', clockTop >= 0, true);

  // 設定を既定(96px)に戻す
  await js(`window.roopieInternal.__setSettings({ startIconSize: 96 })`);
  await sleep(150);
  check('アイコンサイズを戻すとセルサイズも既定に戻る', parseFloat(await gridVar('--cell')), 96);

  // ---- ページのスワイプ切り替え(トラックパッド横スワイプ/タッチ。stubは2ページ p1/p2 を用意) ----
  check('スワイプ前はp1のグリッド(4件)', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 4);

  // トラックパッドの横スワイプ(precisionタッチパッドはwheelイベントのdeltaXとして届く)→ 次ページ(p2)
  await js(`document.getElementById('quick-links').dispatchEvent(
    new WheelEvent('wheel', { deltaX: 80, deltaY: 0, bubbles: true, cancelable: true })
  )`);
  await sleep(500);
  check('スワイプでp2に切り替わる(1件)', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 1);
  check('p2のショートカット名が表示される', await js(`document.querySelector('#quick-links .grid-item .label')?.textContent`), 'Second');
  check('ページタブのactiveがp2になる', await js(`document.querySelectorAll('.page-tab')[1]?.classList.contains('active')`), true);

  // タッチスワイプ(右方向=前のページ)→ p1に戻る
  await js(`(() => {
    const el = document.getElementById('quick-links');
    const rect = el.getBoundingClientRect();
    const start = new Touch({ identifier: 1, target: el, clientX: rect.left + 200, clientY: rect.top + 40 });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [start], changedTouches: [start], bubbles: true, cancelable: true }));
    const end = new Touch({ identifier: 1, target: el, clientX: rect.left + 320, clientY: rect.top + 40 });
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [end], bubbles: true, cancelable: true }));
  })()`);
  await sleep(500);
  check('タッチスワイプでp1に戻る(4件)', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 4);
  check('ページタブのactiveがp1になる', await js(`document.querySelectorAll('.page-tab')[0]?.classList.contains('active')`), true);

  // 切り替えアニメーションの後始末(フェードアウトを fill:'forwards' のまま残すと、
  // 切り替えるたびにグリッドが透明・ずれたままになり「切り替わらない」ように見える)
  const afterSwitch = await js(`(() => {
    const s = getComputedStyle(document.getElementById('quick-links'));
    return { opacity: Number(s.opacity), transform: s.transform };
  })()`);
  check('切り替え後もグリッドが見えている', afterSwitch.opacity, 1);
  check('切り替え後に位置が元へ戻る', ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(afterSwitch.transform), true);

  // ---- ページ名の表示・クリック切り替え・改名・削除 ----
  const pageNames = () => js(`[...document.querySelectorAll('.page-tab:not(.page-tab-add)')].map((b) => b.textContent)`);
  check('ページ名が並んで表示される', await pageNames(), ['ページ1', 'ページ2']);
  check('現在のページのタブがactive', await js(`document.querySelector('.page-tab.active')?.textContent`), 'ページ1');

  // 名前をクリックして切り替え(マウスだけでも切り替えられること)
  await js(`[...document.querySelectorAll('.page-tab')].find((b) => b.textContent === 'ページ2').click()`);
  await sleep(500);
  check('ページ名のクリックでp2へ切り替わる(1件)', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 1);
  check('activeがページ2に移る', await js(`document.querySelector('.page-tab.active')?.textContent`), 'ページ2');
  check(
    'クリック切り替えでもグリッドが見えている',
    await js(`Number(getComputedStyle(document.getElementById('quick-links')).opacity)`),
    1
  );

  // ダブルクリックでその場改名(Enterで確定)
  await js(`(() => {
    const tab = document.querySelector('.page-tab.active');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const input = tab.querySelector('input');
    input.value = '仕事';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(200);
  check('ダブルクリックで名前を変更できる', await js(`document.querySelector('.page-tab.active')?.textContent`), '仕事');
  check('変更した名前が保存される', await pageNames(), ['ページ1', '仕事']);

  // 右クリックメニュー → 削除(確認をもう一段挟む)
  await js(
    `document.querySelector('.page-tab.active').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`
  );
  await sleep(100);
  check('ページの右クリックメニューは2項目(改名/削除)', await js(`document.querySelectorAll('.grid-popup-item').length`), 2);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('削除')).click()`);
  await sleep(100);
  check('削除は確認をもう一段挟む', await js(`document.querySelector('.grid-popup-item')?.textContent.includes('中身ごと削除')`), true);
  await js(`document.querySelector('.grid-popup-item').click()`);
  await sleep(500);
  check('ページを削除すると残りのページだけになる', await pageNames(), ['ページ1']);
  check('削除後は残ったページの中身を表示する(4件)', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 4);

  // 最後の1ページは削除させない
  await js(
    `document.querySelector('.page-tab:not(.page-tab-add)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`
  );
  await sleep(100);
  check(
    '最後の1ページは削除できない',
    await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('削除'))?.disabled`),
    true
  );
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); // メニューを閉じる
  await sleep(100);

  // ---- 右クリックの除外(既存アイテム/検索欄の上では追加メニューを出さない) ----
  await js(
    `document.querySelector('[data-grid-key^="s:"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`
  );
  await sleep(100);
  check('既存アイテムの上での右クリックでは追加メニューが出ない', await js(`!!document.querySelector('.grid-popup')`), false);

  await js(
    `document.getElementById('search').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`
  );
  await sleep(100);
  check('検索欄の上での右クリックでは追加メニューが出ない', await js(`!!document.querySelector('.grid-popup')`), false);

  // ---- ドラッグでの並べ替え(座標モデル。グリッド線プレビュー・入れ替え・自動上詰めなしを検証) ----
  const DRAG_GAP = 14; // newtab.js の GRID_GAP と同じ値
  function parseSpan(str) {
    const parts = str.split(' '); // "X / span W"
    return { start: Number(parts[0]) - 1, span: Number(parts[3]) };
  }
  async function posOf(selector) {
    const [col, row] = await js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}).closest('.grid-item'); return [el.style.gridColumn, el.style.gridRow]; })()`
    );
    const c = parseSpan(col);
    const r = parseSpan(row);
    return { x: c.start, y: r.start, w: c.span, h: r.span };
  }
  async function centerOf(selector) {
    return js(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
    );
  }
  async function firePointer(selector, type, pointerId, x, y) {
    await js(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { pointerId: ${pointerId}, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, button: 0 }))`
    );
  }
  async function allItemRects() {
    const raw = await js(
      `[...document.querySelectorAll('#quick-links .grid-item')].map((el) => [el.dataset.gridKey, el.style.gridColumn, el.style.gridRow])`
    );
    return raw.map(([key, col, row]) => {
      const c = parseSpan(col);
      const r = parseSpan(row);
      return { key, x: c.start, y: r.start, w: c.span, h: r.span };
    });
  }
  function findFreeCell(items, cols, excludeKey, avoidX, avoidY) {
    const occupied = new Set();
    for (const it of items) {
      if (it.key === excludeKey) continue;
      for (let dy = 0; dy < it.h; dy++) for (let dx = 0; dx < it.w; dx++) occupied.add(`${it.x + dx},${it.y + dy}`);
    }
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < cols; x++) {
        if (x === avoidX && y === avoidY) continue;
        if (!occupied.has(`${x},${y}`)) return { x, y };
      }
    }
    return null;
  }

  // 1) Example(1x1のショートカット)を空きセルへドラッグ。オーバーレイのグリッド線+プレビューを確認
  const cols = Number(await gridVar('--grid-cols'));
  const cellPx1 = parseFloat(await gridVar('--cell'));
  const step1 = cellPx1 + DRAG_GAP;
  const exampleKey = await js(`document.querySelector('[data-grid-key^="s:"]').dataset.gridKey`);
  const examplePos = await posOf(`[data-grid-key="${exampleKey}"]`);
  const freeSpot = findFreeCell(await allItemRects(), cols, exampleKey, examplePos.x, examplePos.y);
  const c1 = await centerOf(`[data-grid-key="${exampleKey}"]`);
  const d1x = (freeSpot.x - examplePos.x) * step1;
  const d1y = (freeSpot.y - examplePos.y) * step1;

  await firePointer(`[data-grid-key="${exampleKey}"]`, 'pointerdown', 1, c1.x, c1.y);
  await firePointer(`[data-grid-key="${exampleKey}"]`, 'pointermove', 1, c1.x + d1x, c1.y + d1y);
  await sleep(50);
  check('ドラッグ中はグリッド線オーバーレイが表示される', await js(`document.querySelectorAll('.grid-overlay-cell').length > 0`), true);
  check('ドラッグ中はドロップ先プレビューが有効(緑)表示になる', await js(`document.querySelector('.grid-overlay-preview')?.classList.contains('valid')`), true);
  await firePointer(`[data-grid-key="${exampleKey}"]`, 'pointerup', 1, c1.x + d1x, c1.y + d1y);
  await sleep(200);
  check('ドラッグ後はオーバーレイが消える', await js(`!document.querySelector('.grid-overlay')`), true);
  const examplePosAfter = await posOf(`[data-grid-key="${exampleKey}"]`);
  check('ドラッグで空きセルに移動できる', examplePosAfter.x === freeSpot.x && examplePosAfter.y === freeSpot.y, true);

  // 2) 同じ大きさ(2x2)のウィジェット同士(天気/ノート)をドラッグすると入れ替わる
  const weatherPos = await posOf('.widget-weather');
  const notepadPos = await posOf('.widget-notepad');
  const cellPx2 = parseFloat(await gridVar('--cell'));
  const step2 = cellPx2 + DRAG_GAP;
  const d2x = (notepadPos.x - weatherPos.x) * step2;
  const d2y = (notepadPos.y - weatherPos.y) * step2;
  const c2 = await centerOf('.widget-weather .widget-head');

  await firePointer('.widget-weather .widget-head', 'pointerdown', 2, c2.x, c2.y);
  await firePointer('.widget-weather .widget-head', 'pointermove', 2, c2.x + d2x, c2.y + d2y);
  await sleep(50);
  check('同サイズと重なるとプレビューが黄色(入れ替え)表示になる', await js(`document.querySelector('.grid-overlay-preview')?.classList.contains('swap')`), true);
  await firePointer('.widget-weather .widget-head', 'pointerup', 2, c2.x + d2x, c2.y + d2y);
  await sleep(200);
  const weatherPosAfter = await posOf('.widget-weather');
  const notepadPosAfter = await posOf('.widget-notepad');
  check(
    '同じ大きさのウィジェット同士はドラッグで入れ替わる',
    weatherPosAfter.x === notepadPos.x &&
      weatherPosAfter.y === notepadPos.y &&
      notepadPosAfter.x === weatherPos.x &&
      notepadPosAfter.y === weatherPos.y,
    true
  );

  // 3) ノートパッドを削除しても他のアイテムの位置は変わらない(自動上詰めをしない)
  const posBeforeDelete = await js(
    `Object.fromEntries([...document.querySelectorAll('#quick-links .grid-item')].map((el) => [el.dataset.gridKey, el.style.gridColumn + '|' + el.style.gridRow]))`
  );
  await js(`document.querySelector('.widget-notepad .widget-menu-btn').click()`);
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('削除')).click()`);
  await sleep(300);
  const posAfterDelete = await js(
    `Object.fromEntries([...document.querySelectorAll('#quick-links .grid-item')].map((el) => [el.dataset.gridKey, el.style.gridColumn + '|' + el.style.gridRow]))`
  );
  const notepadGone = !Object.keys(posAfterDelete).some((k) => k.includes('notepad'));
  const othersUnchanged = Object.keys(posAfterDelete).every((k) => posAfterDelete[k] === posBeforeDelete[k]);
  check('ウィジェット削除後も残りのアイテムは動かない(自動上詰めなし)', notepadGone && othersUnchanged, true);

  // 4) ウィジェットは右下のハンドルをドラッグしてサイズ変更できる(ニュースを幅3→2に縮小)
  check('ニュースの初期サイズは幅3', (await posOf('.widget-news')).w, 3);
  const newsBefore = await posOf('.widget-news');
  const cellPx3 = parseFloat(await gridVar('--cell'));
  const step3 = cellPx3 + DRAG_GAP;
  const h1 = await centerOf('.widget-news .widget-resize-handle');

  await firePointer('.widget-news .widget-resize-handle', 'pointerdown', 3, h1.x, h1.y);
  await firePointer('.widget-news .widget-resize-handle', 'pointermove', 3, h1.x - step3, h1.y);
  await sleep(50);
  check('リサイズ中もグリッド線オーバーレイが表示される', await js(`document.querySelectorAll('.grid-overlay-cell').length > 0`), true);
  check('リサイズ中のプレビューが有効(緑)表示になる', await js(`document.querySelector('.grid-overlay-preview')?.classList.contains('valid')`), true);
  await firePointer('.widget-news .widget-resize-handle', 'pointerup', 3, h1.x - step3, h1.y);
  await sleep(200);
  const newsAfterShrink = await posOf('.widget-news');
  check(
    'ドラッグでウィジェットの幅を1セル縮小できる(位置は変わらない)',
    newsAfterShrink.w === newsBefore.w - 1 && newsAfterShrink.h === newsBefore.h && newsAfterShrink.x === newsBefore.x && newsAfterShrink.y === newsBefore.y,
    true
  );

  // 縮小で空いたスペースへ再び幅を1セル拡大(必ず空いているはずの場所への拡大)
  const h2 = await centerOf('.widget-news .widget-resize-handle');
  await firePointer('.widget-news .widget-resize-handle', 'pointerdown', 4, h2.x, h2.y);
  await firePointer('.widget-news .widget-resize-handle', 'pointermove', 4, h2.x + step3, h2.y);
  await sleep(50);
  await firePointer('.widget-news .widget-resize-handle', 'pointerup', 4, h2.x + step3, h2.y);
  await sleep(200);
  const newsAfterGrow = await posOf('.widget-news');
  check('直前に縮小した分は再び拡大できる', newsAfterGrow.w === newsBefore.w && newsAfterGrow.h === newsBefore.h, true);

  // ---- 共通アイコンピッカー(icon-picker.js): ボタンがパネル幅からはみ出さないこと ----
  await rightClickToAdd();
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('ショートカット')).click()`);
  await sleep(150);
  await js(`[...document.querySelectorAll('.btn')].find((b) => b.textContent === 'アイコンを変更').click()`);
  await sleep(100);
  const overflowInfo = await js(`(() => {
    const panel = document.querySelector('.icon-picker');
    const panelRight = panel.getBoundingClientRect().right;
    const btns = [...panel.querySelectorAll('.icon-picker-row .btn')];
    return { count: btns.length, overflow: btns.some((b) => b.getBoundingClientRect().right > panelRight + 0.5) };
  })()`);
  check('アイコンピッカーのボタンが3個ある(設定/アップロード/既定に戻す)', overflowInfo.count, 3);
  check('アイコンピッカーのボタンがパネル幅をはみ出さない', overflowInfo.overflow, false);

  // ---- ショートカットの個数に上限を設けない + ブックマークのパネルからページのフォルダへ
  // 追加したリンク(=ページ直下のブックマーク)もショートカットとして表示する ----
  await js(`(() => {
    [...document.querySelectorAll('.btn')].find((b) => b.textContent === 'キャンセル')?.click();
    document.querySelector('.icon-picker')?.remove();
    document.querySelector('.icon-picker-backdrop')?.remove();
  })()`);
  await sleep(100);
  // フォルダの中身(6リンク+入れ子フォルダ1)。入れ子は展開しない
  await js(`window.roopieInternal.__setShortcuts('subfolder', [
    ...Array.from({ length: 6 }, (_v, i) => ({ id: 'inner' + i, type: 'bookmark', title: 'Inner' + i, url: 'https://example.org/' + i, favicon: null, icon: null })),
    { id: 'nested', type: 'folder', title: '入れ子' },
  ])`);
  await js(`window.roopieInternal.__setShortcuts('emptyfolder', [])`);
  await js(`window.roopieInternal.__setShortcuts('p1', [
    ...Array.from({ length: 14 }, (_v, i) => ({ id: 'many' + i, type: 'bookmark', title: 'Link' + i, url: 'https://example.com/' + i, favicon: null, icon: null })),
    { id: 'panel1', type: 'bookmark', title: 'パネルから追加', url: 'https://example.net/panel', favicon: null, icon: null },
    { id: 'subfolder', type: 'folder', title: 'サブフォルダ' },
    { id: 'emptyfolder', type: 'folder', title: '空フォルダ' },
  ])`);
  await sleep(500);
  check(
    '10個を超えるショートカットも全部表示される(上限なし)',
    await js(`document.querySelectorAll('#quick-links [data-grid-key^="s:"]').length`),
    17
  );
  check('パネルからページに追加したリンクもショートカットになる', await js(`!!document.querySelector('[data-grid-key="s:panel1"]')`), true);

  // 表示行に入りきらない分はグリッドを縦スクロールすれば届く
  const reach = await js(`(() => {
    const grid = document.getElementById('quick-links');
    grid.scrollTop = grid.scrollHeight;
    const items = [...grid.querySelectorAll('.grid-item')];
    const last = items.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
    const g = grid.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return { scrollable: grid.scrollHeight > grid.clientHeight, visible: r.bottom <= g.bottom + 0.5 && r.top >= g.top - 0.5 };
  })()`);
  console.log(`   (グリッドはスクロール${reach.scrollable ? 'あり' : 'なし'})`);
  check('一番下のショートカットまでスクロールで到達できる', reach.visible, true);

  // ---- ページの中のフォルダ(スマホのアプリフォルダ風のタイル → クリックで展開) ----
  check('ページの中のフォルダもタイルとして出る', await js(`!!document.querySelector('[data-grid-key="s:subfolder"] .group-tile')`), true);
  check(
    'タイルには中身のアイコンが最大4個並ぶ',
    await js(`document.querySelectorAll('[data-grid-key="s:subfolder"] .group-mini').length`),
    4
  );
  check(
    'フォルダ名がラベルに出る',
    await js(`document.querySelector('[data-grid-key="s:subfolder"] .label')?.textContent`),
    'サブフォルダ'
  );

  await js(`document.querySelector('[data-grid-key="s:subfolder"]').click()`);
  await sleep(200);
  check('クリックでフォルダが開く', await js(`!!document.querySelector('.folder-view')`), true);
  check('開いたフォルダの名前が出る', await js(`document.querySelector('.folder-view-title')?.textContent`), 'サブフォルダ');
  // 開くアニメーションでopacityを動かすと、描画が進まない状況で開始キーフレーム(透明)のまま
  // 止まり「開いていない」ように見えるため、透明度は動かさない(ページ切り替えと同じ轍)
  const folderVisible = await js(`(() => {
    const b = getComputedStyle(document.querySelector('.folder-view-backdrop'));
    const p = getComputedStyle(document.querySelector('.folder-view'));
    return [Number(b.opacity), Number(p.opacity)];
  })()`);
  check('開いたフォルダが実際に見えている(透明のまま止まらない)', folderVisible, [1, 1]);
  check(
    '中身のリンクが並ぶ(入れ子のフォルダは出さない)',
    await js(`document.querySelectorAll('.folder-view-grid .quick-link').length`),
    6
  );
  check(
    '中身のリンクはそのまま開けるaタグ',
    await js(`document.querySelector('.folder-view-grid .quick-link')?.getAttribute('href')`),
    'https://example.org/0'
  );
  // --cell は #quick-links に載るので、body直下のオーバーレイには自前で渡す必要がある
  check(
    'アイコンサイズ(--cell)がフォルダの中にも効く',
    await js(`getComputedStyle(document.querySelector('.folder-view')).getPropertyValue('--cell').trim()`),
    '96px'
  );
  await js(`window.roopieInternal.__setSettings({ startIconSize: 160 })`);
  await sleep(200);
  check(
    'アイコンサイズを変えるとフォルダの中も追従する',
    await js(`getComputedStyle(document.querySelector('.folder-view')).getPropertyValue('--cell').trim()`),
    '160px'
  );
  await js(`window.roopieInternal.__setSettings({ startIconSize: 96 })`);
  await sleep(200);

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(150);
  check('Escapeで閉じる', await js(`!!document.querySelector('.folder-view')`), false);

  await js(`document.querySelector('[data-grid-key="s:emptyfolder"]').click()`);
  await sleep(200);
  check('空のフォルダも開ける', await js(`!!document.querySelector('.folder-view-empty')`), true);

  // 開いている間にブックマーク側が変わったら中身も追従する(パネルからの追加・削除)
  await js(`window.roopieInternal.__setShortcuts('emptyfolder', [
    { id: 'added1', type: 'bookmark', title: '後から追加', url: 'https://example.com/added', favicon: null, icon: null },
  ])`);
  await sleep(400);
  check('開いたまま中身が増えたら反映される', await js(`document.querySelectorAll('.folder-view-grid .quick-link').length`), 1);

  // フォルダごと消えたら閉じる
  await js(`window.roopieInternal.__setShortcuts('p1', [
    { id: 'panel1', type: 'bookmark', title: 'パネルから追加', url: 'https://example.net/panel', favicon: null, icon: null },
  ])`);
  await sleep(400);
  check('フォルダが消えたら開いていた表示も閉じる', await js(`!!document.querySelector('.folder-view-backdrop')`), false);

  // ---- スタート画面の右クリックメニューからフォルダを作る + フォルダのカスタムアイコン ----
  await rightClickToAdd();
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('フォルダ')).click()`);
  await sleep(150);
  check('フォルダの追加モーダルが出る', await js(`document.querySelector('.shortcut-modal h3')?.textContent`), 'フォルダを追加');
  check(
    'アイコンの既定は中身のプレビュー',
    await js(`document.querySelector('.shortcut-icon-label')?.textContent`),
    '既定(中身のプレビュー)'
  );
  await js(`(() => {
    const input = document.querySelector('.shortcut-modal input.search');
    input.value = '仕事';
    [...document.querySelectorAll('.shortcut-modal .btn')].find((b) => b.textContent === '保存').click();
  })()`);
  await sleep(400);
  check('右クリックメニューからフォルダを作れる', await js(`[...document.querySelectorAll('#quick-links .quick-link-group .label')].map((e) => e.textContent)`), ['仕事']);
  const newFolderKey = await js(`document.querySelector('.quick-link-group').dataset.gridKey`);
  check('作ったフォルダは中身が空(既定のプレビューは空タイル)', await js(`document.querySelectorAll('.quick-link-group .group-mini').length`), 0);

  // ✎ → 名前・アイコンを変更 → 絵文字を選ぶ
  await js(`document.querySelector('.quick-link-group .quick-link-edit').click()`);
  await sleep(150);
  check('フォルダのメニューは3項目(開く/変更/削除)', await js(`document.querySelectorAll('.grid-popup-item').length`), 3);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('名前・アイコン')).click()`);
  await sleep(150);
  check('フォルダの編集モーダルが出る', await js(`document.querySelector('.shortcut-modal h3')?.textContent`), 'フォルダを編集');
  await js(`[...document.querySelectorAll('.shortcut-modal .btn')].find((b) => b.textContent === 'アイコンを変更').click()`);
  await sleep(150);
  check('アイコンピッカーが開く', await js(`!!document.querySelector('.icon-picker')`), true);
  await js(`document.querySelector('.icon-picker .icon-picker-emoji').click()`);
  await sleep(150);
  check(
    '選んだアイコンがプレビューに出る',
    await js(`document.querySelector('.shortcut-icon-label')?.textContent`),
    'カスタムアイコン'
  );
  const pickedEmoji = await js(`document.querySelector('.shortcut-icon-preview .placeholder')?.textContent`);
  await js(`[...document.querySelectorAll('.shortcut-modal .btn')].find((b) => b.textContent === '保存').click()`);
  await sleep(400);
  check(
    'フォルダのタイルがカスタムアイコンになる',
    await js(`document.querySelector('.quick-link-group .tile .placeholder')?.textContent`),
    pickedEmoji
  );
  check(
    'カスタムアイコンのときは2x2のプレビューをやめる',
    await js(`!!document.querySelector('.quick-link-group .tile.group-tile')`),
    false
  );
  check('カスタムアイコンにしてもフォルダとして開ける', await js(`(() => {
    document.querySelector('.quick-link-group').click();
    return !!document.querySelector('.folder-view');
  })()`), true);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(150);
  console.log(`   (作成したフォルダ: ${newFolderKey})`);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
