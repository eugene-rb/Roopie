const $ = (id) => document.getElementById(id);

const bookmarkListEl = $('bookmark-list');
const historyListEl = $('history-list');
const historySearchEl = $('history-search');
const notesEl = $('notes');
const webPinListEl = $('web-pin-list');
const railEl = $('rail');
const nowPlayingTab = $('now-playing-tab');
const nowPlayingBody = $('now-playing-body');
const panelHeaderTitle = $('panel-header-title');
const webReloadBtn = $('web-reload');
const webOpenTabBtn = $('web-open-tab');
const downloadsListEl = $('downloads-list');
const timersListEl = $('timers-list');

let state = { open: true, webPanels: [], activeSection: null, activeWebId: null, notes: '' };

// パネル見出し・タブのtitle属性と揃えたラベル(Vivaldiのパネルヘッダー相当)
// 'web' は管理画面ではなく、追加/編集モーダルを表示するときのホスト(空のパネル)として使う
const SECTION_LABELS = {
  bookmarks: 'ブックマーク',
  downloads: 'ダウンロード',
  history: '履歴',
  notes: 'メモ',
  readlist: 'リーディングリスト',
  trackers: 'トラッキング',
  timers: 'タイマー',
  web: 'ウェブパネル',
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
    if (e.button === 1) window.roopieInternal.openTab(url, true);
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

// レール最下部の「+」: ウェブパネルの追加(Vivaldiと同じ)
$('web-add-tab').addEventListener('click', () => window.roopieInternal.promptAddWebPanel());

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

// ---- ブックマーク(VSCodeのエクスプローラー風ツリー) ----
// 通常のブックマークとスタート画面のショートカット(startフォルダ→ページ→項目)を
// 1つのツリーで表示・管理する。フォルダ折りたたみ/右クリックメニュー/インライン改名/
// ドラッグ&ドロップでの移動/インラインでのフォルダ新規作成に対応
let bmItems = [];
const bmCollapsed = new Set();
let bmSelectedId = null;
let bmInlineNewFolder = null; // 新しいフォルダのインライン入力を出す先のparentId('' = ルート)

async function refreshBookmarks() {
  bmItems = await window.roopieInternal.listAllBookmarks();
  renderBookmarkTree();
}

function bmChildren(parentId) {
  return bmItems.filter((b) => b.parentId === parentId);
}

function closeBmMenu() {
  document.querySelector('.panel-menu')?.remove();
}

function openBmMenu(x, y, entries) {
  closeBmMenu();
  const menu = document.createElement('div');
  menu.className = 'panel-menu';
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.textContent = entry.label;
    btn.addEventListener('click', () => {
      closeBmMenu();
      entry.action();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
  const onOutside = (e) => {
    if (!menu.contains(e.target)) {
      closeBmMenu();
      document.removeEventListener('mousedown', onOutside, true);
    }
  };
  document.addEventListener('mousedown', onOutside, true);
}

// ラベルをインライン入力欄に差し替えて改名(VSCodeのF2相当)
function bmStartRename(item, labelEl) {
  const input = document.createElement('input');
  input.className = 'panel-input bm-inline-input';
  input.value = item.title;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (title && title !== item.title) window.roopieInternal.renameBookmark(item.id, title);
    else renderBookmarkTree();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      done = true;
      renderBookmarkTree();
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation());
}

// 「新しいフォルダ」のインライン入力行(VSCodeの新規フォルダと同じ操作感)
function bmInlineFolderRow(parentId) {
  const row = document.createElement('div');
  row.className = 'panel-item bm-row';
  const icon = document.createElement('span');
  icon.className = 'letter';
  icon.textContent = '📁';
  row.appendChild(icon);
  const input = document.createElement('input');
  input.className = 'panel-input bm-inline-input';
  input.placeholder = 'フォルダ名';
  row.appendChild(input);
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    bmInlineNewFolder = null;
    const title = input.value.trim();
    if (title) window.roopieInternal.addBookmarkFolder(parentId || null, title);
    else renderBookmarkTree();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      done = true;
      bmInlineNewFolder = null;
      renderBookmarkTree();
    }
  });
  input.addEventListener('blur', commit);
  setTimeout(() => input.focus(), 0);
  return row;
}

// ドロップ先(フォルダ or ルート)としての受け入れ。startルート直下は不可(ページ専用のため)
function bmAcceptDrop(el, targetFolderId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('roopie/bookmark-id')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const id = e.dataTransfer.getData('roopie/bookmark-id');
    if (id) window.roopieInternal.moveBookmark(id, targetFolderId);
  });
}

