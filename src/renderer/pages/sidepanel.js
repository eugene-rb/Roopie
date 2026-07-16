const $ = (id) => document.getElementById(id);

const bookmarkListEl = $('bookmark-list');
const historyListEl = $('history-list');
const historySearchEl = $('history-search');
const notesEl = $('notes');
const webListEl = $('web-list');
const webUrlEl = $('web-url');
const webPinListEl = $('web-pin-list');
const railEl = $('rail');
const nowPlayingTab = $('now-playing-tab');
const nowPlayingBody = $('now-playing-body');
const panelHeaderTitle = $('panel-header-title');
const webReloadBtn = $('web-reload');
const webOpenTabBtn = $('web-open-tab');

let state = { open: true, webPanels: [], activeSection: null, activeWebId: null, notes: '' };

// パネル見出し・タブのtitle属性と揃えたラベル(Edge/Vivaldiのパネルヘッダー相当)
const SECTION_LABELS = {
  bookmarks: 'ブックマーク',
  history: '履歴',
  notes: 'メモ',
  readlist: 'リードリスト',
  web: 'Webパネルを追加・管理',
  'now-playing': '再生中',
};

// ---- 共通の行アイテム ----
function faviconEl(favicon, fallbackText) {
  // faviconが無いページでは Electron が空データURI "data:," を報告することがある(実質「無し」)
  if (favicon && favicon !== 'data:,') {
    const img = document.createElement('img');
    img.src = favicon;
    return img;
  }
  const letter = document.createElement('span');
  letter.className = 'letter';
  letter.textContent = (fallbackText[0] || '?').toUpperCase();
  return letter;
}

function linkItem({ favicon, title, url }) {
  const item = document.createElement('div');
  item.className = 'panel-item';
  item.title = `${title}\n${url}`;
  item.appendChild(faviconEl(favicon, title));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = title || url;
  item.appendChild(label);

  // クリックで現在のタブに表示、中クリックで新しいタブ
  item.addEventListener('click', () => window.roopieInternal.navigate(url));
  item.addEventListener('auxclick', (e) => {
    if (e.button === 1) window.roopieInternal.openTab(url);
  });
  return item;
}

function emptyNote(text, icon = 'inbox') {
  return window.roopieEmptyState(text, { variant: 'note', icon });
}

// Webパネルのアイコン。カスタムアイコン(絵文字/画像)があればそれ、なければfavicon
function webIconEl(panel) {
  const icon = panel.icon;
  if (icon?.type === 'emoji' && icon.value) {
    const span = document.createElement('span');
    span.className = 'letter emoji';
    span.textContent = icon.value;
    return span;
  }
  if (icon?.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.src = icon.value;
    return img;
  }
  return faviconEl(panel.favicon, panel.title);
}

// ---- アイコンレール(常時表示)。クリックで開閉はメインプロセス側(SidePanel)が判断する ----
for (const btn of document.querySelectorAll('.section-tab[data-section]')) {
  btn.addEventListener('click', () => window.roopieInternal.openSidePanelSection(btn.dataset.section));
}

// 何もないところを右クリック: 左右切替/アイコンの追加/非表示のメニュー
railEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopieInternal.sidePanelRailContextMenu();
});

// ---- 幅のリサイズ(境界のハンドルをドラッグ。Edge/Vivaldiと同じ操作) ----
// パネル自身のViewはドラッグ中に再配置されるため、絶対座標ではなく直前からの
// 相対移動量(movementX)を都度メインへ送る(フローティングプレイヤーのドラッグと同じ方式)
const resizeHandle = $('resize-handle');
resizeHandle.addEventListener('pointerdown', (e) => {
  resizeHandle.setPointerCapture(e.pointerId);
  resizeHandle.classList.add('dragging');
});
resizeHandle.addEventListener('pointermove', (e) => {
  if (!resizeHandle.hasPointerCapture(e.pointerId)) return;
  if (e.movementX) window.roopieInternal.resizeSidePanel(e.movementX);
});
resizeHandle.addEventListener('pointerup', (e) => {
  resizeHandle.releasePointerCapture(e.pointerId);
  resizeHandle.classList.remove('dragging');
});
resizeHandle.addEventListener('pointercancel', () => {
  resizeHandle.classList.remove('dragging');
});

// ---- ブックマーク ----
async function refreshBookmarks() {
  const items = await window.roopieInternal.listBookmarks();
  renderBookmarks(items);
}

