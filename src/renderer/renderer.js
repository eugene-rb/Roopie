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
  for (const tab of tabState.tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === tabState.activeTabId ? ' active' : '');
    tabEl.title = tab.title;

    if (tab.isLoading) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      tabEl.appendChild(spinner);
    } else if (tab.favicon) {
      const icon = document.createElement('img');
      icon.className = 'favicon';
      icon.src = tab.favicon;
      tabEl.appendChild(icon);
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

function activeTab() {
  return tabState.tabs.find((t) => t.id === tabState.activeTabId) || null;
}

function renderToolbar() {
  const tab = activeTab();
  backBtn.disabled = !tab?.canGoBack;
  forwardBtn.disabled = !tab?.canGoForward;

  starBtn.textContent = tab?.isBookmarked ? '★' : '☆';
  starBtn.classList.toggle('bookmarked', !!tab?.isBookmarked);
  starBtn.disabled = !!tab?.isInternal;

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