function bmFolderRow(folder) {
  const row = document.createElement('div');
  row.className = 'panel-item bm-row bm-folder-row';
  if (folder.id === bmSelectedId) row.classList.add('selected');

  const chevron = document.createElement('span');
  chevron.className = 'bm-chevron';
  chevron.textContent = bmCollapsed.has(folder.id) ? '▸' : '▾';
  row.appendChild(chevron);

  const icon = document.createElement('span');
  icon.className = 'letter';
  icon.textContent = folder.startRoot ? '🏠' : '📁';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = folder.startRoot ? 'スタート画面' : folder.title;
  row.appendChild(label);

  row.title = folder.startRoot ? 'スタート画面のショートカット' : folder.title;
  row.addEventListener('click', () => {
    bmSelectedId = folder.id;
    if (bmCollapsed.has(folder.id)) bmCollapsed.delete(folder.id);
    else bmCollapsed.add(folder.id);
    renderBookmarkTree();
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bmSelectedId = folder.id;
    const entries = [];
    if (!folder.startRoot) {
      entries.push({ label: '新しいブックマーク', action: () => openBookmarkAddModal(folder.id) });
    }
    entries.push({
      label: folder.startRoot ? '新しいページ' : '新しいフォルダ',
      action: () => {
        bmCollapsed.delete(folder.id);
        bmInlineNewFolder = folder.id;
        renderBookmarkTree();
      },
    });
    if (!folder.startRoot) {
      entries.push({ label: '名前を変更', action: () => bmStartRename(folder, label) });
      entries.push({ label: '削除', action: () => window.roopieInternal.removeBookmark(folder.id) });
    }
    openBmMenu(e.clientX, e.clientY, entries);
  });

  // startルート直下へのドロップは不可(ページ構造保護)。それ以外のフォルダは受け入れる
  if (!folder.startRoot) bmAcceptDrop(row, folder.id);
  return row;
}

function bmBookmarkRow(bookmark) {
  const row = document.createElement('div');
  row.className = 'panel-item bm-row';
  if (bookmark.id === bmSelectedId) row.classList.add('selected');
  row.title = `${bookmark.title}\n${bookmark.url}`;

  const pad = document.createElement('span');
  pad.className = 'bm-chevron';
  row.appendChild(pad);

  if (bookmark.icon?.type === 'emoji' && bookmark.icon.value) {
    const span = document.createElement('span');
    span.className = 'letter emoji';
    span.textContent = bookmark.icon.value;
    row.appendChild(span);
  } else if (bookmark.icon?.type === 'image' && bookmark.icon.value) {
    const img = document.createElement('img');
    img.src = bookmark.icon.value;
    row.appendChild(img);
  } else {
    row.appendChild(faviconEl(bookmark.favicon, bookmark.title));
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = bookmark.title || bookmark.url;
  row.appendChild(label);

  row.addEventListener('click', () => {
    bmSelectedId = bookmark.id;
    window.roopieInternal.navigate(bookmark.url);
  });
  row.addEventListener('auxclick', (e) => {
    if (e.button === 1) window.roopieInternal.openTab(bookmark.url, true);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bmSelectedId = bookmark.id;
    renderBookmarkTree();
    openBmMenu(e.clientX, e.clientY, [
      { label: '開く', action: () => window.roopieInternal.navigate(bookmark.url) },
      { label: '新しいタブで開く', action: () => window.roopieInternal.openTab(bookmark.url) },
      { label: '名前を変更', action: () => bmStartRename(bookmark, document.querySelector(`[data-bm-id="${bookmark.id}"] .label`)) },
      { label: '削除', action: () => window.roopieInternal.removeBookmark(bookmark.id) },
    ]);
  });

  row.dataset.bmId = bookmark.id;
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('roopie/bookmark-id', bookmark.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  // ブックマーク行へのドロップは「同じフォルダへ入れる」として受ける
  // (ルート直下の行なら親=null。startルート直下にブックマーク行は無いので不正な移動先にはならない)
  bmAcceptDrop(row, bookmark.parentId ?? null);
  return row;
}

// VSCodeのエクスプローラーと同じ並び: フォルダが先、その後にブックマーク
function renderBookmarkSubtree(parentId, container) {
  const children = bmChildren(parentId);
  for (const folder of children.filter((b) => b.type === 'folder')) {
    container.appendChild(bmFolderRow(folder));
    if (bmCollapsed.has(folder.id)) continue;
    const box = document.createElement('div');
    box.className = 'bm-tree-children';
    renderBookmarkSubtree(folder.id, box);
    if (bmInlineNewFolder === folder.id) box.appendChild(bmInlineFolderRow(folder.id));
    container.appendChild(box);
  }
  for (const bookmark of children.filter((b) => b.type === 'bookmark')) container.appendChild(bmBookmarkRow(bookmark));
}

function renderBookmarkTree() {
  bookmarkListEl.textContent = '';
  renderBookmarkSubtree(null, bookmarkListEl);
  if (bmInlineNewFolder === '') bookmarkListEl.appendChild(bmInlineFolderRow(''));
  if (!bookmarkListEl.childElementCount) {
    bookmarkListEl.appendChild(emptyNote('ブックマークはまだありません(Ctrl+D で追加)', 'bookmark'));
  }
}

// ツリーの余白: ドロップでルートへ移動、右クリックでルートのメニュー
bmAcceptDrop(bookmarkListEl, null);
bookmarkListEl.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  openBmMenu(e.clientX, e.clientY, [
    { label: '新しいブックマーク', action: () => openBookmarkAddModal(null) },
    {
      label: '新しいフォルダ',
      action: () => {
        bmInlineNewFolder = '';
        renderBookmarkTree();
      },
    },
  ]);
});

