const MAX_QUICK_LINKS = 10;

const newtabEl = document.getElementById('newtab');
const clockEl = document.getElementById('clock');
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const greetingEl = document.getElementById('greeting');
const searchEl = document.getElementById('search');
const quickLinksEl = document.getElementById('quick-links');
const pageDotsEl = document.getElementById('shortcut-pages');
const localServersEl = document.getElementById('local-servers');

// ---- グリッドのアイコンサイズ(設定画面で最大サイズだけ手動設定)。列数・行数はウィンドウの
// 大きさから自動計算する(Androidのホーム画面と違い、ウィンドウをリサイズしてもアイコン自体の
// 大きさは変わらず、表示できる列数・行数だけが変わる) ----
const GRID_GAP = 14;
const MIN_MARGIN = 16; // 上下の要素と画面端に最低限残す余白
const MIN_ICON_SIZE = 48;
const MAX_ICON_SIZE = 160;
const MIN_COLS = 2; // 狭いウィンドウでも最低限これだけは表示する
const MIN_VISIBLE_ROWS = 2;
const MAX_VISIBLE_ROWS = 6;
const GRID_MAX_WIDTH = 700; // グリッド全体の目安の横幅=700pxとウィンドウ幅の小さいほう(この中に入る列数を計算する)
let iconSize = 96;
let computedCols = 6;
let computedRows = 3;

function applyGridMetrics() {
  const cellPx = Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, Math.round(iconSize) || 96));
  // グリッドは#newtabの箱の幅に縛られず独立に伸縮する(centerで見た目上はみ出さず中央寄せされる)。
  // 700pxとウィンドウ幅(左右の余白48pxを除く)の小さいほうに収まる列数を、アイコンサイズは変えずに計算する
  const targetW = Math.min(GRID_MAX_WIDTH, window.innerWidth - 48);
  const cols = Math.max(MIN_COLS, Math.floor((targetW + GRID_GAP) / (cellPx + GRID_GAP)));
  computedCols = cols;

  function fits() {
    const clockTop = clockEl.getBoundingClientRect().top;
    const tailEl = localServersEl.childElementCount ? localServersEl : pageDotsEl;
    const tailBottom = tailEl.getBoundingClientRect().bottom;
    return clockTop >= MIN_MARGIN && tailBottom <= window.innerHeight - MIN_MARGIN;
  }

  function apply(rows) {
    quickLinksEl.style.setProperty('--grid-cols', cols);
    quickLinksEl.style.setProperty('--cell', `${cellPx}px`);
    quickLinksEl.style.setProperty('--grid-height', `${rows * cellPx + GRID_GAP * (rows - 1)}px`);
  }

  newtabEl.style.removeProperty('--newtab-shift');
  for (let rows = MAX_VISIBLE_ROWS; rows >= MIN_VISIBLE_ROWS; rows--) {
    apply(rows);
    computedRows = rows;
    if (fits()) return;
    if (rows === MIN_VISIBLE_ROWS) break;
  }

  // 最小行数でも収まらない場合(アイコンサイズを大きくした狭い画面): 上にずらす分(既定-6vh)を
  // 段階的に緩めて時計を画面内に収める
  for (let vh = -6; vh <= 0; vh += 1) {
    newtabEl.style.setProperty('--newtab-shift', `${vh}vh`);
    if (fits()) return;
  }
}

let gridMetricsResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(gridMetricsResizeTimer);
  gridMetricsResizeTimer = setTimeout(applyGridMetrics, 120);
});

// ---- 背景(テーマ設定が auto なら時間帯で切り替え) ----
const bgEl = document.getElementById('bg');
const bgDimEl = document.getElementById('bg-dim');
let currentTheme = {};

function backgroundByHour(hour) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}

// ---- 三体問題の3Dシミュレーション(背景が threebody のときだけ動く) ----
// 初期条件はタブを開くたびにランダム。三体問題は「解が閉じた式で書けない」有名な例で、
// わずかな初期値の差で軌道が全く変わる(カオス)。だからタブごとに違う模様になる。
//
// 実装上の要点:
//  - 重力は 1/(r^2 + soft^2)^1.5 と軟化する。素の 1/r^2 だと二体が接近した瞬間に加速度が
//    発散し、座標がNaNへ飛んで絵が消える
//  - 積分はvelocity Verlet(シンプレクティック)。オイラー法はエネルギーが増え続けて破綻する
//  - それでも飛び去る/破綻することはあるので、その場合は新しい初期条件で組み直す
//  - 見えていない間(タブが裏、別のページ)はrAFを止める。裏で回し続けるとCPUを食う
const threeBody = (() => {
  const canvas = document.getElementById('bg-sim');
  const ctx = canvas.getContext('2d');
  const COLORS = ['#ffd479', '#7ad7f0', '#ff8fa3'];
  const G = 1;
  const SOFT = 0.35; // 軟化長。これ未満の距離では引力が頭打ちになる
  const DT = 0.004;
  const STEPS_PER_FRAME = 6;
  const TRAIL = 260; // 軌跡として保持する点の数
  const FOCAL = 2.2; // 透視投影の焦点距離(大きいほど遠近が弱い)

  let bodies = [];
  let running = false;
  let active = false;
  let frame = 0;
  let rotation = 0;
  let width = 0;
  let height = 0;

  const rand = (min, max) => min + Math.random() * (max - min);

  // 重心を原点・全運動量を0にした3体をランダムに作る(そうしないと全体が画面外へ流れていく)
  function seed() {
    const masses = [rand(0.8, 1.6), rand(0.8, 1.6), rand(0.8, 1.6)];
    const made = masses.map((mass) => ({
      mass,
      x: rand(-1.1, 1.1),
      y: rand(-1.1, 1.1),
      z: rand(-0.7, 0.7),
      vx: rand(-0.45, 0.45),
      vy: rand(-0.45, 0.45),
      vz: rand(-0.3, 0.3),
      ax: 0,
      ay: 0,
      az: 0,
      trail: [],
    }));
    const total = made.reduce((sum, b) => sum + b.mass, 0);
    for (const axis of ['x', 'y', 'z']) {
      const center = made.reduce((sum, b) => sum + b[axis] * b.mass, 0) / total;
      const v = 'v' + axis;
      const drift = made.reduce((sum, b) => sum + b[v] * b.mass, 0) / total;
      for (const b of made) {
        b[axis] -= center;
        b[v] -= drift;
      }
    }
    bodies = made;
    accelerate();
    rotation = rand(0, Math.PI * 2);
  }

  function accelerate() {
    for (const b of bodies) {
      b.ax = 0;
      b.ay = 0;
      b.az = 0;
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const soft = dx * dx + dy * dy + dz * dz + SOFT * SOFT;
        const inv = G / (soft * Math.sqrt(soft));
        a.ax += dx * inv * b.mass;
        a.ay += dy * inv * b.mass;
        a.az += dz * inv * b.mass;
        b.ax -= dx * inv * a.mass;
        b.ay -= dy * inv * a.mass;
        b.az -= dz * inv * a.mass;
      }
    }
  }

  function step() {
    for (const b of bodies) {
      b.x += b.vx * DT + 0.5 * b.ax * DT * DT;
      b.y += b.vy * DT + 0.5 * b.ay * DT * DT;
      b.z += b.vz * DT + 0.5 * b.az * DT * DT;
      b.vx += 0.5 * b.ax * DT;
      b.vy += 0.5 * b.ay * DT;
      b.vz += 0.5 * b.az * DT;
    }
    accelerate();
    for (const b of bodies) {
      b.vx += 0.5 * b.ax * DT;
      b.vy += 0.5 * b.ay * DT;
      b.vz += 0.5 * b.az * DT;
    }
  }

  // 1つでも飛び去った/数値が壊れたら作り直す(カオス系なのでいずれ必ず起きる)
  function needsReseed() {
    return bodies.some((b) => !Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz) || Math.hypot(b.x, b.y, b.z) > 9);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Y軸まわりに回してから透視投影する(ゆっくり回すと立体だと分かる)
  function project(x, y, z) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    const depth = FOCAL / (FOCAL + rz);
    const scale = Math.min(width, height) * 0.26;
    return { sx: width / 2 + rx * scale * depth, sy: height / 2 + y * scale * depth, depth };
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const [index, b] of bodies.entries()) {
      const color = COLORS[index % COLORS.length];
      // 軌跡(古いほど薄く)
      ctx.lineWidth = 1.4;
      for (let i = 1; i < b.trail.length; i++) {
        const prev = project(b.trail[i - 1].x, b.trail[i - 1].y, b.trail[i - 1].z);
        const cur = project(b.trail[i].x, b.trail[i].y, b.trail[i].z);
        ctx.strokeStyle = color;
        ctx.globalAlpha = (i / b.trail.length) * 0.5;
        ctx.beginPath();
        ctx.moveTo(prev.sx, prev.sy);
        ctx.lineTo(cur.sx, cur.sy);
        ctx.stroke();
      }
      // 本体(手前ほど大きく明るく)
      const p = project(b.x, b.y, b.z);
      const radius = Math.max(1.5, 4.5 * b.mass * p.depth);
      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, radius * 5);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 1フレーム分進めて描く(検証からも直接呼べるようにloopから切り出してある。
  // 画面に出ていないウィンドウではrequestAnimationFrameが回らないため)
  function tick() {
    for (let i = 0; i < STEPS_PER_FRAME; i++) step();
    if (needsReseed()) seed();
    frame++;
    if (frame % 2 === 0) {
      for (const b of bodies) {
        b.trail.push({ x: b.x, y: b.y, z: b.z });
        if (b.trail.length > TRAIL) b.trail.shift();
      }
    }
    rotation += 0.0012;
    draw();
  }

  function loop() {
    if (!running) return;
    tick();
    requestAnimationFrame(loop);
  }

  function start() {
    if (running || !active || document.hidden) return;
    running = true;
    resize();
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  window.addEventListener('resize', () => {
    if (running) resize();
  });
  // 裏に回ったら止める(見えていないタブでCPUを使い続けない)
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  return {
    setActive(next) {
      if (active === next) {
        if (next) start();
        return;
      }
      active = next;
      if (!next) {
        stop();
        ctx.clearRect(0, 0, width, height);
        return;
      }
      seed(); // タブごと(この新しいタブページごと)にランダムな初期条件
      start();
    },
    // 検証用(scripts/test-backgrounds.js)
    __state: () => ({ running, active, bodies: bodies.map((b) => ({ x: b.x, y: b.y, z: b.z, mass: b.mass, trail: b.trail.length })) }),
    __reseed: seed,
    __tick: tick,
  };
})();

