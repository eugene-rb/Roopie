// マウスジェスチャーのうち、ページ側でしかできない部分を担当するpreload。
// プロファイルのセッション全体(session.registerPreloadScript)に登録され、
// 通常タブ・内部ページの両方で動く。ページ側には何もAPIを公開しない。
//
// 検出そのものはメインプロセス(main/gesture-input.js)が行う。ここに検出を置くと、
// ページのJSが重いときにpreloadも同じメインスレッドで止まってしまい、
// ジェスチャーが効かなくなるため(そのための役割分担)。
//   - 軌跡とラベルの描画  … メインから 'gestures:trail' で受け取って描く
//   - ページ内スクロール  … メインから 'gestures:trail' の scroll で受け取って実行する
//   - 右クリックメニューの抑止 … contextmenu はページ側にしか飛んでこないのでここで止める
// 重いページでは描画とスクロールがページの都合で遅れるが、ジェスチャーの成立と
// アクションの実行(タブを閉じる・戻る等)はメイン側で完結しているので影響を受けない。
const { ipcRenderer } = require('electron');

// オーバーレイ(プルダウンメニュー用View)ではジェスチャーを動かさない
if (!location.href.startsWith('roopie://menu')) {
  initGestureView();
  initMenuSuppression();
}

function initGestureView() {
  let trailContainer = null, label = null, lastX = 0, lastY = 0;

  ipcRenderer.on('gestures:trail', (_e, msg) => {
    if (!msg) return;
    if (msg.type === 'start') showTrail(msg.x, msg.y);
    else if (msg.type === 'move') drawTo(msg.x, msg.y);
    else if (msg.type === 'label') updateLabel(msg.text);
    else if (msg.type === 'end') hideTrail();
    else if (msg.type === 'scroll') scroll(msg.action);
  });

  // メイン側はページのスクロール位置もビューポートの高さも持たないので、ここで実行する
  function scroll(action) {
    if (action === 'scrollTop') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'scrollBottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else if (action === 'scrollPageUp') {
      window.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
    } else if (action === 'scrollPageDown') {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    }
  }

  // ---- 軌跡とラベルの描画 ----
  // 軌跡はcanvasではなくDOM要素(線分ごとのdiv)で描く。
  // このタブはZen風の角丸カード表示のため WebContentsView.setBorderRadius() が掛かっており、
  // その状態だとcanvasへの動的な描画(ctx.stroke()の連続呼び出し)が実ウィンドウの合成結果に
  // 反映されない(devtoolsのスクリーンショットには映るのに、実際の画面には出ない)という
  // Electron側の挙動を確認した。通常のDOM要素(div)は同条件でも問題なく合成されるため、
  // 軌跡はdivの線分を都度追加していく方式にする

  function showTrail(x, y) {
    hideTrail(); // 前のジェスチャーの消し残し(endを取り逃した場合)を掃除する
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
    lastX = x;
    lastY = y;
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

  function updateLabel(text) {
    if (!label) return;
    label.textContent = text;
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

// ジェスチャーとして動かした場合は右クリックメニューを出さない
// (Windowsではcontextmenuはmouseupの後に発火する)。
//
// メイン側の検出結果を待って抑止することはできない。ページが重いときは contextmenu が
// 数秒遅れて発火する一方、メインからの通知は別経路で先に届いてしまうため、順序を当てにできない。
// そこでこのpreloadだけで完結するように、自分が受け取った mousedown→mouseup の移動量だけで判断する。
// 重くて入力の処理が遅れている場合でも、mousedown → mousemove → mouseup → contextmenu の
// 順序自体は保たれるので、この判定はそのまま正しく働く(mousemoveが間引かれても影響しない)。
function initMenuSuppression() {
  const START_DIST = 10; // main/gesture-input.js と同じ閾値
  let downX = 0, downY = 0, maxDist = 0, tracking = false, suppress = false;

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    tracking = true;
    suppress = false;
    maxDist = 0;
    downX = e.clientX;
    downY = e.clientY;
  }, true);

  // 行って戻ってくるジェスチャー(→←など)は終点が始点に近いので、途中の最大距離で見る
  window.addEventListener('mousemove', (e) => {
    if (!tracking) return;
    maxDist = Math.max(maxDist, Math.hypot(e.clientX - downX, e.clientY - downY));
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !tracking) return;
    tracking = false;
    maxDist = Math.max(maxDist, Math.hypot(e.clientX - downX, e.clientY - downY));
    suppress = maxDist >= START_DIST;
  }, true);

  window.addEventListener('contextmenu', (e) => {
    if (!suppress) return;
    suppress = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}
