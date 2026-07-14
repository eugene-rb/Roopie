const MAX_QUICK_LINKS = 10;

const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const greetingEl = document.getElementById('greeting');
const searchEl = document.getElementById('search');
const quickLinksEl = document.getElementById('quick-links');

// ---- 背景(テーマ設定が auto なら時間帯で切り替え) ----
const bgEl = document.getElementById('bg');
let themeBackground = 'auto';
let themeBackgroundImage = '';

function backgroundByHour(hour) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}

function applyBackground() {
  const key =
    themeBackground === 'auto' ? backgroundByHour(new Date().getHours()) : themeBackground;
  document.body.dataset.bg = key;
  bgEl.style.backgroundImage = key === 'image' && themeBackgroundImage ? `url("${themeBackgroundImage}")` : '';
}

// theme.js から呼ばれる(初期化時とテーマ変更時)
window.onRoopieTheme = (theme) => {
  themeBackground = theme.background || 'auto';
  themeBackgroundImage = theme.backgroundImage || '';
  applyBackground();
};
// theme.jsのgetTheme()がこのスクリプトの読み込みより先に解決していた場合に備える
if (window.__roopieLastTheme) window.onRoopieTheme(window.__roopieLastTheme);

// ---- 時計 ----
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]})`;

  const hour = now.getHours();
  greetingEl.textContent =
    hour < 5 ? 'おやすみなさい' : hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';

  applyBackground();
}

updateClock();
setInterval(updateClock, 10_000);

// ---- 検索 ----
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchEl.value.trim()) {
    window.roopieInternal.navigate(searchEl.value);
  }
});

// ---- ショートカット(bookmarksの "start" フォルダ以下。ページ=サブフォルダ) ----
// ショートカットのURLは file:// で始まればローカルフォルダ、それ以外はページ
let pages = [];
let currentPageId = null;
let shortcuts = [];

function shortcutKind(shortcut) {
  return shortcut.url.startsWith('file://') ? 'folder' : 'url';
}

function shortcutTarget(shortcut) {
  return shortcutKind(shortcut) === 'folder' ? shortcut.url.slice('file://'.length) : shortcut.url;
}

function shortcutTileEl(shortcut) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const icon = shortcut.icon ?? { type: 'letter' };

  if (icon.type === 'emoji' && icon.value) {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = icon.value;
    tile.appendChild(span);
  } else if (shortcutKind(shortcut) === 'folder') {
    tile.innerHTML =
      '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  } else if (shortcut.favicon) {
    const img = document.createElement('img');
    img.src = shortcut.favicon;
    tile.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder';
    placeholder.textContent = (shortcut.title[0] || '?').toUpperCase();
    tile.appendChild(placeholder);
  }
  return tile;
}

function renderShortcuts() {
  quickLinksEl.textContent = '';

  for (const shortcut of shortcuts.slice(0, MAX_QUICK_LINKS)) {
    const kind = shortcutKind(shortcut);
    const target = shortcutTarget(shortcut);
    const el = document.createElement(kind === 'folder' ? 'div' : 'a');
    el.className = 'quick-link';
    el.title = `${shortcut.title}\n${target}`;
    if (kind === 'url') {
      el.href = shortcut.url;
    } else {
      el.addEventListener('click', () => window.roopieInternal.openShortcutFolder(target));
    }

    el.appendChild(shortcutTileEl(shortcut));

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = shortcut.title;
    el.appendChild(label);

    const editBtn = document.createElement('button');
    editBtn.className = 'quick-link-edit';
    editBtn.title = '編集';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openShortcutModal(shortcut);
    });
    el.appendChild(editBtn);

    quickLinksEl.appendChild(el);
  }

  if (shortcuts.length < MAX_QUICK_LINKS) {
    const addTile = document.createElement('button');
    addTile.className = 'quick-link quick-link-add';
    addTile.title = 'ショートカットを追加';
    addTile.innerHTML = '<div class="tile"><span class="plus">+</span></div><span class="label">追加</span>';
    addTile.addEventListener('click', () => openShortcutModal(null));
    quickLinksEl.appendChild(addTile);
  }
}

// ---- ページ切り替え(複数ページ=startフォルダ直下の各サブフォルダ) ----
const pageDotsEl = document.getElementById('shortcut-pages');

function renderPageDots() {
  pageDotsEl.textContent = '';
  if (pages.length > 1) {
    for (const page of pages) {
      const dot = document.createElement('button');
      dot.className = 'page-dot' + (page.id === currentPageId ? ' active' : '');
      dot.title = page.title;
      dot.addEventListener('click', () => {
        currentPageId = page.id;
        renderPageDots();
        loadShortcuts();
      });
      pageDotsEl.appendChild(dot);
    }
  }
  const addDot = document.createElement('button');
  addDot.className = 'page-dot page-dot-add';
  addDot.title = 'ページを追加';
  addDot.textContent = '+';
  addDot.addEventListener('click', async () => {
    const page = await window.roopieInternal.addStartPage('');
    if (page) {
      currentPageId = page.id;
      await loadPages();
    }
  });
  pageDotsEl.appendChild(addDot);
}

async function loadShortcuts() {
  shortcuts = currentPageId ? await window.roopieInternal.listShortcuts(currentPageId) : [];
  renderShortcuts();
}

async function loadPages() {
  pages = await window.roopieInternal.listStartPages();
  if (!pages.find((p) => p.id === currentPageId)) currentPageId = pages[0]?.id ?? null;
  renderPageDots();
  await loadShortcuts();
}

// ---- 追加/編集モーダル ----
function radioOption(name, value, label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'shortcut-kind-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  wrap.append(input, Object.assign(document.createElement('span'), { textContent: label }));
  return { wrap, input };
}

function openShortcutModal(existing) {
  const backdrop = document.createElement('div');
  backdrop.className = 'shortcut-backdrop';

  const modal = document.createElement('div');
  modal.className = 'shortcut-modal';

  const existingKind = existing ? shortcutKind(existing) : 'url';
  const existingTarget = existing ? shortcutTarget(existing) : '';

  const title = document.createElement('h3');
  title.textContent = existing ? 'ショートカットを編集' : 'ショートカットを追加';
  modal.appendChild(title);

  const kindRow = document.createElement('div');
  kindRow.className = 'shortcut-kind-row';
  const kindUrl = radioOption('shortcut-kind', 'url', 'ページ', existingKind !== 'folder');
  const kindFolder = radioOption('shortcut-kind', 'folder', 'フォルダ', existingKind === 'folder');
  kindRow.append(kindUrl.wrap, kindFolder.wrap);
  modal.appendChild(kindRow);

  const nameInput = document.createElement('input');
  nameInput.className = 'search';
  nameInput.type = 'text';
  nameInput.placeholder = '名前';
  nameInput.value = existing?.title ?? '';
  modal.appendChild(nameInput);

  const urlInput = document.createElement('input');
  urlInput.className = 'search';
  urlInput.type = 'text';
  urlInput.placeholder = 'URL(例: example.com)';
  urlInput.value = existingKind !== 'folder' ? existingTarget : '';
  modal.appendChild(urlInput);

  let pickedFolder = existingKind === 'folder' ? existingTarget : '';
  const folderRow = document.createElement('div');
  folderRow.className = 'shortcut-folder-row';
  const folderPathText = document.createElement('span');
  folderPathText.className = 'shortcut-folder-path';
  folderPathText.textContent = pickedFolder || '未選択';
  const folderPickBtn = document.createElement('button');
  folderPickBtn.className = 'btn';
  folderPickBtn.textContent = 'フォルダを選択';
  folderPickBtn.addEventListener('click', async () => {
    const picked = await window.roopieInternal.pickShortcutFolder();
    if (picked) {
      pickedFolder = picked;
      folderPathText.textContent = picked;
    }
  });
  folderRow.append(folderPickBtn, folderPathText);
  modal.appendChild(folderRow);

  function syncKindVisibility() {
    const isFolder = kindFolder.input.checked;
    urlInput.classList.toggle('hidden', isFolder);
    folderRow.classList.toggle('hidden', !isFolder);
  }
  kindUrl.input.addEventListener('change', syncKindVisibility);
  kindFolder.input.addEventListener('change', syncKindVisibility);
  syncKindVisibility();

  const iconInput = document.createElement('input');
  iconInput.className = 'search';
  iconInput.type = 'text';
  iconInput.placeholder = 'アイコン(絵文字。空なら頭文字を使用)';
  iconInput.maxLength = 8;
  iconInput.value = existing?.icon?.type === 'emoji' ? existing.icon.value : '';
  modal.appendChild(iconInput);

  const actions = document.createElement('div');
  actions.className = 'shortcut-actions';

  if (existing) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => {
      window.roopieInternal.removeShortcut(existing.id);
      loadShortcuts();
      close();
    });
    actions.appendChild(removeBtn);
  }
  actions.appendChild(document.createElement('div')).className = 'spacer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    const name = nameInput.value.trim();
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    if (!name || !target) return;
    const icon = iconInput.value.trim() ? { type: 'emoji', value: iconInput.value.trim() } : { type: 'letter' };

    if (existing) {
      window.roopieInternal.updateShortcut(existing.id, { kind, title: name, target, icon });
    } else {
      await window.roopieInternal.addShortcut(currentPageId, { kind, name, target, icon });
    }
    await loadShortcuts();
    close();
  });
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  nameInput.focus();

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);
}

// 他のタブでの変更(追加/削除/名前変更など)を拾って再読み込みする
window.roopieInternal.onBookmarksState(() => loadPages());
loadPages();
