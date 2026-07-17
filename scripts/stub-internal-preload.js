// newtab.html のE2E検証用スタブpreload(test-newtab-widgets.js から使う)。
// 本物の internal-preload.js の代わりに、newtab が使うAPIをメモリ上のデータで返す。
const { contextBridge } = require('electron');

const pages = [{ id: 'p1', type: 'folder', title: 'ページ1' }];
const shortcuts = [
  { id: 's1', type: 'bookmark', title: 'Example', url: 'https://example.com', favicon: null, icon: null },
];
let layout = [];
const configCalls = [];
const layoutCalls = [];
let settings = { startGridCols: 6, startGridRows: 4 };
let onSettingsCb = () => {};

const FAKE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>テストフィード</title>
<item><title>記事1のタイトル</title><link>https://example.com/1</link><pubDate>Thu, 16 Jul 2026 10:00:00 +0900</pubDate></item>
<item><title>記事2のタイトル</title><link>https://example.com/2</link><pubDate>Fri, 17 Jul 2026 09:00:00 +0900</pubDate></item>
</channel></rss>`;

contextBridge.exposeInMainWorld('roopieInternal', {
  navigate: () => {},
  openTab: () => {},
  listStartPages: async () => pages,
  addStartPage: async () => null,
  listShortcuts: async () => shortcuts,
  addShortcut: async () => null,
  updateShortcut: () => {},
  removeShortcut: () => {},
  pickShortcutFolder: async () => null,
  openShortcutFolder: () => {},
  fetchPageTitle: async () => 'タイトル',
  listLocalServers: async () => [],
  dismissLocalServer: () => {},
  onBookmarksState: () => {},
  onThemeState: () => {},
  getTheme: async () => ({ accent: '#6c8cff', background: 'night', backgroundImage: '', customCss: '' }),
  getSettings: async () => settings,
  setSetting: (key, value) => {
    settings = { ...settings, [key]: value };
    onSettingsCb(settings);
  },
  onSettings: (cb) => {
    onSettingsCb = cb;
  },

  getWidgetLayout: async () => layout,
  setWidgetLayout: (_pageId, items) => {
    layout = items;
    layoutCalls.push(items);
  },
  addWidget: async (_pageId, widgetType) => {
    const item = { type: 'widget', id: `w-${layout.length + 1}-${widgetType}`, widgetType, config: {} };
    layout = [...layout, item];
    return item;
  },
  removeWidget: (_pageId, id) => {
    layout = layout.filter((i) => !(i.type === 'widget' && i.id === id));
  },
  setWidgetConfig: (_pageId, id, patch) => {
    configCalls.push({ id, patch });
    const item = layout.find((i) => i.type === 'widget' && i.id === id);
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
  __stubState: () => ({ layout, configCalls, layoutCalls, settings }),
  __setSettings: (patch) => {
    settings = { ...settings, ...patch };
    onSettingsCb(settings);
  },
});
