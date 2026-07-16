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

// リンク先のfavicon URL(既定アイコン)。ホストが取れないURLはnull
function faviconUrlFor(url) {
  try {
    const host = new URL(url).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
  } catch {
    return null;
  }
}

function letterPlaceholderEl(title) {
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  placeholder.textContent = (title[0] || '?').toUpperCase();
  return placeholder;
}

const FOLDER_ICON_SVG =
  '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// タイルの中身(アイコン部分)を作る。iconOverride はモーダルのプレビュー用
// (undefined = shortcut.icon を使う / null = 既定に戻した状態を表示)
function tileIconContent(tile, shortcut, iconOverride) {
  const icon = iconOverride !== undefined ? iconOverride : shortcut.icon ?? null;

  if (icon?.type === 'emoji' && icon.value) {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = icon.value;
    tile.appendChild(span);
  } else if (icon?.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.className = 'custom-image'; // アップロード画像はタイル全体に敷く(プロファイルのアバターと同じ見せ方)
    img.src = icon.value;
    tile.appendChild(img);
  } else if (shortcutKind(shortcut) === 'folder') {
    tile.innerHTML = FOLDER_ICON_SVG;
  } else {
    // 既定はリンク先のfavicon(訪問時に取得済みならそれ、なければfaviconサービス)。
    // 読み込めなければ頭文字にフォールバック
    const src = shortcut.favicon || faviconUrlFor(shortcut.url);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.addEventListener('error', () => img.replaceWith(letterPlaceholderEl(shortcut.title)));
      tile.appendChild(img);
    } else {
      tile.appendChild(letterPlaceholderEl(shortcut.title));
    }
  }
}

function shortcutTileEl(shortcut) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tileIconContent(tile, shortcut, undefined);
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

  // アイコン: プロファイルと同じ共通ピッカー(絵文字グリッド+自由入力+画像クロップ)。
  // 既定はリンク先のfavicon。pendingIcon: undefined=変更なし / null=既定に戻す / {type,value}=変更
  let pendingIcon;
  const iconRow = document.createElement('div');
  iconRow.className = 'shortcut-icon-row';
  const iconPreview = document.createElement('div');
  iconPreview.className = 'tile shortcut-icon-preview';
  const iconLabel = document.createElement('span');
  iconLabel.className = 'shortcut-icon-label';
  const iconBtn = document.createElement('button');
  iconBtn.className = 'btn';
  iconBtn.textContent = 'アイコンを変更';
  iconRow.append(iconPreview, iconLabel, iconBtn);
  modal.appendChild(iconRow);

  function renderIconPreview() {
    iconPreview.textContent = '';
    // プレビューは現在の入力内容(URL/フォルダ)を反映した仮のショートカットで描く
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    const preview = {
      title: nameInput.value.trim() || existing?.title || '?',
      url: kind === 'folder' ? `file://${target}` : /^https?:/i.test(target) ? target : `https://${target}`,
      favicon: existing?.favicon ?? null,
      icon: existing?.icon ?? null,
    };
    tileIconContent(iconPreview, preview, pendingIcon);
    const effective = pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null;
    iconLabel.textContent = effective ? 'カスタムアイコン' : '既定(リンク先のfavicon)';
  }
  urlInput.addEventListener('input', () => {
    // 既定アイコン表示中はURLに追随してプレビューを更新する
    if ((pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null) === null) renderIconPreview();
  });
  iconBtn.addEventListener('click', () => {
    window.roopieIconPicker.open({
      resetLabel: '既定に戻す(favicon)',
      onPick: (icon) => {
        pendingIcon = icon; // null = 既定(favicon)に戻す
        renderIconPreview();
      },
    });
  });
  renderIconPreview();

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

    if (existing) {
      const patch = { kind, title: name, target };
      if (pendingIcon !== undefined) patch.icon = pendingIcon; // null = 既定(favicon)に戻す
      window.roopieInternal.updateShortcut(existing.id, patch);
    } else {
      await window.roopieInternal.addShortcut(currentPageId, { kind, name, target, icon: pendingIcon ?? null });
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

// ---- ローカルサーバーのサジェスト(起動中の localhost:PORT を検知して表示) ----
// 走査するのは代表的な開発ポートのみ。HTTP応答が返ったものだけを候補にする。
const localServersEl = document.getElementById('local-servers');
let localServerMenu = null;

function closeLocalServerMenu() {
  if (localServerMenu) {
    localServerMenu.remove();
    localServerMenu = null;
    document.removeEventListener('mousedown', onLocalServerDocDown, true);
    document.removeEventListener('keydown', onLocalServerKeydown, true);
  }
}
function onLocalServerDocDown(e) {
  if (localServerMenu && !localServerMenu.contains(e.target)) closeLocalServerMenu();
}
function onLocalServerKeydown(e) {
  if (e.key === 'Escape') closeLocalServerMenu();
}

// 右クリック:このサーバーを非表示にする(以後サジェストしない)
function showLocalServerMenu(x, y, port) {
  closeLocalServerMenu();
  const menu = document.createElement('div');
  menu.className = 'ls-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const hide = document.createElement('button');
  hide.className = 'ls-menu-item';
  hide.textContent = '非表示にする';
  hide.addEventListener('click', () => {
    window.roopieInternal.dismissLocalServer(port);
    closeLocalServerMenu();
    loadLocalServers();
  });
  menu.appendChild(hide);
  document.body.appendChild(menu);
  localServerMenu = menu;
  // 生成直後の同一クリックで閉じないよう、次のtickでリスナーを張る
  setTimeout(() => {
    document.addEventListener('mousedown', onLocalServerDocDown, true);
    document.addEventListener('keydown', onLocalServerKeydown, true);
  });
}

function localServerTile(server) {
  const a = document.createElement('a');
  a.className = 'quick-link';
  a.href = server.url;
  a.title = `${server.title || ''}\n${server.url}`.trim();

  const tile = document.createElement('div');
  tile.className = 'tile';
  if (server.favicon) {
    const img = document.createElement('img');
    img.src = server.favicon;
    tile.appendChild(img);
  } else {
    // faviconが無ければポート番号をプレースホルダに(ショートカットの頭文字と同じ見た目)
    const ph = document.createElement('span');
    ph.className = 'placeholder ls-port';
    ph.textContent = String(server.port);
    tile.appendChild(ph);
  }
  a.appendChild(tile);

  const label = document.createElement('span');
  label.className = 'label';
  // タイトルは信頼できない任意プロセスの文字列なので textContent で入れる
  label.textContent = server.title || `localhost:${server.port}`;
  a.appendChild(label);

  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showLocalServerMenu(e.clientX, e.clientY, server.port);
  });
  return a;
}

async function loadLocalServers() {
  const servers = await window.roopieInternal.listLocalServers();
  localServersEl.textContent = '';
  if (!servers.length) return;

  const heading = document.createElement('div');
  heading.className = 'ls-heading';
  heading.textContent = 'ローカルサーバー';
  localServersEl.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'ls-grid';
  for (const server of servers) grid.appendChild(localServerTile(server));
  localServersEl.appendChild(grid);
}

// 長く開きっぱなしのタブでも、後から起動したサーバーを反映する
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadLocalServers();
});

// 他のタブでの変更(追加/削除/名前変更など)を拾って再読み込みする
window.roopieInternal.onBookmarksState(() => loadPages());
loadPages();
loadLocalServers();
