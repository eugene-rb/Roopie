const $ = (id) => document.getElementById(id);

const bookmarkListEl = $('bookmark-list');
const historyListEl = $('history-list');
const historySearchEl = $('history-search');
const notesEl = $('notes');
const webListEl = $('web-list');
const webUrlEl = $('web-url');
const webIconsEl = $('web-icons');
const nowPlayingTab = $('now-playing-tab');
const nowPlayingBody = $('now-playing-body');

let state = { open: false, webPanels: [], activeWebId: null, notes: '' };
let section = 'bookmarks';

// ---- 共通の行アイテム ----
function faviconEl(favicon, fallbackText) {
  if (favicon) {
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

function emptyNote(text) {
  const el = document.createElement('div');
  el.className = 'empty-note';
  el.textContent = text;
  return el;
}

// ---- セクション切り替え ----
function showSection(next) {
  section = next;
  for (const btn of document.querySelectorAll('.section-tab[data-section]')) {
    btn.classList.toggle('active', btn.dataset.section === section);
  }
  for (const el of document.querySelectorAll('.section')) {
    el.classList.toggle('active', el.id === `section-${section}`);
  }
  if (section === 'history') refreshHistory();
  if (section === 'bookmarks') refreshBookmarks();
}

for (const btn of document.querySelectorAll('.section-tab[data-section]')) {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
}

$('panel-close').addEventListener('click', () => window.roopieInternal.toggleSidePanel());

// ---- ブックマーク ----
async function refreshBookmarks() {
  const items = await window.roopieInternal.listBookmarks();
  renderBookmarks(items);
}

function renderBookmarks(items) {
  bookmarkListEl.textContent = '';
  if (!items.length) {
    bookmarkListEl.appendChild(emptyNote('ブックマークはまだありません(Ctrl+D で追加)'));
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
    historyListEl.appendChild(emptyNote('履歴はありません'));
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
    webListEl.appendChild(emptyNote('まだ登録されていません'));
    return;
  }
  for (const panel of state.webPanels) {
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.title = panel.url;
    item.appendChild(faviconEl(panel.favicon, panel.title));

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
    webListEl.appendChild(item);
  }
}

// ---- Webパネルモードのヘッダー ----
$('web-back').addEventListener('click', () => window.roopieInternal.closeWebPanel());
$('web-reload').addEventListener('click', () => window.roopieInternal.reloadWebPanel());
$('web-open-tab').addEventListener('click', () => {
  const active = state.webPanels.find((p) => p.id === state.activeWebId);
  if (!active) return;
  window.roopieInternal.openTab(active.url);
});

function renderWebHeader() {
  webIconsEl.textContent = '';
  for (const panel of state.webPanels) {
    const btn = document.createElement('button');
    btn.className = 'web-icon' + (panel.id === state.activeWebId ? ' active' : '');
    btn.title = panel.title || panel.url;
    btn.appendChild(faviconEl(panel.favicon, panel.title));
    btn.addEventListener('click', () => window.roopieInternal.openWebPanel(panel.id));
    webIconsEl.appendChild(btn);
  }
}

// ---- 再生中 ----
let mediaState = null;
let mediaSettings = { mediaDocked: false };
let seekingNowPlaying = false;

function renderNowPlaying() {
  nowPlayingTab.classList.toggle('hidden', !mediaState);
  if (section === 'now-playing' && !mediaState) showSection('bookmarks');
  // シークバーをドラッグ中に描画し直すと操作中の値が飛ぶため、いったん保留する
  if (seekingNowPlaying) return;

  nowPlayingBody.textContent = '';
  if (!mediaState) {
    nowPlayingBody.appendChild(emptyNote('再生中のメディアはありません'));
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
  controls.appendChild(button(mediaState.playing ? '一時停止' : '再生', () => window.roopieInternal.mediaToggle()));
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
  if (mediaState) renderNowPlaying();
});

// ---- 状態の反映 ----
function render() {
  document.body.classList.toggle('web-mode', !!state.activeWebId);
  renderWebList();
  renderWebHeader();
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
  showSection('bookmarks');
  render();
  refreshBookmarks();
})();
