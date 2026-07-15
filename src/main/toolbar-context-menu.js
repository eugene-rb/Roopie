const { Menu, MenuItem } = require('electron');
const browser = require('./browser');

function setSidePanelPosition(value) {
  if (!browser.settings || value === browser.settings.data.sidePanelPosition) return;
  browser.settings.data.sidePanelPosition = value;
  browser.settings.save();
  browser.applySidePanelPosition();
  browser.sendSettings();
}

function addPositionItems(menu) {
  if (!browser.settings) return;
  const current = browser.settings.data.sidePanelPosition === 'left' ? 'left' : 'right';
  menu.append(
    new MenuItem({
      label: '右側に表示',
      type: 'radio',
      checked: current === 'right',
      click: () => setSidePanelPosition('right'),
    })
  );
  menu.append(
    new MenuItem({
      label: '左側に表示',
      type: 'radio',
      checked: current === 'left',
      click: () => setSidePanelPosition('left'),
    })
  );
}

/**
 * サイドパネルの開閉ボタン(非表示中だけツールバーに出る)を右クリックしたときのメニュー。
 */
function showSidePanelPositionMenu() {
  if (!browser.settings) return;
  const menu = new Menu();
  addPositionItems(menu);
  menu.popup();
}

/**
 * サイドバー(アイコンレール)の何もない部分を右クリックしたときのメニュー。
 * 左右の切り替えに加えて、Webパネルの追加・サイドバー自体の非表示を行える。
 */
function showSidePanelRailMenu(panel) {
  if (!browser.settings || !panel) return;
  const menu = new Menu();
  addPositionItems(menu);
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append({ label: 'アイコンを追加...', click: () => panel.openSection('web') });
  menu.append({ label: 'サイドバーを非表示', click: () => panel.hide() });
  menu.popup();
}

module.exports = { showSidePanelPositionMenu, showSidePanelRailMenu };