// 検証用のフック(scripts/test-backgrounds.js から呼ぶ)
window.__threeBodyState = threeBody.__state;
window.__threeBodyReseed = threeBody.__reseed;
window.__threeBodyTick = threeBody.__tick;

function applyBackground() {
  const theme = currentTheme;
  const mode = theme.background || 'auto';
  const key = mode === 'auto' ? backgroundByHour(new Date().getHours()) : mode;
  document.body.dataset.bg = key;

  // インラインで触るのは background(グラデーション)と background-image(画像)だけ。
  // 先に両方消してからモードごとに設定する(背景色・パターンはCSS側が持つ)
  bgEl.style.background = '';

  // 画像: ぼかしと暗さ。ぼかすと縁が透けるので、ぼかし量のぶん外へはみ出させる
  const blur = Number.isFinite(theme.backgroundBlur) ? theme.backgroundBlur : 0;
  bgEl.style.backgroundImage = key === 'image' && theme.backgroundImage ? `url("${theme.backgroundImage}")` : '';
  bgEl.style.setProperty('--bg-blur', `${key === 'image' ? blur : 0}px`);
  bgEl.style.inset = key === 'image' && blur ? `-${4 + blur * 0.3}%` : '';
  const dim = Number.isFinite(theme.backgroundDim) ? theme.backgroundDim : 0;
  bgDimEl.style.setProperty('--bg-dim', String(key === 'image' ? dim / 100 : 0));

  // パターン: 種類と2色
  bgEl.dataset.pattern = theme.backgroundPattern || 'dots';
  bgEl.style.setProperty('--pattern-color', theme.patternColor || '#6c8cff');
  bgEl.style.setProperty('--pattern-base', theme.patternBase || '#12162b');

  // グラデーション: 検証済みの色(#rrggbb)だけが渡ってくるのでここで文字列に組み立てる
  if (key === 'gradient') {
    const stops = Array.isArray(theme.gradientStops) && theme.gradientStops.length >= 2 ? theme.gradientStops : ['#171632', '#453667'];
    const angle = Number.isFinite(theme.gradientAngle) ? theme.gradientAngle : 165;
    bgEl.style.background = `linear-gradient(${angle}deg, ${stops.join(', ')})`;
  }

  threeBody.setActive(key === 'threebody');
}

// theme.js から呼ばれる(初期化時とテーマ変更時)
window.onRoopieTheme = (theme) => {
  currentTheme = theme || {};
  applyBackground();
};
// theme.jsのgetTheme()がこのスクリプトの読み込みより先に解決していた場合に備える
if (window.__roopieLastTheme) window.onRoopieTheme(window.__roopieLastTheme);

// ---- 時計 ----
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]})`;

  const hour = now.getHours();
  greetingEl.textContent =
    hour < 5 ? 'おやすみなさい' : hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';

  applyBackground();
}

updateClock();
setInterval(updateClock, 10_000);

// ---- 検索 ----
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchEl.value.trim()) {
    window.roopieInternal.navigate(searchEl.value);
  }
});

// ---- ショートカット(bookmarksの "start" フォルダ以下。ページ=サブフォルダ) ----
// ショートカットのURLは file:// で始まればローカルフォルダ、それ以外はページ
let pages = [];
let currentPageId = null;
let shortcuts = [];

function shortcutKind(shortcut) {
  return shortcut.url.startsWith('file://') ? 'folder' : 'url';
}

function shortcutTarget(shortcut) {
  return shortcutKind(shortcut) === 'folder' ? shortcut.url.slice('file://'.length) : shortcut.url;
}

// 入力URL(スキーム省略可)のホスト名。取れなければ空文字
function hostnameOf(target) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`).hostname;
  } catch {
    return '';
  }
}

// リンク先のfavicon URL(既定アイコン)。ホストが取れないURLはnull
function faviconUrlFor(url) {
  try {
    const host = new URL(url).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
  } catch {
    return null;
  }
}

function letterPlaceholderEl(title) {
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  placeholder.textContent = (title[0] || '?').toUpperCase();
  return placeholder;
}

const FOLDER_ICON_SVG =
  '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// タイルの中身(アイコン部分)を作る。iconOverride はモーダルのプレビュー用
// (undefined = shortcut.icon を使う / null = 既定に戻した状態を表示)
function tileIconContent(tile, shortcut, iconOverride) {
  const icon = iconOverride !== undefined ? iconOverride : shortcut.icon ?? null;

  if (icon?.type === 'emoji' && icon.value) {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = icon.value;
    tile.appendChild(span);
  } else if (icon?.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.className = 'custom-image'; // アップロード画像はタイル全体に敷く(プロファイルのアバターと同じ見せ方)
    img.src = icon.value;
    tile.appendChild(img);
  } else if (shortcutKind(shortcut) === 'folder') {
    tile.innerHTML = FOLDER_ICON_SVG;
  } else {
    // 既定はリンク先のfavicon(訪問時に取得済みならそれ、なければfaviconサービス)。
    // 読み込めなければ頭文字にフォールバック
    const src = shortcut.favicon || faviconUrlFor(shortcut.url);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.addEventListener('error', () => img.replaceWith(letterPlaceholderEl(shortcut.title)));
      tile.appendChild(img);
    } else {
      tile.appendChild(letterPlaceholderEl(shortcut.title));
    }
  }
}

