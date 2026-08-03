// タブの音声エフェクト「ニャンキャット」用のスプライトを生成する。
// 実行: node scripts/gen-nyan-sprite.js  → src/renderer/nyan-sprite.css を書き出す
//
// 元ネタは linear-gradient を何十枚も重ねてドット絵を作る有名なCSS実装。
// 30pxのタブに収めるには1ドット=1pxまで縮める必要があり、その大きさでは
// グラデーションの重ね合わせは潰れて読めないので、同じドットデータから
// 6コマのスプライトシート(SVG)を焼き直して background-position で送る。
//
// 座標系は元CSSの「1マス」をそのまま1pxとして扱う($scale: 10px → 1px)。
const fs = require('fs');
const path = require('path');

const K = '#000000'; // 輪郭
const G = '#999999'; // 体
const W = '#ffffff'; // 目のハイライト
const C = '#ff9999'; // ほお・鼻(peach)
const T = '#ffcc99'; // ポップタルトの生地(tan)
const P = '#ff99ff'; // フロスティング(pink)
const M = '#ff3399'; // スプリンクル(magenta)

// 各行を [開始x, 終了x(排他), 色] の並びで持つ。元CSSの linear-gradient の
// カラーストップ(100%/N*k)をそのままマス目に読み替えたもの
const rows = (...list) => list;
const r = (...runs) => runs;

// ---- ポップタルト(21×18)----
// パン(3枚)+ フロスティング(3枚)を重ねた結果を展開したもの
const POPTART_W = 21;
const POPTART = rows(
  r([2, 19, K]),
  r([1, 2, K], [2, 19, T], [19, 20, K]),
  r([0, 1, K], [1, 4, T], [4, 17, P], [17, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 3, T], [3, 18, P], [18, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 2, T], [2, 19, P], [19, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 3, T], [3, 18, P], [18, 20, T], [20, 21, K]),
  r([0, 1, K], [1, 4, T], [4, 17, P], [17, 20, T], [20, 21, K]),
  r([1, 2, K], [2, 19, T], [19, 20, K]),
  r([2, 19, K])
);
// スプリンクル(1マスのドット)
const SPRINKLES = [
  [9, 3], [12, 3], [4, 4], [16, 5], [8, 7], [5, 9],
  [9, 10], [3, 11], [7, 13], [4, 14], [11, 14],
];

// ---- 頭(16×13)----
const HEAD_W = 16;
const HEAD = rows(
  r([2, 4, K], [12, 14, K]),
  r([1, 2, K], [2, 4, G], [4, 5, K], [11, 12, K], [12, 14, G], [14, 15, K]),
  r([1, 2, K], [2, 5, G], [5, 6, K], [10, 11, K], [11, 14, G], [14, 15, K]),
  r([1, 2, K], [2, 6, G], [6, 10, K], [10, 14, G], [14, 15, K]),
  r([1, 2, K], [2, 14, G], [14, 15, K]),
  r([0, 1, K], [1, 15, G], [15, 16, K]),
  r([0, 1, K], [1, 4, G], [4, 5, W], [5, 6, K], [6, 11, G], [11, 12, W], [12, 13, K], [13, 15, G], [15, 16, K]),
  r([0, 1, K], [1, 4, G], [4, 6, K], [6, 9, G], [9, 10, K], [10, 11, G], [11, 13, K], [13, 15, G], [15, 16, K]),
  r([0, 1, K], [1, 2, G], [2, 4, C], [4, 13, G], [13, 15, C], [15, 16, K]),
  r([0, 1, K], [1, 2, G], [2, 4, C], [4, 5, G], [5, 6, K], [6, 8, G], [8, 9, K], [9, 11, G], [11, 12, K], [12, 13, G], [13, 15, C], [15, 16, K]),
  r([1, 2, K], [2, 5, G], [5, 12, K], [12, 14, G], [14, 15, K]),
  r([2, 3, K], [3, 13, G], [13, 14, K]),
  r([3, 13, K])
);

