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
    attachTabDrag(tabEl, tab);

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

function attachTabDrag(tabEl, tab) {
  tabEl.addEventListener('dragstart', (e) => {
    draggingId = tab.id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // FirefoxやChromiumでdragを成立させるにはデータが必要
    e.dataTransfer.setData('text/plain', String(tab.id));
  });

  tabEl.addEventListener('dragend', () => {
    draggingId = null;
    clearDropMarkers();
    tabEl.classList.remove('dragging');
  });

  tabEl.addEventListener('dragover', (e) => {
    if (draggingId === null || draggingId === tab.id) return;
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

// ---- プロファイル ----
const profileBtn = $('profile-btn');

window.roopie.onProfilesState((state) => {
  const active = state.profiles.find((p) => p.id === state.activeId);
  if (!active) return;
  profileBtn.textContent = (active.name[0] || '?').toUpperCase();
  profileBtn.style.background = active.color;
  profileBtn.title = `プロファイル: ${active.name}(クリックで切り替え)`;
});

// プルダウンはページの上に重なるオーバーレイViewに描画するため、
// ボタンの位置(ページ表示領域から見た座標)をメインプロセスへ渡す
profileBtn.addEventListener('click', () => {
  const rect = profileBtn.getBoundingClientRect();
  window.roopie.openProfileMenu({
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
  });
});

$('settings-btn').addEventListener('click', () => window.roopie.newTab('roopie://settings'));

// ---- ダウンロード ----
window.roopie.onDownloadsState((state) => {
  downloadsBtn.classList.toggle('active', state.hasActive);
});

// ---- 設定(ブックマークバーの表示切替) ----
window.roopie.onSettings((settings) => {
  bookmarkBarEl.classList.toggle('hidden', !settings.showBookmarkBar);
  reportChromeHeight();
});

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

// ---- ウィンドウ種別(シークレットかどうか) ----
window.roopie.onWindowInfo(({ incognito }) => {
  document.body.classList.toggle('incognito', !!incognito);
  if (incognito) {
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
downloadsBtn.addEventListener('click', () => window.roopie.newTab('roopie://downloads'));
$('history-btn').addEventListener('click', () => window.roopie.newTab('roopie://history'));

// ---- サイドパネル ----
const sidepanelBtn = $('sidepanel-btn');
sidepanelBtn.addEventListener('click', () => window.roopie.toggleSidePanel());
window.roopie.onSidePanelState((state) => {
  sidepanelBtn.classList.toggle('active', state.open);
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
