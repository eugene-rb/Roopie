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
const qrLogoBtn = document.getElementById('qr-logo-btn');
const qrLogoClear = document.getElementById('qr-logo-clear');
const qrLogoInput = document.getElementById('qr-logo-input');
const qrDownload = document.getElementById('qr-download');

const QR_SIZE = 480; // 描画解像度(表示はCSSで縮小)
const QR_QUIET = 4; // クワイエットゾーン(モジュール数)
let qrLogoImage = null; // 中央に重ねる画像(HTMLImageElement)
let qrRenderTimer = null;

window.roopieInternal.onQrShow(({ url, anchor }) => {
  menu.classList.add('hidden');
  qrLogoImage = null;
  qrLogoClear.classList.add('hidden');
  qrText.value = url ?? '';
  qrPopup.classList.remove('hidden');
  position(qrPopup, anchor ?? { right: window.innerWidth - MARGIN }, QR_WIDTH);
  renderQr();
});

// テキストからQRのモジュール行列を作る。ロゴがあると中央が隠れるので誤り訂正はH(高)を優先し、
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

  // 中央のロゴ(誤り訂正Hなら約2〜3割の欠損に耐えるので、22%程度までに抑える)
  if (qrLogoImage) {
    const logoSize = Math.round(dim * 0.22);
    const pad = Math.round(cell * 1.5);
    const box = logoSize + pad * 2;
    const x = Math.round((dim - box) / 2);
    const y = Math.round((dim - box) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, box, box);
    // アスペクト比を保って中央に収める
    const iw = qrLogoImage.naturalWidth || logoSize;
    const ih = qrLogoImage.naturalHeight || logoSize;
    const scale = Math.min(logoSize / iw, logoSize / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(qrLogoImage, Math.round((dim - dw) / 2), Math.round((dim - dh) / 2), dw, dh);
  }
}

// 内容の編集(打つたびに再生成。負荷を抑えるため少しデバウンス)
qrText.addEventListener('input', () => {
  clearTimeout(qrRenderTimer);
  qrRenderTimer = setTimeout(renderQr, 150);
});

qrLogoBtn.addEventListener('click', () => qrLogoInput.click());

qrLogoInput.addEventListener('change', () => {
  const file = qrLogoInput.files?.[0];
  qrLogoInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      qrLogoImage = img;
      qrLogoClear.classList.remove('hidden');
      renderQr();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

qrLogoClear.addEventListener('click', () => {
  qrLogoImage = null;
  qrLogoClear.classList.add('hidden');
  renderQr();
});

qrDownload.addEventListener('click', async () => {
  if (!qrText.value.trim()) return;
  await window.roopieInternal.saveQr(qrCanvas.toDataURL('image/png'));
});