function shortcutTileEl(shortcut) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tileIconContent(tile, shortcut, undefined);
  return tile;
}

// =========================================================
// グリッド(ショートカット+ウィジェットをスマホのホーム画面風に配置)
// 並び順は widgets:layout(ページ単位)が持ち、ショートカットの実体はbookmarksのまま
// =========================================================
// 天気の既定の場所({ name, lat, lon })。イントロか設定画面で決める。null = 未設定
let defaultWeatherLocation = null;
let gridItems = []; // [{type:'shortcut', shortcut, x, y} | {type:'widget', id, widgetType, config, x, y, w, h}]
let gridElToItem = new Map();

const WIDGET_META = {
  weather: { name: '天気', icon: '🌤️', w: 2, h: 2 },
  notepad: { name: 'ノート', icon: '📝', w: 2, h: 2 },
  calendar: { name: 'カレンダー', icon: '📅', w: 2, h: 2 },
  news: { name: 'ニュース', icon: '📰', w: 3, h: 2 },
};
const MIN_WIDGET_SPAN = 2;
const MAX_WIDGET_SPAN = 4;

// 列数・行数はapplyGridMetrics()がウィンドウサイズから計算する(手動設定はアイコンサイズのみ)
function effectiveCols() {
  return computedCols;
}
function effectiveRows() {
  return computedRows;
}

// ---- グリッドの座標(x,y)まわりの純粋関数(スマホのホーム画面風。空きセルを自前で探すだけで、
// 既に置かれているアイテムの座標は絶対に動かさない=自動上詰めはしない) ----
function itemSpan(item) {
  return item.type === 'widget' ? [item.w, item.h] : [1, 1];
}
function footprintCells(x, y, w, h) {
  const cells = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push(`${x + dx},${y + dy}`);
  return cells;
}
function occupiedCells(items, exclude) {
  const set = new Set();
  for (const it of items) {
    if (it === exclude || it.x == null || it.y == null) continue;
    const [w, h] = itemSpan(it);
    for (const c of footprintCells(it.x, it.y, w, h)) set.add(c);
  }
  return set;
}
function spotFits(x, y, w, h, cols, occupied) {
  if (x < 0 || y < 0 || x + w > cols) return false;
  return footprintCells(x, y, w, h).every((c) => !occupied.has(c));
}
function findFreeSpot(w, h, cols, occupied) {
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (spotFits(x, y, w, h, cols, occupied)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function layoutForSave() {
  return gridItems.map((item) =>
    item.type === 'shortcut'
      ? { type: 'shortcut', refId: item.shortcut.id, x: item.x, y: item.y }
      : {
          type: 'widget',
          id: item.id,
          widgetType: item.widgetType,
          config: item.config,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        }
  );
}

// 保存済みの並びとブックマークの現状を突き合わせる(消えた参照は落とし、新規は空きセルへ)。
// rawLayoutに座標を持つアイテムはその座標をそのまま使う(=動かさない)。座標が無いアイテム
// (新規追加、または座標を持たない旧レイアウトからの移行)だけ空きセルを探して割り当てる
function reconcileLayout(rawLayout, list) {
  const cols = effectiveCols();
  const byId = new Map(list.map((s) => [s.id, s]));
  const seen = new Set();
  const items = [];
  for (const it of rawLayout ?? []) {
    if (it.type === 'shortcut') {
      const shortcut = byId.get(it.refId);
      if (shortcut && !seen.has(shortcut.id)) {
        items.push({ type: 'shortcut', shortcut, x: it.x, y: it.y });
        seen.add(shortcut.id);
      }
    } else if (it.type === 'widget' && WIDGET_META[it.widgetType]) {
      const meta = WIDGET_META[it.widgetType];
      items.push({
        type: 'widget',
        id: it.id,
        widgetType: it.widgetType,
        config: it.config ?? {},
        x: it.x,
        y: it.y,
        w: Number.isInteger(it.w) ? it.w : meta.w,
        h: Number.isInteger(it.h) ? it.h : meta.h,
      });
    }
  }
  for (const shortcut of list.slice(0, MAX_QUICK_LINKS)) {
    if (!seen.has(shortcut.id)) items.push({ type: 'shortcut', shortcut, x: undefined, y: undefined });
  }

  const occupied = occupiedCells(items);
  for (const it of items) {
    if (it.x == null || it.y == null) {
      const [w, h] = itemSpan(it);
      const spot = findFreeSpot(w, h, cols, occupied);
      it.x = spot.x;
      it.y = spot.y;
      for (const c of footprintCells(spot.x, spot.y, w, h)) occupied.add(c);
    }
  }
  return items;
}

function shortcutItemEl(shortcut) {
  const kind = shortcutKind(shortcut);
  const target = shortcutTarget(shortcut);
  const el = document.createElement(kind === 'folder' ? 'div' : 'a');
  el.className = 'quick-link';
  el.title = `${shortcut.title}\n${target}`;
  el.draggable = false; // <a>は既定でネイティブドラッグ対象になり、独自のpointerドラッグと衝突するため無効化
  if (kind === 'url') {
    el.href = shortcut.url;
  } else {
    el.addEventListener('click', () => window.roopieInternal.openShortcutFolder(target));
  }

  el.appendChild(shortcutTileEl(shortcut));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = shortcut.title;
  el.appendChild(label);

  const editBtn = document.createElement('button');
  editBtn.className = 'quick-link-edit';
  editBtn.title = '編集';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openShortcutModal(shortcut);
  });
  el.appendChild(editBtn);
  return el;
}

function widgetItemEl(item) {
  const el = document.createElement('div');
  el.className = `widget widget-${item.widgetType}`;

  const head = document.createElement('div');
  head.className = 'widget-head';
  const title = document.createElement('span');
  title.className = 'widget-title';
  title.textContent =
    item.widgetType === 'weather'
      ? item.config.name || defaultWeatherLocation?.name || WIDGET_META.weather.name
      : WIDGET_META[item.widgetType].name;
  const menuBtn = document.createElement('button');
  menuBtn.className = 'widget-menu-btn';
  menuBtn.textContent = '⋮';
  menuBtn.title = 'メニュー';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openWidgetMenu(menuBtn, el, item);
  });
  head.append(title, menuBtn);

  const body = document.createElement('div');
  body.className = 'widget-body';
  el.append(head, body);
  WIDGET_RENDERERS[item.widgetType](body, item);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'widget-resize-handle';
  resizeHandle.title = 'ドラッグしてサイズ変更';
  el.appendChild(resizeHandle);
  attachWidgetResize(resizeHandle, el, item);

  return el;
}

function applyItemPosition(el, x, y, w, h) {
  el.style.gridColumn = `${x + 1} / span ${w}`;
  el.style.gridRow = `${y + 1} / span ${h}`;
}

function renderGrid() {
  quickLinksEl.textContent = '';
  gridElToItem = new Map();

  for (const item of gridItems) {
    const el = item.type === 'shortcut' ? shortcutItemEl(item.shortcut) : widgetItemEl(item);
    el.classList.add('grid-item');
    el.dataset.gridKey = item.type === 'shortcut' ? `s:${item.shortcut.id}` : `w:${item.id}`;
    const [w, h] = itemSpan(item);
    applyItemPosition(el, item.x, item.y, w, h);
    gridElToItem.set(el, item);
    attachGridDrag(el, item);
    quickLinksEl.appendChild(el);
  }
}

