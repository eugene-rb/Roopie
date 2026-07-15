const { Menu, MenuItem, clipboard, shell } = require('electron');

const SEARCH_URL = 'https://www.google.com/search?q=';
const IMAGE_SEARCH_URL = 'https://lens.google.com/uploadbyurl?url=';
const MAX_SELECTION_LABEL = 16;

/**
 * ページ上の右クリックメニュー(Chrome/Edge相当)。
 */
function attachContextMenu(webContents, tabManager) {
  webContents.on('context-menu', (_event, params) => {
    // browser は循環依存の下流にあるため、クリック時(=完全ロード後)に遅延requireする
    const browser = require('./browser');
    const menu = new Menu();
    const add = (options) => menu.append(new MenuItem(options));
    const separator = () => add({ type: 'separator' });

    // 送信元タブ(favicon参照・現在のセッション判定に使う)
    const ownTab = tabManager.tabs.find((t) => t.view.webContents === webContents);

    // ---- リンク ----
    if (params.linkURL) {
      add({ label: 'リンクを新しいタブで開く', click: () => tabManager.createTab(params.linkURL) });
      add({
        label: 'リンクを新しいウィンドウで開く',
        click: () => browser.createWindow({ url: params.linkURL }),
      });
      add({
        label: 'リンクをシークレットウィンドウで開く',
        click: () => browser.createWindow({ incognito: true, url: params.linkURL }),
      });
      separator();
      if (params.linkText) {
        add({ label: 'リンクのテキストをコピー', click: () => clipboard.writeText(params.linkText) });
      }
      add({ label: 'リンクのアドレスをコピー', click: () => clipboard.writeText(params.linkURL) });
      add({ label: 'リンク先を保存', click: () => webContents.downloadURL(params.linkURL) });
      separator();
    }

    // ---- 画像 ----
    if (params.mediaType === 'image' && params.srcURL) {
      add({ label: '画像を新しいタブで開く', click: () => tabManager.createTab(params.srcURL) });
      add({ label: '画像のアドレスをコピー', click: () => clipboard.writeText(params.srcURL) });
      add({ label: '画像をコピー', click: () => webContents.copyImageAt(params.x, params.y) });
      add({ label: '画像を保存', click: () => webContents.downloadURL(params.srcURL) });
      add({
        label: '画像をGoogleで検索',
        click: () => tabManager.createTab(IMAGE_SEARCH_URL + encodeURIComponent(params.srcURL)),
      });
      separator();
    }

    // ---- 動画・音声 ----
    if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
      const isVideo = params.mediaType === 'video';
      const noun = isVideo ? '動画' : '音声';
      if (isVideo && params.mediaFlags?.canShowPictureInPicture) {
        add({
          label: 'ピクチャー・イン・ピクチャー',
          click: () => webContents.executeJavaScript(
            'document.querySelector("video")?.requestPictureInPicture?.()',
            true
          ).catch(() => {}),
        });
      }
      if (params.mediaFlags?.canLoop) {
        add({
          label: 'ループ再生',
          type: 'checkbox',
          checked: !!params.mediaFlags.isLooping,
          click: () => webContents.executeJavaScript(
            'for (const m of document.querySelectorAll("video,audio")) m.loop = !m.loop',
            true
          ).catch(() => {}),
        });
      }
      add({ label: `${noun}のアドレスをコピー`, click: () => clipboard.writeText(params.srcURL) });
      add({ label: `${noun}を保存`, click: () => webContents.downloadURL(params.srcURL) });
      separator();
    }

    // ---- 選択テキスト ----
    if (params.selectionText) {
      const text = params.selectionText.trim();
      add({ label: 'コピー', role: 'copy' });
      const label = text.length > MAX_SELECTION_LABEL ? `${text.slice(0, MAX_SELECTION_LABEL)}…` : text;
      add({
        label: `「${label}」をGoogleで検索`,
        click: () => tabManager.createTab(SEARCH_URL + encodeURIComponent(text)),
      });
      // 選択テキストがURLらしければ、そのまま開く選択肢も出す
      if (/^https?:\/\/\S+$/i.test(text)) {
        add({ label: 'リンクとして新しいタブで開く', click: () => tabManager.createTab(text) });
      }
      separator();
    }

    // ---- 入力欄 ----
    if (params.isEditable) {
      // スペルミスの修正候補(あれば最優先で出す)
      if (params.misspelledWord) {
        if (params.dictionarySuggestions.length) {
          for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
            add({ label: suggestion, click: () => webContents.replaceMisspelling(suggestion) });
          }
        } else {
          add({ label: '候補がありません', enabled: false });
        }
        add({
          label: '辞書に追加',
          click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        });
        separator();
      }
      add({ label: '元に戻す', role: 'undo', enabled: params.editFlags.canUndo });
      add({ label: 'やり直し', role: 'redo', enabled: params.editFlags.canRedo });
      separator();
      add({ label: '切り取り', role: 'cut', enabled: params.editFlags.canCut });
      add({ label: 'コピー', role: 'copy', enabled: params.editFlags.canCopy });
      add({ label: '貼り付け', role: 'paste', enabled: params.editFlags.canPaste });
      add({
        label: '書式なしで貼り付け',
        role: 'pasteAndMatchStyle',
        enabled: params.editFlags.canPaste,
      });
      add({ label: 'すべて選択', role: 'selectAll' });
      separator();
    }

    // ---- ページ全体(リンク・選択・入力欄がないとき) ----
    // 画面分割で非アクティブなペインに出す場合もあるため、tabManagerの「アクティブタブ」ではなく
    // このメニューを開いた webContents 自身に対して操作する
    if (!params.linkURL && !params.selectionText && !params.isEditable && params.mediaType === 'none') {
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
      separator();

      const url = webContents.getURL();
      const isBookmarked = !!tabManager.bookmarks.find(url);
      add({
        label: isBookmarked ? 'ブックマークを解除' : 'このページをブックマーク',
        click: () => tabManager.bookmarks.toggle(url, webContents.getTitle() || url, ownTab?.favicon ?? null),
      });
      add({ label: '印刷', click: () => webContents.print() });
      add({ label: 'ページのソースを表示', click: () => tabManager.createTab(`view-source:${url}`) });
      add({ label: '名前を付けてページを保存', click: () => webContents.downloadURL(url) });
      add({ label: '既定のブラウザで開く', click: () => shell.openExternal(url) });
      separator();
    }

    add({
      label: '検証(デベロッパーツール)',
      click: () => webContents.inspectElement(params.x, params.y),
    });

    menu.popup();
  });
}

module.exports = { attachContextMenu };
