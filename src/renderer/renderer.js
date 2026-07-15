const $ = (id) => document.getElementById(id);

const chromeEl = $('chrome');
const tabsEl = $('tabs');
const bookmarkBarEl = $('bookmark-bar');
const addressBar = $('address-bar');
const starBtn = $('star-btn');
const backBtn = $('back-btn');
const forwardBtn = $('forward-btn');
const reloadBtn = $('reload-btn');
const zoomLabel = $('zoom-label');
const downloadsBtn = $('downloads-btn');
const findBar = $('find-bar');
const findInput = $('find-input');
const findCount = $('find-count');

let tabState = { tabs: [], activeTabId: null };
let bookmarks = [];

// ---- タブ ----
window.roopie.onTabsState((state) => {
  tabState = state;
  renderTabs();
  renderToolbar();
});

function renderTabs() {
  tabsEl.textContent = '';
  for (const [index, tab] of tabState.tabs.entries()) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === tabState.activeTabId ? ' active' : '');
    tabEl.title = tab.title;
    tabEl.draggable = true;
    tabEl.dataset.id = String(tab.id);
    tabEl.dataset.index = String(index);
    // 画面分割中は、並んでいる2枚のタブに同じ強調表示を付けてペアだと分かるようにする
    if (tabState.splitTabId && (tab.id === tabState.activeTabId || tab.id === tabState.splitTabId)) {
      tabEl.classList.add('split');
    }
    attachTabDrag(tabEl, tab);
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.roopie.tabContextMenu(tab.id);
    });

    if (tab.isLoading) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      tabEl.appendChild(spinner);
    } else if (tab.favicon) {
      const icon = document.createElement('img');
      icon.className = 'favicon';
      icon.src = tab.favicon;
      tabEl.appendChild(icon);
    } else {
      // faviconがないタブは頭文字で代替
      const letter = document.createElement('span');
      letter.className = 'favicon-letter';
      letter.textContent = (tab.title[0] || '·').toUpperCase();
      tabEl.appendChild(letter);
    }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    tabEl.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'タブを閉じる (Ctrl+W)';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.roopie.closeTab(tab.id);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => window.roopie.switchTab(tab.id));
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.roopie.closeTab(tab.id); // 中クリックで閉じる
    });

    tabsEl.appendChild(tabEl);
  }
}

// ---- タブのドラッグ並べ替え ----
// ドラッグ中は挿入位置のタブに .drop-before / .drop-after を付けて目印にする
let draggingId = null;
const DETACH_THRESHOLD = 40; // タブバーの下端からこれだけ離れたら切り離しと判定

function attachTabDrag(tabEl, tab) {
  tabEl.addEventListener('dragstart', (e) => {
    draggingId = tab.id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // FirefoxやChromiumでdragを成立させるにはデータが必要
    e.dataTransfer.setData('text/plain', String(tab.id));
  });

  tabEl.addEventListener('dragend', (e) => {
    const reordered = e.dataTransfer.dropEffect === 'move';
    draggingId = null;
    clearDropMarkers();
    tabEl.classList.remove('dragging');

    // タブバーの外(下方向にしきい値を超えて)にドロップしたら新しいウィンドウへ切り離す
    if (!reordered && tabState.tabs.length > 1) {
      const barBottom = tabsEl.getBoundingClientRect().bottom;
      if (e.clientY > barBottom + DETACH_THRESHOLD) {
        window.roopie.detachTab(tab.id, { screenX: e.screenX, screenY: e.screenY });
      }
    }
  });

  tabEl.addEventListener('dragover', (e) => {
    if (draggingId === null || draggingId === tab.id) return;
    // タブ並べ替えのドラッグは、親(#tab-bar)のドラッグ検索ハンドラへ伝播させない
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    // タブの左半分なら手前、右半分なら後ろへ挿入
    const rect = tabEl.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    tabEl.classList.add(after ? 'drop-after' : 'drop-before');
  });

  tabEl.addEventListener('drop', (e) => {
    if (draggingId === null || draggingId === tab.id) return;
    // タブ並べ替えのドロップは、親(#tab-bar)のドラッグ検索ハンドラへ伝播させない
    // (先に draggingId を null にするため、伝播すると検索ハンドラの draggingId ガードをすり抜ける)
    e.stopPropagation();
    e.preventDefault();
    const rect = tabEl.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;

    const from = tabState.tabs.findIndex((t) => t.id === draggingId);
    let to = tabState.tabs.findIndex((t) => t.id === tab.id);
    if (after) to += 1;
    // 前方から後方へ動かす場合、抜けた分だけ位置が1つ詰まる
    if (from < to) to -= 1;

    clearDropMarkers();
    window.roopie.moveTab(draggingId, to);
    draggingId = null;
  });
}