function renderBookmarks(items) {
  bookmarkListEl.textContent = '';
  if (!items.length) {
    bookmarkListEl.appendChild(emptyNote('ブックマークはまだありません(Ctrl+D で追加)', 'bookmark'));
    return;
  }
  for (const bookmark of items) {
    bookmarkListEl.appendChild(linkItem(bookmark));
  }
}

window.roopieInternal.onBookmarksState((items) => renderBookmarks(items));

// ---- 履歴 ----
let historyTimer = null;

async function refreshHistory() {
  const items = await window.roopieInternal.listHistory(historySearchEl.value);
  historyListEl.textContent = '';
  if (!items.length) {
    historyListEl.appendChild(emptyNote('履歴はありません', 'clock'));
    return;
  }
  for (const entry of items.slice(0, 100)) {
    const item = linkItem(entry);
    const time = new Date(entry.visitedAt);
    item.title += `\n${time.toLocaleString('ja-JP')}`;
    historyListEl.appendChild(item);
  }
}

historySearchEl.addEventListener('input', () => {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(refreshHistory, 200);
});

// ---- リードリスト(後で読む) ----
const readlistListEl = $('readlist-list');
const readlistFilterBtn = $('readlist-filter-btn');
let readlist = [];
let readlistUnreadOnly = false;

function renderReadlist() {
  readlistListEl.textContent = '';
  const items = readlistUnreadOnly ? readlist.filter((e) => !e.read) : readlist;
  if (!items.length) {
    readlistListEl.appendChild(
      emptyNote(
        readlistUnreadOnly
          ? '未読はありません'
          : 'まだありません(ページを右クリック→「リーディングリストに追加」)',
        'book'
      )
    );
    return;
  }
  for (const entry of items) {
    const item = document.createElement('div');
    item.className = 'panel-item readlist-item' + (entry.read ? ' read' : '');
    item.title = `${entry.title}\n${entry.url}`;
    item.appendChild(faviconEl(entry.favicon, entry.title));

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.title || entry.url;
    const sub = document.createElement('span');
    sub.className = 'sub';
    try {
      sub.textContent = new URL(entry.url).host;
    } catch {
      sub.textContent = entry.url;
    }
    label.appendChild(sub);
    item.appendChild(label);

    const readBtn = document.createElement('button');
    readBtn.className = 'item-btn';
    readBtn.textContent = entry.read ? '未読に' : '既読に';
    readBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.roopieInternal.setReadlistRead(entry.id, !entry.read);
    });
    item.appendChild(readBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.roopieInternal.removeReadlist(entry.id);
    });
    item.appendChild(removeBtn);

    // クリックで現在のタブに開いて既読に、中クリックで新しいタブ
    item.addEventListener('click', () => {
      window.roopieInternal.navigate(entry.url);
      window.roopieInternal.setReadlistRead(entry.id, true);
    });
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        window.roopieInternal.openTab(entry.url);
        window.roopieInternal.setReadlistRead(entry.id, true);
      }
    });
    readlistListEl.appendChild(item);
  }
}

$('readlist-add-btn').addEventListener('click', () => window.roopieInternal.addCurrentToReadlist());
readlistFilterBtn.addEventListener('click', () => {
  readlistUnreadOnly = !readlistUnreadOnly;
  readlistFilterBtn.textContent = readlistUnreadOnly ? 'すべて表示' : '未読のみ';
  readlistFilterBtn.classList.toggle('active', readlistUnreadOnly);
  renderReadlist();
});
$('readlist-clear-btn').addEventListener('click', () => window.roopieInternal.clearReadReadlist());

async function refreshReadlist() {
  readlist = await window.roopieInternal.listReadlist();
  renderReadlist();
}
window.roopieInternal.onReadlistState((items) => {
  readlist = items;
  renderReadlist();
});

// ---- メモ(自動保存) ----
let notesTimer = null;

notesEl.addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => window.roopieInternal.setSidePanelNotes(notesEl.value), 400);
});

// ---- Webパネル ----
function addWebPanel() {
  const url = webUrlEl.value.trim();
  if (!url) return;
  window.roopieInternal.addWebPanel(url);
  webUrlEl.value = '';
}

$('web-add-btn').addEventListener('click', addWebPanel);
webUrlEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addWebPanel();
});

