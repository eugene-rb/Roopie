// WebContentsView を透過させたとき、背後にある**ウィンドウのacrylic**が出るかを確かめる探り。
// (test-window-material.js がウィンドウ本体について同じことを確かめたのに続くもの)
//
// なぜ要るか: 内部ページ(設定・履歴・サイドパネル)は WebContentsView に載っている。
// 2026-08-06 の作業では「WebContentsViewが transparent ではないので透かすと黒が出る」と判断し、
// 本物の透過ではなく「ページ自身が光を敷く」方式を採った(SPEC-theme.md / window-theme.js:15-19)。
// だがその transparent は**Viewの生成時オプション**であって、プラットフォームの限界ではない。
// オーバーレイ(browser.js:677)や分割の仕切り(tab-manager.js:415)は現に transparent:true で作られている。
// ただしその2つが透かしているのは「別のWebContentsView(実ページ)」であって、
// 「ウィンドウのacrylic」ではない。合成の経路が違うのでここで実測する。
//
// 実行: npx electron scripts/test-view-transparency.js [出力dir]
// 背後に縞模様のウィンドウを敷き、acrylicのウィンドウを重ね、その上にViewを置いて画面から撮る。
// View の領域に縞のぼけが見えれば「Viewを透かすと背後のacrylicが出る」。黒ならば従来の判断が正しい。
const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'roopie-view-transparency');
fs.mkdirSync(OUT, { recursive: true });

const BOUNDS = { x: 200, y: 150, width: 900, height: 520 };
const FRAME_COLOR = '#16181d'; // browser.js と同じ
// Viewを置く矩形(クロームの帯の下＝実際のタブ/サイドパネルの位置に相当)
const VIEW_RECT = { x: 0, y: 84, width: BOUNDS.width, height: BOUNDS.height - 84 };

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

function pageFile(name, body) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

// 内部ページを模したページ。bodyの背景だけを差し替えて見え方を比べる。
// カードは tailwind.css の liquidglass と同じ作り(半透明＋backdrop-filter)
const innerPage = (bodyBg, label) => `<body style="margin:0;height:100vh;background:${bodyBg};font-family:Segoe UI;color:#e5e7eb">
  <div style="padding:20px">
    <div style="font-size:13px;opacity:.7;margin-bottom:10px">${label}</div>
    <div style="background:rgb(255 255 255 / 0.1);border:1px solid rgb(255 255 255 / 0.18);border-radius:12px;padding:18px 20px;backdrop-filter:blur(12px) saturate(160%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.3)">
      <div style="font-size:15px;font-weight:600">カード(--glass-surface 相当)</div>
      <div style="font-size:13px;opacity:.8;margin-top:6px">この下に縞が透けていれば、Viewの透過でacrylicが出ている</div>
    </div>
  </div>
</body>`;

// クローム側(ウィンドウ本体のwebContents)。liquidglass では body が transparent になる
const chrome = `<body style="margin:0;height:100vh;background:transparent;font-family:Segoe UI;color:#e5e7eb">
  <div style="height:40px;background:rgba(30,33,40,.6);display:flex;align-items:center;padding:0 12px;backdrop-filter:blur(14px)">tab bar</div>
  <div style="height:44px;background:rgba(26,28,34,.6);display:flex;align-items:center;padding:0 12px;backdrop-filter:blur(14px)">toolbar</div>
</body>`;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  // ---- 背後に敷く縞模様(これが透ければ acrylic が届いている) ----
  const backdrop = new BrowserWindow({
    x: SHOT_RECT.x,
    y: SHOT_RECT.y,
    width: SHOT_RECT.width,
    height: SHOT_RECT.height,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
  });
  backdrop.loadFile(
    pageFile(
      'backdrop',
      `<body style="margin:0;height:100vh;background:repeating-linear-gradient(45deg,#ff2d55 0 24px,#00d4ff 24px 48px)"></body>`
    )
  );
  await wait(600);

  // ---- acrylic のウィンドウ(browser.js の applyWindowChrome と同じ指定) ----
  const win = new BrowserWindow({
    ...BOUNDS,
    title: 'view transparency probe',
    backgroundColor: FRAME_COLOR,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e5e7eb', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setBackgroundMaterial('acrylic');
  win.setBackgroundColor('#00000000');
  win.loadFile(pageFile('chrome', chrome));
  await wait(900);

  // Viewを1つ作って中身を差し替えながら撮る。transparent は生成時オプションなので、
  // 「透明で作ったView」と「不透明で作ったView」は別々に作って比べる必要がある
  const makeView = (transparent) => {
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, transparent },
    });
    if (transparent) view.setBackgroundColor('#00000000');
    view.setBounds(VIEW_RECT);
    return view;
  };

  const frames = [
    // 1) 今の作り: transparent なしのView + 不透明なbody(＝現状の設定・履歴)
    { name: '1-opaque-view-opaque-body', transparent: false, bodyBg: FRAME_COLOR, label: 'transparent:false / body 不透明(現状)' },
    // 2) 現状のViewのまま body だけ透過にした場合(前回「黒が出る」と判断した想定)
    { name: '2-opaque-view-transparent-body', transparent: false, bodyBg: 'transparent', label: 'transparent:false / body 透過' },
    // 3) 本命: transparent:true のView + 透過body
    { name: '3-transparent-view-transparent-body', transparent: true, bodyBg: 'transparent', label: 'transparent:true / body 透過' },
    // 4) 本命の実用形: transparent:true のView + 半透明のスクリム(文字の可読性を残す)
    {
      name: '4-transparent-view-scrim-body',
      transparent: true,
      bodyBg: 'rgba(22,24,29,0.6)',
      label: 'transparent:true / body スクリム60%',
    },
  ];

  for (const f of frames) {
    const view = makeView(f.transparent);
    win.contentView.addChildView(view);
    view.webContents.loadFile(pageFile(f.name, innerPage(f.bodyBg, f.label)));
    await wait(900);
    shot(f.name);
    win.contentView.removeChildView(view);
    view.webContents.close();
    await wait(200);
  }

  console.log('\n--- 出力 ---');
  console.log(OUT);
  console.log('判定: 3 と 4 のView領域(帯の下)に縞のぼけが見えれば、Viewの透過でacrylicが出る。');
  console.log('      2 が黒ければ「bodyだけ透過にしても駄目」という従来の記述が裏付けられる。');

  await wait(300);
  backdrop.destroy();
  win.destroy();
  app.exit(0);
});
