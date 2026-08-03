// bookmarks.html(管理画面)のE2E検証用スタブpreload(test-bookmarks-manager.js から使う)。
// 通常ブックマーク+startフォルダ/ページ/ショートカットの1ツリーをメモリ上に持つ。
const { contextBridge } = require('electron');

let items = [
  { id: 'b1', type: 'bookmark', parentId: null, url: 'https://example.com/', title: 'Example', favicon: null, icon: null },
  { id: 'b2', type: 'bookmark', parentId: null, url: 'https://news.example.org/', title: 'ニュースサイト', favicon: null, icon: null },
  { id: 'root', type: 'folder', parentId: null, startRoot: true, title: 'start' },
  { id: 'p1', type: 'folder', parentId: 'root', title: 'ページ1' },
  { id: 'p2', type: 'folder', parentId: 'root', title: 'ページ2' },
  { id: 's1', type: 'bookmark', parentId: 'p1', url: 'https://short.example.net/', title: 'ショートカットA', favicon: null, icon: { type: 'emoji', value: '🚀' } },
];
const calls = { moves: [], removes: [], renames: [] };
let onStateCb = () => {};

contextBridge.exposeInMainWorld('roopieInternal', {
  listAllBookmarks: async () => items,
  listBookmarks: async () => items.filter((b) => b.type !== 'folder' && !b.parentId),
  removeBookmark: (id) => {
    calls.removes.push(id);
    const removed = items.find((b) => b.id === id);
    items = items.filter((b) => b.id !== id && !(removed?.type === 'folder' && b.parentId === id));
    onStateCb();
  },
  renameBookmark: (id, title) => {
    calls.renames.push({ id, title });
    const item = items.find((b) => b.id === id);
    if (item) item.title = title;
    onStateCb();
  },
  moveBookmark: (id, parentId) => {
    calls.moves.push({ id, parentId });
    const item = items.find((b) => b.id === id);
    if (item) item.parentId = parentId;
    onStateCb();
  },
  onBookmarksState: (cb) => {
    onStateCb = cb;
  },
  onThemeState: () => {},
  getTheme: async () => ({ accent: '#6c8cff', background: 'night', backgroundImage: '', customCss: '' }),

  // テストからの状態確認用
  __stubState: () => ({ items, calls }),
});