function renderWebList() {
  webListEl.textContent = '';
  if (!state.webPanels.length) {
    webListEl.appendChild(emptyNote('まだ登録されていません', 'globe'));
    return;
  }
  for (const panel of state.webPanels) {
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.title = panel.url;
    item.appendChild(webIconEl(panel));

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = panel.title || panel.url;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = panel.url;
    label.appendChild(sub);
    item.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.roopieInternal.removeWebPanel(panel.id);
    });
    item.appendChild(removeBtn);

    item.addEventListener('click', () => window.roopieInternal.openWebPanel(panel.id));
    // 右クリックで名前/アイコン/URLの変更・削除
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.roopieInternal.webPanelContextMenu(panel.id);
    });
    webListEl.appendChild(item);
  }
}

// アイコンレールへの直接ピン留め表示。クリックで即座にそのWebパネルを開く
// (表示中のものをもう一度押すとメイン側の判断で折りたたまれ、activeWebIdがnullに戻って反映される)
function renderPinnedWebPanels() {
  webPinListEl.textContent = '';
  for (const panel of state.webPanels) {
    const btn = document.createElement('button');
    btn.className = 'web-icon' + (panel.id === state.activeWebId ? ' active' : '');
    btn.title = panel.title || panel.url;
    btn.appendChild(webIconEl(panel));
    btn.addEventListener('click', () => window.roopieInternal.openWebPanel(panel.id));
    // 右クリックで名前/アイコン/URLの変更・削除
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.roopieInternal.webPanelContextMenu(panel.id);
    });
    webPinListEl.appendChild(btn);
  }
}

$('web-reload').addEventListener('click', () => window.roopieInternal.reloadWebPanel());
$('web-open-tab').addEventListener('click', () => {
  const active = state.webPanels.find((p) => p.id === state.activeWebId);
  if (!active) return;
  window.roopieInternal.openTab(active.url);
});

// ---- Webパネルの編集モーダル(名前/URL/アイコン) ----
// 右クリックメニュー→メイン(section-webを開く=パネルを広げる)→ここでモーダルを開く
const WEB_EDIT_EMOJI = [
  '⭐', '🔖', '📮', '💬', '🎵', '📺',
  '🛒', '📰', '💼', '📅', '☁', '🌐',
  '🔧', '🎮', '📚', '☕', '💡', '❤',
];
const webEditModal = $('web-edit');
const webEditTitle = $('web-edit-title');
const webEditInput = $('web-edit-input');
const webEditEmojiInput = $('web-edit-emoji-input');
const webEditError = $('web-edit-error');
const webEditTextMode = $('web-edit-text-mode');
const webEditIconMode = $('web-edit-icon-mode');
let webEdit = null; // { id, field, pendingIcon }

function looksLikeUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  try {
    new URL(/^https?:/i.test(t) ? t : `https://${t}`);
    return true;
  } catch {
    return false;
  }
}

function setPendingIcon(icon) {
  if (!webEdit) return;
  webEdit.pendingIcon = icon;
  for (const b of $('web-edit-emoji').children) {
    b.classList.toggle('selected', icon?.type === 'emoji' && b.textContent === icon.value);
  }
}

function openWebEditModal(id, field) {
  const entry = state.webPanels.find((p) => p.id === id);
  if (!entry) return;
  webEdit = { id, field, pendingIcon: entry.icon ?? null };
  webEditError.classList.add('hidden');
  const isIcon = field === 'icon';
  webEditTextMode.classList.toggle('hidden', isIcon);
  webEditIconMode.classList.toggle('hidden', !isIcon);

  webEditInput.placeholder = '';
  if (field === 'name') {
    webEditTitle.textContent = '名前を変更';
    webEditInput.value = entry.title || '';
  } else if (field === 'url') {
    webEditTitle.textContent = 'URLを変更';
    webEditInput.value = entry.url || '';
  } else {
    webEditTitle.textContent = 'アイコンを変更';
    renderEmojiGrid();
    webEditEmojiInput.value = entry.icon?.type === 'emoji' ? entry.icon.value : '';
  }

  webEditModal.classList.remove('hidden');
  if (!isIcon) {
    webEditInput.focus();
    webEditInput.select();
  }
}

// レール右クリック「ウェブパネルを追加」からのURL入力モーダル
function openWebAddModal() {
  webEdit = { id: null, field: 'add' };
  webEditError.classList.add('hidden');
  webEditTextMode.classList.remove('hidden');
  webEditIconMode.classList.add('hidden');
  webEditTitle.textContent = 'ウェブパネルを追加';
  webEditInput.value = '';
  webEditInput.placeholder = 'URLを入力(例: gmail.com)';
  webEditModal.classList.remove('hidden');
  webEditInput.focus();
}

