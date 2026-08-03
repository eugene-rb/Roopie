// NSISインストーラーの画像(BMP)を生成する。
// 使い方: npx electron scripts/gen-installer-art.js
//
// NSISは24bitのBMP(BMP3。アルファ・圧縮なし)しか受け付けないため、
// Canvasで描いた絵をPNG→nativeImage→BGRAピクセル配列にしてから自前でBMPを組み立てる。
//   build/installerSidebar.bmp   164x314  ウィザードの左側(ようこそ/完了ページ)
//   build/uninstallerSidebar.bmp 164x314  アンインストーラーの左側
//   build/installerHeader.bmp    150x57   各ページ右上のヘッダー
// ロゴを差し替えたいときはこのファイルの描画コードだけ直せばよい。
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SIDEBAR = { width: 164, height: 314 };
const HEADER = { width: 150, height: 57 };

// レンダラー側で実行する描画関数(引数はJSONで渡せる値だけ)
function draw(kind, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 背景: インディゴ→バイオレットの斜めグラデーション(アプリのアイコンと同系色)
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#4f46e5');
  bg.addColorStop(0.55, '#6366f1');
  bg.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 斜めの光沢(薄い白のバンド)
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-width * 0.2, height);
  ctx.lineTo(width * 0.85, 0);
  ctx.lineTo(width * 1.3, 0);
  ctx.lineTo(width * 0.25, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ぼかした光の玉(グラデーションで代用。filterはBMP化に影響しないので使わない)
  const glow = ctx.createRadialGradient(width * 0.15, height * 0.12, 0, width * 0.15, height * 0.12, width * 0.9);
  glow.addColorStop(0, 'rgba(255,255,255,0.28)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const roundedLogo = (x, y, size) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, size * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.62}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', x + size / 2, y + size / 2 + size * 0.04);
    ctx.restore();
  };

  if (kind === 'sidebar') {
    roundedLogo(width / 2 - 33, 54, 66);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.fillText('Roopie', width / 2, 156);
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText('あなた好みに組み替えられる', width / 2, 182);
    ctx.fillText('ウェブブラウザ', width / 2, 198);
    // 下部の細いライン(余白を締める)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(width / 2 - 18, 218, 36, 2);
  } else {
    roundedLogo(12, 11, 35);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('Roopie', 58, 27);
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('ウェブブラウザ', 59, 43);
  }

  return canvas.toDataURL('image/png');
}

// BGRAのピクセル配列(nativeImage.toBitmap)から24bit BMPを組み立てる。
// BMPは行が下から上、1行を4バイト境界に揃える必要がある
function toBmp24(bgra, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height); // 埋めなかった部分は0(パディング)
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 3;
      pixels[d] = bgra[s]; // B
      pixels[d + 1] = bgra[s + 1]; // G
      pixels[d + 2] = bgra[s + 2]; // R
    }
  }

  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2); // ファイルサイズ
  header.writeUInt32LE(54, 10); // 画素データの開始位置
  header.writeUInt32LE(40, 14); // BITMAPINFOHEADERのサイズ
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26); // プレーン数
  header.writeUInt16LE(24, 28); // 1画素あたりのbit数
  header.writeUInt32LE(pixels.length, 34); // 画素データのサイズ
  header.writeInt32LE(2835, 38); // 解像度(72dpi相当)
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { kind: 'sidebar', size: SIDEBAR, files: ['installerSidebar.bmp', 'uninstallerSidebar.bmp'] },
    { kind: 'header', size: HEADER, files: ['installerHeader.bmp'] },
  ];

  for (const target of targets) {
    const dataUrl = await win.webContents.executeJavaScript(
      `(${draw.toString()})(${JSON.stringify(target.kind)}, ${target.size.width}, ${target.size.height})`
    );
    const image = nativeImage.createFromDataURL(dataUrl);
    const { width, height } = image.getSize();
    const bmp = toBmp24(image.toBitmap(), width, height);
    for (const file of target.files) {
      const out = path.join(outDir, file);
      fs.writeFileSync(out, bmp);
      console.log('生成完了:', out, `${width}x${height}`, bmp.length, 'bytes');
    }
  }

  app.quit();
});

app.on('window-all-closed', () => {});
