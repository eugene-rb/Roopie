const $ = (id) => document.getElementById(id);

const chromeEl = $('chrome');
const tabsEl = $('tabs');
const bookmarkBarEl = $('bookmark-bar');
const bookmarkHintEl = $('bookmark-hint');
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
  // FLIP: 再描画前の位置を覚えておき、並び替えなどで動いたタブを滑らかにスライドさせる
  const prevRects = new Map();
  for (const el of tabsEl.children) {
    if (el.dataset.id) prevRects.set(el.dataset.id, el.getBoundingClientRect());
  }
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

  // ドラッグ中に再描画が走った場合(読み込み状態の変化など)でも、畳み表示と挿入プレビューを維持する
  if (draggingId !== null) {
    tabsEl.querySelector(`[data-id="${draggingId}"]`)?.classList.add('dragging', 'drag-collapsed');
    if (dropSlot._index !== null) showDropSlot(dropSlot._index);
  }

  for (const el of tabsEl.children) {
    // ドロップ直後のタブはスロットのあった位置にそのまま現れる(FLIPで滑らせない)
    if (el.dataset.id === justDroppedId) continue;
    const prev = prevRects.get(el.dataset.id);
    if (!prev) continue;
    const rect = el.getBoundingClientRect();
    const dx = prev.left - rect.left;
    const dy = prev.top - rect.top;
    if (dx || dy) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
    }
  }
  justDroppedId = null;
}

// ---- タブのドラッグ(並べ替え & ドロップ挿入検索の共通UX) ----
// 並べ替えでも、ページから選択テキストをドラッグしてきた検索でも、同じ「挿入スロット」を出す。
// スロットは実体のある隙間で、ドラッグ中はカーソル位置にリアルタイムで追従し、タブの間に差し込める。
let draggingId = null;
let justDroppedId = null; // ドロップ直後、確定位置へFLIPで滑らせないタブID(スロット位置にそのまま出す)
const DETACH_THRESHOLD = 40; // タブバーの下端からこれだけ離れたら切り離しと判定

const tabBarEl = $('tab-bar');

// 挿入位置プレビュー用のスロット(隙間)。要素は1つを使い回す
const dropSlot = document.createElement('div');
dropSlot.className = 'tab-drop-slot';
dropSlot._index = null; // スロットが差し込まれているタブインデックス(null=非表示)

function isVerticalTabs() {
  return document.body.classList.contains('vertical-tabs');
}

// スロットの基準となるタブ列。並べ替え中はつまみ上げた自分を除く
// (= このインデックスがそのまま moveTab の挿入先になる)
function slotTargets() {
  return [...tabsEl.querySelectorAll('.tab')].filter((el) => el.dataset.id !== String(draggingId));
}

// カーソル位置から挿入先インデックス(0..件数)を求める。縦タブ時はY座標で判定
function computeSlotIndex(e) {
  const vertical = isVerticalTabs();
  const pos = vertical ? e.clientY : e.clientX;
  const tabs = slotTargets();
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    const mid = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
    if (pos < mid) return i;
  }
  return tabs.length;
}

function showDropSlot(index) {
  if (dropSlot._index === index && dropSlot.isConnected) return;
  dropSlot._index = index;
  tabsEl.insertBefore(dropSlot, slotTargets()[index] || null);
  // 挿入直後に .open を付けてwidth/heightのtransitionで隙間を開く
  requestAnimationFrame(() => dropSlot.classList.add('open'));
}

function hideDropSlot() {
  dropSlot._index = null;
  dropSlot.classList.remove('open');
  dropSlot.remove();
}

function cleanupDrag() {
  hideDropSlot();
  tabBarEl.classList.remove('drag-search');
  for (const el of tabsEl.querySelectorAll('.tab.dragging, .tab.drag-collapsed')) {
    el.classList.remove('dragging', 'drag-collapsed');
  }
  draggingId = null;
}

