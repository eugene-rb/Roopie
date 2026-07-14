const { Menu, MenuItem, clipboard, shell } = require('electron');

const SEARCH_URL = 'https://www.google.com/search?q=';
const MAX_SELECTION_LABEL = 16;

/**
 * ページ上の右クリックメニュー(Chrome相当)。
 */
function attachContextMenu(webContents, tabManager) {
  webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const add = (options) => menu.append(new MenuItem(options));

    // リンク
    if (params.linkURL) {
      add({
        label: 'リンクを新しいタブで開く',
        click: () => tabManager.createTab(params.linkURL),
      });
      add({
        label: 'リンクのアドレスをコピー',
        click: () => clipboard.writeText(params.linkURL),
      });
      add({ type: 'separator' });
    }

    // 画像
    if (params.mediaType === 'image' && params.srcURL) {
      add({
        label: '画像を新しいタブで開く',
        click: () => tabManager.createTab(params.srcURL),
      });
      add({
        label: '画像のアドレスをコピー',
        click: () => clipboard.writeText(params.srcURL),
      });
      add({
        label: '画像を保存',
        click: () => webContents.downloadURL(params.srcURL),
      });
      add({ type: 'separator' });
    }

    // 選択テキスト
    if (params.selectionText) {
      add({ label: 'コピー', role: 'copy' });
      const text = params.selectionText.trim();
      const label =
        text.length > MAX_SELECTION_LABEL
          ? `${text.slice(0, MAX_SELECTION_LABEL)}…`
          : text;
      add({
        label: `「${label}」をGoogleで検索`,
        click: () => tabManager.createTab(SEARCH_URL + encodeURIComponent(text)),
      });
      add({ type: 'separator' });
    }

    // 入力欄
    if (params.isEditable) {
      add({ label: '元に戻す', role: 'undo' });
      add({ label: 'やり直し', role: 'redo' });
      add({ type: 'separator' });
      add({ label: '切り取り', role: 'cut' });
      add({ label: 'コピー', role: 'copy' });
      add({ label: '貼り付け', role: 'paste' });
      add({ label: 'すべて選択', role: 'selectAll' });
      add({ type: 'separator' });
    }

    // ページ全体(リンクや選択がないとき)
    // 画面分割で非アクティブなペインに出す場合もあるため、tabManagerの「アクティブタブ」ではなく
    // このメニューを開いた webContents 自身に対して操作する
    if (!params.linkURL && !params.selectionText && !params.isEditable) {
      add({
        label: '戻る',
        enabled: webContents.navigationHistory.canGoBack(),
        click: () => webContents.navigationHistory.goBack(),
      });
      add({
        label: '進む',
        enabled: webContents.navigationHistory.canGoForward(),
        click: () => webContents.navigationHistory.goForward(),
      });
      add({ label: '再読み込み', click: () => webContents.reload() });
      add({ type: 'separator' });
      add({
        label: 'このページをブックマーク',
        click: () => {
          const tab = tabManager.tabs.find((t) => t.view.webContents === webContents);
          tabManager.bookmarks.toggle(
            webContents.getURL(),
            webContents.getTitle() || webContents.getURL(),
            tab?.favicon ?? null
          );
        },
      });
      add({
        label: '既定のブラウザで開く',
        click: () => shell.openExternal(webContents.getURL()),
      });
      add({ type: 'separator' });
    }

    add({
      label: '検証(デベロッパーツール)',
      click: () => webContents.inspectElement(params.x, params.y),
    });

    menu.popup();
  });
}

module.exports = { attachContextMenu };