// ツールバー(新しいブックマーク/新しいフォルダ/すべて折りたたむ)。
// 追加先はVSCode同様「選択中のフォルダ(またはその親)」、無ければルート
function bmTargetFolderId() {
  const selected = bmItems.find((b) => b.id === bmSelectedId);
  if (!selected) return null;
  const folder = selected.type === 'folder' ? selected : bmItems.find((b) => b.id === selected.parentId);
  return folder && !folder.startRoot ? folder.id : null;
}

$('bookmark-new-btn').addEventListener('click', () => openBookmarkAddModal(bmTargetFolderId()));
$('bookmark-new-folder-btn').addEventListener('click', () => {
  const target = bmTargetFolderId();
  bmInlineNewFolder = target ?? '';
  if (target) bmCollapsed.delete(target);
  renderBookmarkTree();
});
$('bookmark-collapse-btn').addEventListener('click', () => {
  for (const folder of bmItems.filter((b) => b.type === 'folder')) bmCollapsed.add(folder.id);
  renderBookmarkTree();
});

window.roopieInternal.onBookmarksState(() => refreshBookmarks());

// ---- ブックマークの追加モーダル ----
const bookmarkAddModal = $('bookmark-add');
const bookmarkAddUrl = $('bookmark-add-url');
const bookmarkAddName = $('bookmark-add-name');
const bookmarkAddError = $('bookmark-add-error');
let bookmarkAddParentId = null;

function openBookmarkAddModal(parentId = null) {
  bookmarkAddParentId = parentId;
  bookmarkAddUrl.value = '';
  bookmarkAddName.value = '';
  bookmarkAddError.classList.add('hidden');
  bookmarkAddModal.classList.remove('hidden');
  bookmarkAddUrl.focus();
}

function closeBookmarkAddModal() {
  bookmarkAddModal.classList.add('hidden');
}

function applyBookmarkAdd() {
  const raw = bookmarkAddUrl.value.trim();
  if (!looksLikeUrl(raw)) {
    bookmarkAddError.textContent = '正しいURLを入力してください';
    bookmarkAddError.classList.remove('hidden');
    return;
  }
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  window.roopieInternal.addBookmark(url, bookmarkAddName.value.trim() || url, bookmarkAddParentId);
  closeBookmarkAddModal();
}

$('bookmark-add-apply').addEventListener('click', applyBookmarkAdd);
$('bookmark-add-cancel').addEventListener('click', closeBookmarkAddModal);
bookmarkAddModal.addEventListener('click', (e) => {
  if (e.target === bookmarkAddModal) closeBookmarkAddModal(); // 背景クリックで閉じる
});
for (const input of [bookmarkAddUrl, bookmarkAddName]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyBookmarkAdd();
    else if (e.key === 'Escape') closeBookmarkAddModal();
  });
}

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
        window.roopieInternal.openTab(entry.url, true);
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

// ---- タイマー(カウントダウン/時刻指定/ストップウォッチ) ----
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
let timers = [];
let timersReceivedAt = Date.now(); // 受信時刻からの経過分を差し引いて残り/経過時間をローカル再計算する(IPCを毎秒飛ばさない)

