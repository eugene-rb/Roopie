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
  let trailContainer = null, label = null, lastX = 0, lastY = 0;

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
    // (メイン側はページのスクロール位置もビューポートの高さも持たない)
    if (action === 'scrollTop') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'scrollBottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else if (action === 'scrollPageUp') {
      window.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
    } else if (action === 'scrollPageDown') {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    } else {
      ipcRenderer.send('gestures:perform', action);
    }
  }

  // ---- 軌跡とラベルの描画 ----
  // 軌跡はcanvasではなくDOM要素(線分ごとのdiv)で描く。
  // このタブはZen風の角丸カード表示のため WebContentsView.setBorderRadius() が掛かっており、
  // その状態だとcanvasへの動的な描画(ctx.stroke()の連続呼び出し)が実ウィンドウの合成結果に
  // 反映されない(devtoolsのスクリーンショットには映るのに、実際の画面には出ない)という
  // Electron側の挙動を確認した。通常のDOM要素(div)は同条件でも問題なく合成されるため、
  // 軌跡はdivの線分を都度追加していく方式にする

  function showTrail() {
    trailContainer = document.createElement('div');
    setStyle(trailContainer, {
      position: 'fixed',
      left: '0', top: '0',
      width: '0', height: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });

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

    (document.body || document.documentElement).append(trailContainer, label);
    lastX = startX;
    lastY = startY;
  }

  function drawTo(x, y) {
    if (!trailContainer) return;
    const dx = x - lastX;
    const dy = y - lastY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const seg = document.createElement('div');
    setStyle(seg, {
      position: 'fixed',
      left: `${lastX}px`,
      top: `${lastY - 1.5}px`,
      width: `${dist}px`,
      height: '3px',
      borderRadius: '1.5px',
      background: '#6c8cff',
      transformOrigin: '0 50%',
      transform: `rotate(${Math.atan2(dy, dx)}rad)`,
    });
    trailContainer.appendChild(seg);
    lastX = x;
    lastY = y;
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
    trailContainer?.remove();
    label?.remove();
    trailContainer = label = null;
  }

  function setStyle(el, styles) {
    // ページのCSPに関わらず適用できるよう、style属性ではなくCSSOM経由で設定する
    for (const [key, value] of Object.entries(styles)) el.style[key] = value;
  }
}
