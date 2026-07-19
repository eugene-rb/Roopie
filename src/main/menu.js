const { Menu } = require('electron');
const windows = require('./windows');
const browser = require('./browser');
const { isValidAccelerator } = require('./keybindings');

// メニュー操作はフォーカス中のウィンドウに対して行う
const tabs = () => windows.focused()?.tabManager ?? null;
const ui = () => windows.focused()?.window.webContents ?? null;

// コマンドの実効アクセラレータ。不正値(旧データ・手編集)は割り当てなしに落として、
// 1件の壊れた値が全ショートカットを巻き込まないようにする
const accel = (id) => {
  const a = browser.keybindings?.accelFor(id);
  return a && isValidAccelerator(a) ? a : undefined;
};

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
        { label: '新しいタブ', accelerator: accel('newTab'), click: () => tabs()?.createTab() },
        {
          label: '新しいウィンドウ',
          accelerator: accel('newWindow'),
          // フォーカス中のウィンドウと同じプロファイルで開く(Edge挙動)
          click: () => browser.createWindow({ profileId: windows.focused()?.profileId }),
        },
        {
          label: '新しいシークレットウィンドウ',
          accelerator: accel('newIncognito'),
          click: () => browser.createWindow({ incognito: true, profileId: windows.focused()?.profileId }),
        },
        { type: 'separator' },
        { label: 'タブを閉じる', accelerator: accel('closeTab'), click: () => tabs()?.closeActiveTab() },
        {
          label: '閉じたタブを再度開く',
          accelerator: accel('reopenTab'),
          click: () => tabs()?.reopenClosedTab(),
        },
        {
          label: 'ウィンドウを閉じる',
          accelerator: accel('closeWindow'),
          click: () => windows.focused()?.window.close(),
        },
        { type: 'separator' },
        { label: '印刷', accelerator: accel('print'), click: () => tabs()?.activeWebContents()?.print() },
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
          accelerator: accel('find'),
          click: () => ui()?.send('ui:open-find'),
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: accel('reload'), click: () => tabs()?.reload() },
        { label: '戻る', accelerator: accel('back'), click: () => tabs()?.goBack() },
        { label: '進む', accelerator: accel('forward'), click: () => tabs()?.goForward() },
        { type: 'separator' },
        { label: '拡大', accelerator: accel('zoomIn'), click: () => tabs()?.zoom(1) },
        { label: '拡大 ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => tabs()?.zoom(1) },
        { label: '縮小', accelerator: accel('zoomOut'), click: () => tabs()?.zoom(-1) },
        { label: '実際のサイズ', accelerator: accel('zoomReset'), click: () => tabs()?.zoom(0) },
        { type: 'separator' },
        { label: '全画面表示', role: 'togglefullscreen' },
        {
          label: 'ブックマークバーを表示',
          accelerator: accel('toggleBookmarkBar'),
          click: () => browser.toggleBookmarkBar(),
        },
        {
          label: 'サイドパネル',
          accelerator: accel('toggleSidePanel'),
          click: () => windows.focused()?.sidePanel.toggle(),
        },
        {
          label: 'UIを隠す(集中モード)',
          accelerator: accel('toggleCompact'),
          click: () => ui()?.send('ui:toggle-compact'),
        },
        { type: 'separator' },
        {
          label: 'アドレスバーにフォーカス',
          accelerator: accel('focusAddressBar'),
          click: () => ui()?.send('ui:focus-address-bar'),
        },
        { label: '次のタブ', accelerator: accel('nextTab'), click: () => tabs()?.switchRelative(1) },
        { label: '前のタブ', accelerator: accel('prevTab'), click: () => tabs()?.switchRelative(-1) },
        ...tabNumberShortcuts,
        { type: 'separator' },
        { label: 'デベロッパーツール', accelerator: accel('devTools'), click: () => tabs()?.toggleDevTools() },
      ],
    },
    {
      label: 'ブックマーク',
      submenu: [
        {
          label: 'このページをブックマーク',
          accelerator: accel('bookmarkPage'),
          click: () => tabs()?.toggleBookmarkForActiveTab(),
        },
        {
          label: 'ブックマークマネージャ',
          accelerator: accel('bookmarkManager'),
          click: () => tabs()?.createTab('roopie://bookmarks'),
        },
      ],
    },
    {
      label: '履歴',
      submenu: [
        { label: '履歴を表示', accelerator: accel('history'), click: () => tabs()?.createTab('roopie://history') },
        { label: 'ダウンロード', accelerator: accel('downloads'), click: () => tabs()?.createTab('roopie://downloads') },
      ],
    },
    {
      label: 'プロファイル',
      submenu: [
        {
          label: 'プロファイルと設定',
          accelerator: accel('settings'),
          click: () => tabs()?.createTab('roopie://settings'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { setupMenu };
