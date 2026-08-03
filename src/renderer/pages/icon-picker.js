// 共通のアイコン選択UI。プロファイル・Webパネル・スタートのショートカットで同じ見た目・操作にする。
// (絵文字24種のグリッド + 自由入力 + 画像アップロード→ドラッグ&ズームの円形クロップ + 既定に戻す)
//
// 使い方:
//   window.roopieIconPicker.toggle(anchorEl, options)  // anchorの下に出すポップオーバー(再クリックで閉じる)
//   window.roopieIconPicker.open(options)              // 画面中央のモーダル
// options:
//   resetLabel: 「既定に戻す」ボタンのラベル(例: 'faviconに戻す')
//   onPick(icon): 選択結果。{ type:'emoji', value } | { type:'image', value: dataURI } | null(既定に戻す)
//   onClose(): ピッカー(クロップ含む)が完全に閉じたときに1回呼ばれる
(() => {
  const DEFAULT_EMOJI = [
    '😀', '😎', '🤓', '🥸', '🤖', '👻',
    '🐱', '🐶', '🦊', '🐼', '🐧', '🦉',
    '🌸', '🌵', '🍀', '🔥', '⚡', '🌙',
    '🎮', '🎧', '📚', '☕', '🚀', '🎨',
  ];

  let session = null; // { root, anchor, onClose }

  function smallButton(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // パネルのDOMだけ片付ける(セッションは続く場合がある: クロップへの受け渡し)
  function removePanel() {
    session?.root.remove();
  }

  // セッション終了(onCloseを1回だけ呼ぶ)
  function endSession() {
    if (!session) return;
    const s = session;
    session = null;
    s.root.remove();
    s.onClose?.();
  }

  function buildPanel({ resetLabel = '既定に戻す', onPick }) {
    const pick = (icon) => {
      onPick?.(icon);
      endSession();
    };

    const panel = document.createElement('div');
    panel.className = 'icon-picker';

    const grid = document.createElement('div');
    grid.className = 'icon-picker-grid';
    for (const emoji of DEFAULT_EMOJI) {
      const emojiBtn = document.createElement('button');
      emojiBtn.className = 'icon-picker-emoji';
      emojiBtn.textContent = emoji;
      emojiBtn.addEventListener('click', () => pick({ type: 'emoji', value: emoji }));
      grid.appendChild(emojiBtn);
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
      if (value) pick({ type: 'emoji', value });
    };
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyCustom();
    });
    customRow.append(customInput, smallButton('設定', applyCustom));
    panel.appendChild(customRow);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      // パネルは片付けるが、onCloseはクロップが終わるまで持ち越す
      removePanel();
      openCropModal(file, pick, endSession);
    });
    panel.appendChild(fileInput);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'icon-picker-row';
    actionsRow.appendChild(smallButton('画像をアップロード', () => fileInput.click()));
    actionsRow.appendChild(smallButton(resetLabel, () => pick(null)));
    panel.appendChild(actionsRow);

    return panel;
  }

  // anchorの下に出すポップオーバー。同じanchorでもう一度呼ぶと閉じる
  function toggle(anchorEl, options) {
    if (session?.anchor === anchorEl) {
      endSession();
      return;
    }
    endSession();
    const panel = buildPanel(options);
    document.body.appendChild(panel);
    const rect = anchorEl.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 236))}px`;
    panel.style.top = `${rect.bottom + 6}px`;
    session = { root: panel, anchor: anchorEl, onClose: options.onClose };
  }

  // 画面中央のモーダル(背景クリックで閉じる)
  function open(options) {
    endSession();
    const backdrop = document.createElement('div');
    backdrop.className = 'icon-picker-backdrop';
    backdrop.appendChild(buildPanel(options));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) endSession();
    });
    document.body.appendChild(backdrop);
    session = { root: backdrop, anchor: null, onClose: options.onClose };
  }

  // ポップオーバーは外側クリックで閉じる
  document.addEventListener('mousedown', (e) => {
    if (session?.anchor && !session.root.contains(e.target) && !session.anchor.contains(e.target)) {
      endSession();
    }
  });

  // ---- 画像のGUIクロップ(ドラッグで位置調整、スライダー/ホイールでズーム、円形プレビュー) ----
  // apply時は pick({type:'image',...})、キャンセル時は cancel() を呼ぶ
  function openCropModal(file, pick, cancel) {
    const VS = 240; // クロップ表示のビューポートサイズ(px)
    const OUTPUT = 160; // 書き出す画像の一辺(px)
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    const backdrop = document.createElement('div');
    backdrop.className = 'crop-backdrop';

    const modal = document.createElement('div');
    modal.className = 'crop-modal';

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'ドラッグで位置を調整、スライダー(またはホイール)で拡大縮小できます';
    modal.appendChild(hint);

    const viewport = document.createElement('div');
    viewport.className = 'crop-viewport';
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
    const applyBtn = smallButton('アイコンに設定', apply);
    applyBtn.classList.add('primary');
    actions.append(smallButton('キャンセル', close), applyBtn);
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
        baseScale = VS / Math.min(nw, nh); // 短辺がビューポートを覆う倍率(zoom=1相当)
        offsetX = (VS - nw * baseScale) / 2;
        offsetY = (VS - nh * baseScale) / 2;
        applyTransform();
      };
      img.onerror = close;
      img.src = reader.result;
    };
    reader.onerror = close;
    reader.readAsDataURL(file);

    // ドラッグで位置調整(pointer captureで、ビューポート外に出ても追従する)
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

    // ズームはビューポート中心を保ったまま拡大縮小する
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

    function onKeydown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeydown);

    function teardown() {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
    }

    function close() {
      teardown();
      cancel();
    }

    function apply() {
      if (!nw) return; // 画像がまだ読み込めていない
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      const srcSize = VS / scale;
      const srcX = clamp(-offsetX / scale, 0, nw - srcSize);
      const srcY = clamp(-offsetY / scale, 0, nh - srcSize);
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
      teardown();
      pick({ type: 'image', value: canvas.toDataURL('image/png') });
    }
  }

  window.roopieIconPicker = { toggle, open, close: endSession };
})();
