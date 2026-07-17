// ブックマーク管理画面。通常のブックマークとスタート画面のショートカット(startフォルダ→
// ページ→ショートカット)を1つのフォルダツリーとして表示・編集・移動できる。
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');

let items = []; // 全アイテム(フラット配列。parentIdで木構造)
const collapsed = new Set(); // 折りたたみ中のフォルダid(メモリ内のみ)

async function load() {
  items = await window.roopieInternal.listAllBookmarks();
  render();
}

function childrenOf(parentId) {
  return items.filter((b) => b.parentId === parentId);
}

function startRootItem() {
  return items.find((b) => b.startRoot) ?? null;
}

// 検索結果の所在表示用: アイテムの属するフォルダのパス(例: スタート画面 / ページ1)
function folderPath(item) {
  const names = [];
  let parentId = item.parentId;
  while (parentId) {
    const folder = items.find((b) => b.id === parentId);
    if (!folder) break;
    names.unshift(folder.startRoot ? 'スタート画面' : folder.title);
    parentId = folder.parentId;
  }
  return names.length ? names.join(' / ') : 'ブックマーク';
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  listEl.textContent = '';

  if (query) {
    const hits = items.filter(
      (b) =>
        b.type === 'bookmark' &&
        (b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query))
    );
    if (!hits.length) {
      listEl.appendChild(window.roopieEmptyState('一致するブックマークはありません', { icon: 'search' }));
      return;
    }
    for (const bookmark of hits) listEl.appendChild(bookmarkRow(bookmark, { showPath: true }));
    return;
  }

  // ルート直下: 通常のブックマーク → フォルダ(スタート画面)の順
  const roots = childrenOf(null);
  const rootBookmarks = roots.filter((b) => b.type === 'bookmark');
  if (!rootBookmarks.length) {
    listEl.appendChild(
      window.roopieEmptyState('ブックマークはまだありません(Ctrl+D で追加できます)', { icon: 'bookmark' })
    );
  }
  for (const bookmark of rootBookmarks) listEl.appendChild(bookmarkRow(bookmark));
  for (const folder of roots.filter((b) => b.type === 'folder')) renderFolder(folder, listEl);
}

function renderFolder(folder, container) {
  container.appendChild(folderRow(folder));
  if (collapsed.has(folder.id)) return;
  const box = document.createElement('div');
  box.className = 'bm-children';
  const children = childrenOf(folder.id);
  for (const bookmark of children.filter((b) => b.type === 'bookmark')) box.appendChild(bookmarkRow(bookmark));
  for (const sub of children.filter((b) => b.type === 'folder')) renderFolder(sub, box);
  if (!box.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'bm-empty';
    empty.textContent = '(空)';
    box.appendChild(empty);
  }
  container.appendChild(box);
}

function folderRow(folder) {
  const row = document.createElement('div');
  row.className = 'row bm-folder';

  const twisty = document.createElement('span');
  twisty.className = 'bm-twisty';
  twisty.textContent = collapsed.has(folder.id) ? '▸' : '▾';
  row.appendChild(twisty);

  const main = document.createElement('div');
  main.className = 'main';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = folder.startRoot ? '🏠 スタート画面のショートカット' : `📁 ${folder.title}`;
  main.appendChild(title);
  const sub = document.createElement('span');
  sub.className = 'sub';
  const count = childrenOf(folder.id).length;
  sub.textContent = folder.startRoot ? 'スタートページに表示されます' : `${count}件`;
  main.appendChild(sub);
  row.appendChild(main);

  // タイトル・矢印クリックで折りたたみ
  const toggle = () => {
    if (collapsed.has(folder.id)) collapsed.delete(folder.id);
    else collapsed.add(folder.id);
    render();
  };
  twisty.addEventListener('click', toggle);
  title.addEventListener('click', toggle);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (!folder.startRoot) {
    actions.appendChild(actionBtn('名前を変更', () => startRename(folder, title)));
    actions.appendChild(actionBtn('削除', () => window.roopieInternal.removeBookmark(folder.id), true));
  }
  row.appendChild(actions);
  return row;
}

function bookmarkRow(bookmark, { showPath = false } = {}) {
  const row = document.createElement('div');
  row.className = 'row';

  // アイコン: カスタム絵文字 > カスタム画像 > favicon
  if (bookmark.icon?.type === 'emoji') {
    const emoji = document.createElement('span');
    emoji.className = 'bm-emoji';
    emoji.textContent = bookmark.icon.value;
    row.appendChild(emoji);
  } else {
    const src = bookmark.icon?.type === 'image' ? bookmark.icon.value : bookmark.favicon;
    if (src) {
      const icon = document.createElement('img');
      icon.className = 'favicon';
      icon.src = src;
      row.appendChild(icon);
    }
  }

  const main = document.createElement('div');
  main.className = 'main';

  const link = document.createElement('a');
  link.className = 'title';
  link.href = bookmark.url;
  link.textContent = bookmark.title;
  main.appendChild(link);

  const url = document.createElement('span');
  url.className = 'sub';
  url.textContent = showPath ? `${folderPath(bookmark)} — ${bookmark.url}` : bookmark.url;
  main.appendChild(url);
  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.appendChild(actionBtn('名前を変更', () => startRename(bookmark, link)));
  actions.appendChild(actionBtn('移動', (btn) => startMove(bookmark, btn)));
  actions.appendChild(actionBtn('削除', () => window.roopieInternal.removeBookmark(bookmark.id), true));
  row.appendChild(actions);
  return row;
}

function actionBtn(label, onClick, danger = false) {
  const btn = document.createElement('button');
  btn.className = danger ? 'row-btn danger' : 'row-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

// タイトルを入力欄に差し替えて編集する
function startRename(item, titleEl) {
  const input = document.createElement('input');
  input.className = 'search';
  input.value = item.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const title = input.value.trim();
    if (title && title !== item.title) {
      window.roopieInternal.renameBookmark(item.id, title);
    } else {
      load(); // 変更なしなら元に戻す
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') load();
  });
  input.addEventListener('blur', commit);
}

// 「移動」ボタンを移動先セレクトに差し替える。
// 移動先: ブックマーク(ルート) / スタート画面の各ページ
function startMove(bookmark, btn) {
  const select = document.createElement('select');
  select.className = 'row-btn';

  const options = [{ id: '', label: 'ブックマーク' }];
  for (const folder of childrenOf(null).filter((b) => b.type === 'folder' && !b.startRoot)) {
    options.push({ id: folder.id, label: folder.title });
  }
  const start = startRootItem();
  if (start) {
    for (const page of childrenOf(start.id).filter((b) => b.type === 'folder')) {
      options.push({ id: page.id, label: `スタート画面 / ${page.title}` });
    }
  }

  const placeholder = document.createElement('option');
  placeholder.textContent = '移動先を選択…';
  placeholder.value = '__cancel__';
  select.appendChild(placeholder);
  for (const opt of options) {
    if ((opt.id || null) === bookmark.parentId) continue; // 今いる場所は出さない
    const option = document.createElement('option');
    option.value = opt.id;
    option.textContent = opt.label;
    select.appendChild(option);
  }

  btn.replaceWith(select);
  select.focus();

  select.addEventListener('change', () => {
    if (select.value !== '__cancel__') {
      window.roopieInternal.moveBookmark(bookmark.id, select.value || null);
    }
    load();
  });
  select.addEventListener('blur', () => load());
}

searchEl.addEventListener('input', render);
// 変更通知のペイロードはルート直下のみなので、ツリー全体を取り直す
window.roopieInternal.onBookmarksState(() => load());

load();