// ---- 足(24×5 の窓に、3種類の絵を差し替える)----
const FEET_W = 24;
const FEET = [
  // コマ1
  rows(
    r([2, 4, K], [4, 5, G]),
    r([1, 3, K], [3, 6, G], [19, 22, G], [22, 23, K]),
    r([0, 1, K], [1, 4, G], [4, 6, K], [6, 10, G], [10, 11, K], [14, 15, K], [15, 18, G], [18, 20, K], [20, 23, G], [23, 24, K]),
    r([0, 1, K], [1, 3, G], [3, 5, K], [6, 7, K], [7, 9, G], [9, 10, K], [15, 16, K], [16, 18, G], [18, 19, K], [20, 21, K], [21, 23, G], [23, 24, K]),
    r([0, 4, K], [6, 9, K], [16, 19, K], [21, 23, K])
  ),
  // コマ2〜5
  rows(
    r([2, 4, K], [4, 5, G]),
    r([1, 2, K], [2, 6, G], [19, 22, G], [22, 23, K]),
    r([0, 1, K], [1, 4, G], [4, 6, K], [6, 9, G], [9, 10, K], [14, 15, K], [15, 18, G], [18, 20, K], [20, 23, G], [23, 24, K]),
    r([0, 1, K], [1, 3, G], [3, 4, K], [5, 6, K], [6, 8, G], [8, 9, K], [15, 16, K], [16, 18, G], [18, 19, K], [20, 21, K], [21, 23, G], [23, 24, K]),
    r([0, 3, K], [6, 9, K], [16, 19, K], [21, 24, K])
  ),
  // コマ6(最終行だけ違う)
  rows(
    r([2, 4, K], [4, 5, G]),
    r([1, 2, K], [2, 6, G], [19, 22, G], [22, 23, K]),
    r([0, 1, K], [1, 4, G], [4, 6, K], [6, 9, G], [9, 10, K], [14, 15, K], [15, 18, G], [18, 20, K], [20, 23, G], [23, 24, K]),
    r([0, 1, K], [1, 3, G], [3, 4, K], [5, 6, K], [6, 8, G], [8, 9, K], [15, 16, K], [16, 18, G], [18, 19, K], [20, 21, K], [21, 23, G], [23, 24, K]),
    r([0, 3, K], [5, 8, K], [15, 18, K], [21, 24, K])
  ),
];

// ---- しっぽ(7×7 の窓に、5種類の絵を差し替える)----
const TAIL_W = 7;
const TAIL = [
  // コマ1・6
  rows(
    r([1, 5, K]),
    r([1, 2, K], [2, 4, G], [4, 6, K]),
    r([1, 3, K], [3, 5, G], [5, 7, K]),
    r([2, 4, K], [4, 6, G], [6, 7, K]),
    r([3, 5, K], [5, 7, G]),
    r([4, 7, K]),
    r([6, 7, K])
  ),
  // コマ2
  rows(
    r(),
    r([2, 4, K]),
    r([1, 2, K], [2, 4, G], [4, 5, K]),
    r([1, 2, K], [2, 4, G], [4, 7, K]),
    r([2, 3, K], [3, 7, G]),
    r([3, 5, K], [5, 7, G]),
    r([5, 7, K])
  ),
  // コマ3
  rows(
    r(),
    r(),
    r([6, 7, K]),
    r([3, 7, K]),
    r([1, 3, K], [3, 7, G]),
    r([1, 2, K], [2, 5, G], [5, 7, K]),
    r([2, 6, K])
  ),
  // コマ4
  rows(
    r(),
    r([5, 7, K]),
    r([3, 5, K], [5, 7, G]),
    r([2, 3, K], [3, 7, G]),
    r([1, 2, K], [2, 4, G], [4, 7, K]),
    r([1, 2, K], [2, 4, G], [4, 5, K]),
    r([2, 4, K])
  ),
  // コマ5
  rows(
    r(),
    r(),
    r([1, 5, K]),
    r([0, 1, K], [1, 4, G], [4, 7, K]),
    r([0, 2, K], [2, 6, G], [6, 7, K]),
    r([2, 6, K], [6, 7, G]),
    r([5, 7, K])
  ),
];

