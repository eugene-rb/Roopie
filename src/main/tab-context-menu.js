const { Menu, MenuItem } = require('electron');

/**
 * タブバーでの右クリックメニュー。画面分割(並べて表示)の入り口はここにある。
 */
function showTabMenu(tabManager, tabId) {
  const tab = tabManager.getTab(tabId);
  if (!tab) return;

  const menu = new Menu();
  const add = (options) => menu.append(new MenuItem(options));
  const isActive = tabId === tabManager.activeTabId;
  const isSplitPartner = tabId === tabManager.splitTabId;

  add({ label: '新しいタブ', click: () => tabManager.createTab() });

  if (tabManager.tabs.length > 1) {
    add({ type: 'separator' });
    if (!isActive) {
      add({ label: '右に並べて表示', click: () => tabManager.splitWith(tabId, 'row') });
      add({ label: '下に並べて表示', click: () => tabManager.splitWith(tabId, 'column') });
    }
    if (tabManager.splitTabId && (isActive || isSplitPartner)) {
      add({ label: '分割を解除', click: () => tabManager.closeSplit() });
    }
  }

  add({ type: 'separator' });
  add({ label: 'タブを閉じる', click: () => tabManager.closeTab(tabId) });
  if (tabManager.tabs.length > 1) {
    add({
      label: '他のタブを閉じる',
      click: () => {
        for (const id of tabManager.tabs.map((t) => t.id)) {
          if (id !== tabId) tabManager.closeTab(id);
        }
      },
    });
  }

  menu.popup();
}

module.exports = { showTabMenu };
