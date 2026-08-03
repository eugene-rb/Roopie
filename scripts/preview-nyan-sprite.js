// ニャンキャットのスプライトを拡大してPNGに焼く(ドット絵の目視確認用・再利用可)。
// 実行: npx electron scripts/preview-nyan-sprite.js [出力PNG] [倍率]
// gen-nyan-sprite.js が書いた nyan-sprite.css の変数をそのまま読み込んで並べる。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const outFile = process.argv[2] || path.join(__dirname, '..', 'nyan-preview.png');
const scale = Number(process.argv[3]) || 8;

const spriteCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'nyan-sprite.css'), 'utf8');

const FRAME_W = 34;
const FRAME_H = 21;
const FRAMES = 6;
const PAD = 8;

// 6コマを縦に並べ、その下に虹タイルを繰り返したものを置く
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${spriteCss}
body { margin: 0; background: #003366; font: 11px monospace; color: #fff; }
.wrap { padding: ${PAD}px; display: flex; flex-wrap: wrap; align-items: center; gap: ${PAD}px; width: ${(FRAME_W * scale + 60) * 3}px; }
.row { display: flex; align-items: center; gap: 4px; }
.frame {
  width: ${FRAME_W * scale}px;
  height: ${FRAME_H * scale}px;
  background-image: var(--nyan-cat);
  background-size: ${FRAME_W * FRAMES * scale}px ${FRAME_H * scale}px;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
.rainbow {
  width: ${16 * 4 * scale}px;
  height: ${19 * scale}px;
  background-image: var(--nyan-rainbow);
  background-size: ${16 * scale}px ${19 * scale}px;
  background-repeat: repeat-x;
  image-rendering: pixelated;
}
/* 実際のタブと同じ大きさ(等倍)での見え方 */
.actual { display: flex; align-items: center; width: 200px; height: 30px; border-radius: 8px; background: #30343f; position: relative; overflow: hidden; }
.actual .r { position: absolute; left: 0; right: 31px; top: 50%; margin-top: -9.5px; height: 19px;
  background-image: var(--nyan-rainbow); background-size: 16px 19px; background-repeat: repeat-x; image-rendering: pixelated; }
.actual .c { position: absolute; right: 4px; top: 50%; margin-top: -10.5px; width: ${FRAME_W}px; height: ${FRAME_H}px;
  background-image: var(--nyan-cat); background-size: ${FRAME_W * FRAMES}px ${FRAME_H}px; background-repeat: no-repeat; image-rendering: pixelated; }
</style></head><body><div class="wrap">
${Array.from({ length: FRAMES }, (_, i) => `<div class="row"><div class="frame" style="background-position: ${-i * FRAME_W * scale}px 0"></div><span>コマ${i + 1}</span></div>`).join('')}
<div class="row"><div class="rainbow"></div><span>虹タイル×4</span></div>
${Array.from({ length: FRAMES }, (_, i) => `<div class="row"><div class="actual"><div class="r"></div><div class="c" style="background-position: ${-i * FRAME_W}px 0"></div></div><span>等倍 コマ${i + 1}</span></div>`).join('')}
</div></body></html>`;

app.whenReady().then(async () => {
  // 3列で折り返すので、猫2段 + 虹 + 等倍タブ2段ぶん
  const height = PAD * 2 + 2 * (FRAME_H * scale + PAD) + (19 * scale + PAD) + 3 * (30 + PAD);
  const win = new BrowserWindow({
    width: (FRAME_W * scale + 60) * 3 + PAD * 2 + 20,
    height: Math.round(height),
    show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outFile, image.toPNG());
  console.log(`書き出し: ${outFile}`);
  app.exit(0);
});

app.on('window-all-closed', () => {});