function attachTabDrag(tabEl, tab) {
  tabEl.addEventListener('dragstart', (e) => {
    draggingId = tab.id;
    e.dataTransfer.effectAllowed = 'move';
    // FirefoxやChromiumでdragを成立させるにはデータが必要。
    // ページ領域のドロップゾーン(オーバーレイ)はこのIDを読んで分割対象を決める
    e.dataTransfer.setData('text/plain', String(tab.id));
    // つまみ上げたタブは畳んで隙間を消す。ドラッグ画像を撮り終える次フレームで畳む
    requestAnimationFrame(() => tabEl.classList.add('dragging', 'drag-collapsed'));
    // ページ領域にドロップゾーンを出す(分割 or 切り離しの受け皿)
    window.roopie.tabDragStart(tab.id);
  });

  tabEl.addEventListener('dragend', (e) => {
    // 分割 or 切り離しの確定はメイン側が行う(ページ領域のドロップゾーンからの分割と競合しないよう、
    // メインで少し遅延させて判定する)。ここでは切り離し候補かどうかの目安だけ渡す
    const reordered = e.dataTransfer.dropEffect === 'move';
    const barBottom = tabsEl.getBoundingClientRect().bottom;
    const belowBar = !reordered && e.clientY > barBottom + DETACH_THRESHOLD;
    cleanupDrag();
    window.roopie.tabDragEnd(tab.id, { belowBar, screenX: e.screenX, screenY: e.screenY });
  });
}

// タブバー全体でドラッグを受ける。並べ替え(自タブ)=move、ページからの選択テキスト=copy。
// どちらも同じスロットで挿入先をプレビューし、既存タブの間に差し込める
function dragMode(e) {
  if (draggingId !== null) return 'reorder';
  if ([...e.dataTransfer.types].includes('text/plain')) return 'search';
  return null;
}

tabBarEl.addEventListener('dragover', (e) => {
  const mode = dragMode(e);
  if (!mode) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = mode === 'reorder' ? 'move' : 'copy';
  // 検索ドロップのときはバー全体もハイライトして「ここに落とせる」と分かるようにする
  tabBarEl.classList.toggle('drag-search', mode === 'search');
  showDropSlot(computeSlotIndex(e));
});

tabBarEl.addEventListener('dragleave', (e) => {
  // 子要素間の移動でも発火するため、バーの外へ出た時だけ片付ける
  if (e.relatedTarget && tabBarEl.contains(e.relatedTarget)) return;
  hideDropSlot();
  tabBarEl.classList.remove('drag-search');
});

tabBarEl.addEventListener('drop', (e) => {
  const mode = dragMode(e);
  if (!mode) return;
  e.preventDefault();
  const index = dropSlot._index ?? computeSlotIndex(e);
  if (mode === 'reorder') {
    // 残りの後始末(dragging解除・draggingId=null)は直後の dragend が行う
    justDroppedId = String(draggingId);
    window.roopie.moveTab(draggingId, index);
    hideDropSlot();
    tabBarEl.classList.remove('drag-search');
  } else {
    const text = e.dataTransfer.getData('text/plain');
    if (text.trim()) {
      window.roopie.searchInNewTab(text, index);
      // ドロップが受理されたと分かる短いフラッシュ
      tabBarEl.animate(
        [{ boxShadow: 'inset 0 0 0 2px var(--accent)' }, { boxShadow: 'inset 0 0 0 2px transparent' }],
        { duration: 350, easing: 'ease-out' }
      );
    }
    cleanupDrag();
  }
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
  renderBookmarkHint();

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

// 「Ctrl+D でブックマーク」の案内。前にも来たのにまだ入れていないページでだけ出す
// (メイン側が tab.bookmarkHint で判定し、ページをクリック/スクロールすると引っ込める)
function renderBookmarkHint() {
  bookmarkHintEl.classList.toggle('hidden', !activeTab()?.bookmarkHint);
}

function renderBookmarkBar() {
  // 案内(#bookmark-hint)はバーの中に常駐しているので、ブックマークだけ作り直す
  for (const el of bookmarkBarEl.querySelectorAll('.bookmark')) el.remove();
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
    bookmarkBarEl.insertBefore(el, bookmarkHintEl);
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
  // Edge風: ピン留めした拡張だけツールバーに出す。アイコンはshadowRoot(open)に
  // 非同期で生えるため、追加を監視して都度フィルタを適用する
  new MutationObserver(applyExtensionPinning).observe(list.shadowRoot, { childList: true });
  applyExtensionPinning();
}

// ---- 拡張機能(Edge風: ピン留め+パズルボタンのメニュー) ----
let pinnedExtensions = [];
let extensionsCount = 0;
const extensionsMenuBtn = $('extensions-menu-btn');

// ツールバーの拡張アイコンをピン留め済みだけに絞る(それ以外はパズルメニューから使う)
function applyExtensionPinning() {
  const list = document.getElementById('extensions-list');
  if (!list?.shadowRoot) return;
  for (const node of list.shadowRoot.querySelectorAll('.action')) {
    node.style.display = pinnedExtensions.includes(node.id) ? '' : 'none';
  }
}

// パズルボタンは拡張が1つ以上あるときだけ表示(シークレットでは拡張自体が無効)
function updateExtensionsMenuBtn() {
  extensionsMenuBtn.classList.toggle('hidden', isIncognito || extensionsCount === 0);
}

window.roopie.onExtensionsState((items) => {
  extensionsCount = items?.length ?? 0;
  updateExtensionsMenuBtn();
});

extensionsMenuBtn.addEventListener('click', () => {
  const rect = extensionsMenuBtn.getBoundingClientRect();
  window.roopie.openExtensionsMenu({
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
  });
});

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
  // 縦横のレイアウト差はCSS(.vertical-tabs と #tab-bar-head)だけで完結する
  document.body.classList.toggle('vertical-tabs', tabBarPosition === 'left');
  $('tab-bar-position-btn').classList.toggle('active', tabBarPosition === 'left');
  sidePanelPosition = settings.sidePanelPosition === 'left' ? 'left' : 'right';
  applySidePanelButtonPosition();
  applyToolbarItems(settings.toolbarItems);
  pinnedExtensions = Array.isArray(settings.pinnedExtensions) ? settings.pinnedExtensions : [];
  applyExtensionPinning();
  reportChromeHeight();
});

