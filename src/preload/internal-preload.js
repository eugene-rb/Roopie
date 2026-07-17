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
    fetchPageTitle: (url) => ipcRenderer.invoke('page:fetch-title', url),
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

    // ローカルサーバー検知(スタートページのサジェスト)
    listLocalServers: () => ipcRenderer.invoke('local-servers:list'),
    dismissLocalServer: (port) => ipcRenderer.send('local-servers:dismiss', port),

    // ショートカット割り当て
    getKeybindings: () => ipcRenderer.invoke('keybindings:get'),
    setKeybinding: (id, accelerator) => ipcRenderer.invoke('keybindings:set', id, accelerator),
    resetKeybinding: (id) => ipcRenderer.invoke('keybindings:reset', id),
    resetAllKeybindings: () => ipcRenderer.invoke('keybindings:reset-all'),
    onKeybindings: (cb) => ipcRenderer.on('keybindings:state', (_e, config) => cb(config)),

    // メディアプレイヤー
    onMediaState: (cb) => ipcRenderer.on('media:state', (_e, state) => cb(state)),
    mediaToggle: () => ipcRenderer.send('media:control', 'toggle'),
    mediaSeek: (time) => ipcRenderer.send('media:control', 'seek', time),
    mediaPip: () => ipcRenderer.send('media:control', 'pip'),
    mediaNext: () => ipcRenderer.send('media:control', 'next'),
    mediaPrev: () => ipcRenderer.send('media:control', 'prev'),

    // 画面分割のペイン間リサイズ(仕切りView)
    onSplitDivider: (cb) => ipcRenderer.on('split:divider', (_e, info) => cb(info)),
    splitResizeStart: () => ipcRenderer.send('split:resize-start'),
    splitResize: (dx, dy) => ipcRenderer.send('split:resize', dx, dy),
    splitResizeEnd: () => ipcRenderer.send('split:resize-end'),

    // D&D分割: タブのドラッグ中にオーバーレイへドロップゾーンを出す
    onDropZones: (cb) => ipcRenderer.on('overlay:drop-zones', (_e, info) => cb(info)),
    splitDrop: (zone) => ipcRenderer.send('split:drop', zone),
    mediaSwitchToTab: () => ipcRenderer.send('media:switch-to-tab'),
    mediaDismiss: () => ipcRenderer.send('media:dismiss'),
    mediaDragStart: () => ipcRenderer.send('media:drag-start'),
    mediaDrag: (dx, dy) => ipcRenderer.send('media:drag', dx, dy),
    mediaDragEnd: () => ipcRenderer.send('media:drag-end'),

    // サイドパネル
    getSidePanel: () => ipcRenderer.invoke('sidepanel:state'),
    toggleSidePanel: () => ipcRenderer.send('sidepanel:toggle'),
    hideSidePanel: () => ipcRenderer.send('sidepanel:hide'),
    openSidePanelSection: (key) => ipcRenderer.send('sidepanel:open-section', key),
    sidePanelRailContextMenu: () => ipcRenderer.send('sidepanel:rail-context-menu'),
    addWebPanel: (url) => ipcRenderer.send('sidepanel:add-web', url),
    removeWebPanel: (id) => ipcRenderer.send('sidepanel:remove-web', id),
    webPanelContextMenu: (id) => ipcRenderer.send('sidepanel:web-context-menu', id),
    setWebPanel: (id, patch) => ipcRenderer.send('sidepanel:set-web', id, patch),
    promptAddWebPanel: () => ipcRenderer.send('sidepanel:prompt-add-web'),
    sidePanelEditDone: () => ipcRenderer.send('sidepanel:edit-done'),
    onEditWebPanel: (cb) => ipcRenderer.on('sidepanel:edit-web', (_e, payload) => cb(payload)),
    onAddWebPrompt: (cb) => ipcRenderer.on('sidepanel:add-web-prompt', () => cb()),
    openWebPanel: (id) => ipcRenderer.send('sidepanel:open-web', id),
    closeWebPanel: () => ipcRenderer.send('sidepanel:close-web'),
    reloadWebPanel: () => ipcRenderer.send('sidepanel:reload-web'),
    setSidePanelNotes: (text) => ipcRenderer.send('sidepanel:set-notes', text),
    resizeSidePanel: (deltaX) => ipcRenderer.send('sidepanel:resize', deltaX),
    onSidePanelState: (cb) => ipcRenderer.on('sidepanel:state', (_e, s) => cb(s)),

    // リードリスト(後で読む)
    listReadlist: () => ipcRenderer.invoke('readlist:list'),
    addCurrentToReadlist: () => ipcRenderer.send('readlist:add-current'),
    removeReadlist: (id) => ipcRenderer.send('readlist:remove', id),
    setReadlistRead: (id, read) => ipcRenderer.send('readlist:set-read', id, read),
    clearReadReadlist: () => ipcRenderer.send('readlist:clear-read'),
    onReadlistState: (cb) => ipcRenderer.on('readlist:state', (_e, items) => cb(items)),

    // 保存パスワード(管理画面用)
    listPasswords: () => ipcRenderer.invoke('passwords:list'),
    revealPassword: (id) => ipcRenderer.invoke('passwords:reveal', id),
    passwordsAvailable: () => ipcRenderer.invoke('passwords:available'),
    removePassword: (id) => ipcRenderer.send('passwords:remove', id),
    clearPasswords: () => ipcRenderer.send('passwords:clear'),
    onPasswordsState: (cb) => ipcRenderer.on('passwords:state', (_e, items) => cb(items)),
    updatePassword: (id, patch) => ipcRenderer.invoke('passwords:update', id, patch),
    exportPasswords: () => ipcRenderer.invoke('passwords:export'),
    importPasswords: () => ipcRenderer.invoke('passwords:import'),
    listExcludedPasswordSites: () => ipcRenderer.invoke('passwords:excluded'),
    removeExcludedPasswordSite: (origin) => ipcRenderer.send('passwords:excluded-remove', origin),

    // 自動入力(住所・個人情報/お支払い方法)
    listAddresses: () => ipcRenderer.invoke('autofill:addresses'),
    saveAddress: (patch) => ipcRenderer.invoke('autofill:address-save', patch),
    removeAddress: (id) => ipcRenderer.send('autofill:address-remove', id),
    listCards: () => ipcRenderer.invoke('autofill:cards'),
    saveCard: (payload) => ipcRenderer.invoke('autofill:card-save', payload),
    removeCard: (id) => ipcRenderer.send('autofill:card-remove', id),
    autofillAvailable: () => ipcRenderer.invoke('autofill:available'),
    onAutofillState: (cb) => ipcRenderer.on('autofill:state', (_e, state) => cb(state)),

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

    // 拡張機能メニュー(Edgeのパズルボタン風)
    onExtensionsMenu: (cb) => ipcRenderer.on('menu:show-extensions', (_e, payload) => cb(payload)),
    setPinnedExtensions: (ids) => ipcRenderer.send('extensions:set-pinned', ids),
    // electron-chrome-extensions のリモートAPIで拡張のポップアップを開く
    // (anchorRectはウィンドウ座標。allowRemoteなハンドラのため内部ページから呼べる)
    activateBrowserAction: (partition, details) =>
      ipcRenderer.invoke('crx-msg-remote', partition, 'browserAction.activate', details),
    newWindow: () => ipcRenderer.send('window:new'),
    newIncognitoWindow: () => ipcRenderer.send('window:new-incognito'),

    // QRコードのポップアップ(オーバーレイ)用
    onQrShow: (cb) => ipcRenderer.on('qr:show', (_e, payload) => cb(payload)),
    saveQr: (dataUrl, filename) => ipcRenderer.invoke('qr:save', dataUrl, filename),

    onDownloadsState: (cb) =>
      ipcRenderer.on('downloads:state', (_e, state) => cb(state)),
    onBookmarksState: (cb) =>
      ipcRenderer.on('bookmarks:state', (_e, items) => cb(items)),
    onProfilesState: (cb) =>
      ipcRenderer.on('profiles:state', (_e, state) => cb(state)),
    onSettings: (cb) => ipcRenderer.on('ui:settings', (_e, s) => cb(s)),
  });
}