function formatDuration(ms) {
  if (ms == null) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatClockTime(t) {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function defaultTimerName(t) {
  return t.type === 'countdown' ? 'カウントダウン' : t.type === 'clock' ? '時刻指定タイマー' : 'ストップウォッチ';
}

function timerSubText(t, elapsed) {
  if (t.ringing) return '時間になりました';
  if (t.type === 'stopwatch') {
    return formatDuration(t.status === 'running' ? t.elapsedMs + elapsed : t.elapsedMs);
  }
  if (t.type === 'countdown') {
    if (t.status !== 'running' && t.status !== 'paused') return `${formatDuration(t.durationMs)} に設定`;
    const ms = t.status === 'running' ? t.remainingMs - elapsed : t.remainingMs;
    return `残り ${formatDuration(ms)}`;
  }
  // clock
  const timeText = formatClockTime(t.clockTime);
  const repeatText = t.repeat?.enabled ? t.repeat.weekdays.map((on, i) => (on ? WEEKDAY_LABELS[i] : '')).join('') : '';
  const label = repeatText ? `${timeText}(${repeatText})` : timeText;
  if (t.status === 'running' && t.remainingMs != null) {
    return `${label} まで残り ${formatDuration(Math.max(0, t.remainingMs - elapsed))}`;
  }
  return label;
}

function timerItemBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'item-btn';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function renderTimers() {
  timersListEl.textContent = '';
  if (!timers.length) {
    timersListEl.appendChild(emptyNote('タイマーはまだありません', 'clock'));
    return;
  }
  const elapsed = Date.now() - timersReceivedAt;
  for (const t of timers) {
    const item = document.createElement('div');
    item.className = 'panel-item timer-item' + (t.ringing ? ' ringing' : '');

    const main = document.createElement('div');
    main.className = 'timer-item-main';
    const icon = document.createElement('span');
    icon.className = 'letter emoji';
    icon.textContent = t.type === 'clock' ? '⏰' : t.type === 'stopwatch' ? '⏱' : '⏲';
    main.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t.name || defaultTimerName(t);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = timerSubText(t, elapsed);
    label.appendChild(sub);
    main.appendChild(label);
    main.addEventListener('click', () => openTimerModal(t.id));
    item.appendChild(main);

    const controls = document.createElement('div');
    controls.className = 'timer-item-controls';

    if (t.ringing) {
      const remainMs = t.graceEndsAt ? Math.max(0, t.graceEndsAt - Date.now()) : null;
      const stopLabel = remainMs != null ? `止める(${Math.ceil(remainMs / 1000)}s)` : '止める';
      controls.appendChild(
        timerItemBtn(stopLabel, () => {
          if (t.fireId) window.roopieInternal.cancelTimerFire(t.fireId);
          else window.roopieInternal.acknowledgeTimer(t.id);
        })
      );
    } else {
      if (t.status === 'running') {
        controls.appendChild(timerItemBtn('一時停止', () => window.roopieInternal.pauseTimer(t.id)));
      } else {
        controls.appendChild(timerItemBtn('開始', () => window.roopieInternal.startTimer(t.id)));
      }
      if (t.status !== 'idle') {
        controls.appendChild(timerItemBtn('リセット', () => window.roopieInternal.resetTimer(t.id)));
      }
    }
    controls.appendChild(timerItemBtn('削除', () => window.roopieInternal.removeTimer(t.id)));

    item.appendChild(controls);
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.roopieInternal.timerContextMenu(t.id);
    });
    timersListEl.appendChild(item);
  }
}

window.roopieInternal.onTimerState((items) => {
  timers = items;
  timersReceivedAt = Date.now();
  renderTimers();
});
window.roopieInternal.listTimers().then((items) => {
  timers = items;
  timersReceivedAt = Date.now();
  renderTimers();
});
// 残り/経過時間の表示だけをローカルで1秒ごとに更新する(データはpush購読のみでIPCは飛ばさない)
setInterval(() => {
  if (state.activeSection === 'timers') renderTimers();
}, 1000);

// ---- タイマーの追加/編集モーダル ----
const timerEditModal = $('timer-edit');
const timerEditTitle = $('timer-edit-title');
const timerNameInput = $('timer-name');
const timerHInput = $('timer-h');
const timerMInput = $('timer-m');
const timerSInput = $('timer-s');
const timerClockTimeInput = $('timer-clock-time');
const timerRepeatEnabled = $('timer-repeat-enabled');
const timerWeekdaysEl = $('timer-weekdays');
const timerActionsBlock = $('timer-actions-block');
const timerEditError = $('timer-edit-error');
const actSound = $('act-sound');
const actHibernate = $('act-hibernate');
const actClose = $('act-close');
const actOpen = $('act-open');
const actOpenUrl = $('act-open-url');
const actShutdown = $('act-shutdown');
const actShutdownConfirmRow = $('act-shutdown-confirm-row');
const actShutdownConfirm = $('act-shutdown-confirm');

