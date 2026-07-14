const { contextBridge, ipcRenderer } = require('electron');

// 内部ページ(roopie://)以外では絶対にIPCを公開しない
if (location.protocol === 'roopie:') {
  contextBridge.exposeInMainWorld('roopieInternal', {
    openTab: (url) => ipcRenderer.send('tabs:new', url),
    navigate: (input) => ipcRenderer.send('tabs:navigate', input),

    listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
    removeBookmark: (id) => ipcRenderer.send('bookmarks:remove', id),
    renameBookmark: (id, title) => ipcRenderer.send('bookmarks:rename', id, title),

    // スタート画面のショートカット(bookmarksの中の "start" フォルダ以下。ページ=サブフォルダ)
    listStartPages: () => ipcRenderer.invoke('bookmarks:start-pages'),
    addStartPage: (title) => ipcRenderer.invoke('bookmarks:start-page-add', title),
    listShortcuts: (pageId) => ipcRenderer.invoke('bookmarks:children', pageId),
    addShortcut: (pageId, payload) => ipcRenderer.invoke('bookmarks:add-shortcut', pageId, payload),
    updateShortcut: (id, patch) => ipcRenderer.send('bookmarks:update-item', id, patch),
    removeShortcut: (id) => ipcRenderer.send('bookmarks:remove', id),
    pickShortcutFolder: () => ipcRenderer.invoke('fs:pick-folder'),
    openShortcutFolder: (folderPath) => ipcRenderer.send('fs:open-folder', folderPath),

    listHistory: (query) => ipcRenderer.invoke('history:list', query),
    removeHistory: (id) => ipcRenderer.send('history:remove', id),
    clearHistory: () => ipcRenderer.send('history:clear'),

    listDownloads: () => ipcRenderer.invoke('downloads:list'),
    openDownload: (id) => ipcRenderer.send('downloads:open', id),
    showDownloadInFolder: (id) => ipcRenderer.send('downloads:show-in-folder', id),
    pauseDownload: (id) => ipcRenderer.send('downloads:pause', id),
    resumeDownload: (id) => ipcRenderer.send('downloads:resume', id),
    cancelDownload: (id) => ipcRenderer.send('downloads:cancel', id),
    removeDownload: (id) => ipcRenderer.send('downloads:remove', id),
    clearDownloads: () => ipcRenderer.send('downloads:clear'),

    listProfiles: () => ipcRenderer.invoke('profiles:list'),
    createProfile: (name) => ipcRenderer.send('profiles:create', name),
    renameProfile: (id, name) => ipcRenderer.send('profiles:rename', id, name),
    removeProfile: (id) => ipcRenderer.send('profiles:remove', id),
    switchProfile: (id) => ipcRenderer.send('profiles:switch', id),
    setProfileShared: (id, key, shared) =>
      ipcRenderer.send('profiles:set-shared', id, key, shared),
    setProfileIcon: (id, icon) => ipcRenderer.send('profiles:set-icon', id, icon),
    setProfileTor: (id, enabled) => ipcRenderer.send('profiles:set-tor', id, enabled),

    getTorStatus: () => ipcRenderer.invoke('tor:status'),
    onTorStatus: (cb) => ipcRenderer.on('tor:status', (_e, s) => cb(s)),

    listGoogleAccounts: () => ipcRenderer.invoke('google:list'),
    addGoogleAccount: (email, label) => ipcRenderer.send('google:add', email, label),
    removeGoogleAccount: (accountId) => ipcRenderer.send('google:remove', accountId),
    setGoogleEnabled: (profileId, accountId, enabled) =>
      ipcRenderer.send('google:set-enabled', profileId, accountId, enabled),
    setGooglePrimary: (profileId, accountId) =>
      ipcRenderer.send('google:set-primary', profileId, accountId),
    signedInGoogleAccounts: (profileId) => ipcRenderer.invoke('google:signed-in', profileId),
    googleLogin: (profileId, accountId) => ipcRenderer.send('google:login', profileId, accountId),
    googleSignOut: (profileId) => ipcRenderer.send('google:signout', profileId),

    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),
    pickDownloadFolder: () => ipcRenderer.invoke('fs:pick-folder'),

    // メディアプレイヤー
    onMediaState: (cb) => ipcRenderer.on('media:state', (_e, state) => cb(state)),
    mediaToggle: () => ipcRenderer.send('media:control', 'toggle'),
    mediaSeek: (time) => ipcRenderer.send('media:control', 'seek', time),
    mediaPip: () => ipcRenderer.send('media:control', 'pip'),
    mediaSwitchToTab: () => ipcRenderer.send('media:switch-to-tab'),
    mediaDismiss: () => ipcRenderer.send('media:dismiss'),
    mediaDragStart: () => ipcRenderer.send('media:drag-start'),
    mediaDrag: (dx, dy) => ipcRenderer.send('media:drag', dx, dy),
    mediaDragEnd: () => ipcRenderer.send('media:drag-end'),

    // サイドパネル
    getSidePanel: () => ipcRenderer.invoke('sidepanel:state'),
    toggleSidePanel: () => ipcRenderer.send('sidepanel:toggle'),
    addWebPanel: (url) => ipcRenderer.send('sidepanel:add-web', url),
    removeWebPanel: (id) => ipcRenderer.send('sidepanel:remove-web', id),
    openWebPanel: (id) => ipcRenderer.send('sidepanel:open-web', id),
    closeWebPanel: () => ipcRenderer.send('sidepanel:close-web'),
    reloadWebPanel: () => ipcRenderer.send('sidepanel:reload-web'),
    setSidePanelNotes: (text) => ipcRenderer.send('sidepanel:set-notes', text),
    onSidePanelState: (cb) => ipcRenderer.on('sidepanel:state', (_e, s) => cb(s)),

    // 保存パスワード(管理画面用)
    listPasswords: () => ipcRenderer.invoke('passwords:list'),
    revealPassword: (id) => ipcRenderer.invoke('passwords:reveal', id),
    passwordsAvailable: () => ipcRenderer.invoke('passwords:available'),
    removePassword: (id) => ipcRenderer.send('passwords:remove', id),
    clearPasswords: () => ipcRenderer.send('passwords:clear'),
    onPasswordsState: (cb) => ipcRenderer.on('passwords:state', (_e, items) => cb(items)),

    // 拡張機能
    installExtension: (extensionId) => ipcRenderer.invoke('extensions:install', extensionId),
    listExtensions: () => ipcRenderer.invoke('extensions:list'),
    removeExtension: (extensionId) => ipcRenderer.send('extensions:remove', extensionId),
    onExtensionsState: (cb) => ipcRenderer.on('extensions:state', (_e, items) => cb(items)),

    // テーマ
    getTheme: () => ipcRenderer.invoke('theme:get'),
    setTheme: (patch) => ipcRenderer.send('theme:set', patch),
    onThemeState: (cb) => ipcRenderer.on('theme:state', (_e, t) => cb(t)),
    getThemeFor: (profileId) => ipcRenderer.invoke('theme:get-for', profileId),
    setThemeFor: (profileId, patch) => ipcRenderer.send('theme:set-for', profileId, patch),

    getGestures: () => ipcRenderer.invoke('gestures:config'),
    setGestures: (config) => ipcRenderer.send('gestures:set', config),
    resetGestures: () => ipcRenderer.send('gestures:reset'),
    onGesturesState: (cb) => ipcRenderer.on('gestures:state', (_e, s) => cb(s)),

    // プルダウンメニュー(オーバーレイ)用
    onMenuShow: (cb) => ipcRenderer.on('menu:show', (_e, payload) => cb(payload)),
    closeMenu: () => ipcRenderer.send('menu:close'),
    newWindow: () => ipcRenderer.send('window:new'),
    newIncognitoWindow: () => ipcRenderer.send('window:new-incognito'),

    onDownloadsState: (cb) =>
      ipcRenderer.on('downloads:state', (_e, state) => cb(state)),
    onBookmarksState: (cb) =>
      ipcRenderer.on('bookmarks:state', (_e, items) => cb(items)),
    onProfilesState: (cb) =>
      ipcRenderer.on('profiles:state', (_e, state) => cb(state)),
    onSettings: (cb) => ipcRenderer.on('ui:settings', (_e, s) => cb(s)),
  });
}
