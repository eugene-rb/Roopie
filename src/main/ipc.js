const fs = require('fs');
const { ipcMain, dialog, shell, net, clipboard } = require('electron');
const windows = require('./windows');
const browser = require('./browser');
const TabManager = require('./tab-manager');
const GoogleAccounts = require('./google-accounts');
const Passwords = require('./passwords');
const Autofill = require('./autofill');
const { showTabMenu } = require('./tab-context-menu');
const {
  showSidePanelPositionMenu,
  showSidePanelRailMenu,
  showToolbarMenu,
  showWebPanelMenu,
  showTimerMenu,
  showBookmarkBarMenu,
} = require('./toolbar-context-menu');
const { searchUrl } = require('./search-engines');
const { normalizeToolbarItems } = require('./toolbar-items');
const { geocode, weather, fetchRss } = require('./widgets');
const trackers = require('./trackers');
const appState = require('./app-state');
const updater = require('./updater');
const defaultBrowser = require('./default-browser');

// ページのタイトルをHTMLの<title>から取得する(ショートカット追加時の名前自動設定用)。
// 本文全体は読まず、</title>が見つかるまで先頭256KBだけ読む
// 天気の既定の場所。レンダラーから来る値なので座標の範囲まで検査する(null = 未設定)
function normalizeWeatherLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const { name, lat, lon } = value;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { name: typeof name === 'string' ? name.slice(0, 80) : '', lat, lon };
}

function decodeHtmlEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, ent) => {
    if (ent[0] === '#') {
      const code = /^#x/i.test(ent) ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return named[ent.toLowerCase()] ?? all;
  });
}