// ---- 追加メニュー / ウィジェットメニュー(小さなポップアップ) ----
// anchorは要素(その下に開く)か、{x,y}(右クリック位置。その場に開く)のどちらか
function popupMenu(anchor, entries) {
  document.querySelector('.grid-popup')?.remove();
  const menu = document.createElement('div');
  menu.className = 'grid-popup';
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.className = 'grid-popup-item';
    btn.disabled = !!entry.disabled;
    btn.textContent = entry.label;
    btn.addEventListener('click', () => {
      close();
      entry.action();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  if (anchor instanceof Element) {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, innerWidth - menuRect.width - 8)}px`;
    menu.style.top =
      rect.bottom + menuRect.height + 8 < innerHeight ? `${rect.bottom + 6}px` : `${rect.top - menuRect.height - 6}px`;
  } else {
    menu.style.left = `${Math.min(anchor.x, innerWidth - menuRect.width - 8)}px`;
    menu.style.top = `${Math.min(anchor.y, innerHeight - menuRect.height - 8)}px`;
  }

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey);
  }
  function onOutside(e) {
    if (!menu.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey);
}

function openAddMenu(anchor) {
  const shortcutCount = gridItems.filter((i) => i.type === 'shortcut').length;
  popupMenu(anchor, [
    {
      label: '🔗 ショートカット',
      disabled: shortcutCount >= MAX_QUICK_LINKS,
      action: () => openShortcutModal(null),
    },
    ...Object.entries(WIDGET_META).map(([type, meta]) => ({
      label: `${meta.icon} ${meta.name}`,
      action: async () => {
        await window.roopieInternal.addWidget(currentPageId, type);
        await loadShortcuts();
      },
    })),
  ]);
}

// 右クリック(スタート画面の空いている場所)からショートカット・ウィジェットを追加。
// 検索欄・既存のショートカット/ウィジェット・他のポップアップの上では出さない
// (ローカルサーバー候補は自前でpreventDefault済みなのでdefaultPreventedのチェックだけで弾ける)
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  if (e.target.closest('#search, .grid-item, .grid-popup, .icon-picker, .icon-picker-backdrop')) return;
  e.preventDefault();
  openAddMenu({ x: e.clientX, y: e.clientY });
});

function openWidgetMenu(anchorEl, widgetEl, item) {
  const entries = [];
  const body = widgetEl.querySelector('.widget-body');
  if (item.widgetType === 'weather') {
    entries.push({
      label: '📍 場所を変更',
      action: () => renderWeatherSetup(body, item),
    });
  }
  if (item.widgetType === 'news') {
    entries.push({
      label: '📡 フィードを編集',
      action: () => renderNewsSetup(body, item),
    });
  }
  if (item.widgetType === 'weather' || item.widgetType === 'news') {
    entries.push({ label: '🔄 更新', action: () => WIDGET_RENDERERS[item.widgetType](body, item) });
  }
  entries.push({
    label: '🗑 削除',
    action: async () => {
      window.roopieInternal.removeWidget(currentPageId, item.id);
      await loadShortcuts();
    },
  });
  popupMenu(anchorEl, entries);
}

// ---- ドラッグで並べ替え(スマホのホーム画面風。掴んだアイコン/ウィジェットだけがポインタに
// 追従し、他のアイテムは自動で詰め直さない。ドロップ先が空きセルなら移動、同じ大きさの
// アイテムと重なったら入れ替え、それ以外(サイズ違いと重なる等)は元の位置に戻すだけ) ----
const DRAG_THRESHOLD = 6; // px。これ未満の移動はクリック扱い(誤爆防止)
let dragState = null;

function currentCellPx() {
  const v = parseFloat(getComputedStyle(quickLinksEl).getPropertyValue('--cell'));
  return Number.isFinite(v) && v > 0 ? v : 84;
}

// ドラッグ中はセルの区切り線+ドロップ先のプレビューを表示する(スマホのホーム画面風で直感的に
// 操作できるように)。座標はposition:fixedで、#quick-linksの現在のスクロール位置を差し引いて
// ドラッグ中のアイテム本体(同じくposition:fixed)とぴったり揃える
function gridOrigin() {
  const rect = quickLinksEl.getBoundingClientRect();
  return { left: rect.left, top: rect.top - quickLinksEl.scrollTop };
}
function cellPixelRect(x, y, w, h) {
  const cellPx = currentCellPx();
  const step = cellPx + GRID_GAP;
  const origin = gridOrigin();
  return {
    left: origin.left + x * step,
    top: origin.top + y * step,
    width: w * cellPx + (w - 1) * GRID_GAP,
    height: h * cellPx + (h - 1) * GRID_GAP,
  };
}
function findSwapTarget(item, x, y, w, h) {
  return gridItems.find((it) => {
    if (it === item) return false;
    const [ow, oh] = itemSpan(it);
    return it.x === x && it.y === y && ow === w && oh === h;
  });
}

let dragOverlay = null;

function showGridOverlay(item) {
  const cols = effectiveCols();
  const maxY = gridItems.reduce((m, it) => Math.max(m, it.y + itemSpan(it)[1]), 0);
  const rows = Math.max(effectiveRows(), maxY + 1);

  const root = document.createElement('div');
  root.className = 'grid-overlay';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const r = cellPixelRect(x, y, 1, 1);
      const cell = document.createElement('div');
      cell.className = 'grid-overlay-cell';
      Object.assign(cell.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      root.appendChild(cell);
    }
  }
  const preview = document.createElement('div');
  preview.className = 'grid-overlay-preview';
  root.appendChild(preview);
  document.body.appendChild(root);
  dragOverlay = { root, preview };
  updateGridOverlayPreview(item, item.x, item.y);
}

function updateGridOverlayPreview(item, x, y, wOverride, hOverride) {
  if (!dragOverlay) return;
  const [iw, ih] = itemSpan(item);
  const w = wOverride ?? iw;
  const h = hOverride ?? ih;
  const cols = effectiveCols();
  const inBounds = x >= 0 && y >= 0 && x + w <= cols;
  if (!inBounds) {
    dragOverlay.preview.style.display = 'none';
    return;
  }
  const r = cellPixelRect(x, y, w, h);
  Object.assign(dragOverlay.preview.style, {
    display: '',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  const occupied = occupiedCells(gridItems, item);
  const free = spotFits(x, y, w, h, cols, occupied);
  const swapTarget = !free && findSwapTarget(item, x, y, w, h);
  dragOverlay.preview.classList.toggle('valid', free);
  dragOverlay.preview.classList.toggle('swap', !!swapTarget);
  dragOverlay.preview.classList.toggle('blocked', !free && !swapTarget);
}

function hideGridOverlay() {
  dragOverlay?.root.remove();
  dragOverlay = null;
}

function attachGridDrag(el, item) {
  // ウィジェットはヘッダーだけ、ショートカットはタイル全体をつまめる
  const handle = item.type === 'widget' ? el.querySelector('.widget-head') : el;
  handle.addEventListener('pointerdown', (e) => {
    if (dragState || e.button !== 0) return;
    const [w, h] = itemSpan(item);
    dragState = {
      item,
      el,
      handle,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: item.x,
      originY: item.y,
      w,
      h,
      moved: false,
      targetX: item.x,
      targetY: item.y,
    };
  });
  handle.addEventListener('pointermove', onGridPointerMove);
  handle.addEventListener('pointerup', onGridPointerUp);
  handle.addEventListener('pointercancel', onGridPointerUp);
}

function beginDragVisual(state) {
  const rect = state.el.getBoundingClientRect();
  state.baseLeft = rect.left;
  state.baseTop = rect.top;
  state.el.classList.add('dragging');
  Object.assign(state.el.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  try {
    state.handle.setPointerCapture?.(state.pointerId);
  } catch {
    // ポインタが既に離れている/合成イベント等でキャプチャできない場合は無視(座標計算はpointerIdに依らない)
  }
  showGridOverlay(state.item);
}

function endDragVisual(state) {
  state.el.classList.remove('dragging');
  Object.assign(state.el.style, { position: '', left: '', top: '', width: '', height: '' });
  try {
    state.handle.releasePointerCapture?.(state.pointerId);
  } catch {
    // 未キャプチャなら何もしない
  }
  hideGridOverlay();
}

function onGridPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dx = e.clientX - dragState.startClientX;
  const dy = e.clientY - dragState.startClientY;
  if (!dragState.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragState.moved = true;
    beginDragVisual(dragState);
  }
  dragState.el.style.left = `${dragState.baseLeft + dx}px`;
  dragState.el.style.top = `${dragState.baseTop + dy}px`;

  const step = currentCellPx() + GRID_GAP;
  const cols = effectiveCols();
  dragState.targetX = Math.min(cols - dragState.w, Math.max(0, dragState.originX + Math.round(dx / step)));
  dragState.targetY = Math.max(0, dragState.originY + Math.round(dy / step));
  updateGridOverlayPreview(dragState.item, dragState.targetX, dragState.targetY);
}

function onGridPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const state = dragState;
  dragState = null;
  if (!state.moved) return; // 動いていなければ通常のクリックとして扱う(何もしない)
  endDragVisual(state);
  tryMoveItem(state.item, state.targetX, state.targetY);
}

function tryMoveItem(item, x, y) {
  const [w, h] = itemSpan(item);
  const cols = effectiveCols();
  if ((x !== item.x || y !== item.y) && x >= 0 && y >= 0 && x + w <= cols) {
    const occupied = occupiedCells(gridItems, item);
    if (spotFits(x, y, w, h, cols, occupied)) {
      item.x = x;
      item.y = y;
      persistGridOrder();
    } else {
      const other = findSwapTarget(item, x, y, w, h);
      if (other) {
        const ox = other.x;
        const oy = other.y;
        other.x = item.x;
        other.y = item.y;
        item.x = x;
        item.y = y;
        persistGridOrder();
      }
      // サイズ違いと重なる等、それ以外は何もしない(元の位置に戻すだけ)
    }
  }
  renderGrid();
}

function persistGridOrder() {
  if (currentPageId) window.roopieInternal.setWidgetLayout(currentPageId, layoutForSave());
}

// ---- ウィジェットのサイズ変更(右下のハンドルをドラッグ。他のアイテムと重ならない範囲で
// セル単位に伸縮。グリッド線+プレビューは移動ドラッグと同じオーバーレイを流用) ----
let resizeState = null;

function attachWidgetResize(handle, el, item) {
  handle.addEventListener('pointerdown', (e) => {
    if (resizeState || dragState || e.button !== 0) return;
    resizeState = {
      item,
      el,
      handle,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: item.w,
      startH: item.h,
      w: item.w,
      h: item.h,
    };
    el.classList.add('resizing');
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
      // 合成イベント等でキャプチャできない場合は無視
    }
    showGridOverlay(item);
  });
  handle.addEventListener('pointermove', onWidgetResizeMove);
  handle.addEventListener('pointerup', onWidgetResizeUp);
  handle.addEventListener('pointercancel', onWidgetResizeUp);
}

function onWidgetResizeMove(e) {
  if (!resizeState || e.pointerId !== resizeState.pointerId) return;
  const dx = e.clientX - resizeState.startClientX;
  const dy = e.clientY - resizeState.startClientY;
  const step = currentCellPx() + GRID_GAP;
  const cols = effectiveCols();
  const item = resizeState.item;
  const maxW = Math.min(MAX_WIDGET_SPAN, cols - item.x);
  const candW = Math.min(maxW, Math.max(MIN_WIDGET_SPAN, resizeState.startW + Math.round(dx / step)));
  const candH = Math.min(MAX_WIDGET_SPAN, Math.max(MIN_WIDGET_SPAN, resizeState.startH + Math.round(dy / step)));

  // 他のアイテムと重ならない範囲でのみサイズを更新する(重なる場合は直前の有効なサイズを維持)
  const occupied = occupiedCells(gridItems, item);
  if (spotFits(item.x, item.y, candW, candH, cols, occupied)) {
    resizeState.w = candW;
    resizeState.h = candH;
  }

  applyItemPosition(resizeState.el, item.x, item.y, resizeState.w, resizeState.h);
  updateGridOverlayPreview(item, item.x, item.y, resizeState.w, resizeState.h);
}

function onWidgetResizeUp(e) {
  if (!resizeState || e.pointerId !== resizeState.pointerId) return;
  const state = resizeState;
  resizeState = null;
  state.el.classList.remove('resizing');
  try {
    state.handle.releasePointerCapture?.(e.pointerId);
  } catch {
    // 未キャプチャなら何もしない
  }
  hideGridOverlay();
  if (state.w !== state.item.w || state.h !== state.item.h) {
    state.item.w = state.w;
    state.item.h = state.h;
    persistGridOrder();
  }
  renderGrid();
}

// =========================================================
// 各ウィジェットの描画
// =========================================================
function widgetNote(body, text) {
  body.textContent = '';
  const note = document.createElement('div');
  note.className = 'widget-note';
  note.textContent = text;
  body.appendChild(note);
  return note;
}

// ウィジェット内の設定UIの一時メッセージ(空文字で消す)。操作が無視された理由をその場で伝える
let widgetSetupErrorTimer = null;
function widgetSetupError(wrap, message) {
  clearTimeout(widgetSetupErrorTimer);
  let el = wrap.querySelector('.widget-setup-error');
  if (!message) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'widget-setup-error';
    const list = wrap.querySelector('.widget-setup-results');
    if (list) wrap.insertBefore(el, list);
    else wrap.appendChild(el);
  }
  el.textContent = message;
  widgetSetupErrorTimer = setTimeout(() => el.remove(), 4000);
}

// ---- 天気(Open-Meteo。メイン経由で取得) ----
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

async function renderWeather(body, item) {
  // ウィジェット個別の設定 → 設定画面/イントロで決めた既定の場所 の順に使う。
  // どちらも無ければ場所を選ぶUIを出す(固定の初期値は持たない)
  const cfg = Number.isFinite(item.config?.lat) ? item.config : defaultWeatherLocation;
  if (!Number.isFinite(cfg?.lat)) {
    renderWeatherSetup(body, item);
    return;
  }
  widgetNote(body, '読み込み中…');
  const data = await window.roopieInternal.getWeather(cfg.lat, cfg.lon);
  if (!data || !Number.isFinite(data.current?.temp)) {
    widgetNote(body, '天気を取得できませんでした');
    return;
  }
  body.textContent = '';

  const now = document.createElement('div');
  now.className = 'weather-now';
  const icon = document.createElement('span');
  icon.className = 'weather-icon';
  icon.textContent = weatherEmoji(data.current.code);
  const temp = document.createElement('span');
  temp.className = 'weather-temp';
  temp.textContent = `${Math.round(data.current.temp)}°`;
  now.append(icon, temp);
  body.appendChild(now);

  const days = document.createElement('div');
  days.className = 'weather-days';
  for (const day of data.daily.slice(0, 3)) {
    const col = document.createElement('div');
    col.className = 'weather-day';
    const date = new Date(day.date + 'T00:00');
    const label = document.createElement('span');
    label.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    const em = document.createElement('span');
    em.textContent = weatherEmoji(day.code);
    const range = document.createElement('span');
    range.className = 'weather-range';
    range.textContent = `${Math.round(day.max)}°/${Math.round(day.min)}°`;
    col.append(label, em, range);
    days.appendChild(col);
  }
  body.appendChild(days);
}

function renderWeatherSetup(body, item) {
  body.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'widget-setup';
  const input = document.createElement('input');
  input.className = 'widget-input';
  input.type = 'text';
  // 検索API(Open-Meteo)は日本語の地名でも当たるものと当たらないものがある
  // (「名古屋」「東京都」は当たるが「東京」「大阪」「札幌」は0件)。ローマ字なら確実に当たる
  input.placeholder = '都市名(例: Tokyo / 名古屋)';
  const results = document.createElement('div');
  results.className = 'widget-setup-results';

  async function search() {
    const query = input.value.trim();
    if (!query) return;
    results.textContent = '検索中…';
    const places = await window.roopieInternal.geocodeCity(query);
    results.textContent = '';
    if (!places.length) {
      results.textContent = /[^\x00-\x7F]/.test(query)
        ? '見つかりませんでした。ローマ字でも試してみてください(例: Tokyo)'
        : '見つかりませんでした';
      return;
    }
    for (const place of places) {
      const btn = document.createElement('button');
      btn.className = 'widget-setup-result';
      btn.textContent = [place.name, place.admin, place.country].filter(Boolean).join(' / ');
      btn.addEventListener('click', () => {
        item.config = { name: place.name, lat: place.lat, lon: place.lon };
        window.roopieInternal.setWidgetConfig(currentPageId, item.id, item.config);
        const titleEl = body.parentElement.querySelector('.widget-title');
        if (titleEl) titleEl.textContent = place.name;
        renderWeather(body, item);
      });
      results.appendChild(btn);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search();
  });
  const searchBtn = document.createElement('button');
  searchBtn.className = 'widget-btn';
  searchBtn.textContent = '検索';
  searchBtn.addEventListener('click', search);

  const row = document.createElement('div');
  row.className = 'widget-setup-row';
  row.append(input, searchBtn);
  wrap.append(row, results);
  body.appendChild(wrap);
  input.focus();
}

// ---- ノートパッド(自動保存) ----
function renderNotepad(body, item) {
  body.textContent = '';
  const textarea = document.createElement('textarea');
  // クラス名はコンテナの .widget-notepad(widget-<type>)と衝突しないようにする
  textarea.className = 'notepad-textarea';
  textarea.placeholder = 'メモを入力…(自動保存)';
  textarea.value = item.config.text ?? '';
  let timer = null;
  textarea.addEventListener('input', () => {
    item.config.text = textarea.value;
    clearTimeout(timer);
    timer = setTimeout(
      () => window.roopieInternal.setWidgetConfig(currentPageId, item.id, { text: textarea.value }),
      500
    );
  });
  body.appendChild(textarea);
}

// ---- カレンダー(月表示) ----
function renderCalendar(body, item, offset = 0) {
  body.textContent = '';
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);

  const head = document.createElement('div');
  head.className = 'cal-head';
  const prev = document.createElement('button');
  prev.className = 'cal-nav';
  prev.textContent = '‹';
  prev.addEventListener('click', () => renderCalendar(body, item, offset - 1));
  const label = document.createElement('span');
  label.textContent = `${base.getFullYear()}年${base.getMonth() + 1}月`;
  const next = document.createElement('button');
  next.className = 'cal-nav';
  next.textContent = '›';
  next.addEventListener('click', () => renderCalendar(body, item, offset + 1));
  head.append(prev, label, next);
  body.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
    const cell = document.createElement('span');
    cell.className = 'cal-weekday';
    cell.textContent = w;
    grid.appendChild(cell);
  }
  const firstDay = base.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('span'));
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('span');
    cell.className = 'cal-day';
    cell.textContent = String(d);
    if (
      offset === 0 &&
      d === today.getDate()
    ) {
      cell.classList.add('today');
    }
    const dow = (firstDay + d - 1) % 7;
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');
    grid.appendChild(cell);
  }
  body.appendChild(grid);
}

// ---- ニュース(RSS。メイン経由で取得し、DOMParserでパース) ----
// 「+ ラベル」ボタンで1クリック追加できる定番フィード。
// URLは実際に取得できることを確認済み(CNNはhttpsを提供していないためhttpのみ)
const NEWS_PRESETS = [
  { label: 'NHKニュース', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
  { label: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml' },
  { label: 'テレビ朝日(ANN)', url: 'https://news.yahoo.co.jp/rss/media/ann/all.xml' },
  { label: 'BBC News Japan', url: 'https://feeds.bbci.co.uk/japanese/rss.xml' },
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss' },
  { label: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
  { label: 'NYタイムズ', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
];

function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  const source = doc.querySelector('channel > title, feed > title')?.textContent?.trim() ?? '';
  // RSS 2.0
  let entries = [...doc.querySelectorAll('item')].map((item) => ({
    title: item.querySelector('title')?.textContent?.trim() ?? '',
    link: item.querySelector('link')?.textContent?.trim() ?? '',
    date: new Date(item.querySelector('pubDate, date')?.textContent ?? 0).getTime() || 0,
    source,
  }));
  // Atom
  if (!entries.length) {
    entries = [...doc.querySelectorAll('entry')].map((entry) => ({
      title: entry.querySelector('title')?.textContent?.trim() ?? '',
      link: entry.querySelector('link')?.getAttribute('href') ?? '',
      date: new Date(entry.querySelector('updated, published')?.textContent ?? 0).getTime() || 0,
      source,
    }));
  }
  return entries.filter((e) => e.title && /^https?:/i.test(e.link));
}

async function renderNews(body, item) {
  const feeds = item.config.feeds ?? [];
  if (!feeds.length) {
    renderNewsSetup(body, item);
    return;
  }
  widgetNote(body, '読み込み中…');
  const xmls = await Promise.all(feeds.map((url) => window.roopieInternal.getRss(url)));
  const entries = xmls
    .filter(Boolean)
    .flatMap(parseFeed)
    .sort((a, b) => b.date - a.date)
    .slice(0, 8);
  body.textContent = '';
  if (!entries.length) {
    widgetNote(body, 'ニュースを取得できませんでした');
    return;
  }
  const list = document.createElement('div');
  list.className = 'news-list';
  for (const entry of entries) {
    const a = document.createElement('a');
    a.className = 'news-item';
    a.href = entry.link;
    a.title = `${entry.title}\n${entry.source}`;
    a.textContent = entry.title;
    list.appendChild(a);
  }
  body.appendChild(list);
}

// URLを人が読める名前にする(定番フィードならそのラベル、それ以外はホスト名)
function feedLabel(url) {
  const preset = NEWS_PRESETS.find((p) => p.url === url);
  if (preset) return preset.label;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ウィジェットは小さい(既定3x2セル)ため中身が入りきらない。縦に潰すのではなく
// .widget-setup ごとスクロールさせる(CSS側で子をflex-shrink:0にしてある)
function renderNewsSetup(body, item) {
  body.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'widget-setup';

  const feeds = (item.config.feeds ?? []).slice();
  const listEl = document.createElement('div');
  listEl.className = 'widget-setup-results';

  function save() {
    item.config.feeds = feeds;
    window.roopieInternal.setWidgetConfig(currentPageId, item.id, { feeds });
  }
  function renderList() {
    listEl.textContent = '';
    if (!feeds.length) {
      const empty = document.createElement('div');
      empty.className = 'widget-note';
      empty.textContent = 'フィードを追加してください';
      listEl.appendChild(empty);
    }
    for (const [index, url] of feeds.entries()) {
      const row = document.createElement('div');
      row.className = 'widget-feed-row';
      const label = document.createElement('span');
      label.textContent = feedLabel(url);
      label.title = url;
      const remove = document.createElement('button');
      remove.className = 'widget-btn';
      remove.textContent = '✕';
      remove.title = '削除';
      remove.addEventListener('click', () => {
        feeds.splice(index, 1);
        save();
        renderList();
        renderPresets();
        syncDone();
      });
      row.append(label, remove);
      listEl.appendChild(row);
    }
  }

  const input = document.createElement('input');
  input.className = 'widget-input';
  input.type = 'text';
  input.placeholder = 'RSSフィードのURL';
  const addBtn = document.createElement('button');
  addBtn.className = 'widget-btn';
  addBtn.textContent = '追加';
  // 追加できなかった理由(URL形式・重複)を黙って捨てず、その場で伝える
  function addFeed(url) {
    const clean = String(url ?? '').trim();
    if (!clean) return;
    if (!/^https?:\/\//i.test(clean)) {
      widgetSetupError(wrap, 'http:// または https:// で始まるURLを入力してください');
      return;
    }
    if (feeds.includes(clean)) {
      widgetSetupError(wrap, 'そのフィードは追加済みです');
      return;
    }
    feeds.push(clean);
    save();
    renderList();
    renderPresets();
    syncDone();
    input.value = '';
    widgetSetupError(wrap, '');
  }
  addBtn.addEventListener('click', () => addFeed(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFeed(input.value);
  });

  const row = document.createElement('div');
  row.className = 'widget-setup-row';
  row.append(input, addBtn);

  // 定番フィードのボタン列。追加済みのものは押せなくする(押した手応えになる)
  const presetRow = document.createElement('div');
  presetRow.className = 'widget-setup-row';
  const presetBtns = NEWS_PRESETS.map((preset) => {
    const btn = document.createElement('button');
    btn.className = 'widget-btn';
    btn.textContent = `+ ${preset.label}`;
    btn.addEventListener('click', () => addFeed(preset.url));
    presetRow.appendChild(btn);
    return { preset, btn };
  });
  function renderPresets() {
    for (const { preset, btn } of presetBtns) {
      const added = feeds.includes(preset.url);
      btn.disabled = added;
      btn.textContent = `${added ? '✓' : '+'} ${preset.label}`;
    }
  }
  renderPresets();

  const done = document.createElement('button');
  done.className = 'widget-btn widget-btn-primary';
  done.addEventListener('click', () => renderNews(body, item));
  // フィードが無いまま「表示する」を押すとこの画面に戻るだけで壊れて見えるので、その間は押せなくする
  function syncDone() {
    done.disabled = !feeds.length;
    done.textContent = feeds.length ? `表示する(${feeds.length}件)` : '表示する';
  }
  renderList();
  syncDone();

  wrap.append(row, presetRow, listEl, done);
  body.appendChild(wrap);
}

const WIDGET_RENDERERS = {
  weather: renderWeather,
  notepad: renderNotepad,
  calendar: (body, item) => renderCalendar(body, item, 0),
  news: renderNews,
};

// ---- ページ切り替え(複数ページ=startフォルダ直下の各サブフォルダ) ----
function renderPageDots() {
  pageDotsEl.textContent = '';
  if (pages.length > 1) {
    for (const page of pages) {
      const dot = document.createElement('button');
      dot.className = 'page-dot' + (page.id === currentPageId ? ' active' : '');
      dot.title = page.title;
      dot.addEventListener('click', () => switchToPage(page.id));
      pageDotsEl.appendChild(dot);
    }
  }
  const addDot = document.createElement('button');
  addDot.className = 'page-dot page-dot-add';
  addDot.title = 'ページを追加';
  addDot.textContent = '+';
  addDot.addEventListener('click', async () => {
    const page = await window.roopieInternal.addStartPage('');
    if (page) {
      currentPageId = page.id;
      await loadPages();
    }
  });
  pageDotsEl.appendChild(addDot);
}

async function loadShortcuts() {
  if (!currentPageId) {
    shortcuts = [];
    gridItems = [];
    renderGrid();
    return;
  }
  const [list, rawLayout] = await Promise.all([
    window.roopieInternal.listShortcuts(currentPageId),
    window.roopieInternal.getWidgetLayout(currentPageId),
  ]);
  shortcuts = list;
  gridItems = reconcileLayout(rawLayout, list);
  renderGrid();
  applyGridMetrics();
  // reconcileLayoutで新しく空きセルへ自動配置された座標をすぐ保存する(次回以降は動かさないため)
  persistGridOrder();
}

async function loadPages() {
  pages = await window.roopieInternal.listStartPages();
  if (!pages.find((p) => p.id === currentPageId)) currentPageId = pages[0]?.id ?? null;
  renderPageDots();
  await loadShortcuts();
}

// ---- ページのスワイプ切り替え(スマホのホーム画面風。トラックパッドの横スワイプ/タッチに対応) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SWIPE_SLIDE = 28; // 切り替え時にスライドさせる距離(px)

let pageSwitchBusy = false;
async function switchToPage(pageId, dir = 0) {
  if (pageSwitchBusy || pageId === currentPageId) return;
  const fromIdx = pages.findIndex((p) => p.id === currentPageId);
  const toIdx = pages.findIndex((p) => p.id === pageId);
  if (toIdx === -1) return;
  if (!dir) dir = toIdx > fromIdx ? 1 : -1;

  pageSwitchBusy = true;
  currentPageId = pageId;
  renderPageDots();

  quickLinksEl.animate(
    [
      { transform: 'translateX(0)', opacity: 1 },
      { transform: `translateX(${-dir * SWIPE_SLIDE}px)`, opacity: 0 },
    ],
    { duration: 120, easing: 'ease-in', fill: 'forwards' }
  );
  await sleep(120);
  await loadShortcuts();
  quickLinksEl.animate(
    [
      { transform: `translateX(${dir * SWIPE_SLIDE}px)`, opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: 160, easing: 'ease-out' }
  );
  pageSwitchBusy = false;
}

function goToAdjacentPage(dir) {
  if (pages.length < 2) return;
  const idx = pages.findIndex((p) => p.id === currentPageId);
  const next = pages[idx + dir];
  if (next) switchToPage(next.id, dir);
}

// トラックパッドの横スワイプ(precisionタッチパッドはwheelイベントのdeltaXとして届く)
let wheelCooldown = false;
quickLinksEl.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (wheelCooldown) return;
    wheelCooldown = true;
    goToAdjacentPage(e.deltaX > 0 ? 1 : -1);
    setTimeout(() => {
      wheelCooldown = false;
    }, 350);
  },
  { passive: false }
);

// タッチスワイプ
let touchStartX = null;
let touchStartY = null;
quickLinksEl.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  },
  { passive: true }
);
quickLinksEl.addEventListener(
  'touchend',
  (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goToAdjacentPage(dx < 0 ? 1 : -1);
    }
  },
  { passive: true }
);

// ---- 追加/編集モーダル ----
function radioOption(name, value, label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'shortcut-kind-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  wrap.append(input, Object.assign(document.createElement('span'), { textContent: label }));
  return { wrap, input };
}

function openShortcutModal(existing) {
  const backdrop = document.createElement('div');
  backdrop.className = 'shortcut-backdrop';

  const modal = document.createElement('div');
  modal.className = 'shortcut-modal';

  const existingKind = existing ? shortcutKind(existing) : 'url';
  const existingTarget = existing ? shortcutTarget(existing) : '';

  const title = document.createElement('h3');
  title.textContent = existing ? 'ショートカットを編集' : 'ショートカットを追加';
  modal.appendChild(title);

  const kindRow = document.createElement('div');
  kindRow.className = 'shortcut-kind-row';
  const kindUrl = radioOption('shortcut-kind', 'url', 'ページ', existingKind !== 'folder');
  const kindFolder = radioOption('shortcut-kind', 'folder', 'フォルダ', existingKind === 'folder');
  kindRow.append(kindUrl.wrap, kindFolder.wrap);
  modal.appendChild(kindRow);

  const nameInput = document.createElement('input');
  nameInput.className = 'search';
  nameInput.type = 'text';
  nameInput.placeholder = '名前(空欄ならページタイトルを自動取得)';
  nameInput.value = existing?.title ?? '';
  modal.appendChild(nameInput);

  const urlInput = document.createElement('input');
  urlInput.className = 'search';
  urlInput.type = 'text';
  urlInput.placeholder = 'URL(例: example.com)';
  urlInput.value = existingKind !== 'folder' ? existingTarget : '';
  modal.appendChild(urlInput);

  let pickedFolder = existingKind === 'folder' ? existingTarget : '';
  const folderRow = document.createElement('div');
  folderRow.className = 'shortcut-folder-row';
  const folderPathText = document.createElement('span');
  folderPathText.className = 'shortcut-folder-path';
  folderPathText.textContent = pickedFolder || '未選択';
  const folderPickBtn = document.createElement('button');
  folderPickBtn.className = 'btn';
  folderPickBtn.textContent = 'フォルダを選択';
  folderPickBtn.addEventListener('click', async () => {
    const picked = await window.roopieInternal.pickShortcutFolder();
    if (picked) {
      pickedFolder = picked;
      folderPathText.textContent = picked;
    }
  });
  folderRow.append(folderPickBtn, folderPathText);
  modal.appendChild(folderRow);

  function syncKindVisibility() {
    const isFolder = kindFolder.input.checked;
    urlInput.classList.toggle('hidden', isFolder);
    folderRow.classList.toggle('hidden', !isFolder);
  }
  kindUrl.input.addEventListener('change', syncKindVisibility);
  kindFolder.input.addEventListener('change', syncKindVisibility);
  syncKindVisibility();

  // アイコン: プロファイルと同じ共通ピッカー(絵文字グリッド+自由入力+画像クロップ)。
  // 既定はリンク先のfavicon。pendingIcon: undefined=変更なし / null=既定に戻す / {type,value}=変更
  let pendingIcon;
  const iconRow = document.createElement('div');
  iconRow.className = 'shortcut-icon-row';
  const iconPreview = document.createElement('div');
  iconPreview.className = 'tile shortcut-icon-preview';
  const iconLabel = document.createElement('span');
  iconLabel.className = 'shortcut-icon-label';
  const iconBtn = document.createElement('button');
  iconBtn.className = 'btn';
  iconBtn.textContent = 'アイコンを変更';
  iconRow.append(iconPreview, iconLabel, iconBtn);
  modal.appendChild(iconRow);

  function renderIconPreview() {
    iconPreview.textContent = '';
    // プレビューは現在の入力内容(URL/フォルダ)を反映した仮のショートカットで描く
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    const preview = {
      title: nameInput.value.trim() || existing?.title || '?',
      url: kind === 'folder' ? `file://${target}` : /^https?:/i.test(target) ? target : `https://${target}`,
      favicon: existing?.favicon ?? null,
      icon: existing?.icon ?? null,
    };
    tileIconContent(iconPreview, preview, pendingIcon);
    const effective = pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null;
    iconLabel.textContent = effective ? 'カスタムアイコン' : '既定(リンク先のfavicon)';
  }
  urlInput.addEventListener('input', () => {
    // 既定アイコン表示中はURLに追随してプレビューを更新する
    if ((pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null) === null) renderIconPreview();
  });
  iconBtn.addEventListener('click', () => {
    window.roopieIconPicker.open({
      resetLabel: '既定に戻す(favicon)',
      onPick: (icon) => {
        pendingIcon = icon; // null = 既定(favicon)に戻す
        renderIconPreview();
      },
    });
  });
  renderIconPreview();

  const actions = document.createElement('div');
  actions.className = 'shortcut-actions';

  if (existing) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => {
      window.roopieInternal.removeShortcut(existing.id);
      loadShortcuts();
      close();
    });
    actions.appendChild(removeBtn);
  }
  actions.appendChild(document.createElement('div')).className = 'spacer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    let name = nameInput.value.trim();
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    if (!target) return;
    if (!name) {
      if (kind !== 'url') return;
      // 名前が空欄ならページのタイトルを自動取得(失敗時はホスト名)
      saveBtn.disabled = true;
      saveBtn.textContent = 'タイトル取得中…';
      name = (await window.roopieInternal.fetchPageTitle(target)) || hostnameOf(target) || target;
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }

    if (existing) {
      const patch = { kind, title: name, target };
      if (pendingIcon !== undefined) patch.icon = pendingIcon; // null = 既定(favicon)に戻す
      window.roopieInternal.updateShortcut(existing.id, patch);
    } else {
      await window.roopieInternal.addShortcut(currentPageId, { kind, name, target, icon: pendingIcon ?? null });
    }
    await loadShortcuts();
    close();
  });
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  nameInput.focus();

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);
}