function renderEmojiGrid() {
  const grid = $('web-edit-emoji');
  grid.textContent = '';
  for (const emoji of WEB_EDIT_EMOJI) {
    const b = document.createElement('button');
    b.className = 'emoji-btn';
    b.textContent = emoji;
    b.addEventListener('click', () => {
      webEditEmojiInput.value = emoji;
      setPendingIcon({ type: 'emoji', value: emoji });
    });
    grid.appendChild(b);
  }
}

function closeWebEditModal() {
  webEditModal.classList.add('hidden');
  webEdit = null;
}

function applyWebEdit() {
  if (!webEdit) return;
  const { id, field } = webEdit;
  if (field === 'add') {
    if (!looksLikeUrl(webEditInput.value)) {
      webEditError.textContent = '正しいURLを入力してください';
      webEditError.classList.remove('hidden');
      return;
    }
    window.roopieInternal.addWebPanel(webEditInput.value);
    closeWebEditModal();
    return;
  }
  if (field === 'name') {
    window.roopieInternal.setWebPanel(id, { title: webEditInput.value });
  } else if (field === 'url') {
    if (!looksLikeUrl(webEditInput.value)) {
      webEditError.textContent = '正しいURLを入力してください';
      webEditError.classList.remove('hidden');
      return;
    }
    window.roopieInternal.setWebPanel(id, { url: webEditInput.value });
  } else {
    // 絵文字入力欄が優先(直接入力を拾う)。空なら現在のpendingIcon(グリッド選択/画像/reset)
    const typed = webEditEmojiInput.value.trim();
    const icon = typed ? { type: 'emoji', value: typed } : webEdit.pendingIcon;
    window.roopieInternal.setWebPanel(id, { icon: icon ?? null });
  }
  closeWebEditModal();
}

// 画像を選んで中央基準の正方形にクロップ→128pxのdata URIに
$('web-edit-upload').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
        webEditEmojiInput.value = '';
        setPendingIcon({ type: 'image', value: canvas.toDataURL('image/png') });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
});

$('web-edit-reset-icon').addEventListener('click', () => {
  webEditEmojiInput.value = '';
  setPendingIcon(null);
});
webEditEmojiInput.addEventListener('input', () => {
  const v = webEditEmojiInput.value.trim();
  setPendingIcon(v ? { type: 'emoji', value: v } : null);
});
$('web-edit-apply').addEventListener('click', applyWebEdit);
$('web-edit-cancel').addEventListener('click', closeWebEditModal);
webEditModal.addEventListener('click', (e) => {
  if (e.target === webEditModal) closeWebEditModal(); // 背景クリックで閉じる
});
webEditInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyWebEdit();
  else if (e.key === 'Escape') closeWebEditModal();
});

window.roopieInternal.onEditWebPanel(({ id, field }) => openWebEditModal(id, field));
window.roopieInternal.onAddWebPrompt(() => openWebAddModal());

// ---- 再生中 ----
let mediaState = null;
let mediaSettings = { mediaDocked: false };
let seekingNowPlaying = false;

