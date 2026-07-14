const { Menu } = require('electron');
const windows = require('./windows');
const browser = require('./browser');

// メニュー操作はフォーカス中のウィンドウに対して行う
const tabs = () => windows.focused()?.tabManager ?? null;
const ui = () => windows.focused()?.window.webContents ?? null;

/** キーボードショートカット(Chrome準拠)をメニューで定義する */
function setupMenu() {
  const tabNumberShortcuts = Array.from({ length: 9 }, (_v, i) => ({
    label: `タブ ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    visible: false,
    click: () => tabs()?.switchToIndex(i),
  }));

  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新しいタブ', accelerator: 'CmdOrCtrl+T', click: () => tabs()?.createTab() },
        { label: '新しいウィンドウ', accelerator: 'CmdOrCtrl+N', click: () => browser.createWindow() },
        {
          label: '新しいシークレットウィンドウ',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => browser.createWindow({ incognito: true }),
        },
        { type: 'separator' },
        { label: 'タブを閉じる', accelerator: 'CmdOrCtrl+W', click: () => tabs()?.closeActiveTab() },
        {
          label: 'ウィンドウを閉じる',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => windows.focused()?.window.close(),
        },
        { type: 'separator' },
        { label: '印刷', accelerator: 'CmdOrCtrl+P', click: () => tabs()?.activeWebContents()?.print() },
        { type: 'separator' },
        { label: '終了', role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す', role: 'undo' },
        { label: 'やり直し', role: 'redo' },
        { type: 'separator' },
        { label: '切り取り', role: 'cut' },
        { label: 'コピー', role: 'copy' },
        { label: '貼り付け', role: 'paste' },
        { label: 'すべて選択', role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'ページ内を検索',
          accelerator: 'CmdOrCtrl+F',
          click: () => ui()?.send('ui:open-find'),
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => tabs()?.reload() },
        { label: '戻る', accelerator: 'Alt+Left', click: () => tabs()?.goBack() },
        { label: '進む', accelerator: 'Alt+Right', click: () => tabs()?.goForward() },
        { type: 'separator' },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => tabs()?.zoom(1) },
        { label: '拡大 ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => tabs()?.zoom(1) },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => tabs()?.zoom(-1) },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: () => tabs()?.zoom(0) },
        { type: 'separator' },
        { label: '全画面表示', role: 'togglefullscreen' },
        {
          label: 'ブックマークバーを表示',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => browser.toggleBookmarkBar(),
        },
        {
          label: 'サイドパネル',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => windows.focused()?.sidePanel.toggle(),
        },
        {
          label: 'UIを隠す(集中モード)',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => ui()?.send('ui:toggle-compact'),
        },
        { type: 'separator' },
        {
          label: 'アドレスバーにフォーカス',
          accelerator: 'CmdOrCtrl+L',
          click: () => ui()?.send('ui:focus-address-bar'),
        },
        { label: '次のタブ', accelerator: 'Ctrl+Tab', click: () => tabs()?.switchRelative(1) },
        { label: '前のタブ', accelerator: 'Ctrl+Shift+Tab', click: () => tabs()?.switchRelative(-1) },
        ...tabNumberShortcuts,
        { type: 'separator' },
        { label: 'デベロッパーツール', accelerator: 'F12', click: () => tabs()?.toggleDevTools() },
      ],
    },
    {
      label: 'ブックマーク',
      submenu: [
        {
          label: 'このページをブックマーク',
          accelerator: 'CmdOrCtrl+D',
          click: () => tabs()?.toggleBookmarkForActiveTab(),
        },
        {
          label: 'ブックマークマネージャ',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => tabs()?.createTab('roopie://bookmarks'),
        },
      ],
    },
    {
      label: '履歴',
      submenu: [
        { label: '履歴を表示', accelerator: 'CmdOrCtrl+H', click: () => tabs()?.createTab('roopie://history') },
        { label: 'ダウンロード', accelerator: 'CmdOrCtrl+J', click: () => tabs()?.createTab('roopie://downloads') },
      ],
    },
    {
      label: 'プロファイル',
      submenu: [
        {
          label: 'プロファイルと設定',
          accelerator: 'CmdOrCtrl+,',
          click: () => tabs()?.createTab('roopie://settings'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { setupMenu };