// ---- コマごとのパーツのずれ(元CSSの @keyframes を step-end で読んだ値)----
// catCycle / headCycle / feetCycle / feetSpriteCycle / tailCycle / tailSpriteCycle
const FRAMES = [
  { cat: 0, head: [0, 0], feetX: 0, feetArt: 0, tailY: 0, tailArt: 0 },
  { cat: 0, head: [1, 0], feetX: 1, feetArt: 1, tailY: 0, tailArt: 1 },
  { cat: 1, head: [1, 0], feetX: 2, feetArt: 1, tailY: 1, tailArt: 2 },
  { cat: 1, head: [1, 0], feetX: 1, feetArt: 1, tailY: 2, tailArt: 3 },
  { cat: 1, head: [0, 0], feetX: -1, feetArt: 1, tailY: -1, tailArt: 4 },
  { cat: 1, head: [0, -1], feetX: -1, feetArt: 2, tailY: -1, tailArt: 0 },
];

// スプライト1コマの大きさ。しっぽが左へ-7、頭が右へ+27まで出るので原点を+7ずらす
const FRAME_W = 34;
const FRAME_H = 21;
const ORIGIN_X = 7;

function blank() {
  return Array.from({ length: FRAME_H }, () => new Array(FRAME_W).fill(null));
}

// 絵(行×ラン)をグリッドへ焼き込む。窓(clip)を渡すとその範囲だけ描く
function paint(grid, art, offsetX, offsetY, clip) {
  for (const [y, runs] of art.entries()) {
    const py = offsetY + y;
    if (py < 0 || py >= FRAME_H) continue;
    if (clip && (py < clip.top || py >= clip.top + clip.height)) continue;
    for (const [from, to, color] of runs) {
      for (let x = from; x < to; x++) {
        const px = offsetX + x;
        if (px < 0 || px >= FRAME_W) continue;
        if (clip && (px < clip.left || px >= clip.left + clip.width)) continue;
        grid[py][px] = color;
      }
    }
  }
}

function buildFrame(f) {
  const grid = blank();
  const oy = f.cat; // 体全体の上下(catCycle)
  const X = (catX) => catX + ORIGIN_X;

  // 奥から手前へ: しっぽ → ポップタルト → 足 → 頭
  // しっぽは 7×7 の窓で切り取る(元CSSの overflow:hidden)
  paint(grid, TAIL[f.tailArt], X(-7), 7 + f.tailY + oy, {
    left: X(-7), top: 7 + f.tailY + oy, width: TAIL_W, height: 7,
  });

  paint(grid, POPTART, X(0), 0 + oy);
  for (const [sx, sy] of SPRINKLES) grid[sy + oy][X(sx)] = M;

  // 足も 24×5 の窓。差し替えた絵の5行がそのまま窓に入る
  paint(grid, FEET[f.feetArt], X(-2) + f.feetX, 15 + oy, {
    left: X(-2) + f.feetX, top: 15 + oy, width: FEET_W, height: 5,
  });

  paint(grid, HEAD, X(10) + f.head[0], 5 + f.head[1] + oy);
  return grid;
}

