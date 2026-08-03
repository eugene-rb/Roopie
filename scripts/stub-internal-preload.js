// newtab.html のE2E検証用スタブpreload(test-newtab-widgets.js から使う)。
// 本物の internal-preload.js の代わりに、newtab が使うAPIをメモリ上のデータで返す。
const { contextBridge } = require('electron');

let pages = [
  { id: 'p1', type: 'folder', title: 'ページ1' },
  { id: 'p2', type: 'folder', title: 'ページ2' },
];
const shortcutsByPage = {
  p1: [{ id: 's1', type: 'bookmark', title: 'Example', url: 'https://example.com', favicon: null, icon: null }],
  p2: [{ id: 's2', type: 'bookmark', title: 'Second', url: 'https://example.org', favicon: null, icon: null }],
};
const layoutByPage = { p1: [], p2: [] };
let nextPageNum = 3;
let nextFolderNum = 1;
let onBookmarksCb = () => {};
const configCalls = [];
const layoutCalls = [];
let settings = { startIconSize: 96 };
let onSettingsCb = () => {};
let theme = {
  accent: '#6c8cff',
  background: 'night',
  backgroundImage: '',
  backgroundBlur: 0,
  backgroundDim: 0,
  backgroundPattern: 'dots',
  patternColor: '#6c8cff',
  patternBase: '#12162b',
  gradientAngle: 165,
  gradientStops: ['#171632', '#453667', '#e29a76'],
  windowOpacity: 1,
  customCss: '',
};
let onThemeCb = () => {};

const FAKE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>テストフィード</title>
<item><title>記事1のタイトル</title><link>https://example.com/1</link><pubDate>Thu, 16 Jul 2026 10:00:00 +0900</pubDate></item>
<item><title>記事2のタイトル</title><link>https://example.com/2</link><pubDate>Fri, 17 Jul 2026 09:00:00 +0900</pubDate></item>
</channel></rss>`;

contextBridge.exposeInMainWorld('roopieInternal', {
  navigate: () => {},
  openTab: () => {},
  listStartPages: async () => pages,
  addStartPage: async (title) => {
    const page = { id: `p${nextPageNum}`, type: 'folder', title: title || `ページ${nextPageNum}` };
    nextPageNum += 1;
    pages = [...pages, page];
    shortcutsByPage[page.id] = [];
    layoutByPage[page.id] = [];
    return page;
  },
  listShortcuts: async (pageId) => shortcutsByPage[pageId] || [],
  // ページの中のフォルダを作る(本物は bookmarks:add-folder。作ったフォルダを返す)
  addBookmarkFolder: async (parentId, title, icon) => {
    if (!parentId) return null;
    const folder = {
      id: `folder-${nextFolderNum++}`,
      type: 'folder',
      parentId,
      title: (title ?? '').trim() || '新しいフォルダ',
      icon: icon ?? null,
    };
    shortcutsByPage[parentId] = [...(shortcutsByPage[parentId] || []), folder];
    shortcutsByPage[folder.id] = [];
    onBookmarksCb();
    return folder;
  },
  // 検証からページの中身を差し替える入口(本物のブックマーク側の変更通知まで再現する)
  __setShortcuts: (pageId, list) => {
    shortcutsByPage[pageId] = list;
    onBookmarksCb();
  },
  addShortcut: async () => null,
  // 本物は bookmarks:update-item / bookmarks:remove。ページ(フォルダ)にも同じ経路が使われるので、
  // ページの改名・削除と、ページの中のアイテム(ショートカット/フォルダ)の名前・アイコンの変更を
  // 実データに反映して変更通知(onBookmarksState)まで再現する
  updateShortcut: (id, patch) => {
    if (!patch) return;
    if (pages.some((p) => p.id === id)) {
      if (!patch.title) return;
      pages = pages.map((p) => (p.id === id ? { ...p, title: patch.title } : p));
      onBookmarksCb();
      return;
    }
    for (const [pageId, list] of Object.entries(shortcutsByPage)) {
      const index = list.findIndex((b) => b.id === id);
      if (index === -1) continue;
      const item = { ...list[index] };
      if (typeof patch.title === 'string' && patch.title.trim()) item.title = patch.title.trim();
      if (patch.icon !== undefined) item.icon = patch.icon;
      shortcutsByPage[pageId] = [...list.slice(0, index), item, ...list.slice(index + 1)];
      onBookmarksCb();
      return;
    }
  },
  removeShortcut: (id) => {
    if (!pages.some((p) => p.id === id)) return;
    pages = pages.filter((p) => p.id !== id);
    delete shortcutsByPage[id];
    delete layoutByPage[id];
    onBookmarksCb();
  },
  pickShortcutFolder: async () => null,
  openShortcutFolder: () => {},
  fetchPageTitle: async () => 'タイトル',
  listLocalServers: async () => [],
  dismissLocalServer: () => {},
  onBookmarksState: (cb) => {
    onBookmarksCb = cb;
  },
  onThemeState: (cb) => {
    onThemeCb = cb;
  },
  getTheme: async () => theme,
  // 検証から背景テーマを差し替えるための入口(本物のsetThemeはメインへ送る)
  __setTheme: (patch) => {
    theme = { ...theme, ...patch };
    onThemeCb(theme);
    return theme;
  },
  getSettings: async () => settings,
  setSetting: (key, value) => {
    settings = { ...settings, [key]: value };
    onSettingsCb(settings);
  },
  onSettings: (cb) => {
    onSettingsCb = cb;
  },

  getWidgetLayout: async (pageId) => layoutByPage[pageId] || (layoutByPage[pageId] = []),
  setWidgetLayout: (pageId, items) => {
    layoutByPage[pageId] = items;
    layoutCalls.push(items);
  },
  addWidget: async (pageId, widgetType) => {
    const list = layoutByPage[pageId] || (layoutByPage[pageId] = []);
    const item = { type: 'widget', id: `w-${list.length + 1}-${widgetType}`, widgetType, config: {} };
    layoutByPage[pageId] = [...list, item];
    return item;
  },
  removeWidget: (pageId, id) => {
    layoutByPage[pageId] = (layoutByPage[pageId] || []).filter((i) => !(i.type === 'widget' && i.id === id));
  },
  setWidgetConfig: (pageId, id, patch) => {
    configCalls.push({ id, patch });
    const item = (layoutByPage[pageId] || []).find((i) => i.type === 'widget' && i.id === id);
    if (item) item.config = { ...item.config, ...patch };
  },
  geocodeCity: async () => [{ name: '東京', admin: '東京都', country: '日本', lat: 35.68, lon: 139.76 }],
  getWeather: async () => ({
    current: { temp: 28.4, code: 1 },
    daily: [
      { date: '2026-07-17', max: 32.1, min: 24.5, code: 1 },
      { date: '2026-07-18', max: 31.0, min: 24.0, code: 3 },
      { date: '2026-07-19', max: 29.8, min: 23.2, code: 61 },
    ],
  }),
  getRss: async () => FAKE_RSS,

  // テストからの状態確認用
  __stubState: () => ({ layout: layoutByPage.p1, configCalls, layoutCalls, settings }),
  __setSettings: (patch) => {
    settings = { ...settings, ...patch };
    onSettingsCb(settings);
  },
});
