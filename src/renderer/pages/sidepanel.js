const $ = (id) => document.getElementById(id);

const bookmarkListEl = $('bookmark-list');
const historyListEl = $('history-list');
const historySearchEl = $('history-search');
const notesEl = $('notes');
const webListEl = $('web-list');
const webUrlEl = $('web-url');
const webIconsEl = $('web-icons');

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
  const next = await window.roopieInternal.getSidePanel();
  if (next) state = next;
  showSection('bookmarks');
  render();
  refreshBookmarks();
})();