// ---- ローカルサーバーのサジェスト(起動中の localhost:PORT を検知して表示) ----
// 走査するのは代表的な開発ポートのみ。HTTP応答が返ったものだけを候補にする。
let localServerMenu = null;

function closeLocalServerMenu() {
  if (localServerMenu) {
    localServerMenu.remove();
    localServerMenu = null;
    document.removeEventListener('mousedown', onLocalServerDocDown, true);
    document.removeEventListener('keydown', onLocalServerKeydown, true);
  }
}
function onLocalServerDocDown(e) {
  if (localServerMenu && !localServerMenu.contains(e.target)) closeLocalServerMenu();
}
function onLocalServerKeydown(e) {
  if (e.key === 'Escape') closeLocalServerMenu();
}

// 右クリック:このサーバーを非表示にする(以後サジェストしない)
function showLocalServerMenu(x, y, port) {
  closeLocalServerMenu();
  const menu = document.createElement('div');
  menu.className = 'ls-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const hide = document.createElement('button');
  hide.className = 'ls-menu-item';
  hide.textContent = '非表示にする';
  hide.addEventListener('click', () => {
    window.roopieInternal.dismissLocalServer(port);
    closeLocalServerMenu();
    loadLocalServers();
  });
  menu.appendChild(hide);
  document.body.appendChild(menu);
  localServerMenu = menu;
  // 生成直後の同一クリックで閉じないよう、次のtickでリスナーを張る
  setTimeout(() => {
    document.addEventListener('mousedown', onLocalServerDocDown, true);
    document.addEventListener('keydown', onLocalServerKeydown, true);
  });
}

