// 新しいタブの背景(パターン/グラデーション/画像のぼかし・暗さ/三体問題)と
// テーマ値の検証(再利用可能)。実行: npx electron scripts/test-backgrounds.js
//
// レンダラー側は test-newtab-widgets.js と同じ静的配信+スタブpreloadで newtab.html を描画し、
// __setTheme() でテーマを差し替えて背景の反映を確かめる。
// メイン側は browser.applyThemePatch のバリデーション(範囲・色形式・不透明度の下限)を直接叩く。
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
// browser.js は app ready より前に protocol.registerSchemesAsPrivileged を呼ぶので、
// whenReady の中ではなくここで読み込む
const browser = require('../src/main/browser');

const PAGES_DIR = path.join(__dirname, '..', 'src', 'renderer', 'pages');
const PORT = 8934;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

// ---- メインプロセス側: テーマのバリデーション ----
function testThemeValidation() {
  const saved = [];
  const store = { data: { ...browser.DEFAULT_THEME }, save: () => saved.push(1) };

  browser.applyThemePatch(store, { background: 'pattern', backgroundPattern: 'hexagon' });
  check('背景の種類にpatternを選べる', store.data.background, 'pattern');
  check('パターンの種類を選べる', store.data.backgroundPattern, 'hexagon');

  browser.applyThemePatch(store, { background: 'ないやつ', backgroundPattern: 'ないやつ' });
  check('未知の背景は無視される', store.data.background, 'pattern');
  check('未知のパターンは無視される', store.data.backgroundPattern, 'hexagon');

  browser.applyThemePatch(store, { backgroundBlur: 999, backgroundDim: -50 });
  check('ぼかしは上限(40)で頭打ち', store.data.backgroundBlur, 40);
  check('暗さは下限(0)で頭打ち', store.data.backgroundDim, 0);

  browser.applyThemePatch(store, { gradientStops: ['#ff0000', 'red; background: url(x)', '#00ff00'], gradientAngle: 400 });
  check('グラデーションの色は#rrggbbだけ通る', store.data.gradientStops, ['#ff0000', '#00ff00']);
  check('角度は360で頭打ち', store.data.gradientAngle, 360);

  browser.applyThemePatch(store, { gradientStops: ['#ff0000'] });
  check('1色だけのグラデーションは拒否される(前の値のまま)', store.data.gradientStops, ['#ff0000', '#00ff00']);

  browser.applyThemePatch(store, { gradientStops: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'] });
  check('グラデーションの色は5つまで', store.data.gradientStops.length, 5);

  browser.applyThemePatch(store, { patternColor: '#ABCDEF', patternBase: 'nope' });
  check('パターンの色は小文字化して保存', store.data.patternColor, '#abcdef');
  check('不正な色は無視される', store.data.patternBase, browser.DEFAULT_THEME.patternBase);

  browser.applyThemePatch(store, { windowOpacity: 0 });
  check('ウィンドウ不透明度は0.3未満にできない(画面から消えるため)', store.data.windowOpacity, 0.3);
  browser.applyThemePatch(store, { windowOpacity: 5 });
  check('ウィンドウ不透明度は1を超えない', store.data.windowOpacity, 1);
}

app.whenReady().then(async () => {
  testThemeValidation();

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
  const setTheme = (patch) => js(`window.roopieInternal.__setTheme(${JSON.stringify(patch)})`);
  const styleOf = (selector, prop) =>
    js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(prop)}).trim()`);

  await win.loadURL(`http://localhost:${PORT}/newtab.html`);
  await sleep(400);

  // ---- パターン背景 ----
  await setTheme({ background: 'pattern', backgroundPattern: 'grid', patternColor: '#ff0000', patternBase: '#001122' });
  await sleep(120);
  check('bodyのdata-bgがpatternになる', await js(`document.body.dataset.bg`), 'pattern');
  check('選んだパターンがdata-patternに出る', await js(`document.getElementById('bg').dataset.pattern`), 'grid');
  check('下地色が反映される', await styleOf('#bg', 'background-color'), 'rgb(0, 17, 34)');
  check('模様の色が背景画像(線)に使われる', (await styleOf('#bg', 'background-image')).includes('rgb(255, 0, 0)'), true);

  for (const pattern of ['dots', 'grid', 'diagonal', 'crosshatch', 'hexagon', 'wave', 'circuit']) {
    await setTheme({ backgroundPattern: pattern });
    await sleep(60);
    const image = await styleOf('#bg', 'background-image');
    check(`パターン「${pattern}」が描画される`, image !== 'none' && image.length > 0, true);
  }

  // ---- グラデーション ----
  await setTheme({ background: 'gradient', gradientAngle: 90, gradientStops: ['#ff0000', '#00ff00', '#0000ff'] });
  await sleep(120);
  // インラインstyleに入れた #rrggbb はブラウザが rgb() に正規化して返す
  const gradient = await js(`document.getElementById('bg').style.background`);
  check('角度と色がそのままlinear-gradientになる', gradient, 'linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255))');
  await setTheme({ gradientStops: ['#ffffff', '#000000'] });
  await sleep(80);
  check('色を減らすと組み直される', await js(`document.getElementById('bg').style.background`), 'linear-gradient(90deg, rgb(255, 255, 255), rgb(0, 0, 0))');

  // ---- 画像のぼかし・暗さ ----
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  await setTheme({ background: 'image', backgroundImage: PIXEL, backgroundBlur: 20, backgroundDim: 50 });
  await sleep(120);
  check('画像が背景に設定される', (await js(`document.getElementById('bg').style.backgroundImage`)).startsWith('url("data:image/gif'), true);
  check('ぼかしがCSSのfilterに入る', await styleOf('#bg', 'filter'), 'blur(20px)');
  check('ぼかすと縁が透けないよう外へ広げる', await js(`document.getElementById('bg').style.inset`), '-10%');
  check('暗さのオーバーレイが効く', await styleOf('#bg-dim', 'opacity'), '0.5');
  await setTheme({ backgroundBlur: 0, backgroundDim: 0 });
  await sleep(80);
  check('ぼかし0なら広げない', await js(`document.getElementById('bg').style.inset`), '');
  check('暗さ0なら透明', await styleOf('#bg-dim', 'opacity'), '0');

  // 画像以外に切り替えたらぼかし・暗さは効かない(前の設定が残って暗いままにならない)
  await setTheme({ background: 'night', backgroundBlur: 30, backgroundDim: 60 });
  await sleep(80);
  check('画像以外ではぼかしを適用しない', await styleOf('#bg', 'filter'), 'none');
  check('画像以外では暗さを適用しない', await styleOf('#bg-dim', 'opacity'), '0');

  // ---- 三体問題シミュレーション ----
  await setTheme({ background: 'threebody' });
  await sleep(300);
  check('canvasが表示される', await styleOf('#bg-sim', 'display'), 'block');
  const simState = await js(`window.__threeBodyState()`);
  check('3体が生成される', simState.bodies.length, 3);
  check('アニメーションが動いている', simState.running, true);
  check('canvasの解像度がウィンドウに合っている', await js(`document.getElementById('bg-sim').width > 0`), true);

  // 長く回しても座標が壊れない(軟化+シンプレクティック積分。素の1/r^2+オイラー法だとNaNへ飛ぶ)。
  // 画面に出ていないウィンドウではrAFが回らないので、フレームを直接進める
  await js(`for (let i = 0; i < 600; i++) window.__threeBodyTick()`);
  const advanced = await js(`window.__threeBodyState()`);
  check(
    '長く回しても座標がNaN/無限にならない',
    advanced.bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)),
    true
  );
  check(
    '飛び去った体は作り直され、常に画面の範囲に収まる',
    advanced.bodies.every((b) => Math.hypot(b.x, b.y, b.z) <= 9),
    true
  );

  // 軌跡が伸びている(フレームを進めると位置が記録される)
  check('軌跡が記録される', advanced.bodies.every((b) => b.trail > 0), true);

  // タブごとに初期条件が変わる
  const first = await js(`window.__threeBodyState().bodies.map((b) => b.x)`);
  await js(`window.__threeBodyReseed()`);
  const second = await js(`window.__threeBodyState().bodies.map((b) => b.x)`);
  check('作り直すと初期条件が変わる(タブごとにランダム)', JSON.stringify(first) !== JSON.stringify(second), true);

  // 背景を戻すと止まる(見えていないのにCPUを使い続けない)
  await setTheme({ background: 'night' });
  await sleep(150);
  check('背景を変えるとシミュレーションが止まる', (await js(`window.__threeBodyState()`)).running, false);
  check('canvasが隠れる', await styleOf('#bg-sim', 'display'), 'none');

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