let timerEditId = null; // nullなら新規追加
let timerEditType = 'countdown';
let timerEditWeekdays = Array(7).fill(false);

function setTimerType(type) {
  timerEditType = type;
  for (const btn of document.querySelectorAll('.timer-type-btn')) {
    btn.classList.toggle('active', btn.dataset.type === type);
  }
  $('timer-fields-countdown').classList.toggle('hidden', type !== 'countdown');
  $('timer-fields-clock').classList.toggle('hidden', type !== 'clock');
  timerActionsBlock.classList.toggle('hidden', type === 'stopwatch');
}

for (const btn of document.querySelectorAll('.timer-type-btn')) {
  btn.addEventListener('click', () => setTimerType(btn.dataset.type));
}

function renderWeekdayChips() {
  for (const chip of timerWeekdaysEl.querySelectorAll('.weekday-chip')) {
    chip.classList.toggle('active', timerEditWeekdays[Number(chip.dataset.day)]);
  }
}

for (const chip of timerWeekdaysEl.querySelectorAll('.weekday-chip')) {
  chip.addEventListener('click', () => {
    const day = Number(chip.dataset.day);
    timerEditWeekdays[day] = !timerEditWeekdays[day];
    renderWeekdayChips();
  });
}

timerRepeatEnabled.addEventListener('change', () => {
  timerWeekdaysEl.classList.toggle('hidden', !timerRepeatEnabled.checked);
});
actOpen.addEventListener('change', () => {
  actOpenUrl.classList.toggle('hidden', !actOpen.checked);
});
actShutdown.addEventListener('change', () => {
  actShutdownConfirmRow.classList.toggle('hidden', !actShutdown.checked);
  if (!actShutdown.checked) actShutdownConfirm.checked = false;
});

function openTimerModal(id) {
  const existing = id ? timers.find((t) => t.id === id) : null;
  timerEditId = id || null;
  timerEditError.classList.add('hidden');
  timerEditTitle.textContent = existing ? 'タイマーを編集' : '新しいタイマー';
  timerNameInput.value = existing?.name || '';

  setTimerType(existing?.type || 'countdown');

  const total = Math.round((existing?.type === 'countdown' ? existing.durationMs : 5 * 60_000) / 1000);
  timerHInput.value = Math.floor(total / 3600);
  timerMInput.value = Math.floor((total % 3600) / 60);
  timerSInput.value = total % 60;

  const clockTime = existing?.clockTime || { hour: 9, minute: 0 };
  timerClockTimeInput.value = formatClockTime(clockTime);
  timerRepeatEnabled.checked = !!existing?.repeat?.enabled;
  timerEditWeekdays = existing?.repeat?.weekdays ? [...existing.repeat.weekdays] : Array(7).fill(false);
  timerWeekdaysEl.classList.toggle('hidden', !timerRepeatEnabled.checked);
  renderWeekdayChips();

  const actions = existing?.actions || {};
  actSound.checked = actions.sound !== undefined ? actions.sound : true;
  actHibernate.checked = !!actions.hibernateTabs;
  actClose.checked = !!actions.closeWindow;
  actOpen.checked = !!actions.openPage?.enabled;
  actOpenUrl.value = actions.openPage?.url || '';
  actOpenUrl.classList.toggle('hidden', !actOpen.checked);
  actShutdown.checked = !!actions.shutdown;
  actShutdownConfirm.checked = !!actions.shutdownConfirmed;
  actShutdownConfirmRow.classList.toggle('hidden', !actShutdown.checked);

  timerEditModal.classList.remove('hidden');
  timerNameInput.focus();
}

function closeTimerModal() {
  timerEditModal.classList.add('hidden');
  timerEditId = null;
}

function applyTimerEdit() {
  timerEditError.classList.add('hidden');
  const payload = { name: timerNameInput.value.trim(), type: timerEditType };

  if (timerEditType === 'countdown') {
    const h = Number(timerHInput.value) || 0;
    const m = Number(timerMInput.value) || 0;
    const s = Number(timerSInput.value) || 0;
    const durationMs = (h * 3600 + m * 60 + s) * 1000;
    if (durationMs < 1000) {
      timerEditError.textContent = '1秒以上の時間を指定してください';
      timerEditError.classList.remove('hidden');
      return;
    }
    payload.durationMs = durationMs;
  }

  if (timerEditType === 'clock') {
    const [hour, minute] = (timerClockTimeInput.value || '09:00').split(':').map(Number);
    payload.clockTime = { hour, minute };
    payload.repeat = { enabled: timerRepeatEnabled.checked, weekdays: timerEditWeekdays };
  }

  if (timerEditType !== 'stopwatch') {
    if (actShutdown.checked && !actShutdownConfirm.checked) {
      timerEditError.textContent = 'シャットダウンを有効にするには確認チェックが必要です';
      timerEditError.classList.remove('hidden');
      return;
    }
    if (actOpen.checked && !looksLikeUrl(actOpenUrl.value)) {
      timerEditError.textContent = '「特定のページを開く」に正しいURLを入力してください';
      timerEditError.classList.remove('hidden');
      return;
    }
    payload.actions = {
      sound: actSound.checked,
      hibernateTabs: actHibernate.checked,
      closeWindow: actClose.checked,
      openPage: { enabled: actOpen.checked, url: actOpenUrl.value },
      shutdown: actShutdown.checked,
      shutdownConfirmed: actShutdownConfirm.checked,
    };
  }

  if (timerEditId) window.roopieInternal.updateTimer(timerEditId, payload);
  else window.roopieInternal.addTimer(payload);
  closeTimerModal();
}

