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
  await win.loadURL(`http://localhost:${PORT}/newtab.html`);
  await sleep(400);

  // 初期状態: ショートカット1件+追加タイル
  check('グリッドにショートカット', await js(`document.querySelectorAll('#quick-links .grid-item').length`), 1);
  check('追加タイルがある', await js(`!!document.querySelector('.quick-link-add')`), true);

  // 追加メニュー: ショートカット+4ウィジェット
  await js(`document.querySelector('.quick-link-add').click()`);
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
  await js(`document.querySelector('.quick-link-add').click()`);
  await sleep(100);
  await js(`[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('ノート')).click()`);
  await sleep(300);
  check('ノートパッド追加', await js(`!!document.querySelector('.notepad-textarea')`), true);
  await js(`(() => { const t = document.querySelector('.notepad-textarea'); t.value = 'テストメモ'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(700);
  const noteSaved = await js(`window.roopieInternal.__stubState().configCalls.some((c) => c.patch.text === 'テストメモ')`);
  check('ノートの自動保存', noteSaved, true);

  // カレンダー: 今日の強調と月送り
  await js(`document.querySelector('.quick-link-add').click()`);
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
  await js(`document.querySelector('.quick-link-add').click()`);
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

  // ---- グリッドの列数・行数設定(Android風の自由なグリッドサイズ) ----
  const gridVar = (name) => js(`getComputedStyle(document.getElementById('quick-links')).getPropertyValue('${name}').trim()`);

  check('既定の列数(6)が反映される', await gridVar('--grid-cols'), '6');
  const defaultCell = parseFloat(await gridVar('--cell'));
  check('既定のセルサイズが正の数', defaultCell > 0, true);

  // 設定を横4・縦8に変更 → ライブ反映
  await js(`window.roopieInternal.__setSettings({ startGridCols: 4, startGridRows: 8 })`);
  await sleep(150);
  check('列数4がライブ反映される', await gridVar('--grid-cols'), '4');
  const tallCell = parseFloat(await gridVar('--cell'));
  check('縦8行だとセルが既定より縮む', tallCell < defaultCell, true);

  // 縦8行でも時計が画面外にはみ出ない(セル縮小→--newtab-shift緩和の二段安全弁が効く)
  const clockTop = await js(`document.getElementById('clock').getBoundingClientRect().top`);
  check('時計が画面上端で欠けない', clockTop >= 0, true);

  // 設定を横10・縦3に戻す
  await js(`window.roopieInternal.__setSettings({ startGridCols: 10, startGridRows: 3 })`);
  await sleep(150);
  check('列数10がライブ反映される', await gridVar('--grid-cols'), '10');

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
