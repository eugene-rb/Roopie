const backdrop = document.getElementById('backdrop');
const menu = document.getElementById('menu');
const itemsEl = document.getElementById('items');
const manageBtn = document.getElementById('manage');
const qrPopup = document.getElementById('qr-popup');

const MENU_WIDTH = 260;
const QR_WIDTH = 300;
const MARGIN = 8;

// メインプロセスから「このアンカー位置に、このプロファイル一覧で開いて」と指示が来る
window.roopieInternal.onMenuShow(({ profiles, activeId, anchor }) => {
  qrPopup.classList.add('hidden');
  renderItems(profiles, activeId);
  menu.classList.remove('hidden');
  position(menu, anchor, MENU_WIDTH);
});

// プロファイルのアイコン(文字/絵文字/画像)を1つの.avatar要素として作る
function buildAvatar(profile) {
  const el = document.createElement('span');
  el.className = 'avatar';
  const icon = profile.icon ?? { type: 'letter' };
  if (icon.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.src = icon.value;
    img.alt = '';
    el.appendChild(img);
  } else if (icon.type === 'emoji' && icon.value) {
    el.classList.add('emoji');
    el.textContent = icon.value;
  } else {
    el.style.background = profile.color;
    el.textContent = (profile.name[0] || '?').toUpperCase();
  }
  return el;
}

function renderItems(profiles, activeId) {
  itemsEl.textContent = '';
  for (const profile of profiles) {
    const item = document.createElement('button');
    item.className = 'menu-item';

    item.appendChild(buildAvatar(profile));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = profile.name;
    item.appendChild(name);

    if (profile.id === activeId) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      item.appendChild(check);
    }

    item.addEventListener('click', () => {
      if (profile.id !== activeId) window.roopieInternal.switchProfile(profile.id);
      close();
    });
    itemsEl.appendChild(item);
  }
}

// アンカー(ツールバーのボタン)の右端に合わせてポップアップを表示する
function position(el, anchor, width) {
  const maxLeft = window.innerWidth - width - MARGIN;
  const left = Math.max(MARGIN, Math.min(anchor.right - width, maxLeft));
  el.style.left = `${left}px`;
  el.style.top = `${MARGIN}px`;
}

function close() {
  menu.classList.add('hidden');
  qrPopup.classList.add('hidden');
  window.roopieInternal.closeMenu();
}

// ポップアップの外側をクリックしたら閉じる
backdrop.addEventListener('mousedown', (e) => {
  if (!menu.contains(e.target) && !qrPopup.contains(e.target)) close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});

manageBtn.addEventListener('click', () => {
  window.roopieInternal.openTab('roopie://settings');
  close();
});

document.getElementById('new-window').addEventListener('click', () => {
  window.roopieInternal.newWindow();
  close();
});

document.getElementById('new-incognito').addEventListener('click', () => {
  window.roopieInternal.newIncognitoWindow();
  close();
});

// =========================================================
// QRコードのポップアップ
// =========================================================
const qrCanvas = document.getElementById('qr-canvas');
const qrText = document.getElementById('qr-text');
const qrCenterBtn = document.getElementById('qr-center-btn');
const qrCenterClear = document.getElementById('qr-center-clear');
const qrLogoInput = document.getElementById('qr-logo-input');
const qrDownload = document.getElementById('qr-download');

const QR_SIZE = 480; // 描画解像度(表示はCSSで縮小)
const QR_QUIET = 4; // クワイエットゾーン(モジュール数)

// 中央のマーク(角丸四角形に描く)。プロフィールアイコンと同じ選び方
//   null | { type:'emoji', value } | { type:'image', img: HTMLImageElement }
let qrCenter = null;
let qrRenderTimer = null;

// アイコン選択の初期候補(settings.js と同じ)
const QR_EMOJI = [
  '😀', '😎', '🤓', '🥸', '🤖', '👻',
  '🐱', '🐶', '🦊', '🐼', '🐧', '🦉',
  '🌸', '🌵', '🍀', '🔥', '⚡', '🌙',
  '🎮', '🎧', '📚', '☕', '🚀', '🎨',
];

function qrButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// 角丸四角形のパスを引く(clip/fill 共用)
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

window.roopieInternal.onQrShow(({ url, anchor }) => {
  menu.classList.add('hidden');
  closeQrCenterPicker();
  qrCenter = null;
  qrCenterClear.classList.add('hidden');
  qrText.value = url ?? '';
  qrPopup.classList.remove('hidden');
  position(qrPopup, anchor ?? { right: window.innerWidth - MARGIN }, QR_WIDTH);
  renderQr();
});

// テキストからQRのモジュール行列を作る。中央マークで隠れるので誤り訂正はH(高)を優先し、
// 容量オーバーで作れないときは段階的に下げる
function buildQr(text) {
  for (const level of ['H', 'Q', 'M', 'L']) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text);
      qr.make();
      return qr;
    } catch {
      // このレベルでは容量が足りない → 次へ
    }
  }
  return null;
}