$('timer-add-btn').addEventListener('click', () => openTimerModal(null));
$('timer-edit-apply').addEventListener('click', applyTimerEdit);
$('timer-edit-cancel').addEventListener('click', closeTimerModal);
timerEditModal.addEventListener('click', (e) => {
  if (e.target === timerEditModal) closeTimerModal();
});
timerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyTimerEdit();
  else if (e.key === 'Escape') closeTimerModal();
});

// ---- メモ(自動保存) ----
let notesTimer = null;

notesEl.addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => window.roopieInternal.setSidePanelNotes(notesEl.value), 400);
});

// ---- ダウンロード(Vivaldiのダウンロードパネル相当) ----
let downloadItems = [];

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function renderDownloads() {
  downloadsListEl.textContent = '';
  if (!downloadItems.length) {
    downloadsListEl.appendChild(emptyNote('ダウンロードはありません', 'download'));
    return;
  }
  for (const entry of downloadItems) {
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.title = entry.filename;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.filename;
    const sub = document.createElement('span');
    sub.className = 'sub';
    if (entry.state === 'progressing') {
      const percent = entry.totalBytes > 0 ? Math.round((entry.receivedBytes / entry.totalBytes) * 100) : null;
      sub.textContent = percent === null ? 'ダウンロード中...' : `${percent}%(${formatBytes(entry.receivedBytes)} / ${formatBytes(entry.totalBytes)})`;
    } else if (entry.state === 'paused') {
      sub.textContent = '一時停止中';
    } else if (entry.state === 'completed') {
      sub.textContent = formatBytes(entry.totalBytes) || '完了';
    } else if (entry.state === 'cancelled') {
      sub.textContent = 'キャンセル済み';
    } else {
      sub.textContent = '中断されました';
    }
    label.appendChild(sub);
    item.appendChild(label);

    if (entry.state === 'completed') {
      const folderBtn = document.createElement('button');
      folderBtn.className = 'item-btn';
      folderBtn.textContent = 'フォルダ';
      folderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.showDownloadInFolder(entry.id);
      });
      item.appendChild(folderBtn);
      item.addEventListener('click', () => window.roopieInternal.openDownload(entry.id));
    } else if (entry.state === 'progressing') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'item-btn';
      cancelBtn.textContent = '中止';
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.cancelDownload(entry.id);
      });
      item.appendChild(cancelBtn);
    }
    downloadsListEl.appendChild(item);
  }
}

async function refreshDownloads() {
  downloadItems = await window.roopieInternal.listDownloads();
  renderDownloads();
}

window.roopieInternal.onDownloadsState(({ items }) => {
  downloadItems = items;
  if (state.activeSection === 'downloads') renderDownloads();
});

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
    // 右クリックで追加/削除/編集(名前・アイコン・URL)のメニュー。
    // 親レールのメニュー(左右切替など)が同時に出ないよう伝播を止める
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
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

// ---- Webパネルの編集(名前/URLはモーダル、アイコンは共通のicon-picker.js) ----
// 右クリックメニュー→メイン(ホストパネル'web'を広げる)→ここでモーダル/ピッカーを開く
const webEditModal = $('web-edit');
const webEditTitle = $('web-edit-title');
const webEditInput = $('web-edit-input');
const webEditError = $('web-edit-error');
let webEdit = null; // { id, field }

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