function renderNowPlaying() {
  nowPlayingTab.classList.toggle('hidden', !mediaState);
  // 再生が止まったのに「再生中」を表示中なら、折りたたんで空振りを解消する
  if (state.activeSection === 'now-playing' && !mediaState) {
    window.roopieInternal.openSidePanelSection('now-playing');
  }
  // シークバーをドラッグ中に描画し直すと操作中の値が飛ぶため、いったん保留する
  if (seekingNowPlaying) return;

  nowPlayingBody.textContent = '';
  if (!mediaState) {
    nowPlayingBody.appendChild(emptyNote('再生中のメディアはありません', 'music'));
    return;
  }

  const card = document.createElement('div');
  card.className = 'now-playing-card';

  const art = document.createElement('div');
  art.className = 'now-playing-art';
  if (mediaState.artwork) {
    const img = document.createElement('img');
    img.src = mediaState.artwork;
    art.appendChild(img);
  } else {
    art.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  card.appendChild(art);

  const title = document.createElement('div');
  title.className = 'now-playing-title';
  title.textContent = mediaState.title || '';
  card.appendChild(title);

  const artist = document.createElement('div');
  artist.className = 'now-playing-artist';
  artist.textContent = mediaState.artist || '';
  card.appendChild(artist);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1000';
  range.className = 'now-playing-seek';
  range.disabled = !(mediaState.duration > 0);
  range.value = String(
    mediaState.duration > 0 ? Math.round((mediaState.currentTime / mediaState.duration) * 1000) : 0
  );
  range.addEventListener('mousedown', () => {
    seekingNowPlaying = true;
  });
  range.addEventListener('change', () => {
    if (mediaState.duration > 0) {
      window.roopieInternal.mediaSeek((Number(range.value) / 1000) * mediaState.duration);
    }
    seekingNowPlaying = false;
  });
  card.appendChild(range);

  const controls = document.createElement('div');
  controls.className = 'now-playing-controls';
  if (mediaState.canPrev) {
    controls.appendChild(button('前へ', () => window.roopieInternal.mediaPrev()));
  }
  controls.appendChild(button(mediaState.playing ? '一時停止' : '再生', () => window.roopieInternal.mediaToggle()));
  if (mediaState.canNext) {
    controls.appendChild(button('次へ', () => window.roopieInternal.mediaNext()));
  }
  if (mediaState.hasVideo) {
    controls.appendChild(button('PinP', () => window.roopieInternal.mediaPip()));
  }
  controls.appendChild(button('タブを表示', () => window.roopieInternal.mediaSwitchToTab()));
  card.appendChild(controls);

  card.appendChild(
    createToggleRow(
      'フローティング表示',
      'オフにすると、このパネルだけで操作します',
      !mediaSettings.mediaDocked,
      (checked) => window.roopieInternal.setSetting('mediaDocked', !checked)
    )
  );

  nowPlayingBody.appendChild(card);
}

// 簡易ボタン(内部ページ共通の.btnスタイルを流用)
function button(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function createToggleRow(name, desc, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'setting-name';
  title.textContent = name;
  text.appendChild(title);
  const description = document.createElement('div');
  description.className = 'setting-desc';
  description.textContent = desc;
  text.appendChild(description);
  row.appendChild(text);

  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);
  const slider = document.createElement('span');
  slider.className = 'slider';
  label.appendChild(slider);
  row.appendChild(label);
  return row;
}

window.roopieInternal.onMediaState((next) => {
  mediaState = next;
  renderNowPlaying();
});

window.roopieInternal.onSettings((settings) => {
  mediaSettings.mediaDocked = settings.mediaDocked === true;
  applySidePanelSide(settings.sidePanelPosition);
  if (mediaState) renderNowPlaying();
});

// パネルが左右どちら側に開くかで、コンテンツとアイコンレールの左右を入れ替える
// (レールは常に「外側の端」= ウィンドウの縁に接する側に来るようにする。Vivaldi等と同様)
function applySidePanelSide(position) {
  document.body.classList.toggle('panel-left', position === 'left');
}

// ---- 状態の反映 ----
// activeSection(組み込みセクション)/activeWebId(Webパネル)のどちらか一方だけが有効。
// どちらも無ければレールのみ(折りたたみ)の状態
function render() {
  const activeWeb = state.webPanels.find((p) => p.id === state.activeWebId);

  for (const btn of document.querySelectorAll('.section-tab[data-section]')) {
    btn.classList.toggle('active', !state.activeWebId && btn.dataset.section === state.activeSection);
  }
  for (const el of document.querySelectorAll('.section')) {
    el.classList.toggle('active', !state.activeWebId && el.id === `section-${state.activeSection}`);
  }

  panelHeaderTitle.textContent = activeWeb ? activeWeb.title || activeWeb.url : SECTION_LABELS[state.activeSection] ?? '';
  webReloadBtn.classList.toggle('hidden', !activeWeb);
  webOpenTabBtn.classList.toggle('hidden', !activeWeb);

  if (state.activeSection === 'history') refreshHistory();
  if (state.activeSection === 'bookmarks') refreshBookmarks();

  renderWebList();
  renderPinnedWebPanels();
  // 入力中のメモは上書きしない
  if (document.activeElement !== notesEl) notesEl.value = state.notes;
}

window.roopieInternal.onSidePanelState((next) => {
  state = next;
  render();
});

(async () => {
  const [next, settings] = await Promise.all([
    window.roopieInternal.getSidePanel(),
    window.roopieInternal.getSettings(),
  ]);
  if (next) state = next;
  mediaSettings.mediaDocked = settings.mediaDocked === true;
  applySidePanelSide(settings.sidePanelPosition);
  render();
  refreshBookmarks();
  refreshReadlist();
})();
