const { Menu, MenuItem, clipboard } = require('electron');
const browser = require('./browser');
const windows = require('./windows');
const { GROUP_COLORS } = require('./tab-groups');

const COLOR_LABELS = {
  blue: '青',
  red: '赤',
  yellow: '黄',
  green: '緑',
  pink: 'ピンク',
  purple: '紫',
  cyan: '水色',
  orange: 'オレンジ',
  grey: 'グレー',
};

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

  // ---- タブグループ ----
  separator();
  const group = tab.groupId != null ? tabManager.getGroup(tab.groupId) : null;
  const otherGroups = tabManager.groups.filter((g) => g.id !== tab.groupId);
  const groupItems = [
    { label: '新しいグループを作成', click: () => startGroupRename(tabManager, tabManager.createGroup([tabId])) },
  ];
  if (otherGroups.length) {
    groupItems.push({ type: 'separator' });
    for (const g of otherGroups) {
      groupItems.push({ label: g.name, click: () => tabManager.addToGroup(g.id, [tabId]) });
    }
  }
  add({ label: 'タブをグループに追加', submenu: groupItems });
  if (group) {
    add({ label: `グループ「${group.name}」から外す`, click: () => tabManager.removeFromGroup([tabId]) });
  }
  add({
    label: 'ドメインごとに自動でグループ化',
    // 同じドメインが2タブ以上あるときだけまとめる(1件だけのグループは作らない)
    enabled: tabManager.tabs.filter((t) => t.groupId == null).length > 1,
    click: () => tabManager.groupByDomain(),
  });

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

// 作った直後のグループは名前をその場で入れられるようにする
// (メインプロセス側にテキスト入力の手段が無いので、タブバー側のインライン編集を呼ぶ)
function startGroupRename(tabManager, group) {
  if (!group || tabManager.window.isDestroyed()) return;
  tabManager.window.webContents.send('tab-group:rename-request', group.id);
}

/**
 * 1段目のグループチップでの右クリックメニュー。
 */
function showTabGroupMenu(tabManager, groupId) {
  const group = tabManager.getGroup(groupId);
  if (!group) return;

  const menu = new Menu();
  const add = (options) => menu.append(new MenuItem(options));

  add({ label: 'このグループに新しいタブ', click: () => tabManager.createTab(undefined, { groupId }) });
  add({ label: '名前を変更', click: () => startGroupRename(tabManager, group) });
  add({
    label: '色',
    submenu: GROUP_COLORS.map((color) => ({
      label: COLOR_LABELS[color] ?? color,
      type: 'checkbox',
      checked: group.color === color,
      click: () => tabManager.setGroupColor(groupId, color),
    })),
  });
  add({ type: 'separator' });
  add({ label: 'グループを解除', click: () => tabManager.ungroup(groupId) });
  add({ label: 'グループのタブをすべて閉じる', click: () => tabManager.closeGroup(groupId) });

  menu.popup();
}

module.exports = { showTabMenu, showTabGroupMenu };
