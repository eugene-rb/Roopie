const tabsEl = document.getElementById('tabs');
const newTabBtn = document.getElementById('new-tab-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const addressBar = document.getElementById('address-bar');

let currentState = { tabs: [], activeTabId: null };

// ---- タブ状態の受信と描画 ----
window.roopie.onTabsState((state) => {
  currentState = state;
  renderTabs();
  renderToolbar();
});

function renderTabs() {
  tabsEl.textContent = '';
  for (const tab of currentState.tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === currentState.activeTabId ? ' active' : '');
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

function renderToolbar() {
  const active = currentState.tabs.find((t) => t.id === currentState.activeTabId);
  backBtn.disabled = !active?.canGoBack;
  forwardBtn.disabled = !active?.canGoForward;

  // 入力中はアドレスバーを上書きしない
  if (active && document.activeElement !== addressBar) {
    addressBar.value = active.url;
  }
}

// ---- 操作イベント ----
newTabBtn.addEventListener('click', () => window.roopie.newTab());
backBtn.addEventListener('click', () => window.roopie.goBack());
forwardBtn.addEventListener('click', () => window.roopie.goForward());
reloadBtn.addEventListener('click', () => window.roopie.reload());

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && addressBar.value.trim()) {
    window.roopie.navigate(addressBar.value);
    addressBar.blur();
  } else if (e.key === 'Escape') {
    addressBar.blur();
  }
});

addressBar.addEventListener('focus', () => addressBar.select());

window.roopie.onFocusAddressBar(() => {
  addressBar.focus();
  addressBar.select();
});
