const { Menu, MenuItem, clipboard } = require('electron');
const browser = require('./browser');
const windows = require('./windows');

/**
 * タブバーでの右クリックメニュー。画面分割(並べて表示)の入り口はここにある。
 */
function showTabMenu(tabManager, tabId) {
  const tab = tabManager.getTab(tabId);
  if (!tab) return;

  const wc = tab.view.webContents;
  const menu = new Menu();
  const add = (options) => menu.append(new MenuItem(options));
  const separator = () => add({ type: 'separator' });

  const index = tabManager.tabs.findIndex((t) => t.id === tabId);
  const isActive = tabId === tabManager.activeTabId;
  const isSplitPartner = tabId === tabManager.splitTabId;
  const multiple = tabManager.tabs.length > 1;
  const hasTabsToRight = index < tabManager.tabs.length - 1;

  add({ label: '新しいタブ', click: () => tabManager.createTab() });
  add({ label: 'タブを複製', click: () => tabManager.createTab(wc.getURL()) });
  add({ label: 'タブを再読み込み', click: () => wc.reload() });
  add({
    label: wc.isAudioMuted() ? 'タブのミュートを解除' : 'タブをミュート',
    click: () => wc.setAudioMuted(!wc.isAudioMuted()),
  });

  // ---- 画面分割 ----
  if (multiple) {
    separator();
    if (!isActive) {
      add({ label: '右に並べて表示', click: () => tabManager.splitWith(tabId, 'row') });
      add({ label: '下に並べて表示', click: () => tabManager.splitWith(tabId, 'column') });
    }
    if (tabManager.splitTabId && (isActive || isSplitPartner)) {
      add({ label: '分割を解除', click: () => tabManager.closeSplit() });
    }
  }

  separator();
  add({ label: 'URLをコピー', click: () => clipboard.writeText(wc.getURL()) });
  if (multiple) {
    add({
      label: 'タブを新しいウィンドウに移動',
      click: () => {
        const url = wc.getURL();
        const profileId = windows.contextFor(wc)?.profileId;
        tabManager.closeTab(tabId);
        browser.createWindow({ url, profileId });
      },
    });
  }

  // ---- 閉じる ----
  separator();
  add({ label: 'タブを閉じる', click: () => tabManager.closeTab(tabId) });
  if (multiple) {
    add({
      label: '他のタブを閉じる',
      click: () => {
        for (const id of tabManager.tabs.map((t) => t.id)) {
          if (id !== tabId) tabManager.closeTab(id);
        }
      },
    });
    add({
      label: '右側のタブを閉じる',
      enabled: hasTabsToRight,
      click: () => {
        // 右側から先に閉じる(閉じるたびに配列が詰まるため、IDを控えてから処理する)
        const idsToRight = tabManager.tabs.slice(index + 1).map((t) => t.id);
        for (const id of idsToRight) tabManager.closeTab(id);
      },
    });
  }

  menu.popup();
}

module.exports = { showTabMenu };
