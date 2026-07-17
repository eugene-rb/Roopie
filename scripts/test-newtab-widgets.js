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
    show: false,
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

  // 初期状態: ショートカット1件
  check('グリッドにショートカット', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 1);

  // 追加メニュー(右クリック): ショートカット+4ウィジェット
  await rightClickToAdd();
  await sleep(100);
  check('追加メニューの項目数', await js(`document.querySelectorAll('.grid-popup-item').length`), 5);

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
  await js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent.includes('NHK')).click()`);
  await sleep(100);
  await js(`[...document.querySelectorAll('.widget-news .widget-btn')].find((b) => b.textContent === '表示する').click()`);
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
  check('ページドットのactiveがp2になる', await js(`document.querySelectorAll('.page-dot')[1]?.classList.contains('active')`), true);

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
  check('ページドットのactiveがp1になる', await js(`document.querySelectorAll('.page-dot')[0]?.classList.contains('active')`), true);

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

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