async function fetchPageTitle(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  const url = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  if (!/^https?:/i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
    let decoder;
    try {
      decoder = new TextDecoder(charset || 'utf-8');
    } catch {
      decoder = new TextDecoder();
    }
    const reader = res.body.getReader();
    let html = '';
    while (html.length < 262144) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    return decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// パスワードCSVのインポート用ミニパーサー(RFC 4180: 引用符・カンマ・改行入りに対応)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// IPCは「送信元のウィンドウ」に対して処理する
const ctxOf = (e) => windows.contextFor(e.sender);
const tabsOf = (e) => ctxOf(e)?.tabManager ?? null;
const panelOf = (e) => ctxOf(e)?.sidePanel ?? null;
// 送信元ウィンドウのプロファイルのデータ一式(Edge挙動: ウィンドウごとにプロファイルが異なる)
const bundleOf = (e) => browser.bundleFor(ctxOf(e)?.profileId ?? browser.profiles?.activeId);
const profileIdOf = (e) => ctxOf(e)?.profileId ?? browser.profiles?.activeId;

function registerIpc() {
  // ---- タブ ----
  ipcMain.on('tabs:new', (e, url, background) => tabsOf(e)?.createTab(url || undefined, { background: !!background }));
  // タブバーへのドラッグ&ドロップ検索(Edgeオマージュ): 選択テキストは常に検索する
  ipcMain.on('tabs:search-new-tab', (e, text, index) => {
    const query = String(text ?? '').trim();
    if (!query) return;
    const tabs = tabsOf(e);
    const tab = tabs?.createTab(searchUrl(bundleOf(e)?.settings.data.searchEngine, query));
    // ドロップ位置(タブの間)に差し込む。未指定なら末尾のまま
    if (tab && Number.isInteger(index)) tabs.moveTab(tab.id, index);
  });
  ipcMain.on('tabs:close', (e, id) => tabsOf(e)?.closeTab(id));
  ipcMain.on('tabs:switch', (e, id) => tabsOf(e)?.switchTab(id));
  ipcMain.on('tabs:move', (e, id, toIndex) => tabsOf(e)?.moveTab(id, toIndex));
  ipcMain.on('tabs:toggle-mute', (e, id) => tabsOf(e)?.toggleMute(id));

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
    // split:drop や tabs:move-from-window が別Viewから遅れて届く可能性があるため、確定を少し遅らせる
    setTimeout(() => {
      const tabManager = ctx.tabManager;
      const zone = ctx.pendingSplitZone;
      ctx.pendingSplitZone = null;
      ctx.draggingTabId = null;
      if (ctx.tabConsumedBy === id) {
        // 別ウィンドウのタブバーへドロップされ、そちら側で既に処理済み(タブは閉じられている)
        ctx.tabConsumedBy = null;
        return;
      }
      if (zone) {
        tabManager.dropSplit(id, zone);
      } else if (info?.belowBar && tabManager.getTab(id) && tabManager.tabs.length > 1) {
        // タブバーの下へ落とした = 新しいウィンドウへ切り離す(同じプロファイルのまま)
        const url = tabManager.getTab(id).view.webContents.getURL();
        tabManager.closeTab(id);
        browser.createWindow({ url, x: info.screenX, y: info.screenY, profileId: ctx.profileId });
      }
    }, 40);
  });

  // 別ウィンドウのタブバーへドロップされたタブを、このウィンドウへ移す
  // (WebContentsViewはウィンドウをまたいで再利用できないため、URLだけ引き継いで元は閉じ・こちらで開き直す)
  ipcMain.on('tabs:move-from-window', (e, sourceWindowId, sourceTabId, toIndex) => {
    const targetCtx = ctxOf(e);
    if (!targetCtx) return;
    const sourceCtx = windows.all().find((c) => c.window.id === sourceWindowId);
    if (!sourceCtx || sourceCtx === targetCtx) return;
    const tab = sourceCtx.tabManager.getTab(sourceTabId);
    if (!tab) return;
    const url = tab.view.webContents.getURL();
    sourceCtx.tabConsumedBy = sourceTabId;
    sourceCtx.tabManager.closeTab(sourceTabId);
    const newTab = targetCtx.tabManager.createTab(url);
    targetCtx.tabManager.moveTab(newTab.id, toIndex);
    targetCtx.window.focus();
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
  // 新しいウィンドウは呼び出し元ウィンドウと同じプロファイルで開く(Edge挙動)
  ipcMain.on('window:new', (e) => browser.createWindow({ profileId: profileIdOf(e) }));
  ipcMain.on('window:new-incognito', (e) =>
    browser.createWindow({ incognito: true, profileId: profileIdOf(e) })
  );

  ipcMain.on('ui:chrome-height', (e, height) => tabsOf(e)?.setChromeHeight(height));
  ipcMain.on('ui:toggle-bookmark-bar', () => browser.toggleBookmarkBar());

  // プロファイルのプルダウン: ボタン位置(anchor)を受け取り、オーバーレイに描画させる
  ipcMain.on('menu:open-profiles', (e, anchor) => {
    const tabManager = tabsOf(e);
    if (!tabManager?.overlay || !browser.profiles) return;
    tabManager.showOverlay(true);
    tabManager.overlay.webContents.send('menu:show', {
      profiles: browser.profiles.list(),
      activeId: profileIdOf(e), // 「使用中」はこのウィンドウのプロファイル
      anchor,
    });
  });
  ipcMain.on('menu:close', (e) => tabsOf(e)?.showOverlay(false));

  // 拡張機能メニュー(Edgeのパズルボタン風)。全拡張の一覧+ピン留め切替をオーバーレイに描画する
  ipcMain.on('menu:open-extensions', (e, anchor) => {
    const ctx = ctxOf(e);
    if (!ctx || ctx.incognito || !ctx.tabManager.overlay || !browser.profiles) return;
    const tabManager = ctx.tabManager;
    const profile = browser.profiles.list().find((p) => p.id === ctx.profileId) ?? browser.profiles.active();
    tabManager.showOverlay(true);
    tabManager.overlay.webContents.send('menu:show-extensions', {
      extensions: browser.extensions.list(browser.profiles.sessionFor(profile)),
      pinned: bundleOf(e)?.settings.data.pinnedExtensions ?? [],
      // アンカーはウィンドウ座標で届く。オーバーレイは縦タブ時に左へずれるので補正する
      anchor: anchor ? { ...anchor, right: anchor.right - tabManager.chromeLeft } : null,
      partition: browser.profiles.partitionFor(profile),
      // 拡張システムのtabIdはwebContentsのid
      activeTabId: tabManager.activeWebContents()?.id ?? -1,
      // 拡張ポップアップのアンカーをウィンドウ座標へ戻すためのオーバーレイ原点
      offset: { x: tabManager.chromeLeft, y: tabManager.chromeHeight },
    });
  });

  // ピン留めの切り替え(拡張機能メニューのピンボタンから)
  ipcMain.on('extensions:set-pinned', (e, ids) => {
    const bundle = bundleOf(e);
    if (!bundle) return;
    bundle.settings.data.pinnedExtensions = Array.isArray(ids)
      ? ids.filter((id) => typeof id === 'string').slice(0, 200)
      : [];
    bundle.settings.save();
    browser.sendSettingsFor(bundle.profileId);
  });

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
  ipcMain.on('bookmarks:add', (e, url, title, parentId) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const bookmarks = bundleOf(e)?.bookmarks;
    const name = typeof title === 'string' && title.trim() ? title.trim() : url.trim();
    if (typeof parentId === 'string' && parentId) {
      bookmarks?.addShortcut(parentId, { kind: 'url', name, target: url.trim() });
    } else {
      bookmarks?.add(url.trim(), name, null);
    }
  });
  ipcMain.on('bookmarks:add-folder', (e, parentId, title) =>
    bundleOf(e)?.bookmarks.addFolder(typeof parentId === 'string' && parentId ? parentId : null, title)
  );
  ipcMain.on('bookmarks:remove', (e, id) => bundleOf(e)?.bookmarks.remove(id));
  ipcMain.on('bookmarks:rename', (e, id, title) => bundleOf(e)?.bookmarks.rename(id, title));
  ipcMain.handle('bookmarks:list', (e) => bundleOf(e)?.bookmarks.list() ?? []);
  // 管理画面用: 全アイテム(通常ブックマーク+startフォルダ/ページ/ショートカットの1ツリー)
  ipcMain.handle('bookmarks:all', (e) => bundleOf(e)?.bookmarks.all() ?? []);
  ipcMain.on('bookmarks:move', (e, id, parentId) => bundleOf(e)?.bookmarks.move(id, parentId));

  // ---- スタート画面のショートカット(bookmarksの中の "start" フォルダ以下) ----
  ipcMain.handle('bookmarks:start-pages', (e) => bundleOf(e)?.bookmarks.startPages() ?? []);
  ipcMain.handle('bookmarks:start-page-add', (e, title) => bundleOf(e)?.bookmarks.addStartPage(title) ?? null);
  ipcMain.handle('bookmarks:children', (e, folderId) => bundleOf(e)?.bookmarks.children(folderId) ?? []);
  ipcMain.handle('bookmarks:add-shortcut', (e, folderId, payload) =>
    bundleOf(e)?.bookmarks.addShortcut(folderId, payload ?? {})
  );
  ipcMain.on('bookmarks:update-item', (e, id, patch) => bundleOf(e)?.bookmarks.updateItem(id, patch));
  ipcMain.handle('page:fetch-title', (_e, url) => fetchPageTitle(url));

  // ---- スタート画面のウィジェット(グリッド配置はページ単位) ----
  ipcMain.handle('widgets:layout', (e, pageId) => bundleOf(e)?.widgets.layoutFor(pageId) ?? []);
  ipcMain.on('widgets:set-layout', (e, pageId, items) => bundleOf(e)?.widgets.setLayout(pageId, items));
  ipcMain.handle('widgets:add', (e, pageId, widgetType) => bundleOf(e)?.widgets.addWidget(pageId, widgetType) ?? null);
  ipcMain.on('widgets:remove', (e, pageId, id) => bundleOf(e)?.widgets.removeWidget(pageId, id));
  ipcMain.on('widgets:config', (e, pageId, id, patch) => bundleOf(e)?.widgets.updateConfig(pageId, id, patch));
  // 天気・RSSは内部ページのCSPを通れないためメインで代理取得する
  ipcMain.handle('widgets:geocode', (_e, query) => geocode(query));
  ipcMain.handle('widgets:weather', (_e, lat, lon) => weather(lat, lon));
  ipcMain.handle('widgets:rss', (_e, url) => fetchRss(url));

  // ---- 履歴(シークレットウィンドウからは参照させない)----
  ipcMain.handle('history:list', (e, query) =>
    ctxOf(e)?.incognito ? [] : bundleOf(e)?.history.list(query) ?? []
  );
  ipcMain.on('history:remove', (e, id) => bundleOf(e)?.history.remove(id));
  ipcMain.on('history:clear', (e) => bundleOf(e)?.history.clear());

  // ---- ダウンロード ----
  ipcMain.handle('downloads:list', (e) => bundleOf(e)?.downloads.list() ?? []);
  ipcMain.on('downloads:open', (e, id) => bundleOf(e)?.downloads.open(id));
  ipcMain.on('downloads:show-in-folder', (e, id) => bundleOf(e)?.downloads.showInFolder(id));
  ipcMain.on('downloads:pause', (e, id) => bundleOf(e)?.downloads.pause(id));
  ipcMain.on('downloads:resume', (e, id) => bundleOf(e)?.downloads.resume(id));
  ipcMain.on('downloads:cancel', (e, id) => bundleOf(e)?.downloads.cancel(id));
  ipcMain.on('downloads:remove', (e, id) => bundleOf(e)?.downloads.remove(id));
  ipcMain.on('downloads:clear', (e) => bundleOf(e)?.downloads.clear());

  // ---- プロファイル ----
  ipcMain.handle('profiles:list', (e) => ({
    profiles: browser.profiles?.list() ?? [],
    // 「使用中」は問い合わせ元ウィンドウのプロファイル(Edge挙動)
    activeId: profileIdOf(e) ?? null,
  }));
  ipcMain.on('profiles:create', (_e, name) => {
    browser.profiles?.create(name);
    browser.sendProfiles();
  });
  ipcMain.on('profiles:rename', (_e, id, name) => {
    browser.profiles?.rename(id, name);
    browser.sendProfiles();
  });
  // プロファイルの削除: そのプロファイルのウィンドウも閉じる(Edge挙動)
  ipcMain.on('profiles:remove', (_e, id) => browser.removeProfile(id));
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

  // 実際にログイン中のアカウントは、そのプロファイルで開いているGoogleページのDOMから取得する。
  // 未登録のアカウントがあれば自動登録・有効化もあわせて行う
  ipcMain.handle('google:signed-in', async (_e, profileId) => {
    const profile = browser.profiles?.list().find((p) => p.id === profileId);
    if (!profile) return [];
    const detected = await browser.autoRegisterGoogleAccounts(profile);
    return detected.map((a) => a.email);
  });

  // ログインはそのプロファイルのセッションで行う必要がある。
  // 別プロファイルなら、そのプロファイルの新しいウィンドウでログインページを開く(Edge挙動)
  ipcMain.on('google:login', (e, profileId, accountId) => {
    const profile = browser.profiles?.list().find((p) => p.id === profileId);
    if (!profile) return;
    const target = accountId ?? profile.google.primaryId;
    const account = target ? browser.googleAccounts?.find(target) : null;
    const loginUrl = GoogleAccounts.loginUrl(account?.email);
    if (profileId !== profileIdOf(e)) browser.switchProfile(profileId, { url: loginUrl });
    else tabsOf(e)?.createTab(loginUrl);
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
  ipcMain.on('sidepanel:context-menu', (e) => showSidePanelPositionMenu(ctxOf(e)));
  ipcMain.on('sidepanel:rail-context-menu', (e) => showSidePanelRailMenu(ctxOf(e)));

  // ツールバーのユーティリティ群を右クリック → 表示/非表示の切り替えメニュー
  ipcMain.on('toolbar:context-menu', (e) => showToolbarMenu(ctxOf(e)));
  ipcMain.on('bookmark-bar:context-menu', (e) => showBookmarkBarMenu(ctxOf(e)));
  ipcMain.handle('sidepanel:state', (e) => panelOf(e)?.state() ?? null);
  ipcMain.on('sidepanel:add-web', (e, url) => panelOf(e)?.addWeb(url));
  ipcMain.on('sidepanel:remove-web', (e, id) => panelOf(e)?.removeWeb(id));
  ipcMain.on('sidepanel:web-context-menu', (e, id) => showWebPanelMenu(panelOf(e), id));
  ipcMain.on('sidepanel:set-web', (e, id, patch) => panelOf(e)?.setWebPanel(id, patch));
  // レール最下部の「+」(Vivaldiと同じ)。パネルを広げてからURL入力モーダルを出す
  ipcMain.on('sidepanel:prompt-add-web', (e) => panelOf(e)?.promptAddWeb());
  // 追加/編集モーダルが閉じた(モーダル用に広げたホストパネルを畳む)
  ipcMain.on('sidepanel:edit-done', (e) => panelOf(e)?.closeEditHost());

  // ---- リードリスト(後で読む。プロファイル単位) ----
  ipcMain.handle('readlist:list', (e) => bundleOf(e)?.readlist.list() ?? []);
  ipcMain.on('readlist:add-current', (e) => {
    const tabManager = tabsOf(e);
    const tab = tabManager?.getTab(tabManager.activeTabId);
    if (!tab || tab.isInternal) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (url) bundleOf(e)?.readlist.add(url, wc.getTitle() || url, tab.favicon ?? null);
  });
  ipcMain.on('readlist:remove', (e, id) => bundleOf(e)?.readlist.remove(id));
  ipcMain.on('readlist:set-read', (e, id, read) => bundleOf(e)?.readlist.setRead(id, read));
  ipcMain.on('readlist:clear-read', (e) => bundleOf(e)?.readlist.clearRead());

  // ---- タイマー(プロファイル単位のデータCRUD) ----
  ipcMain.handle('timer:list', (e) => bundleOf(e)?.timers.list() ?? []);
  ipcMain.on('timer:add', (e, payload) => bundleOf(e)?.timers.add(payload));
  ipcMain.on('timer:update', (e, id, patch) => bundleOf(e)?.timers.update(id, patch));
  ipcMain.on('timer:remove', (e, id) => bundleOf(e)?.timers.remove(id));
  ipcMain.on('timer:start', (e, id) => bundleOf(e)?.timers.start(id));
  ipcMain.on('timer:pause', (e, id) => bundleOf(e)?.timers.pause(id));
  ipcMain.on('timer:reset', (e, id) => bundleOf(e)?.timers.reset(id));
  // 危険アクション(ウィンドウを閉じる/シャットダウン)無しの発火(音のみ等)を確認して止める
  ipcMain.on('timer:acknowledge', (e, id) => bundleOf(e)?.timers.acknowledge(id));
  // 危険アクション付きの発火をユーザーが猶予中にキャンセルする
  ipcMain.on('timer:cancel-fire', (e, fireId) => {
    bundleOf(e)?.timers.cancelFire(fireId);
    ctxOf(e)?.timerPanel?.ringClear(fireId);
  });
  ipcMain.on('timer:context-menu', (e, id) => showTimerMenu(bundleOf(e), id));

  // ---- トラッキング分析(サイドパネル「トラッキング」) ----
  // セッションは送信元ウィンドウのもの(プロファイルごとにCookieストアが別)
  ipcMain.handle('trackers:analyze', (e) => {
    const ctx = ctxOf(e);
    const bundle = bundleOf(e);
    if (!ctx?.session || !bundle) return null;
    return trackers.analyze(ctx.session, {
      history: bundle.history.list(),
      adblockEnabled: bundle.settings.data.adblock !== false,
    });
  });
  ipcMain.handle('trackers:forget', (e, companyName) => {
    const ctx = ctxOf(e);
    if (!ctx?.session || typeof companyName !== 'string') return 0;
    return trackers.forgetCompany(ctx.session, companyName);
  });
  ipcMain.handle('trackers:forget-all', (e) => {
    const ctx = ctxOf(e);
    return ctx?.session ? trackers.forgetAll(ctx.session) : 0;
  });

  // ---- ローカルサーバー検知(スタートページのサジェスト) ----
  ipcMain.handle('local-servers:list', () => browser.localServers?.detect() ?? []);
  ipcMain.on('local-servers:dismiss', (_e, port) => browser.localServers?.dismiss(port));
  ipcMain.on('sidepanel:open-web', (e, id) => panelOf(e)?.openWeb(id));
  ipcMain.on('sidepanel:close-web', (e) => panelOf(e)?.closeWeb());
  ipcMain.on('sidepanel:reload-web', (e) => panelOf(e)?.reloadWeb());
  ipcMain.on('sidepanel:set-notes', (e, text) => panelOf(e)?.setNotes(text));
  ipcMain.on('sidepanel:resize', (e, deltaX) => panelOf(e)?.resizeBy(deltaX));

  // ---- パスワード ----
  // ページ側の引数は信用せず、送信元フレームのURLからオリジンを導出する
  const frameOrigin = (e) => {
    try {
      return new URL(e.senderFrame.url).origin;
    } catch {
      return null;
    }
  };

  // ページのpreloadがログイン送信を検出したら、未保存のときだけUIに確認バーを出す
  ipcMain.on('passwords:captured', (e, { username, password } = {}) => {
    const ctx = ctxOf(e);
    const bundle = bundleOf(e);
    const passwords = bundle?.passwords;
    const origin = frameOrigin(e);
    if (!passwords || !ctx || ctx.incognito) return; // シークレットでは保存しない
    if (!origin || !username || !password) return;
    if (bundle.settings.data.savePasswords === false) return;
    if (!Passwords.available()) return;
    if (passwords.isExcluded(origin)) return; // 「このサイトでは保存しない」
    if (passwords.matches(origin, username, password)) return; // 同じ内容なら何も出さない

    // どのプロファイルのウィンドウで拾ったかを覚えておく(保存先を間違えないため)
    browser.pendingPassword = { origin, username, password, profileId: bundle.profileId };
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
    browser.bundleFor(pending.profileId)?.passwords.save(pending.origin, pending.username, pending.password);
    browser.sendPasswordsFor(pending.profileId);
  });
  ipcMain.on('passwords:dismiss', () => {
    browser.pendingPassword = null;
  });
  // 確認バーの「このサイトでは保存しない」
  ipcMain.on('passwords:never-save', () => {
    const pending = browser.pendingPassword;
    browser.pendingPassword = null;
    if (pending) browser.bundleFor(pending.profileId)?.passwords.addNeverSave(pending.origin);
  });

  // ---- 既定のブラウザ化のお願い ----
  ipcMain.on('default-browser:set', () => defaultBrowser.setAsDefault());
  ipcMain.on('default-browser:dismiss', () => defaultBrowser.dismiss());

  // ページのオートフィルに出す候補一覧。パスワード本体は含めない(選択時に別途取得)
  ipcMain.handle('autofill:page-data', (e) => {
    const ctx = ctxOf(e);
    const bundle = bundleOf(e);
    const origin = frameOrigin(e);
    const settings = bundle?.settings.data ?? {};
    if (!ctx || ctx.incognito || !origin || !bundle) return { usernames: [], addresses: [], cards: [] };
    return {
      usernames:
        settings.savePasswords === false ? [] : bundle.passwords.usernamesForOrigin(origin),
      addresses: settings.autofillAddresses === false ? [] : bundle.autofill.listAddresses(),
      cards: settings.autofillCards === false ? [] : bundle.autofill.listCards(),
    };
  });

  // 選択された1件の資格情報を返す(最終使用日時を更新)。シークレットでは返さない
  ipcMain.handle('passwords:credential', (e, username) => {
    const origin = frameOrigin(e);
    const bundle = bundleOf(e);
    if (!origin || !bundle || ctxOf(e)?.incognito) return null;
    if (bundle.settings.data.savePasswords === false) return null;
    return bundle.passwords.credential(origin, username) ?? null;
  });

  // 保存済みが1件だけの時の自動入力用(従来挙動)。シークレットでは自動入力もしない
  ipcMain.handle('passwords:for-origin', (e) => {
    const origin = frameOrigin(e);
    const bundle = bundleOf(e);
    if (!origin || !bundle || ctxOf(e)?.incognito) return [];
    if (bundle.settings.data.savePasswords === false) return [];
    return bundle.passwords.forOrigin(origin);
  });

  ipcMain.handle('passwords:list', (e) => bundleOf(e)?.passwords.list() ?? []);
  ipcMain.handle('passwords:reveal', (e, id) => bundleOf(e)?.passwords.reveal(id) ?? null);
  ipcMain.handle('passwords:available', () => Passwords.available());
  ipcMain.handle('passwords:update', (e, id, patch) => {
    const ok = bundleOf(e)?.passwords.update(id, patch ?? {}) ?? false;
    if (ok) browser.sendPasswordsFor(profileIdOf(e));
    return ok;
  });
  ipcMain.on('passwords:remove', (e, id) => {
    bundleOf(e)?.passwords.remove(id);
    browser.sendPasswordsFor(profileIdOf(e));
  });
  ipcMain.on('passwords:clear', (e) => {
    bundleOf(e)?.passwords.clear();
    browser.sendPasswordsFor(profileIdOf(e));
  });

  // 除外リスト(このサイトでは保存しない)
  ipcMain.handle('passwords:excluded', (e) => bundleOf(e)?.passwords.neverSave ?? []);
  ipcMain.on('passwords:excluded-remove', (e, origin) => {
    bundleOf(e)?.passwords.removeNeverSave(origin);
    browser.sendPasswordsFor(profileIdOf(e));
  });

  // CSVエクスポート/インポート(Chrome互換: name,url,username,password)
  ipcMain.handle('passwords:export', async (e) => {
    const items = bundleOf(e)?.passwords.exportAll() ?? [];
    if (!items.length) return { count: 0 };
    const { canceled, filePath } = await dialog.showSaveDialog(ctxOf(e)?.window, {
      title: 'パスワードをエクスポート',
      defaultPath: 'Roopie Passwords.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return null;
    const esc = (s) => `"${String(s).replaceAll('"', '""')}"`;
    const lines = ['name,url,username,password'];
    for (const p of items) {
      let host = p.origin;
      try {
        host = new URL(p.origin).hostname;
      } catch {}
      lines.push([esc(host), esc(p.origin), esc(p.username), esc(p.password)].join(','));
    }
    await fs.promises.writeFile(filePath, '﻿' + lines.join('\r\n'), 'utf8');
    return { count: items.length };
  });

  ipcMain.handle('passwords:import', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctxOf(e)?.window, {
      title: 'パスワードをインポート',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths?.[0]) return null;
    const text = (await fs.promises.readFile(filePaths[0], 'utf8')).replace(/^﻿/, '');
    const rows = parseCsv(text);
    if (!rows.length) return { imported: 0, skipped: 0 };
    // ヘッダー行から列位置を決める(Chrome/Edge/Firefoxのエクスポート形式に対応)
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const urlCol = header.findIndex((h) => h === 'url' || h === 'origin');
    const userCol = header.findIndex((h) => h === 'username');
    const passCol = header.findIndex((h) => h === 'password');
    if (urlCol === -1 || userCol === -1 || passCol === -1) return { imported: 0, skipped: rows.length };
    let imported = 0;
    let skipped = 0;
    for (const row of rows.slice(1)) {
      try {
        const origin = new URL(row[urlCol]).origin;
        if (bundleOf(e)?.passwords.save(origin, row[userCol]?.trim(), row[passCol])) imported++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
    browser.sendPasswordsFor(profileIdOf(e));
    return { imported, skipped };
  });

  // ---- 自動入力(住所・個人情報/お支払い方法) ----
  ipcMain.handle('autofill:addresses', (e) => bundleOf(e)?.autofill.listAddresses() ?? []);
  ipcMain.handle('autofill:address-save', (e, patch) => {
    const item = bundleOf(e)?.autofill.saveAddress(patch ?? {}) ?? null;
    if (item) browser.sendAutofillFor(profileIdOf(e));
    return item;
  });
  ipcMain.on('autofill:address-remove', (e, id) => {
    bundleOf(e)?.autofill.removeAddress(id);
    browser.sendAutofillFor(profileIdOf(e));
  });

  ipcMain.handle('autofill:cards', (e) => bundleOf(e)?.autofill.listCards() ?? []);
  ipcMain.handle('autofill:available', () => Autofill.available());
  ipcMain.handle('autofill:card-save', (e, payload) => {
    const id = bundleOf(e)?.autofill.saveCard(payload ?? {}) ?? null;
    if (id) browser.sendAutofillFor(profileIdOf(e));
    return id;
  });
  ipcMain.on('autofill:card-remove', (e, id) => {
    bundleOf(e)?.autofill.removeCard(id);
    browser.sendAutofillFor(profileIdOf(e));
  });

  // カード番号の復号はドロップダウンでユーザーが選択した時だけ
  ipcMain.handle('autofill:card-fill', (e, id) => {
    const bundle = bundleOf(e);
    if (!bundle || ctxOf(e)?.incognito) return null;
    if (bundle.settings.data.autofillCards === false) return null;
    return bundle.autofill.cardFill(id) ?? null;
  });

  // ---- 拡張機能(送信元ウィンドウのプロファイルに対して操作する) ----
  const profileOf = (e) => {
    const id = profileIdOf(e);
    return browser.profiles.list().find((p) => p.id === id) ?? browser.profiles.active();
  };
  ipcMain.handle('extensions:install', async (e, extensionId) => {
    const profile = profileOf(e);
    const session = browser.profiles.sessionFor(profile);
    const ext = await browser.extensions.install(session, profile.id, extensionId);
    browser.sendExtensionsFor(profile.id);
    return { id: ext.id, name: ext.name, version: ext.version };
  });
  ipcMain.handle('extensions:list', (e) =>
    browser.extensions.list(browser.profiles.sessionFor(profileOf(e)))
  );
  ipcMain.on('extensions:remove', async (e, extensionId) => {
    const profile = profileOf(e);
    const session = browser.profiles.sessionFor(profile);
    await browser.extensions.remove(session, profile.id, extensionId);
    browser.sendExtensionsFor(profile.id);
  });

  // ---- テーマ ----
  ipcMain.handle('theme:get', (e) => bundleOf(e)?.theme.data ?? { ...browser.DEFAULT_THEME });
  ipcMain.on('theme:set', (e, patch) => {
    const bundle = bundleOf(e);
    if (!bundle) return;
    browser.applyThemePatch(bundle.theme, patch);
    browser.sendThemeFor(bundle.profileId);
  });

  // プロファイルを切り替えずに、そのプロファイルのテーマを読み書きする(設定画面のプロファイルカード用)
  ipcMain.handle('theme:get-for', (_e, profileId) => browser.themeFor(profileId));
  ipcMain.on('theme:set-for', (_e, profileId, patch) => browser.setThemeFor(profileId, patch));

  // ---- マウスジェスチャー ----
  ipcMain.handle('gestures:config', (e) => bundleOf(e)?.gestures.config() ?? null);
  ipcMain.on('gestures:set', (e, config) => {
    bundleOf(e)?.gestures.update(config);
    browser.sendGesturesFor(profileIdOf(e));
  });
  ipcMain.on('gestures:reset', (e) => {
    bundleOf(e)?.gestures.reset();
    browser.sendGesturesFor(profileIdOf(e));
  });

  // ジェスチャーpreloadからのアクション実行要求(送信元のタブに対して実行する)。
  // 対応するアクションの一覧は gestures.js の ACTIONS
  ipcMain.on('gestures:perform', (e, action) => {
    const ctx = ctxOf(e);
    const tabManager = tabsOf(e);
    if (!bundleOf(e)?.gestures.data.enabled || !tabManager || !ctx) return;
    const wc = e.sender;
    const tab = tabManager.tabs.find((t) => t.view.webContents === wc);
    const open = (url) => tabManager.createTab(url);

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
      case 'reloadHard':
        wc.reloadIgnoringCache();
        break;
      case 'stop':
        wc.stop();
        break;
      case 'home':
        open(TabManager.NEW_TAB_URL);
        break;

      case 'newTab':
        tabManager.createTab();
        break;
      case 'closeTab':
        if (tab) tabManager.closeTab(tab.id);
        break;
      case 'reopenTab':
        tabManager.reopenClosedTab();
        break;
      case 'duplicateTab':
        if (tab) tabManager.duplicateTab(tab.id);
        break;
      case 'closeOtherTabs':
        if (tab) tabManager.closeOtherTabs(tab.id);
        break;
      case 'nextTab':
        tabManager.switchRelative(1);
        break;
      case 'prevTab':
        tabManager.switchRelative(-1);
        break;
      case 'muteTab':
        if (tab) tabManager.toggleMute(tab.id);
        break;
      case 'detachTab':
        // 最後の1枚は切り離せない(元のウィンドウが空になるため)。
        // シークレットのタブは必ずシークレットのまま切り離す(通常ウィンドウへ移すと
        // Cookieも履歴も残ってしまう)
        if (tab && tabManager.tabs.length > 1) {
          const url = wc.getURL();
          tabManager.closeTab(tab.id);
          browser.createWindow({ url, profileId: ctx.profileId, incognito: ctx.incognito });
        }
        break;

      case 'newWindow':
        // シークレットから開いた「新しいウィンドウ」はシークレットのままにする(Chrome準拠)
        browser.createWindow({ profileId: ctx.profileId, incognito: ctx.incognito });
        break;
      case 'incognitoWindow':
        browser.createWindow({ incognito: true, profileId: ctx.profileId });
        break;
      case 'closeWindow':
        ctx.window.close();
        break;
      case 'minimizeWindow':
        ctx.window.minimize();
        break;
      case 'toggleFullscreen':
        ctx.window.setFullScreen(!ctx.window.isFullScreen());
        break;

      case 'bookmarkPage':
        tabManager.toggleBookmarkForActiveTab();
        break;
      case 'copyUrl':
        clipboard.writeText(wc.getURL());
        break;
      case 'findInPage':
        ctx.window.webContents.send('ui:open-find');
        break;
      case 'print':
        wc.print();
        break;
      case 'zoomIn':
        tabManager.zoom(1);
        break;
      case 'zoomOut':
        tabManager.zoom(-1);
        break;
      case 'zoomReset':
        tabManager.zoom(0);
        break;

      case 'toggleSidePanel':
        ctx.sidePanel.toggle();
        break;
      case 'openHistory':
        open('roopie://history');
        break;
      case 'openDownloads':
        open('roopie://downloads');
        break;
      case 'openBookmarks':
        open('roopie://bookmarks');
        break;
      case 'openSettings':
        open('roopie://settings');
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
  ipcMain.handle('settings:get', (e) => bundleOf(e)?.settings.data ?? { ...browser.DEFAULT_SETTINGS });
  ipcMain.on('settings:set', (e, key, value) => {
    const bundle = bundleOf(e);
    const settings = bundle?.settings;
    if (!settings || !(key in browser.DEFAULT_SETTINGS)) return;
    if (key === 'toolbarItems') {
      settings.data[key] = normalizeToolbarItems(value);
    } else if (key === 'pinnedExtensions') {
      settings.data[key] = Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(0, 200) : [];
    } else if (key === 'weatherLocation') {
      settings.data[key] = normalizeWeatherLocation(value);
    } else if (key === 'startIconSize') {
      const [min, max] = browser.START_ICON_SIZE_RANGE;
      const n = Math.round(Number(value));
      settings.data[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : browser.DEFAULT_SETTINGS[key];
    } else {
      settings.data[key] = value;
    }
    settings.save();
    const profileId = bundle.profileId;
    if (key === 'adblock') browser.applyAdblockFor(profileId);
    if (key === 'mediaDocked') browser.applyMediaDockedFor(profileId);
    if (key === 'timerDocked') browser.applyTimerDockedFor(profileId);
    if (key === 'downloadPath') browser.applyDownloadPathFor(profileId);
    if (key === 'tabBarPosition') browser.applyTabBarPositionFor(profileId);
    if (key === 'sidePanelPosition') browser.applySidePanelPositionFor(profileId);
    if (key === 'searchEngine') browser.applySearchEngineFor(profileId);
    browser.sendSettingsFor(profileId);
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
  // 再生状態の収集はメインプロセス側(tab-manager.js の probeMedia → browser.refreshMedia)。
  // ここでは操作だけを受ける。複数タブが同時に再生し得るため、どのタブへの操作かをtabIdで指定する

  // フローティングパネルは表示されるまでViewが作られないため(push配信だけでは表示直後に
  // 何も描画されないまま=timerpanel.jsで見つかった不具合と同型)、表示時に明示的取得できるようにする
  ipcMain.handle('media:list', (e) => ctxOf(e)?.mediaPlayer.visibleRows() ?? []);

  ipcMain.on('media:control', (e, tabId, action, value) => {
    const ctx = ctxOf(e);
    const entry = ctx?.mediaFrames.get(tabId);
    const tab = ctx?.tabManager.getTab(tabId);
    if (!entry || !tab) {
      if (ctx) browser.forgetMediaForTab(ctx, tabId);
      return;
    }
    // 操作は「その動画があるフレーム」に対して行う。タブのメインフレームに送ると、
    // 動画がiframeの中にあるサイト(ニュース系に多い)では要素が見つからず何も起きない
    const frame = entry.frame && !entry.frame.isDestroyed?.() ? entry.frame : null;
    const run = (code) => {
      const target = frame ?? tab.view.webContents;
      target.executeJavaScript(code, true).catch(() => {});
    };
    // shadow DOM の中にプレイヤーを作るサイトがあるため、影も含めて探す
    const pick = `(() => {
      const found = [];
      const walk = (root, depth) => {
        if (!root || depth > 8) return;
        for (const el of root.querySelectorAll('video, audio')) found.push(el);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      };
      walk(document, 0);
      return found.find((el) => !el.paused) || found[found.length - 1];
    })()`;

    if (action === 'toggle') {
      run(`(() => { const el = ${pick}; if (el) el.paused ? el.play() : el.pause(); })()`);
    } else if (action === 'seek' && typeof value === 'number') {
      run(`(() => { const el = ${pick}; if (el) el.currentTime = ${JSON.stringify(value)}; })()`);
    } else if (action === 'pip') {
      run(`(() => {
        const el = ${pick};
        if (el && el.tagName === 'VIDEO' && document.pictureInPictureEnabled) el.requestPictureInPicture().catch(() => {});
      })()`);
    } else if (action === 'next' || action === 'prev') {
      // main worldに退避したMediaSessionハンドラ(tab-manager.jsのMEDIA_HOOK)を呼ぶ
      const evt = action === 'next' ? 'nexttrack' : 'previoustrack';
      run(`(() => {
        const h = window.__roopieMediaActions && window.__roopieMediaActions['${evt}'];
        if (typeof h === 'function') { h({ action: '${evt}' }); }
      })()`);
    }
  });

  // タブ単位のミュート切り替え(タブのスピーカーアイコンと同じtoggleMuteを使う)
  ipcMain.on('media:toggle-mute', (e, tabId) => {
    const ctx = ctxOf(e);
    ctx?.tabManager.toggleMute(tabId);
    if (ctx) browser.refreshMedia(ctx);
  });

  // タブ単位の「フローティング表示」上書き(既定値はmediaDocked設定)
  ipcMain.on('media:set-docked', (e, tabId, docked) => {
    const ctx = ctxOf(e);
    if (ctx) browser.setMediaDockedForTab(ctx, tabId, docked);
  });

  ipcMain.on('media:switch-to-tab', (e, tabId) => {
    ctxOf(e)?.tabManager.switchTab(tabId);
  });

  // フローティングパネルの「一時的に非表示」(全タブぶんまとめて。タイマーと同型)
  ipcMain.on('media:dismiss', (e) => {
    ctxOf(e)?.mediaPlayer.hideTemporarily();
  });

  ipcMain.on('media:drag-start', (e) => ctxOf(e)?.mediaPlayer.dragStart());
  ipcMain.on('media:drag', (e, dx, dy) => ctxOf(e)?.mediaPlayer.dragBy(dx, dy));
  ipcMain.on('media:drag-end', (e) => ctxOf(e)?.mediaPlayer.dragEnd());

  // ---- タイマーのフローティングパネル(ウィンドウ操作。media:drag-*と同型) ----
  ipcMain.on('timer:drag-start', (e) => ctxOf(e)?.timerPanel?.dragStart());
  ipcMain.on('timer:drag', (e, dx, dy) => ctxOf(e)?.timerPanel?.dragBy(dx, dy));
  ipcMain.on('timer:drag-end', (e) => ctxOf(e)?.timerPanel?.dragEnd());
  ipcMain.on('timer:dismiss', (e) => ctxOf(e)?.timerPanel?.hideTemporarily());

  // ---- イントロ / 変更点 / アプリ情報 ----

  ipcMain.handle('app:info', () => appState.info());
  ipcMain.on('app:intro-done', () => appState.markIntroDone());
  ipcMain.on('app:notes-seen', () => appState.markNotesSeen());
  ipcMain.handle('app:update-status', () => updater.updateStatus());
  ipcMain.handle('app:check-updates', () => updater.checkForUpdatesNow());
  ipcMain.on('app:quit-and-install', () => updater.quitAndInstall());
  ipcMain.on('app:open-external', (_e, url) => {
    // 内部ページからの外部リンク(リポジトリ等)。http(s)だけ通す
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

module.exports = { registerIpc };
