// ウィンドウの背景マテリアル(Windows 11 の acrylic / mica)を**実行中に**切り替えられるかを確かめる探り。
// 「半透明」「liquidglass」をテーマの一項目として持てるか(=ウィンドウを作り直さずに済むか)が
// データの持ち方とUIの文言を左右するので、設定画面を書く前にここで白黒つける。
//
// 実行: npx electron scripts/test-window-material.js [出力dir]
// 背景に縞模様のウィンドウを敷き、その上に検証ウィンドウを重ねて、画面全体をPowerShellで撮る。
// 縞がぼけていればマテリアルが効いている。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'roopie-material');
fs.mkdirSync(OUT, { recursive: true });

const BOUNDS = { x: 200, y: 150, width: 900, height: 500 };
const FRAME_COLOR = '#16181d'; // browser.js と同じ

// 検証ウィンドウの矩形だけをPNGへ撮る(capturePage はウィンドウの中身しか写らず、
// DWMの背景ぼかしが見えないため画面から撮る。他のウィンドウを写さないよう範囲は最小限にする)
const SHOT_RECT = { x: BOUNDS.x - 40, y: BOUNDS.y - 40, width: BOUNDS.width + 80, height: BOUNDS.height + 80 };
function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
    `$bmp = New-Object System.Drawing.Bitmap ${SHOT_RECT.width}, ${SHOT_RECT.height};`,
    '$g = [System.Drawing.Graphics]::FromImage($bmp);',
    `$g.CopyFromScreen(${SHOT_RECT.x}, ${SHOT_RECT.y}, 0, 0, $bmp.Size);`,
    `$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png);`,
  ].join(' ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
  console.log('  撮影:', file);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// data: URL は CSP なしで済ませたいので一時HTMLに書き出す
function pageFile(name, body) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const results = [];
  const record = (label, ok, note) => {
    results.push({ label, ok, note });
    console.log(`${ok ? 'OK ' : 'NG '} ${label}${note ? ' — ' + note : ''}`);
  };

  // ---- 背後に敷く縞模様(これがぼければマテリアルが効いている) ----
  const backdrop = new BrowserWindow({
    ...BOUNDS,
    x: BOUNDS.x - 40,
    y: BOUNDS.y - 40,
    width: BOUNDS.width + 80,
    height: BOUNDS.height + 80,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    // 他のウィンドウに隠れると縞が写らないので最前面に出す(検証ウィンドウはさらにその上)
    alwaysOnTop: true,
  });
  backdrop.loadFile(
    pageFile(
      'backdrop',
      `<body style="margin:0;height:100vh;background:repeating-linear-gradient(45deg,#ff2d55 0 24px,#00d4ff 24px 48px)"></body>`
    )
  );
  await wait(600);

  // ---- 検証ウィンドウ: browser.js:412-431 と同じ指定 ----
  const win = new BrowserWindow({
    ...BOUNDS,
    minWidth: 500,
    minHeight: 300,
    title: 'material probe',
    backgroundColor: FRAME_COLOR,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: FRAME_COLOR, symbolColor: '#e5e7eb', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // 背景ウィンドウ(alwaysOnTop)より確実に手前へ
  win.setAlwaysOnTop(true, 'pop-up-menu');

  // クロームの帯(タブバー・ツールバー)だけ色を持ち、下は透過にした簡易UI。
  // 本物の body{background:var(--bg)} を透過に置き換えたときの見え方を模す
  const chrome = (bodyBg) => `<body style="margin:0;height:100vh;background:${bodyBg};font-family:Segoe UI;color:#e5e7eb">
    <div style="height:40px;background:rgba(30,33,40,.6);display:flex;align-items:center;padding:0 12px">tab bar (alpha .6)</div>
    <div style="height:44px;background:rgba(26,28,34,.6);display:flex;align-items:center;padding:0 12px">toolbar (alpha .6)</div>
    <div style="padding:16px">page area</div>
  </body>`;

  win.loadFile(pageFile('chrome-opaque', chrome(FRAME_COLOR)));
  await wait(800);
  shot('1-baseline');
  record('起動時(マテリアルなし・不透明)', true, '基準');

  // ---- 1) 起動後に setBackgroundMaterial を呼べるか(不透明な backgroundColor のまま) ----
  let apiOk = true;
  try {
    win.setBackgroundMaterial('acrylic');
  } catch (err) {
    apiOk = false;
    record('setBackgroundMaterial が実行中に呼べる', false, String(err.message));
  }
  if (apiOk) record('setBackgroundMaterial が実行中に呼べる', true, '例外なし');
  await wait(600);
  shot('2-acrylic-opaque-bgcolor');

  // ---- 2) backgroundColor を透明にしてから(こちらが本命) ----
  win.setBackgroundColor('#00000000');
  win.loadFile(pageFile('chrome-transparent', chrome('transparent')));
  await wait(900);
  shot('3-acrylic-transparent');

  // ---- 3) mica も試す(壁紙しか拾わないため、背後のウィンドウは透けない見込み) ----
  win.setBackgroundMaterial('mica');
  await wait(700);
  shot('4-mica-transparent');

  // ---- 3b) acrylic と setOpacity の同居(不透明度スライダーと併用できるか) ----
  win.setBackgroundMaterial('acrylic');
  win.loadFile(pageFile('chrome-transparent2', chrome('transparent')));
  await wait(700);
  win.setOpacity(0.8);
  await wait(600);
  shot('4b-acrylic-opacity80');
  win.setOpacity(1);
  await wait(400);

  // ---- 3c) color-mix の割合に calc() を渡せるか(トークン導出の土台) ----
  // 左が calc()、右が直書き。同じ色に見えれば calc() が通っている
  const mixProbe = `<body style="margin:0;height:100vh;background:#101216;--c:#3b82f6;--a:0.5;display:flex">
    <div style="flex:1;background:color-mix(in srgb, var(--c) calc(var(--a) * 100%), transparent)"></div>
    <div style="flex:1;background:color-mix(in srgb, var(--c) 50%, transparent)"></div>
    <div style="flex:1;background:rgb(var(--t, 255 255 255) / 0.5)"></div>
  </body>`;
  win.loadFile(pageFile('mix-probe', mixProbe));
  await wait(700);
  const mixOk = await win.webContents.executeJavaScript(`(() => {
    const [a, b, c] = [...document.body.children].map((el) => getComputedStyle(el).backgroundColor);
    return { a, b, c, same: a === b };
  })()`);
  record('color-mix の割合に calc() が通る', mixOk.same, `calc=${mixOk.a} / 直書き=${mixOk.b}`);
  record('rgb(var(--tint) / a) が通る', /^rgba?\(/.test(mixOk.c) && mixOk.c !== 'rgba(0, 0, 0, 0)', mixOk.c);

  // ---- 4) 元に戻せるか(テーマを切り替え直せることの確認) ----
  win.setBackgroundMaterial('none');
  win.setBackgroundColor(FRAME_COLOR);
  win.loadFile(pageFile('chrome-back', chrome(FRAME_COLOR)));
  await wait(800);
  shot('5-back-to-solid');

  // ---- 5) タイトルバーオーバーレイの色を実行中に変えられるか(ライトテーマで必要) ----
  try {
    win.setTitleBarOverlay({ color: '#f5f6f8', symbolColor: '#1f2430', height: 40 });
    record('setTitleBarOverlay が実行中に効く', true, '例外なし(色は5-*と6-*を見比べる)');
  } catch (err) {
    record('setTitleBarOverlay が実行中に効く', false, String(err.message));
  }
  await wait(600);
  shot('6-titlebar-light');

  console.log('\n--- 出力 ---');
  console.log(OUT);
  console.log('スクショを見比べて、2/3/4で縞模様が透けているかを判定する');

  await wait(300);
  backdrop.destroy();
  win.destroy();
  app.exit(results.every((r) => r.ok) ? 0 : 1);
});
