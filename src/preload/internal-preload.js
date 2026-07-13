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

    onDownloadsState: (cb) =>
      ipcRenderer.on('downloads:state', (_e, state) => cb(state)),
    onBookmarksState: (cb) =>
      ipcRenderer.on('bookmarks:state', (_e, items) => cb(items)),
  });
}
