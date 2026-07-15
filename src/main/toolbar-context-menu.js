const { Menu, MenuItem } = require('electron');
const browser = require('./browser');

/**
 * サイドパネルの開閉ボタンを右クリックしたときのメニュー(表示する側の切り替え)。
 */
function showSidePanelPositionMenu() {
  if (!browser.settings) return;
  const current = browser.settings.data.sidePanelPosition === 'left' ? 'left' : 'right';
  const menu = new Menu();

  const setPosition = (value) => {
    if (value === browser.settings.data.sidePanelPosition) return;
    browser.settings.data.sidePanelPosition = value;
    browser.settings.save();
    browser.applySidePanelPosition();
    browser.sendSettings();
  };

  menu.append(
    new MenuItem({
      label: '右側に表示',
      type: 'radio',
      checked: current === 'right',
      click: () => setPosition('right'),
    })
  );
  menu.append(
    new MenuItem({
      label: '左側に表示',
      type: 'radio',
      checked: current === 'left',
      click: () => setPosition('left'),
    })
  );

  menu.popup();
}

module.exports = { showSidePanelPositionMenu };