function localServerTile(server) {
  const a = document.createElement('a');
  a.className = 'quick-link';
  a.href = server.url;
  a.title = `${server.title || ''}\n${server.url}`.trim();

  const tile = document.createElement('div');
  tile.className = 'tile';
  if (server.favicon) {
    const img = document.createElement('img');
    img.src = server.favicon;
    tile.appendChild(img);
  } else {
    // faviconが無ければポート番号をプレースホルダに(ショートカットの頭文字と同じ見た目)
    const ph = document.createElement('span');
    ph.className = 'placeholder ls-port';
    ph.textContent = String(server.port);
    tile.appendChild(ph);
  }
  a.appendChild(tile);

  const label = document.createElement('span');
  label.className = 'label';
  // タイトルは信頼できない任意プロセスの文字列なので textContent で入れる
  label.textContent = server.title || `localhost:${server.port}`;
  a.appendChild(label);

  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showLocalServerMenu(e.clientX, e.clientY, server.port);
  });
  return a;
}

async function loadLocalServers() {
  const servers = await window.roopieInternal.listLocalServers();
  localServersEl.textContent = '';
  if (!servers.length) return;

  const heading = document.createElement('div');
  heading.className = 'ls-heading';
  heading.textContent = 'ローカルサーバー';
  localServersEl.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'ls-grid';
  for (const server of servers) grid.appendChild(localServerTile(server));
  localServersEl.appendChild(grid);
  applyGridMetrics();
}

// 長く開きっぱなしのタブでも、後から起動したサーバーを反映する
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadLocalServers();
});

// 他のタブでの変更(追加/削除/名前変更など)を拾って再読み込みする
window.roopieInternal.onBookmarksState(() => loadPages());
loadPages();
loadLocalServers();

// ---- 設定(アイコンの最大サイズ。設定画面での変更をライブ反映) ----
function applySettings(settings) {
  iconSize = settings.startIconSize || 96;
  const before = defaultWeatherLocation;
  defaultWeatherLocation = settings.weatherLocation ?? null;
  applyGridMetrics();
  // 場所が決まった/変わったら、既定の場所を使っている天気ウィジェットを描き直す
  if (JSON.stringify(before) !== JSON.stringify(defaultWeatherLocation)) renderGrid();
}
window.roopieInternal.onSettings(applySettings);
window.roopieInternal.getSettings().then(applySettings);
