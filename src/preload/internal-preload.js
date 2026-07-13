const { contextBridge, ipcRenderer } = require('electron');

// 内部ページ(roopie://)以外では絶対にIPCを公開しない
if (location.protocol === 'roopie:') {
  contextBridge.exposeInMainWorld('roopieInternal', {
    openTab: (url) => ipcRenderer.send('tabs:new', url),
    navigate: (input) => ipcRenderer.send('tabs:navigate', input),

    listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
    removeBookmark: (id) => ipcRenderer.send('bookmarks:remove', id),
    renameBookmark: (id, title) => ipcRenderer.send('bookmarks:rename', id, title),

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

    onDownloadsState: (cb) =>
      ipcRenderer.on('downloads:state', (_e, state) => cb(state)),
    onBookmarksState: (cb) =>
      ipcRenderer.on('bookmarks:state', (_e, items) => cb(items)),
    onProfilesState: (cb) =>
      ipcRenderer.on('profiles:state', (_e, state) => cb(state)),
    onSettings: (cb) => ipcRenderer.on('ui:settings', (_e, s) => cb(s)),
  });
}
