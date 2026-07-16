const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');

let bookmarks = [];

async function load() {
  bookmarks = await window.roopieInternal.listBookmarks();
  render();
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const items = query
    ? bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query)
      )
    : bookmarks;

  listEl.textContent = '';

  if (items.length === 0) {
    listEl.appendChild(
      query
        ? window.roopieEmptyState('一致するブックマークはありません', { icon: 'search' })
        : window.roopieEmptyState('ブックマークはまだありません(Ctrl+D で追加できます)', { icon: 'bookmark' })
    );
    return;
  }

  for (const bookmark of items) {
    listEl.appendChild(createRow(bookmark));
  }
}

function createRow(bookmark) {
  const row = document.createElement('div');
  row.className = 'row';

  if (bookmark.favicon) {
    const icon = document.createElement('img');
    icon.className = 'favicon';
    icon.src = bookmark.favicon;
    row.appendChild(icon);
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
  url.textContent = bookmark.url;
  main.appendChild(url);
  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'row-btn';
  renameBtn.textContent = '名前を変更';
  renameBtn.addEventListener('click', () => startRename(bookmark, link, renameBtn));
  actions.appendChild(renameBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'row-btn';
  removeBtn.textContent = '削除';
  removeBtn.addEventListener('click', () => window.roopieInternal.removeBookmark(bookmark.id));
  actions.appendChild(removeBtn);

  row.appendChild(actions);
  return row;
}

// タイトルを入力欄に差し替えて編集する
function startRename(bookmark, linkEl, renameBtn) {
  const input = document.createElement('input');
  input.className = 'search';
  input.value = bookmark.title;
  linkEl.replaceWith(input);
  renameBtn.disabled = true;
  input.focus();
  input.select();

  const commit = () => {
    const title = input.value.trim();
    if (title && title !== bookmark.title) {
      window.roopieInternal.renameBookmark(bookmark.id, title);
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

searchEl.addEventListener('input', render);
window.roopieInternal.onBookmarksState((items) => {
  bookmarks = items;
  render();
});

load();
