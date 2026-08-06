// ウィンドウの外観(明暗・面の作り)をドキュメントへ反映する共通処理。
// 消費者が2つあるので1箇所にまとめる:
//   - ブラウザUI(index.html → renderer.js)
//   - 全内部ページ(roopie://… → theme.js)。オーバーレイの roopie://menu も含む
// IPCには触れない純粋な処理。テーマの受け取りは呼び出し側の担当。
//
// 帯を透かして背後を見せる「半透明」「liquidglass」のぼかしそのものは、
// CSSではなくウィンドウのacrylic(src/main/browser.js の applyWindowChrome)が作る。
(() => {
  const MODES = ['dark', 'light'];
  const STYLES = ['solid', 'translucent', 'gradient', 'glass', 'pattern'];
  const PATTERNS = ['dots', 'grid', 'diagonal', 'crosshatch', 'hexagon', 'wave', 'circuit'];
  const HEX = /^#[0-9a-fA-F]{6}$/;

  // 面を半透明にするのはクロームと、ページの上に重なるオーバーレイだけ。
  // 設定や履歴などの内部ページを透かすと、後ろに透けるものが無く色が壊れる。
  // サイドパネルも同じ理由で不透明のまま(WebContentsViewが transparent ではないので、
  // 透かしても背後のacrylicではなく黒が出る)。色は明るさ・基準色に追従するので浮かない
  const TRANSLUCENT_STYLES = new Set(['translucent', 'glass', 'gradient', 'pattern']);

  // モード既定の基準色(--c-bg 相当。tailwind.css の :root と揃える)
  const BASE_COLOR = { dark: '#16181d', light: '#eef0f4' };
  // 文字と重ね色。tailwind.css の :root / [data-window-mode="light"] と同じ値
  const FOREGROUND = {
    dark: { text: '#e5e7eb', dim: '#99a0ac', tint: '255 255 255' },
    light: { text: '#1c2129', dim: '#5b6472', tint: '15 23 42' },
  };

  // #rrggbb の明るさ(0-255)
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  }

  const osPrefersDark = () => !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;

  // 'system' はOSの設定で解決する。nativeTheme.themeSource はアプリ全体に効いてしまい
  // プロファイルごとに別の明暗にできないので、メイン側でも書き込んでいない
  function resolveMode(theme) {
    const mode = theme?.windowMode;
    return MODES.includes(mode) ? mode : osPrefersDark() ? 'dark' : 'light';
  }

  const color = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value : fallback);

  // 基準色1色から手前の面(ツールバー・タブ)を作る。手前ほど明るい側へ寄せる
  function surfacesFrom(base) {
    const lift = (percent) => `color-mix(in srgb, ${base} ${100 - percent}%, #ffffff)`;
    return {
      '--c-bg': base,
      '--c-bar': lift(3),
      '--c-toolbar': lift(7),
      '--c-tab-inactive': lift(5),
      '--c-tab-active': lift(13),
      '--c-card': lift(7),
      '--c-card-hover': lift(11),
      '--c-menu': lift(9),
      '--c-menu-hover': lift(14),
    };
  }

  // 「ぼかしつきのグラデーション」。線形のグラデに大きな放射のにじみを重ねて、
  // filter を使わずに輪郭のぼけた見た目にする(filterは下のUIまでぼかしてしまう)
  function gradientSurface(stops, angle) {
    const blobs = stops.map((c, i) => {
      const x = 12 + (76 / Math.max(1, stops.length - 1)) * i;
      const y = i % 2 === 0 ? 18 : 82;
      return `radial-gradient(60% 120% at ${x}% ${y}%, ${c} 0%, transparent 62%)`;
    });
    return [...blobs, `linear-gradient(${angle}deg, ${stops.join(', ')})`].join(', ');
  }

  /**
   * @param {object} theme  テーマ(theme:state の中身)
   * @param {{ incognito?: boolean, overlay?: boolean }} opts
   *   incognito: シークレットウィンドウ(識別色を守るため外観を一切当てない)
   *   overlay: ページの上に重なる透明ビュー(roopie://menu)。面を透かしてよい
   */
  function applyWindowTheme(theme, opts = {}) {
    const root = document.documentElement;
    const style = root.style;

    // シークレットは常にダーク・単色。CSSの .chrome-body.incognito に任せる
    if (opts.incognito) {
      root.dataset.windowMode = 'dark';
      delete root.dataset.windowStyle;
      delete root.dataset.windowPattern;
      for (const name of ['--surface-alpha', '--chrome-surface', '--chrome-pattern-color', '--text', '--text-dim', '--tint', 'color-scheme', ...Object.keys(surfacesFrom('#000000'))]) {
        style.removeProperty(name);
      }
      return;
    }

    const mode = resolveMode(theme);
    const windowStyle = STYLES.includes(theme?.windowStyle) ? theme.windowStyle : 'solid';
    root.dataset.windowMode = mode;
    root.dataset.windowStyle = windowStyle;

    // 基準色。未指定ならモード既定(このときは tailwind.css の :root / [data-window-mode] に任せる)
    const base = color(theme?.windowColor, '');
    for (const [name, value] of Object.entries(surfacesFrom(base || BASE_COLOR[mode]))) {
      if (base) style.setProperty(name, value);
      else style.removeProperty(name);
    }

    // 文字色は**実際の面の明るさ**から決める。明るさの選択と基準色は別々に選べるので、
    // モードだけを見ていると「ライトなのに暗い基準色」で暗い面に暗い文字が乗ってしまう
    const fg = FOREGROUND[base ? (luminance(base) > 140 ? 'light' : 'dark') : mode];
    if (base) {
      style.setProperty('--text', fg.text);
      style.setProperty('--text-dim', fg.dim);
      style.setProperty('--tint', fg.tint);
      // フォームやスクロールバーの既定の見た目も面に合わせる
      style.setProperty('color-scheme', fg === FOREGROUND.light ? 'light' : 'dark');
    } else {
      for (const name of ['--text', '--text-dim', '--tint', 'color-scheme']) style.removeProperty(name);
    }

    // 帯をどれだけ透かすか。クロームとオーバーレイだけが対象
    const canTranslucent = (opts.chrome || opts.overlay) && TRANSLUCENT_STYLES.has(windowStyle);
    const translucency = Number.isFinite(theme?.windowTranslucency) ? theme.windowTranslucency : 62;
    style.setProperty('--surface-alpha', canTranslucent ? String(Math.min(100, Math.max(20, translucency)) / 100) : '1');

    // 内部ページの下地の濃さ。liquidglass のとき、透明なView越しにウィンドウのacrylicを
    // どれだけ見せるかを決める(0%=完全に透過)。--surface-alpha とは別の仕組みなので混同しない
    const scrim = Number.isFinite(theme?.pageScrim) ? theme.pageScrim : 0;
    style.setProperty('--page-scrim', `${Math.min(60, Math.max(0, scrim))}%`);

    // 帯の背後に描く面。半透明・liquidglass では何も描かず、ウィンドウのacrylicを見せる
    if (windowStyle === 'gradient') {
      const stops = Array.isArray(theme?.windowGradientStops)
        ? theme.windowGradientStops.filter((c) => HEX.test(c))
        : [];
      const angle = Number.isFinite(theme?.windowGradientAngle) ? theme.windowGradientAngle : 160;
      const list = stops.length >= 2 ? stops : ['#1b2340', '#2d2a55'];
      style.setProperty('--chrome-surface', gradientSurface(list, angle));
    } else {
      style.removeProperty('--chrome-surface');
    }

    if (windowStyle === 'pattern') {
      root.dataset.windowPattern = PATTERNS.includes(theme?.windowPattern) ? theme.windowPattern : 'dots';
      style.setProperty('--chrome-pattern-color', color(theme?.windowPatternColor, '#6c8cff'));
    } else {
      delete root.dataset.windowPattern;
      style.removeProperty('--chrome-pattern-color');
    }
  }

  window.roopieWindowTheme = { apply: applyWindowTheme, resolveMode };

  // OSの明暗が変わったら 'system' のウィンドウを追随させる。
  // 直近のテーマは呼び出し側が __roopieLastWindowTheme に置く
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const last = window.__roopieLastWindowTheme;
    if (last && !MODES.includes(last.theme?.windowMode)) applyWindowTheme(last.theme, last.opts);
  });
})();