function clearDropMarkers() {
  for (const el of tabsEl.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

// ---- 選択テキストをタブバーへドラッグして検索(Edgeオマージュ) ----
// ページ(別のWebContentsView)から選択テキストをドラッグしてきた場合のみ反応する。
// 自分のタブの並べ替えドラッグは draggingId が立つので、その間は何もしない
const tabBarEl = $('tab-bar');
tabBarEl.addEventListener('dragover', (e) => {
  if (draggingId !== null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
tabBarEl.addEventListener('drop', (e) => {
  if (draggingId !== null) return;
  e.preventDefault();
  const text = e.dataTransfer.getData('text/plain');
  if (text.trim()) window.roopie.searchInNewTab(text);
});

function activeTab() {
  return tabState.tabs.find((t) => t.id === tabState.activeTabId) || null;
}

function renderToolbar() {
  const tab = activeTab();
  backBtn.disabled = !tab?.canGoBack;
  forwardBtn.disabled = !tab?.canGoForward;

  starBtn.classList.toggle('bookmarked', !!tab?.isBookmarked);
  starBtn.disabled = !!tab?.isInternal;

  // アドレスバーのアイコン: httpsなら鍵、それ以外は検索
  const isSecure = (tab?.url ?? '').startsWith('https://');
  document.getElementById('icon-lock').classList.toggle('hidden', !isSecure);
  document.getElementById('icon-search').classList.toggle('hidden', isSecure);

  // ズーム率(Chromiumのzoomレベルは1段階=1.2倍)
  const percent = Math.round(1.2 ** (tab?.zoomLevel ?? 0) * 100);
  zoomLabel.textContent = `${percent}%`;

  // 画面分割のコントロール(分割中だけ表示)
  const splitControls = $('split-controls');
  splitControls.classList.toggle('hidden', !tabState.splitTabId);
  $('icon-split-row').classList.toggle('hidden', tabState.splitDirection === 'column');
  $('icon-split-column').classList.toggle('hidden', tabState.splitDirection !== 'column');

  // 入力中はアドレスバーを上書きしない
  if (tab && document.activeElement !== addressBar) {
    addressBar.value = tab.url;
  }
}

// ---- ブックマークバー ----
window.roopie.onBookmarksState((items) => {
  bookmarks = items;
  renderBookmarkBar();
});

function renderBookmarkBar() {
  bookmarkBarEl.textContent = '';
  for (const bookmark of bookmarks) {
    const el = document.createElement('div');
    el.className = 'bookmark';
    el.title = `${bookmark.title}\n${bookmark.url}`;

    if (bookmark.favicon) {
      const icon = document.createElement('img');
      icon.src = bookmark.favicon;
      el.appendChild(icon);
    }

    const label = document.createElement('span');
    label.textContent = bookmark.title;
    el.appendChild(label);

    el.addEventListener('click', () => window.roopie.navigate(bookmark.url));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.roopie.newTab(bookmark.url); // 中クリックで新しいタブ
    });
    bookmarkBarEl.appendChild(el);
  }
  reportChromeHeight();
}

// ---- プロファイル(Edgeの「ワークスペース」風ピル。タブバー左端) ----
const workspaceBtn = $('workspace-btn');
const workspaceAvatar = $('workspace-avatar');
const workspaceName = $('workspace-name');

window.roopie.onProfilesState((state) => {
  const active = state.profiles.find((p) => p.id === state.activeId);
  if (!active) return;
  renderAvatar(workspaceAvatar, active);
  workspaceName.textContent = active.name;
  workspaceBtn.style.setProperty('--workspace-color', active.color);
  workspaceBtn.title = `プロファイル: ${active.name}(クリックで切り替え)`;
  // アクティブプロファイルがTorを使っているかを、ピルの🧅インジケーターで示す
  activeProfileTor = !!active.tor;
  updateTorIndicator();
  renderExtensionActions(active.partition);
});

// ---- Torインジケーター(ワークスペースピル内) ----
let activeProfileTor = false;
let torStatus = { status: 'disabled' };
const torIndicator = $('workspace-tor');

function updateTorIndicator() {
  if (!activeProfileTor) {
    torIndicator.classList.add('hidden');
    return;
  }
  torIndicator.classList.remove('hidden');
  torIndicator.classList.toggle('connecting', torStatus.status === 'starting');
  torIndicator.classList.toggle('error', torStatus.status === 'error');
  torIndicator.title =
    torStatus.status === 'ready'
      ? 'Torで接続中'
      : torStatus.status === 'starting'
        ? 'Torに接続しています…'
        : torStatus.status === 'error'
          ? `Torに接続できません: ${torStatus.error ?? ''}`
          : 'Tor(停止中)';
}

window.roopie.onTorStatus((status) => {
  torStatus = status;
  updateTorIndicator();
});

// 拡張機能アイコンをアクティブなプロファイルのセッションに向ける。
// <browser-action-list> はDOM接続時のpartitionでしか更新を購読しないため、
// partitionが変わったら要素ごと作り直す(シークレットでは拡張機能が無効なので出さない)
function renderExtensionActions(partition) {
  const area = $('extensions-area');
  if (isIncognito) {
    area.replaceChildren();
    return;
  }
  if (area.firstElementChild?.getAttribute('partition') === partition) return;
  const list = document.createElement('browser-action-list');
  list.id = 'extensions-list';
  list.setAttribute('alignment', 'top right');
  list.setAttribute('partition', partition);
  area.replaceChildren(list);
}

// プロファイルのアイコン(文字/絵文字/画像)を1つの.avatar要素に反映する
function renderAvatar(el, profile) {
  el.textContent = '';
  el.classList.remove('emoji');
  el.style.background = '';
  const icon = profile.icon ?? { type: 'letter' };
  if (icon.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.src = icon.value;
    img.alt = '';
    el.appendChild(img);
  } else if (icon.type === 'emoji' && icon.value) {
    el.classList.add('emoji');
    el.textContent = icon.value;
  } else {
    el.style.background = profile.color;
    el.textContent = (profile.name[0] || '?').toUpperCase();
  }
}

// プルダウンはページの上に重なるオーバーレイViewに描画するため、
// ボタンの位置(ページ表示領域から見た座標)をメインプロセスへ渡す
workspaceBtn.addEventListener('click', () => {
  const rect = workspaceBtn.getBoundingClientRect();
  window.roopie.openProfileMenu({
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
  });
});

$('settings-btn').addEventListener('click', () => window.roopie.newTab('roopie://settings'));

// QRコード: 現在のページURL・タイトル・ボタン位置をオーバーレイViewへ渡す
$('qr-btn').addEventListener('click', () => {
  const rect = $('qr-btn').getBoundingClientRect();
  const tab = activeTab();
  window.roopie.openQr({
    url: tab?.url ?? '',
    title: tab?.title ?? '',
    anchor: {
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
    },
  });
});

// ---- ダウンロード ----
window.roopie.onDownloadsState((state) => {
  downloadsBtn.classList.toggle('active', state.hasActive);
});

// ---- 設定(ブックマークバーの表示切替・タブバーの位置・サイドパネルの位置) ----
let tabBarPosition = 'top';
let sidePanelPosition = 'right';

window.roopie.onSettings((settings) => {
  bookmarkBarEl.classList.toggle('hidden', !settings.showBookmarkBar);
  tabBarPosition = settings.tabBarPosition || 'top';
  document.body.classList.toggle('vertical-tabs', tabBarPosition === 'left');
  $('tab-bar-position-btn').classList.toggle('active', tabBarPosition === 'left');
  applyTabBarLayout();
  sidePanelPosition = settings.sidePanelPosition === 'left' ? 'left' : 'right';
  applySidePanelButtonPosition();
  reportChromeHeight();
});

// 縦タブ時は上部ストリップ(#drag-strip)が空きスペースになるため、
// タブ切替ボタン+ワークスペースピルをそちらへ移して余白をなくす
// (ネイティブのウィンドウ操作ボタン自体はOS描画のため移動できない。周りを埋めるだけ)
function applyTabBarLayout() {
  const dragStrip = $('drag-strip');
  const tabBar = $('tab-bar');
  const posBtn = $('tab-bar-position-btn');
  const workspaceBtn = $('workspace-btn');
  if (tabBarPosition === 'left') {
    dragStrip.appendChild(posBtn);
    dragStrip.appendChild(workspaceBtn);
  } else {
    tabBar.insertBefore(posBtn, tabBar.firstChild);
    tabBar.insertBefore(workspaceBtn, posBtn.nextSibling);
  }
}

$('tab-bar-position-btn').addEventListener('click', () => {
  window.roopie.setSetting('tabBarPosition', tabBarPosition === 'left' ? 'top' : 'left');
});

// on/offボタンは、サイドパネルが実際に開く側(現在の設定)のツールバーの端に置く
function applySidePanelButtonPosition() {
  const toolbar = $('toolbar');
  const btn = $('sidepanel-btn');
  if (sidePanelPosition === 'left') {
    toolbar.insertBefore(btn, toolbar.firstChild);
  } else {
    toolbar.appendChild(btn);
  }
}

// ---- テーマ ----
// カスタムCSSはadoptedStyleSheets経由で適用する(CSPのstyle-srcに妨げられない)
const customSheet = new CSSStyleSheet();

function applyTheme(theme) {
  if (!theme) return;
  document.documentElement.style.setProperty('--accent', theme.accent);
  try {
    customSheet.replaceSync(theme.customCss || '');
  } catch {
    // 不正なCSSは無視
  }
  document.adoptedStyleSheets = [customSheet];
}

window.roopie.onThemeState(applyTheme);
window.roopie.getTheme().then(applyTheme);

// ---- 集中モード(ツールバーを隠してページを広く使う) ----
window.roopie.onToggleCompact(() => {
  document.body.classList.toggle('compact');
  reportChromeHeight();
});

// ---- ウィンドウ種別(シークレットかどうか) ----
let isIncognito = false;
window.roopie.onWindowInfo(({ incognito }) => {
  isIncognito = !!incognito;
  document.body.classList.toggle('incognito', !!incognito);
  if (incognito) {
    $('extensions-area').replaceChildren();
    // シークレットでは履歴・パスワード関連のUIを出さない
    $('history-btn').classList.add('hidden');
    starBtn.title = 'このページをブックマーク (Ctrl+D)';
  }
});

// ---- パスワード保存の確認バー ----
const passwordBar = $('password-bar');
const passwordText = $('password-text');

window.roopie.onPasswordPrompt(({ origin, username, isUpdate }) => {
  const host = origin.replace(/^https?:\/\//, '');
  passwordText.textContent = isUpdate
    ? `${host} の「${username}」のパスワードを更新しますか?`
    : `${host} のパスワードを保存しますか?(${username})`;
  passwordBar.classList.remove('hidden');
  reportChromeHeight();
});

function closePasswordBar() {
  passwordBar.classList.add('hidden');
  reportChromeHeight();
}

$('password-save').addEventListener('click', () => {
  window.roopie.savePassword();
  closePasswordBar();
});
$('password-dismiss').addEventListener('click', () => {
  window.roopie.dismissPassword();
  closePasswordBar();
});

// ---- ページ内検索 ----
window.roopie.onOpenFind(() => {
  findBar.classList.remove('hidden');
  reportChromeHeight();
  findInput.focus();
  findInput.select();
  if (findInput.value) window.roopie.find(findInput.value);
});

window.roopie.onFindResult(({ activeMatchOrdinal, matches }) => {
  findCount.textContent = `${matches ? activeMatchOrdinal : 0}/${matches}`;
});

function closeFind() {
  findBar.classList.add('hidden');
  findCount.textContent = '0/0';
  window.roopie.stopFind();
  reportChromeHeight();
}

findInput.addEventListener('input', () => {
  if (findInput.value) window.roopie.find(findInput.value);
  else {
    window.roopie.stopFind();
    findCount.textContent = '0/0';
  }
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.roopie.find(findInput.value, { findNext: true, forward: !e.shiftKey });
  } else if (e.key === 'Escape') {
    closeFind();
  }
});

$('find-next').addEventListener('click', () =>
  window.roopie.find(findInput.value, { findNext: true, forward: true })
);
$('find-prev').addEventListener('click', () =>
  window.roopie.find(findInput.value, { findNext: true, forward: false })
);
$('find-close').addEventListener('click', closeFind);

// ---- ツールバー操作 ----
$('new-tab-btn').addEventListener('click', () => window.roopie.newTab());
backBtn.addEventListener('click', () => window.roopie.goBack());
forwardBtn.addEventListener('click', () => window.roopie.goForward());
reloadBtn.addEventListener('click', () => window.roopie.reload());
starBtn.addEventListener('click', () => window.roopie.toggleBookmark());
$('zoom-in-btn').addEventListener('click', () => window.roopie.zoom(1));
$('zoom-out-btn').addEventListener('click', () => window.roopie.zoom(-1));
zoomLabel.addEventListener('click', () => window.roopie.zoom(0));
// ズーム表示の上でホイールを回すと拡大縮小できる
$('zoom-controls').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    window.roopie.zoom(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);
downloadsBtn.addEventListener('click', () => window.roopie.newTab('roopie://downloads'));
$('split-direction-btn').addEventListener('click', () => window.roopie.toggleSplitDirection());
$('split-close-btn').addEventListener('click', () => window.roopie.closeSplit());
$('history-btn').addEventListener('click', () => window.roopie.newTab('roopie://history'));

// ---- サイドパネル ----
const sidepanelBtn = $('sidepanel-btn');
sidepanelBtn.addEventListener('click', () => window.roopie.toggleSidePanel());
// 右クリックで表示側(左/右)を選べるメニューを開く
sidepanelBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopie.sidePanelContextMenu();
});
// サイドバー(アイコンレール)は常時表示が既定のため、復帰用ボタンは非表示中だけツールバーに出す
window.roopie.onSidePanelState((state) => {
  sidepanelBtn.classList.toggle('hidden', state.open);
});

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && addressBar.value.trim()) {
    window.roopie.navigate(addressBar.value);
    addressBar.blur();
  } else if (e.key === 'Escape') {
    addressBar.value = activeTab()?.url ?? '';
    addressBar.blur();
  }
});
addressBar.addEventListener('focus', () => addressBar.select());

// ---- UI領域の高さをメインプロセスへ通知(ページ表示領域の計算に使う) ----
function reportChromeHeight() {
  window.roopie.setChromeHeight(chromeEl.offsetHeight);
}

new ResizeObserver(reportChromeHeight).observe(chromeEl);
reportChromeHeight();