function openWebEditModal(id, field) {
  const entry = state.webPanels.find((p) => p.id === id);
  if (!entry) return;

  // アイコンはプロファイルと同じ共通ピッカー(絵文字グリッド+自由入力+画像クロップ)。
  // nullは「faviconに戻す」= 既定に戻る
  if (field === 'icon') {
    window.roopieIconPicker.open({
      resetLabel: 'faviconに戻す',
      onPick: (icon) => window.roopieInternal.setWebPanel(id, { icon }),
      onClose: () => window.roopieInternal.sidePanelEditDone(),
    });
    return;
  }

  webEdit = { id, field };
  webEditError.classList.add('hidden');
  webEditInput.placeholder = '';
  if (field === 'name') {
    webEditTitle.textContent = '名前を変更';
    webEditInput.value = entry.title || '';
  } else {
    webEditTitle.textContent = 'URLを変更';
    webEditInput.value = entry.url || '';
  }

  webEditModal.classList.remove('hidden');
  webEditInput.focus();
  webEditInput.select();
}

// レール右クリック/「+」からのURL入力モーダル
function openWebAddModal() {
  webEdit = { id: null, field: 'add' };
  webEditError.classList.add('hidden');
  webEditTitle.textContent = 'ウェブパネルを追加';
  webEditInput.value = '';
  webEditInput.placeholder = 'URLを入力(例: gmail.com)';
  webEditModal.classList.remove('hidden');
  webEditInput.focus();
}

function closeWebEditModal() {
  webEditModal.classList.add('hidden');
  webEdit = null;
  // モーダルのために広げたホストパネル('web')を畳む(判定はメイン側で行う)
  window.roopieInternal.sidePanelEditDone();
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
  } else {
    if (!looksLikeUrl(webEditInput.value)) {
      webEditError.textContent = '正しいURLを入力してください';
      webEditError.classList.remove('hidden');
      return;
    }
    window.roopieInternal.setWebPanel(id, { url: webEditInput.value });
  }
  closeWebEditModal();
}

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

// ---- トラッキング分析 ----
// メイン側(trackers.js)がCookieを既知トラッカー定義に照らして企業単位にまとめた結果を表示する。
// 「どの企業が自分に固有IDを付けているか」「それがサイトをまたいで使えるか」を出すのが目的
const trackersBodyEl = $('trackers-body');
let trackersLoading = false;

function formatExpires(ms) {
  if (!ms) return null;
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days <= 0) return null;
  if (days >= 365) return `約${(days / 365).toFixed(1)}年後まで`;
  if (days >= 31) return `約${Math.round(days / 30)}か月後まで`;
  return `約${days}日後まで`;
}

function trackerSummary(data) {
  const box = document.createElement('div');
  box.className = 'tr-summary';

  const headline = document.createElement('div');
  headline.className = 'tr-headline';
  headline.textContent =
    data.identifiedBy > 0
      ? `${data.identifiedBy}社があなたに固有のIDを付けています`
      : 'あなたに固有IDを付けているトラッカーはありません';
  box.appendChild(headline);

  const stats = document.createElement('div');
  stats.className = 'tr-stats';
  for (const [label, value] of [
    ['トラッカーのCookie', `${data.trackerCookies}件`],
    ['サイトをまたぐ', `${data.crossSiteCookies}件`],
    ['Cookie全体', `${data.totalCookies}件`],
  ]) {
    const cell = document.createElement('div');
    cell.className = 'tr-stat';
    const v = document.createElement('span');
    v.className = 'tr-stat-value';
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'tr-stat-label';
    l.textContent = label;
    cell.append(v, l);
    stats.appendChild(cell);
  }
  box.appendChild(stats);

  const expires = formatExpires(data.longestExpires);
  if (expires) {
    const note = document.createElement('div');
    note.className = 'tr-note';
    note.textContent = `最も長いものは${expires}あなたを識別できます`;
    box.appendChild(note);
  }

  const shield = document.createElement('div');
  shield.className = 'tr-shield' + (data.adblockEnabled ? ' on' : ' off');
  shield.textContent = data.adblockEnabled
    ? '広告ブロックが有効です。多くのトラッカーは読み込み前に遮断されています'
    : '広告ブロックが無効です。設定から有効にすると大半のトラッカーを遮断できます';
  box.appendChild(shield);
  return box;
}

// 履歴からローカルに推定した興味カテゴリ。トラッカーが何を推定しうるかの目安
function trackerInterests(data) {
  const box = document.createElement('div');
  box.className = 'tr-block';
  const title = document.createElement('div');
  title.className = 'tr-block-title';
  title.textContent = '推定されうる興味';
  box.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'tr-note';
  desc.textContent = `あなたの閲覧履歴(${data.visitedSites}サイト)から、この端末の中だけで推定した分類です`;
  box.appendChild(desc);

  const tags = document.createElement('div');
  tags.className = 'tr-tags';
  for (const interest of data.interests) {
    const tag = document.createElement('span');
    tag.className = 'tr-tag';
    tag.textContent = `${interest.label} (${interest.sites})`;
    tags.appendChild(tag);
  }
  box.appendChild(tags);
  return box;
}