function renderQr() {
  const ctx = qrCanvas.getContext('2d');
  const text = qrText.value.trim();

  if (!text) {
    qrCanvas.width = qrCanvas.height = QR_SIZE;
    ctx.clearRect(0, 0, QR_SIZE, QR_SIZE);
    return;
  }

  const qr = buildQr(text);
  if (!qr) return;

  const count = qr.getModuleCount();
  const total = count + QR_QUIET * 2;
  const cell = Math.floor(QR_SIZE / total);
  const dim = cell * total;
  qrCanvas.width = qrCanvas.height = dim;

  // 背景(白)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);

  // モジュール(黒)
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + QR_QUIET) * cell, (r + QR_QUIET) * cell, cell, cell);
      }
    }
  }

  drawQrCenter(ctx, dim, cell);
}

// 中央のマークを角丸四角形で描く(誤り訂正Hなら約2〜3割の欠損に耐えるので、22%程度までに抑える)
function drawQrCenter(ctx, dim, cell) {
  if (!qrCenter) return;
  const inner = Math.round(dim * 0.22);
  const pad = Math.round(cell * 1.5);
  const box = inner + pad * 2;
  const x = Math.round((dim - box) / 2);
  const y = Math.round((dim - box) / 2);
  const radius = Math.round(box * 0.22); // 角丸

  // 白い角丸の下地
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, x, y, box, box, radius);
  ctx.fill();

  if (qrCenter.type === 'emoji') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${inner}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.fillText(qrCenter.value, dim / 2, dim / 2 + inner * 0.06);
    ctx.restore();
  } else if (qrCenter.type === 'image' && qrCenter.img) {
    ctx.save();
    // 画像は角丸四角形にクリップして描く
    const ir = Math.round(inner * 0.22);
    roundRectPath(ctx, Math.round((dim - inner) / 2), Math.round((dim - inner) / 2), inner, inner, ir);
    ctx.clip();
    const img = qrCenter.img;
    const iw = img.naturalWidth || inner;
    const ih = img.naturalHeight || inner;
    const scale = Math.max(inner / iw, inner / ih); // カバー(はみ出しはクリップで切る)
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, Math.round((dim - dw) / 2), Math.round((dim - dh) / 2), dw, dh);
    ctx.restore();
  }
}

function setQrCenter(center) {
  qrCenter = center;
  qrCenterClear.classList.toggle('hidden', !center);
  renderQr();
}

// 内容の編集(打つたびに再生成。負荷を抑えるため少しデバウンス)
qrText.addEventListener('input', () => {
  clearTimeout(qrRenderTimer);
  qrRenderTimer = setTimeout(renderQr, 150);
});

qrCenterClear.addEventListener('click', () => setQrCenter(null));

qrDownload.addEventListener('click', async () => {
  if (!qrText.value.trim()) return;
  await window.roopieInternal.saveQr(qrCanvas.toDataURL('image/png'));
});

// ---- 中央マークの選択パネル(プロフィールアイコンと同じUI) ----
let qrCenterPicker = null;

function closeQrCenterPicker() {
  qrCenterPicker?.remove();
  qrCenterPicker = null;
}