// 同じ色の横並びをまとめて1本のパスにする(rectを並べるよりかなり短い)
function gridsToSvg(grids) {
  const paths = new Map();
  for (const [index, grid] of grids.entries()) {
    const baseX = index * FRAME_W;
    for (let y = 0; y < FRAME_H; y++) {
      let x = 0;
      while (x < FRAME_W) {
        const color = grid[y][x];
        if (!color) {
          x++;
          continue;
        }
        let end = x;
        while (end < FRAME_W && grid[y][end] === color) end++;
        const width = end - x;
        if (!paths.has(color)) paths.set(color, []);
        paths.get(color).push(`M${baseX + x} ${y}h${width}v1h-${width}z`);
        x = end;
      }
    }
  }
  const body = [...paths]
    .map(([color, d]) => `<path fill='${color}' d='${d.join('')}'/>`)
    .join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${FRAME_W * grids.length}' height='${FRAME_H}' shape-rendering='crispEdges'>${body}</svg>`;
}

// ---- 虹(16×19の1タイル。repeat-xで横に伸ばす)----
// 元CSSは1色につき「左半分」「右半分」の2枚を1マスずらして重ね、階段状の縁を作っている。
// その重なりを展開すると、各色は「左半分だけの行 → 全幅2行 → 右半分だけの行」になる
const RAINBOW_COLORS = ['#ff0000', '#ff9900', '#ffff00', '#33ff00', '#0099ff', '#6633ff'];
const RAINBOW_W = 16;
const RAINBOW_H = 19;

function rainbowSvg() {
  const grid = Array.from({ length: RAINBOW_H }, () => new Array(RAINBOW_W).fill(null));
  // 後ろの色から塗り、手前の色で上書きする(元CSSの重ね順と同じ)
  for (let i = RAINBOW_COLORS.length - 1; i >= 0; i--) {
    const color = RAINBOW_COLORS[i];
    const top = i * 3;
    for (const [y, from, to] of [
      [top, 0, 8],
      [top + 1, 0, RAINBOW_W],
      [top + 2, 0, RAINBOW_W],
      [top + 3, 8, RAINBOW_W],
    ]) {
      if (y >= RAINBOW_H) continue;
      for (let x = from; x < to; x++) grid[y][x] = color;
    }
  }
  const paths = new Map();
  for (let y = 0; y < RAINBOW_H; y++) {
    let x = 0;
    while (x < RAINBOW_W) {
      const color = grid[y][x];
      if (!color) {
        x++;
        continue;
      }
      let end = x;
      while (end < RAINBOW_W && grid[y][end] === color) end++;
      if (!paths.has(color)) paths.set(color, []);
      paths.get(color).push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  const body = [...paths]
    .map(([color, d]) => `<path fill='${color}' d='${d.join('')}'/>`)
    .join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${RAINBOW_W}' height='${RAINBOW_H}' shape-rendering='crispEdges'>${body}</svg>`;
}

// CSSのurl()に入れられるようにする。' で囲むので " のエスケープは不要
const toDataUri = (svg) =>
  `url("data:image/svg+xml,${svg.replace(/[<>#%{}|\\^~[\]`"]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))}")`;

const catUri = toDataUri(gridsToSvg(FRAMES.map(buildFrame)));
const rainbowUri = toDataUri(rainbowSvg());

const out = `/*
 * 自動生成: node scripts/gen-nyan-sprite.js (手で編集しない)
 * タブの音声エフェクト「ニャンキャット」のドット絵。
 * --nyan-cat は6コマ横並びのスプライトシート(1コマ ${FRAME_W}x${FRAME_H}px)、
 * --nyan-rainbow は虹の1タイル(${RAINBOW_W}x${RAINBOW_H}px、repeat-xで伸ばす)。
 */
:root {
  --nyan-cat: ${catUri};
  --nyan-rainbow: ${rainbowUri};
}
`;

const file = path.join(__dirname, '..', 'src', 'renderer', 'nyan-sprite.css');
fs.writeFileSync(file, out, 'utf8');
console.log(`書き出し: ${file}`);
console.log(`猫スプライト: ${FRAME_W * 6}x${FRAME_H}px / ${(catUri.length / 1024).toFixed(1)}KB`);
console.log(`虹タイル: ${RAINBOW_W}x${RAINBOW_H}px / ${(rainbowUri.length / 1024).toFixed(1)}KB`);
