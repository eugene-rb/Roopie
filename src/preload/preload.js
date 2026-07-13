const { contextBridge, ipcRenderer } = require('electron');

// ブラウザUI(レンダラー)に公開する安全なAPI
contextBridge.exposeInMainWorld('roopie', {
  newTab: (url) => ipcRenderer.send('tabs:new', url),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  switchTab: (id) => ipcRenderer.send('tabs:switch', id),
  navigate: (input) => ipcRenderer.send('tabs:navigate', input),
  goBack: () => ipcRenderer.send('tabs:back'),
  goForward: () => ipcRenderer.send('tabs:forward'),
  reload: () => ipcRenderer.send('tabs:reload'),
  stop: () => ipcRenderer.send('tabs:stop'),

  onTabsState: (callback) =>
    ipcRenderer.on('tabs:state', (_e, state) => callback(state)),
  onFocusAddressBar: (callback) =>
    ipcRenderer.on('ui:focus-address-bar', () => callback()),
});
