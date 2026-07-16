const fs = require('fs');
const { ipcMain, dialog, shell } = require('electron');
const windows = require('./windows');
const browser = require('./browser');
const GoogleAccounts = require('./google-accounts');
const Passwords = require('./passwords');
const { showTabMenu } = require('./tab-context-menu');
const {
  showSidePanelPositionMenu,
  showSidePanelRailMenu,
  showToolbarMenu,
  showWebPanelMenu,
} = require('./toolbar-context-menu');
const { searchUrl } = require('./search-engines');
const { normalizeToolbarItems } = require('./toolbar-items');
const { AI_PROVIDERS } = require('./ai-providers');

// IPCは「送信元のウィンドウ」に対して処理する
const ctxOf = (e) => windows.contextFor(e.sender);
const tabsOf = (e) => ctxOf(e)?.tabManager ?? null;
const panelOf = (e) => ctxOf(e)?.sidePanel ?? null;

function registerIpc() {
  // ---- タブ ----
  ipcMain.on('tabs:new', (e, url) => tabsOf(e)?.createTab(url || undefined));
  // タブバーへのドラッグ&ドロップ検索(Edgeオマージュ): 選択テキストは常に検索する
  ipcMain.on('tabs:search-new-tab', (e, text) => {
    const query = String(text ?? '').trim();
    if (!query) return;
    tabsOf(e)?.createTab(searchUrl(browser.settings?.data.searchEngine, query));
  });
  ipcMain.on('tabs:close', (e, id) => tabsOf(e)?.closeTab(id));
  ipcMain.on('tabs:switch', (e, id) => tabsOf(e)?.switchTab(id));
  ipcMain.on('tabs:move', (e, id, toIndex) => tabsOf(e)?.moveTab(id, toIndex));

  // ---- タブのドラッグ(D&D分割 / 新しいウィンドウへの切り離し) ----
  // ドラッグ中はページ領域にドロップゾーンを出す。ドロップ先で「分割」か「切り離し」かが決まる。
  // 分割ゾーンへのドロップ(split:drop)と切り離し判定(drag-end)は別Viewから届くため、
  // drag-end 側を少し遅延させて競合(先に切り離してしまう)を防ぐ。
  ipcMain.on('tabs:drag-start', (e, id) => {
    const ctx = ctxOf(e);
    if (!ctx) return;
    ctx.draggingTabId = id;
    ctx.pendingSplitZone = null;
    ctx.tabManager.showDropZones();
  });

  ipcMain.on('split:drop', (e, zone) => {
    const ctx = ctxOf(e);
    if (ctx) ctx.pendingSplitZone = zone; // 実行は drag-end の確定処理でまとめて行う
  });

  ipcMain.on('tabs:drag-end', (e, id, info) => {
    const ctx = ctxOf(e);
    if (!ctx) return;
    ctx.tabManager.hideDropZones();
    // split:drop が別Viewから遅れて届く可能性があるため、確定を少し遅らせる
    setTimeout(() => {
      const tabManager = ctx.tabManager;
      const zone = ctx.pendingSplitZone;
      ctx.pendingSplitZone = null;
      ctx.draggingTabId = null;
      if (zone) {
        tabManager.dropSplit(id, zone);
      } else if (info?.belowBar && tabManager.getTab(id) && tabManager.tabs.length > 1) {
        // タブバーの下へ落とした = 新しいウィンドウへ切り離す
        const url = tabManager.getTab(id).view.webContents.getURL();
        tabManager.closeTab(id);
        browser.createWindow({ url, x: info.screenX, y: info.screenY });
      }
    }, 40);
  });
  ipcMain.on('tabs:navigate', (e, input) => tabsOf(e)?.navigate(input));
  ipcMain.on('tabs:back', (e) => tabsOf(e)?.goBack());
  ipcMain.on('tabs:forward', (e) => tabsOf(e)?.goForward());
  ipcMain.on('tabs:reload', (e) => tabsOf(e)?.reload());
  ipcMain.on('tabs:stop', (e) => tabsOf(e)?.stop());
  ipcMain.on('tabs:zoom', (e, direction) => tabsOf(e)?.zoom(direction));
  ipcMain.on('tabs:context-menu', (e, id) => {
    const tabManager = tabsOf(e);
    if (tabManager) showTabMenu(tabManager, id);
  });

  // ---- 画面分割 ----
  ipcMain.on('tabs:split-with', (e, id, direction) => tabsOf(e)?.splitWith(id, direction));
  ipcMain.on('tabs:split-toggle-direction', (e) => tabsOf(e)?.toggleSplitDirection());
  ipcMain.on('tabs:split-close', (e) => tabsOf(e)?.closeSplit());

  // ペイン間リサイズ(仕切りViewから)
  ipcMain.on('split:resize-start', (e) => tabsOf(e)?.splitResizeStart());
  ipcMain.on('split:resize', (e, dx, dy) => tabsOf(e)?.splitResizeBy(dx, dy));
  ipcMain.on('split:resize-end', (e) => tabsOf(e)?.splitResizeEnd());

  // ---- ウィンドウ ----
  ipcMain.on('window:new', () => browser.createWindow());
  ipcMain.on('window:new-incognito', () => browser.createWindow({ incognito: true }));

  ipcMain.on('ui:chrome-height', (e, height) => tabsOf(e)?.setChromeHeight(height));
  ipcMain.on('ui:toggle-bookmark-bar', () => browser.toggleBookmarkBar());

  // プロファイルのプルダウン: ボタン位置(anchor)を受け取り、オーバーレイに描画させる
  ipcMain.on('menu:open-profiles', (e, anchor) => {
    const tabManager = tabsOf(e);
    if (!tabManager?.overlay || !browser.profiles) return;
    tabManager.showOverlay(true);
    tabManager.overlay.webContents.send('menu:show', {
      profiles: browser.profiles.list(),
      activeId: browser.profiles.activeId,
      anchor,
    });
  });
  ipcMain.on('menu:close', (e) => tabsOf(e)?.showOverlay(false));

  // QRコードのポップアップもオーバーレイに描画する(タブより手前に出すため)
  ipcMain.on('menu:open-qr', (e, payload) => {
    const tabManager = tabsOf(e);
    if (!tabManager?.overlay) return;
    tabManager.showOverlay(true);
    tabManager.overlay.webContents.send('qr:show', payload ?? {});
  });

  // QR画像(dataURL)をPNGとして保存する。ファイル名はリンク先のページタイトルを既定にする
  ipcMain.handle('qr:save', async (e, dataUrl, filename) => {
    const window = ctxOf(e)?.window;
    if (!window || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
    // レンダラー側で既に禁止文字は除去済みだが、念のためここでも取り除く
    const safeName = (typeof filename === 'string' ? filename : '').replace(/[\\/:*?"<>|]/g, '').trim();
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'QRコードを保存',
      defaultPath: `${safeName || 'qrcode'}.png`,
      filters: [{ name: 'PNG画像', extensions: ['png'] }],
    });
    if (canceled || !filePath) return false;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
    return true;
  });

  // ---- ページ内検索 ----
  ipcMain.on('find:start', (e, text, options) => tabsOf(e)?.find(text, options));
  ipcMain.on('find:stop', (e) => tabsOf(e)?.stopFind());

  // ---- ブックマーク ----
  ipcMain.on('bookmarks:toggle-current', (e) => tabsOf(e)?.toggleBookmarkForActiveTab());
  ipcMain.on('bookmarks:remove', (_e, id) => browser.bookmarks?.remove(id));
  ipcMain.on('bookmarks:rename', (_e, id, title) => browser.bookmarks?.rename(id, title));
  ipcMain.handle('bookmarks:list', () => browser.bookmarks?.list() ?? []);

  // ---- スタート画面のショートカット(bookmarksの中の "start" フォルダ以下) ----
  ipcMain.handle('bookmarks:start-pages', () => browser.bookmarks?.startPages() ?? []);
  ipcMain.handle('bookmarks:start-page-add', (_e, title) => browser.bookmarks?.addStartPage(title) ?? null);
  ipcMain.handle('bookmarks:children', (_e, folderId) => browser.bookmarks?.children(folderId) ?? []);
  ipcMain.handle('bookmarks:add-shortcut', (_e, folderId, payload) =>
    browser.bookmarks?.addShortcut(folderId, payload ?? {})
  );
  ipcMain.on('bookmarks:update-item', (_e, id, patch) => browser.bookmarks?.updateItem(id, patch));

  // ---- 履歴(シークレットウィンドウからは参照させない)----
  ipcMain.handle('history:list', (e, query) =>
    ctxOf(e)?.incognito ? [] : browser.history?.list(query) ?? []
  );
  ipcMain.on('history:remove', (_e, id) => browser.history?.remove(id));
  ipcMain.on('history:clear', () => browser.history?.clear());

  // ---- ダウンロード ----
  ipcMain.handle('downloads:list', () => browser.downloads?.list() ?? []);
  ipcMain.on('downloads:open', (_e, id) => browser.downloads?.open(id));
  ipcMain.on('downloads:show-in-folder', (_e, id) => browser.downloads?.showInFolder(id));
  ipcMain.on('downloads:pause', (_e, id) => browser.downloads?.pause(id));
  ipcMain.on('downloads:resume', (_e, id) => browser.downloads?.resume(id));
  ipcMain.on('downloads:cancel', (_e, id) => browser.downloads?.cancel(id));
  ipcMain.on('downloads:remove', (_e, id) => browser.downloads?.remove(id));
  ipcMain.on('downloads:clear', () => browser.downloads?.clear());

  // ---- プロファイル ----
  ipcMain.handle('profiles:list', () => ({
    profiles: browser.profiles?.list() ?? [],
    activeId: browser.profiles?.activeId ?? null,
  }));
  ipcMain.on('profiles:create', (_e, name) => {
    browser.profiles?.create(name);
    browser.sendProfiles();
  });
  ipcMain.on('profiles:rename', (_e, id, name) => {
    browser.profiles?.rename(id, name);
    browser.sendProfiles();
  });
  ipcMain.on('profiles:remove', (_e, id) => {
    const wasActive = browser.profiles?.activeId === id;
    // 使用中のプロファイルを消した場合だけ、別プロファイルへ切り替えてタブを作り直す
    if (browser.profiles?.remove(id)) browser.applyActiveProfile({ recreateTabs: wasActive });
  });
  ipcMain.on('profiles:switch', (_e, id) => browser.switchProfile(id));
  ipcMain.on('profiles:set-shared', (_e, id, key, shared) => browser.setShared(id, key, shared));
  ipcMain.on('profiles:set-icon', (_e, id, icon) => {
    browser.profiles?.setIcon(id, icon);
    browser.sendProfiles();
  });

  // ---- Tor ----
  ipcMain.handle('tor:status', () => browser.tor.state());
  ipcMain.on('profiles:set-tor', (_e, id, enabled) => browser.setProfileTor(id, enabled));

  // ---- Googleアカウント ----
  ipcMain.handle('google:list', () => browser.googleAccounts?.list() ?? []);
  ipcMain.on('google:add', (_e, email, label) => browser.googleAccounts?.add(email, label));
  ipcMain.on('google:remove', (_e, accountId) => {
    browser.profiles?.forgetAccount(accountId);
    browser.googleAccounts?.remove(accountId);
    browser.sendProfiles();
  });
  ipcMain.on('google:set-enabled', (_e, profileId, accountId, enabled) => {
    browser.profiles?.setGoogleEnabled(profileId, accountId, enabled);
    browser.sendProfiles();
  });
  ipcMain.on('google:set-primary', (_e, profileId, accountId) => {
    browser.profiles?.setGooglePrimary(profileId, accountId);
    browser.sendProfiles();
  });

  // 実際にログイン中のアカウントは、そのプロファイルのセッションのCookieから取得する。
  // 未登録のアカウントがあれば自動登録・有効化もあわせて行う
  ipcMain.handle('google:signed-in', async (_e, profileId) => {
    const profile = browser.profiles?.list().find((p) => p.id === profileId);
    if (!profile) return [];
    await browser.autoRegisterGoogleAccounts(profile);
    return GoogleAccounts.signedInAccounts(browser.profiles.sessionFor(profile));
  });

  // ログインはそのプロファイルのセッションで行う必要があるので、必要なら先に切り替える
  ipcMain.on('google:login', (e, profileId, accountId) => {
    const profile = browser.profiles?.list().find((p) => p.id === profileId);
    if (!profile) return;
    const target = accountId ?? profile.google.primaryId;
    const account = target ? browser.googleAccounts?.find(target) : null;
    if (profileId !== browser.profiles.activeId) browser.switchProfile(profileId);
    tabsOf(e)?.createTab(GoogleAccounts.loginUrl(account?.email));
  });

  ipcMain.on('google:signout', async (_e, profileId) => {
    const profile = browser.profiles?.list().find((p) => p.id === profileId);
    if (!profile) return;
    await GoogleAccounts.signOut(browser.profiles.sessionFor(profile));
    browser.sendProfiles();
  });

  // ---- サイドパネル ----
  ipcMain.on('sidepanel:toggle', (e) => panelOf(e)?.toggle());
  ipcMain.on('sidepanel:hide', (e) => panelOf(e)?.hide());
  ipcMain.on('sidepanel:open-section', (e, key) => panelOf(e)?.openSection(key));
  ipcMain.on('sidepanel:context-menu', () => showSidePanelPositionMenu());
  ipcMain.on('sidepanel:rail-context-menu', (e) => showSidePanelRailMenu(panelOf(e)));

  // ツールバーのユーティリティ群を右クリック → 表示/非表示の切り替えメニュー
  ipcMain.on('toolbar:context-menu', (e) => showToolbarMenu(ctxOf(e)));
  ipcMain.handle('sidepanel:state', (e) => panelOf(e)?.state() ?? null);
  ipcMain.on('sidepanel:add-web', (e, url) => panelOf(e)?.addWeb(url));
  ipcMain.on('sidepanel:remove-web', (e, id) => panelOf(e)?.removeWeb(id));
  ipcMain.on('sidepanel:web-context-menu', (e, id) => showWebPanelMenu(panelOf(e), id));
  ipcMain.on('sidepanel:set-web', (e, id, patch) => panelOf(e)?.setWebPanel(id, patch));

  // ---- AIアシスタント(Copilot風。Webパネルとして開く) ----
  ipcMain.handle('sidepanel:ai-providers', () => AI_PROVIDERS);
  ipcMain.on('sidepanel:add-ai', (e, providerId) => panelOf(e)?.addAiPanel(providerId));
  // アクティブなAIパネルのコンポーザーへ、現在のページ文脈付きプロンプトを注入する
  ipcMain.handle('sidepanel:ask-page', (e, opts) => panelOf(e)?.askAboutPage(opts) ?? { ok: false });

  // ---- リードリスト(後で読む。ブラウザ全体・プロファイル単位) ----
  ipcMain.handle('readlist:list', () => browser.readlist?.list() ?? []);
  ipcMain.on('readlist:add-current', (e) => {
    const tabManager = tabsOf(e);
    const tab = tabManager?.getTab(tabManager.activeTabId);
    if (!tab || tab.isInternal) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (url) browser.readlist?.add(url, wc.getTitle() || url, tab.favicon ?? null);
  });
  ipcMain.on('readlist:remove', (_e, id) => browser.readlist?.remove(id));
  ipcMain.on('readlist:set-read', (_e, id, read) => browser.readlist?.setRead(id, read));
  ipcMain.on('readlist:clear-read', () => browser.readlist?.clearRead());

  // ---- ローカルサーバー検知(スタートページのサジェスト) ----
  ipcMain.handle('local-servers:list', () => browser.localServers?.detect() ?? []);
  ipcMain.on('local-servers:dismiss', (_e, port) => browser.localServers?.dismiss(port));
  ipcMain.on('sidepanel:open-web', (e, id) => panelOf(e)?.openWeb(id));
  ipcMain.on('sidepanel:close-web', (e) => panelOf(e)?.closeWeb());
  ipcMain.on('sidepanel:reload-web', (e) => panelOf(e)?.reloadWeb());
  ipcMain.on('sidepanel:set-notes', (e, text) => panelOf(e)?.setNotes(text));
  ipcMain.on('sidepanel:resize', (e, deltaX) => panelOf(e)?.resizeBy(deltaX));

  // ---- パスワード ----
  // ページのpreloadがログイン送信を検出したら、未保存のときだけUIに確認バーを出す
  ipcMain.on('passwords:captured', (e, { origin, username, password } = {}) => {
    const ctx = ctxOf(e);
    const passwords = browser.passwords;
    if (!passwords || !ctx || ctx.incognito) return; // シークレットでは保存しない
    if (!origin || !username || !password) return;
    if (browser.settings?.data.savePasswords === false) return;
    if (!Passwords.available()) return;
    if (passwords.matches(origin, username, password)) return; // 同じ内容なら何も出さない

    browser.pendingPassword = { origin, username, password };
    ctx.window.webContents.send('passwords:prompt', {
      origin,
      username,
      isUpdate: !!passwords.find(origin, username), // 既存の別パスワード = 更新の確認
    });
  });

  ipcMain.on('passwords:confirm-save', () => {
    const pending = browser.pendingPassword;
    if (!pending) return;
    browser.pendingPassword = null;
    browser.passwords?.save(pending.origin, pending.username, pending.password);
    browser.sendPasswords();
  });
  ipcMain.on('passwords:dismiss', () => {
    browser.pendingPassword = null;
  });

  // シークレットでは自動入力もしない
  ipcMain.handle('passwords:for-origin', (e, origin) => {
    if (ctxOf(e)?.incognito) return [];
    if (browser.settings?.data.savePasswords === false) return [];
    return browser.passwords?.forOrigin(origin) ?? [];
  });

  ipcMain.handle('passwords:list', () => browser.passwords?.list() ?? []);
  ipcMain.handle('passwords:reveal', (_e, id) => browser.passwords?.reveal(id) ?? null);
  ipcMain.handle('passwords:available', () => Passwords.available());
  ipcMain.on('passwords:remove', (_e, id) => {
    browser.passwords?.remove(id);
    browser.sendPasswords();
  });
  ipcMain.on('passwords:clear', () => {
    browser.passwords?.clear();
    browser.sendPasswords();
  });

  // ---- 拡張機能 ----
  ipcMain.handle('extensions:install', async (_e, extensionId) => {
    const profile = browser.profiles.active();
    const session = browser.profiles.sessionFor(profile);
    const ext = await browser.extensions.install(session, profile.id, extensionId);
    browser.sendExtensions();
    return { id: ext.id, name: ext.name, version: ext.version };
  });
  ipcMain.handle('extensions:list', () =>
    browser.extensions.list(browser.profiles.sessionFor(browser.profiles.active()))
  );
  ipcMain.on('extensions:remove', async (_e, extensionId) => {
    const profile = browser.profiles.active();
    const session = browser.profiles.sessionFor(profile);
    await browser.extensions.remove(session, profile.id, extensionId);
    browser.sendExtensions();
  });

  // ---- テーマ ----
  ipcMain.handle('theme:get', () => browser.theme?.data ?? { ...browser.DEFAULT_THEME });
  ipcMain.on('theme:set', (_e, patch) => {
    if (!browser.theme) return;
    browser.applyThemePatch(browser.theme, patch);
    browser.sendTheme();
  });

  // プロファイルを切り替えずに、そのプロファイルのテーマを読み書きする(設定画面のプロファイルカード用)
  ipcMain.handle('theme:get-for', (_e, profileId) => browser.themeFor(profileId));
  ipcMain.on('theme:set-for', (_e, profileId, patch) => browser.setThemeFor(profileId, patch));

  // ---- マウスジェスチャー ----
  ipcMain.handle('gestures:config', () => browser.gestures?.config() ?? null);
  ipcMain.on('gestures:set', (_e, config) => {
    browser.gestures?.update(config);
    browser.sendGestures();
  });
  ipcMain.on('gestures:reset', () => {
    browser.gestures?.reset();
    browser.sendGestures();
  });

  // ジェスチャーpreloadからのアクション実行要求(送信元のタブに対して実行する)
  ipcMain.on('gestures:perform', (e, action) => {
    const tabManager = tabsOf(e);
    if (!browser.gestures?.data.enabled || !tabManager) return;
    const wc = e.sender;
    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case 'reload':
        wc.reload();
        break;
      case 'closeTab': {
        const tab = tabManager.tabs.find((t) => t.view.webContents === wc);
        if (tab) tabManager.closeTab(tab.id);
        break;
      }
      case 'newTab':
        tabManager.createTab();
        break;
      case 'nextTab':
        tabManager.switchRelative(1);
        break;
      case 'prevTab':
        tabManager.switchRelative(-1);
        break;
    }
  });

  // フォルダ選択ダイアログ・フォルダを開く(スタート画面のショートカット等で使う汎用IPC)
  ipcMain.handle('fs:pick-folder', async (e) => {
    const window = ctxOf(e)?.window;
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on('fs:open-folder', (_e, folderPath) => {
    if (typeof folderPath === 'string' && folderPath) shell.openPath(folderPath);
  });

  // ---- 設定 ----
  ipcMain.handle('settings:get', () => browser.settings?.data ?? { ...browser.DEFAULT_SETTINGS });
  ipcMain.on('settings:set', (_e, key, value) => {
    const settings = browser.settings;
    if (!settings || !(key in browser.DEFAULT_SETTINGS)) return;
    settings.data[key] = key === 'toolbarItems' ? normalizeToolbarItems(value) : value;
    settings.save();
    if (key === 'adblock') browser.applyAdblock();
    if (key === 'mediaDocked') browser.applyMediaDocked();
    if (key === 'downloadPath') browser.applyDownloadPath();
    if (key === 'tabBarPosition') browser.applyTabBarPosition();
    if (key === 'sidePanelPosition') browser.applySidePanelPosition();
    if (key === 'searchEngine') browser.applySearchEngine();
    browser.sendSettings();
  });

  // ---- ショートカット割り当て(アプリ全体) ----
  // set/reset は onKeybindingsChanged 経由でメニュー再構築 + 設定画面へ配信される
  ipcMain.handle('keybindings:get', () => browser.keybindings?.config() ?? []);
  ipcMain.handle('keybindings:set', (_e, id, accel) => browser.keybindings?.set(id, accel) ?? { ok: false });
  ipcMain.handle('keybindings:reset', (_e, id) => {
    browser.keybindings?.reset(id);
    return browser.keybindings?.config() ?? [];
  });
  ipcMain.handle('keybindings:reset-all', () => {
    browser.keybindings?.resetAll();
    return browser.keybindings?.config() ?? [];
  });

  // ---- メディアプレイヤー ----
  ipcMain.on('media:state', (e, payload) => {
    const ctx = ctxOf(e);
    const tab = ctx?.tabManager.tabs.find((t) => t.view.webContents === e.sender);
    if (!ctx || !tab) return;

    if (payload) {
      ctx.media = { ...payload, tabId: tab.id };
    } else if (ctx.media?.tabId === tab.id) {
      // このタブの再生が終わった場合だけクリアする(他タブの再生中表示は消さない)
      ctx.media = null;
    } else {
      return;
    }
    browser.sendMedia(ctx);
  });

  ipcMain.on('media:control', (e, action, value) => {
    const ctx = ctxOf(e);
    const media = ctx?.media;
    if (!media) return;
    const tab = ctx.tabManager.getTab(media.tabId);
    if (!tab) {
      ctx.media = null;
      browser.sendMedia(ctx);
      return;
    }
    const wc = tab.view.webContents;
    const pick = `(() => {
      const els = [...document.querySelectorAll('video, audio')];
      return els.find((el) => !el.paused) || els[els.length - 1];
    })()`;

    if (action === 'toggle') {
      wc.executeJavaScript(`(() => { const el = ${pick}; if (el) el.paused ? el.play() : el.pause(); })()`, true).catch(() => {});
    } else if (action === 'seek' && typeof value === 'number') {
      wc.executeJavaScript(`(() => { const el = ${pick}; if (el) el.currentTime = ${JSON.stringify(value)}; })()`, true).catch(() => {});
    } else if (action === 'pip') {
      wc.executeJavaScript(
        `(() => {
          const el = [...document.querySelectorAll('video')].find((v) => !v.paused) || document.querySelector('video');
          if (el && document.pictureInPictureEnabled) el.requestPictureInPicture().catch(() => {});
        })()`,
        true
      ).catch(() => {});
    } else if (action === 'next' || action === 'prev') {
      // main worldに退避したMediaSessionハンドラ(tab-manager.jsのMEDIA_HOOK)を呼ぶ
      const evt = action === 'next' ? 'nexttrack' : 'previoustrack';
      wc.executeJavaScript(
        `(() => {
          const h = window.__roopieMediaActions && window.__roopieMediaActions['${evt}'];
          if (typeof h === 'function') { h({ action: '${evt}' }); }
        })()`,
        true
      ).catch(() => {});
    }
  });

  ipcMain.on('media:switch-to-tab', (e) => {
    const ctx = ctxOf(e);
    if (ctx?.media) ctx.tabManager.switchTab(ctx.media.tabId);
  });

  ipcMain.on('media:dismiss', (e) => {
    const ctx = ctxOf(e);
    if (!ctx) return;
    ctx.media = null;
    browser.sendMedia(ctx);
  });

  ipcMain.on('media:drag-start', (e) => ctxOf(e)?.mediaPlayer.dragStart());
  ipcMain.on('media:drag', (e, dx, dy) => ctxOf(e)?.mediaPlayer.dragBy(dx, dy));
  ipcMain.on('media:drag-end', (e) => ctxOf(e)?.mediaPlayer.dragEnd());
}

module.exports = { registerIpc };
