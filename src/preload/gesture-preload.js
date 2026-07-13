// マウスジェスチャー検出用のpreload。
// プロファイルのセッション全体(session.registerPreloadScript)に登録され、
// 通常タブ・内部ページの両方で動く。ページ側には何もAPIを公開しない。
const { ipcRenderer } = require('electron');

// オーバーレイ(プルダウンメニュー用View)ではジェスチャーを動かさない
if (!location.href.startsWith('roopie://menu')) {
  initGestures();
}

function initGestures() {
  const START_DIST = 10; // この距離を右ドラッグしたらジェスチャー開始とみなす(px)
  const STEP = 20; // 方向を1つ確定するのに必要な移動量(px)
  const MAX_PATTERN = 8;

  const ARROWS = { U: '↑', D: '↓', L: '←', R: '→' };

  let config = { enabled: false, mappings: {}, actions: [] };
  ipcRenderer.invoke('gestures:config').then((c) => {
    if (c) config = c;
  }).catch(() => {});
  ipcRenderer.on('gestures:config', (_e, c) => {
    config = c;
  });

  let tracking = false; // 右ボタンを押している
  let moved = false; // START_DIST を超えて動いた(=ジェスチャー扱い)
  let pattern = '';
  let suppressMenu = false; // 直後のcontextmenuを抑止する
  let startX = 0, startY = 0, anchorX = 0, anchorY = 0;
  let canvas = null, ctx = null, label = null;

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || !config.enabled) return;
    tracking = true;
    moved = false;
    pattern = '';
    startX = anchorX = e.clientX;
    startY = anchorY = e.clientY;
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!tracking) return;
    // ウィンドウ外でボタンを離した等でmouseupを取り逃した場合はキャンセル
    if (!(e.buttons & 2)) {
      endGesture(false);
      return;
    }
    if (!moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < START_DIST) return;
      moved = true;
      showTrail();
    }
    drawTo(e.clientX, e.clientY);

    const dx = e.clientX - anchorX;
    const dy = e.clientY - anchorY;
    if (Math.hypot(dx, dy) < STEP) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
    if (pattern[pattern.length - 1] !== dir && pattern.length < MAX_PATTERN) {
      pattern += dir;
      updateLabel();
    }
    anchorX = e.clientX;
    anchorY = e.clientY;
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !tracking) return;
    endGesture(true);
  }, true);

  window.addEventListener('blur', () => {
    if (tracking) endGesture(false);
  });

  // ジェスチャーとして動かした場合は右クリックメニューを出さない
  // (Windowsではcontextmenuはmouseupの後に発火する)
  window.addEventListener('contextmenu', (e) => {
    if (!suppressMenu) return;
    suppressMenu = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  function endGesture(execute) {
    tracking = false;
    hideTrail();
    if (!moved) return;
    suppressMenu = true;
    setTimeout(() => { suppressMenu = false; }, 300);
    if (!execute || !pattern) return;

    const action = config.mappings[pattern];
    if (!action) return;
    // スクロール系はページ内で完結するのでレンダラー側で実行する
    if (action === 'scrollTop') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'scrollBottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else {
      ipcRenderer.send('gestures:perform', action);
    }
  }

  // ---- 軌跡とラベルの描画 ----

  function showTrail() {
    const dpr = window.devicePixelRatio || 1;
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    setStyle(canvas, {
      position: 'fixed',
      left: '0', top: '0',
      width: '100%', height: '100%',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#6c8cff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);

    label = document.createElement('div');
    setStyle(label, {
      position: 'fixed',
      left: '50%', bottom: '48px',
      transform: 'translateX(-50%)',
      padding: '8px 16px',
      borderRadius: '8px',
      background: 'rgba(30, 31, 36, 0.92)',
      color: '#e4e4e8',
      font: '600 14px "Segoe UI", "Yu Gothic UI", sans-serif',
      whiteSpace: 'nowrap',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
    });

    (document.body || document.documentElement).append(canvas, label);
  }

  function drawTo(x, y) {
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function updateLabel() {
    if (!label) return;
    const arrows = [...pattern].map((d) => ARROWS[d]).join(' ');
    const action = config.mappings[pattern];
    const name = config.actions.find((a) => a.id === action)?.label;
    label.textContent = name ? `${arrows}  ${name}` : arrows;
    label.style.display = 'block';
  }

  function hideTrail() {
    canvas?.remove();
    label?.remove();
    canvas = ctx = label = null;
  }

  function setStyle(el, styles) {
    // ページのCSPに関わらず適用できるよう、style属性ではなくCSSOM経由で設定する
    for (const [key, value] of Object.entries(styles)) el.style[key] = value;
  }
}