function trackerCompanyItem(company) {
  const wrap = document.createElement('div');
  wrap.className = 'tr-company';

  const head = document.createElement('button');
  head.className = 'tr-company-head';
  head.setAttribute('aria-expanded', 'false');

  const name = document.createElement('span');
  name.className = 'tr-company-name';
  name.textContent = company.name;

  const cat = document.createElement('span');
  cat.className = 'tr-company-cat';
  cat.textContent = company.category;

  const count = document.createElement('span');
  count.className = 'tr-company-count';
  count.textContent = company.identifiers > 0 ? `ID ${company.identifiers}` : `${company.cookies.length}件`;

  head.append(name, cat, count);
  wrap.appendChild(head);

  const detail = document.createElement('div');
  detail.className = 'tr-detail hidden';

  const note = document.createElement('div');
  note.className = 'tr-note';
  note.textContent = company.note;
  detail.appendChild(note);

  const expires = formatExpires(company.longestExpires);
  if (expires) {
    const exp = document.createElement('div');
    exp.className = 'tr-note';
    exp.textContent = `保持期限: ${expires}`;
    detail.appendChild(exp);
  }

  // 訪問済みサイトの一次Cookieとして入っていた場合だけ、そのサイト名を出す。
  // (このCookieの存在から「そのサイトがこの企業に閲覧を渡した」と確実に言えるのはこのケースだけ)
  if (company.onSites.length) {
    const sites = document.createElement('div');
    sites.className = 'tr-note';
    sites.textContent = `あなたが訪れた ${company.onSites.join(', ')} 上に置かれています`;
    detail.appendChild(sites);
  }

  for (const cookie of company.cookies) {
    const row = document.createElement('div');
    row.className = 'tr-cookie';

    const cname = document.createElement('span');
    cname.className = 'tr-cookie-name';
    cname.textContent = cookie.name;

    const meta = document.createElement('span');
    meta.className = 'tr-cookie-meta';
    meta.textContent = `${cookie.domain}${cookie.crossSite ? ' · 横断可' : ''}${cookie.session ? ' · 一時的' : ''}`;

    row.append(cname, meta);
    if (cookie.identifier) {
      const badge = document.createElement('span');
      badge.className = 'tr-badge';
      badge.textContent = '識別子';
      badge.title = cookie.preview;
      row.appendChild(badge);
    }
    detail.appendChild(row);
  }

  const forget = document.createElement('button');
  forget.className = 'item-btn tr-forget';
  forget.textContent = 'この企業のCookieを削除';
  forget.addEventListener('click', async () => {
    forget.disabled = true;
    await window.roopieInternal.forgetTracker(company.name);
    refreshTrackers();
  });
  detail.appendChild(forget);

  wrap.appendChild(detail);
  head.addEventListener('click', () => {
    const open = detail.classList.toggle('hidden');
    head.setAttribute('aria-expanded', String(!open));
  });
  return wrap;
}

function renderTrackers(data) {
  trackersBodyEl.textContent = '';
  if (!data) {
    trackersBodyEl.appendChild(emptyNote('分析できませんでした', 'shield'));
    return;
  }

  trackersBodyEl.appendChild(trackerSummary(data));
  if (data.interests.length) trackersBodyEl.appendChild(trackerInterests(data));

  if (!data.companies.length) {
    trackersBodyEl.appendChild(emptyNote('既知のトラッカーCookieは見つかりませんでした', 'shield'));
    return;
  }

  const block = document.createElement('div');
  block.className = 'tr-block';
  const title = document.createElement('div');
  title.className = 'tr-block-title';
  title.textContent = `あなたを追跡している企業 (${data.companies.length})`;
  block.appendChild(title);
  for (const company of data.companies) block.appendChild(trackerCompanyItem(company));
  trackersBodyEl.appendChild(block);
}

async function refreshTrackers() {
  if (trackersLoading) return;
  trackersLoading = true;
  try {
    renderTrackers(await window.roopieInternal.analyzeTrackers());
  } finally {
    trackersLoading = false;
  }
}

$('trackers-refresh-btn').addEventListener('click', () => refreshTrackers());
$('trackers-forget-all-btn').addEventListener('click', async () => {
  await window.roopieInternal.forgetAllTrackers();
  refreshTrackers();
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
  if (state.activeSection === 'downloads') refreshDownloads();
  if (state.activeSection === 'trackers') refreshTrackers();
  if (state.activeSection === 'timers') renderTimers();

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
