// build/icon.ico を生成する(仮ロゴ: インディゴ→バイオレットのグラデーション角丸 + 白い R)。
// 使い方: npx electron scripts/gen-icon.js
// ちゃんとしたロゴができたら build/icon.ico を差し替えるだけでよい。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const PAGE = `data:text/html,<canvas id="c"></canvas>`;

const DRAW = `
  (${function (sizes) {
    return sizes.map((size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, size * 0.22);
      const g = ctx.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, '#6366f1');
      g.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + size * 0.66 + 'px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('R', size / 2, size / 2 + size * 0.04);
      return c.toDataURL('image/png').split(',')[1];
    });
  }})(${JSON.stringify(SIZES)})
`;

// PNGをそのまま格納するICOコンテナ(Vista以降対応の形式)
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  const datas = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    datas.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL(PAGE);
  const base64List = await win.webContents.executeJavaScript(DRAW);
  const pngs = SIZES.map((size, i) => ({ size, buf: Buffer.from(base64List[i], 'base64') }));
  const out = path.join(__dirname, '..', 'build', 'icon.ico');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildIco(pngs));
  console.log('生成完了:', out, fs.statSync(out).size, 'bytes');
  app.quit();
});
