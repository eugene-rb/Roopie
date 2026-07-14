const { contextBridge, ipcRenderer } = require('electron');

// ブラウザUI(タブバー・ツールバー)に公開する安全なAPI
contextBridge.exposeInMainWorld('roopie', {
  // タブ操作
  newTab: (url) => ipcRenderer.send('tabs:new', url),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  switchTab: (id) => ipcRenderer.send('tabs:switch', id),
  moveTab: (id, toIndex) => ipcRenderer.send('tabs:move', id, toIndex),
  tabContextMenu: (id) => ipcRenderer.send('tabs:context-menu', id),
  splitWith: (id, direction) => ipcRenderer.send('tabs:split-with', id, direction),
  toggleSplitDirection: () => ipcRenderer.send('tabs:split-toggle-direction'),
  closeSplit: () => ipcRenderer.send('tabs:split-close'),
  newWindow: () => ipcRenderer.send('window:new'),
  newIncognitoWindow: () => ipcRenderer.send('window:new-incognito'),
  onWindowInfo: (cb) => ipcRenderer.on('ui:window', (_e, info) => cb(info)),
  navigate: (input) => ipcRenderer.send('tabs:navigate', input),
  goBack: () => ipcRenderer.send('tabs:back'),
  goForward: () => ipcRenderer.send('tabs:forward'),
  reload: () => ipcRenderer.send('tabs:reload'),
  stop: () => ipcRenderer.send('tabs:stop'),
  zoom: (direction) => ipcRenderer.send('tabs:zoom', direction),

  // UI
  setChromeHeight: (height) => ipcRenderer.send('ui:chrome-height', height),
  toggleBookmarkBar: () => ipcRenderer.send('ui:toggle-bookmark-bar'),
  toggleSidePanel: () => ipcRenderer.send('sidepanel:toggle'),

  // ページ内検索
  find: (text, options) => ipcRenderer.send('find:start', text, options),
  stopFind: () => ipcRenderer.send('find:stop'),

  // ブックマーク
  toggleBookmark: () => ipcRenderer.send('bookmarks:toggle-current'),
  removeBookmark: (id) => ipcRenderer.send('bookmarks:remove', id),

  // ダウンロード
  openDownload: (id) => ipcRenderer.send('downloads:open', id),

  // プロファイル
  switchProfile: (id) => ipcRenderer.send('profiles:switch', id),
  openProfileMenu: (anchor) => ipcRenderer.send('menu:open-profiles', anchor),

  // メインプロセスからの通知
  onTabsState: (cb) => ipcRenderer.on('tabs:state', (_e, state) => cb(state)),
  onBookmarksState: (cb) => ipcRenderer.on('bookmarks:state', (_e, items) => cb(items)),
  onProfilesState: (cb) => ipcRenderer.on('profiles:state', (_e, state) => cb(state)),
  onDownloadsState: (cb) => ipcRenderer.on('downloads:state', (_e, state) => cb(state)),
  onSettings: (cb) => ipcRenderer.on('ui:settings', (_e, s) => cb(s)),
  onSidePanelState: (cb) => ipcRenderer.on('sidepanel:state', (_e, s) => cb(s)),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  onThemeState: (cb) => ipcRenderer.on('theme:state', (_e, t) => cb(t)),

  // パスワード保存の確認バー
  onPasswordPrompt: (cb) => ipcRenderer.on('passwords:prompt', (_e, p) => cb(p)),
  savePassword: () => ipcRenderer.send('passwords:confirm-save'),
  dismissPassword: () => ipcRenderer.send('passwords:dismiss'),
  onFocusAddressBar: (cb) => ipcRenderer.on('ui:focus-address-bar', () => cb()),
  onOpenFind: (cb) => ipcRenderer.on('ui:open-find', () => cb()),
  onToggleCompact: (cb) => ipcRenderer.on('ui:toggle-compact', () => cb()),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r)),
});