qrCenterBtn.addEventListener('click', () => {
  if (qrCenterPicker) {
    closeQrCenterPicker();
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'icon-picker';
  // パネル内のクリックはオーバーレイの外側クリック判定に渡さない
  panel.addEventListener('mousedown', (e) => e.stopPropagation());

  const grid = document.createElement('div');
  grid.className = 'icon-picker-grid';
  for (const emoji of QR_EMOJI) {
    const b = document.createElement('button');
    b.className = 'icon-picker-emoji';
    b.textContent = emoji;
    b.addEventListener('click', () => {
      setQrCenter({ type: 'emoji', value: emoji });
      closeQrCenterPicker();
    });
    grid.appendChild(b);
  }
  panel.appendChild(grid);

  const customRow = document.createElement('div');
  customRow.className = 'icon-picker-row';
  const customInput = document.createElement('input');
  customInput.className = 'search';
  customInput.type = 'text';
  customInput.placeholder = '絵文字を入力';
  customInput.maxLength = 8;
  const applyCustom = () => {
    const value = customInput.value.trim();
    if (!value) return;
    setQrCenter({ type: 'emoji', value });
    closeQrCenterPicker();
  };
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyCustom();
  });
  customRow.append(customInput, qrButton('設定', applyCustom));
  panel.appendChild(customRow);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'icon-picker-row';
  actionsRow.appendChild(qrButton('画像をアップロード', () => qrLogoInput.click()));
  actionsRow.appendChild(qrButton('マークを消す', () => {
    setQrCenter(null);
    closeQrCenterPicker();
  }));
  panel.appendChild(actionsRow);

  document.body.appendChild(panel);
  const rect = qrCenterBtn.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 236))}px`;
  panel.style.top = `${Math.max(8, rect.top - 8 - panel.offsetHeight)}px`;
  qrCenterPicker = panel;
});

qrLogoInput.addEventListener('change', () => {
  const file = qrLogoInput.files?.[0];
  qrLogoInput.value = '';
  if (!file) return;
  closeQrCenterPicker();
  openQrCropModal(file);
});

// 選択パネルの外側クリックで閉じる(オーバーレイ自体は閉じないよう、captureで先に処理して止める)
document.addEventListener(
  'mousedown',
  (e) => {
    if (qrCenterPicker && !qrCenterPicker.contains(e.target) && e.target !== qrCenterBtn) {
      closeQrCenterPicker();
      e.stopPropagation();
    }
  },
  true
);

// ---- 画像のGUIクロップ(角丸四角形。プロフィールアイコンと同じ操作) ----
function openQrCropModal(file) {
  const VS = 240; // クロップ表示のビューポートサイズ(px)
  const OUTPUT = 200; // 書き出す一辺(px)
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const backdrop = document.createElement('div');
  backdrop.className = 'crop-backdrop';
  // クロップ中のクリック/キーはオーバーレイに渡さない
  backdrop.addEventListener('mousedown', (e) => e.stopPropagation());

  const modal = document.createElement('div');
  modal.className = 'crop-modal';

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'ドラッグで位置を調整、スライダー(またはホイール)で拡大縮小できます';
  modal.appendChild(hint);

  const viewport = document.createElement('div');
  viewport.className = 'crop-viewport crop-viewport-rect';
  const img = document.createElement('img');
  img.draggable = false;
  viewport.appendChild(img);
  modal.appendChild(viewport);

  const zoomInput = document.createElement('input');
  zoomInput.type = 'range';
  zoomInput.className = 'crop-zoom';
  zoomInput.min = '0';
  zoomInput.max = '100';
  zoomInput.value = '0';
  modal.appendChild(zoomInput);

  const actions = document.createElement('div');
  actions.className = 'crop-actions';
  const applyBtn = qrButton('中央に設定', apply);
  applyBtn.classList.add('primary');
  actions.append(qrButton('キャンセル', close), applyBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  let nw = 0;
  let nh = 0;
  let baseScale = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function currentZoomedScale() {
    const z = 1 + (Number(zoomInput.value) / 100) * 2; // 1倍〜3倍
    return baseScale * z;
  }

  function applyTransform() {
    scale = currentZoomedScale();
    const dw = nw * scale;
    const dh = nh * scale;
    offsetX = clamp(offsetX, VS - dw, 0);
    offsetY = clamp(offsetY, VS - dh, 0);
    img.style.width = `${dw}px`;
    img.style.height = `${dh}px`;
    img.style.left = `${offsetX}px`;
    img.style.top = `${offsetY}px`;
  }

  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      nw = img.naturalWidth;
      nh = img.naturalHeight;
      baseScale = VS / Math.min(nw, nh); // 短辺がビューポートを覆う倍率
      offsetX = (VS - nw * baseScale) / 2;
      offsetY = (VS - nh * baseScale) / 2;
      applyTransform();
    };
    img.onerror = close;
    img.src = reader.result;
  };
  reader.onerror = close;
  reader.readAsDataURL(file);

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  viewport.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offsetX = startOffsetX + (e.clientX - startX);
    offsetY = startOffsetY + (e.clientY - startY);
    applyTransform();
  });
  viewport.addEventListener('pointerup', () => {
    dragging = false;
  });
  viewport.addEventListener('pointercancel', () => {
    dragging = false;
  });

  zoomInput.addEventListener('input', () => {
    const oldScale = scale;
    const newScale = currentZoomedScale();
    const cx = (VS / 2 - offsetX) / oldScale;
    const cy = (VS / 2 - offsetY) / oldScale;
    offsetX = VS / 2 - cx * newScale;
    offsetY = VS / 2 - cy * newScale;
    applyTransform();
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomInput.value = String(clamp(Number(zoomInput.value) + (e.deltaY > 0 ? -4 : 4), 0, 100));
      zoomInput.dispatchEvent(new Event('input'));
    },
    { passive: false }
  );

  // Escでモーダルを閉じる(オーバーレイ自体は閉じないよう、captureで先に止める)
  function onKeydown(e) {
    if (e.key === 'Escape') {
      close();
      e.stopPropagation();
    }
  }
  document.addEventListener('keydown', onKeydown, true);

  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
  }

  function apply() {
    if (!nw) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    const srcSize = VS / scale;
    const srcX = clamp(-offsetX / scale, 0, nw - srcSize);
    const srcY = clamp(-offsetY / scale, 0, nh - srcSize);
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
    const out = new Image();
    out.onload = () => setQrCenter({ type: 'image', img: out });
    out.src = canvas.toDataURL('image/png');
    close();
  }
}