// ---- ツールバーのユーティリティ項目(表示/非表示・並び替え) ----
// メイン側で正規化済みの配列 [{id, visible}] を受け取り、DOMへ反映する
const TOOLBAR_EL_BY_ID = {
  downloads: 'downloads-btn',
  history: 'history-btn',
  qr: 'qr-btn',
  zoom: 'zoom-controls',
};

function applyToolbarItems(items) {
  if (!Array.isArray(items) || !items.length) return;
  const utility = $('toolbar-utility');
  // 表示/非表示。history-btnはシークレット時に .hidden(!important)で隠れるため、
  // 表示側は display='' に戻して .hidden 側に判断を委ねる
  for (const { id, visible } of items) {
    const el = document.getElementById(TOOLBAR_EL_BY_ID[id]);
    if (el) el.style.display = visible ? '' : 'none';
  }
  // 並び替え: configurable な要素だけを保存順に入れ替える。
  // サイドパネルボタン・分割コントロールなど非対象の要素は現在の位置を保つ
  const queue = items
    .map((it) => document.getElementById(TOOLBAR_EL_BY_ID[it.id]))
    .filter((el) => el && el.parentElement === utility);
  const configurable = new Set(queue);
  const newOrder = [];
  let q = 0;
  for (const child of utility.children) {
    newOrder.push(configurable.has(child) ? queue[q++] : child);
  }
  for (const el of newOrder) utility.appendChild(el);
}

// ユーティリティ群を右クリック → 表示/非表示の切り替えメニュー(ネイティブ)
$('toolbar-utility').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopie.toolbarContextMenu();
});

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

// ---- ページ側の全画面(YouTube等の全画面ボタン) ----
// タブバー・ツールバー・ブックマークバーをまとめて隠す。ページの領域はメイン側
// (tab-manager.js の layout)がウィンドウ一杯に広げる
window.roopie.onHtmlFullscreen((on) => {
  document.body.classList.toggle('html-fullscreen', !!on);
  reportChromeHeight();
});

// ---- ウィンドウ種別(シークレットかどうか) ----
let isIncognito = false;
window.roopie.onWindowInfo(({ incognito }) => {
  isIncognito = !!incognito;
  document.body.classList.toggle('incognito', !!incognito);
  if (incognito) {
    $('extensions-area').replaceChildren();
    updateExtensionsMenuBtn();
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
$('password-never').addEventListener('click', () => {
  window.roopie.neverSavePassword();
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
