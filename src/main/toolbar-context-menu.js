const { Menu, MenuItem } = require('electron');
const browser = require('./browser');
const { TOOLBAR_ITEMS, normalizeToolbarItems } = require('./toolbar-items');

// ウィンドウのプロファイルの設定を引く(Edge挙動: ウィンドウごとにプロファイルが異なる)
function bundleOf(ctx) {
  return browser.bundleFor(ctx?.profileId ?? browser.profiles?.activeId);
}

function setSidePanelPosition(bundle, value) {
  if (!bundle || value === bundle.settings.data.sidePanelPosition) return;
  bundle.settings.data.sidePanelPosition = value;
  bundle.settings.save();
  browser.applySidePanelPositionFor(bundle.profileId);
  browser.sendSettingsFor(bundle.profileId);
}

function addPositionItems(menu, bundle) {
  if (!bundle) return;
  const current = bundle.settings.data.sidePanelPosition === 'left' ? 'left' : 'right';
  menu.append(
    new MenuItem({
      label: '右側に表示',
      type: 'radio',
      checked: current === 'right',
      click: () => setSidePanelPosition(bundle, 'right'),
    })
  );
  menu.append(
    new MenuItem({
      label: '左側に表示',
      type: 'radio',
      checked: current === 'left',
      click: () => setSidePanelPosition(bundle, 'left'),
    })
  );
}

/**
 * サイドパネルの開閉ボタン(非表示中だけツールバーに出る)を右クリックしたときのメニュー。
 */
function showSidePanelPositionMenu(ctx) {
  const bundle = bundleOf(ctx);
  if (!bundle) return;
  const menu = new Menu();
  addPositionItems(menu, bundle);
  menu.popup();
}

/**
 * サイドバー(アイコンレール)の何もない部分を右クリックしたときのメニュー。
 * 左右の切り替えに加えて、Webパネルの追加・サイドバー自体の非表示を行える。
 */
function showSidePanelRailMenu(ctx) {
  const bundle = bundleOf(ctx);
  const panel = ctx?.sidePanel;
  if (!bundle || !panel) return;
  const menu = new Menu();
  addPositionItems(menu, bundle);
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: 'ウェブパネルを追加...', click: () => panel.promptAddWeb() }));
  menu.append(new MenuItem({ label: 'サイドバーを非表示', click: () => panel.hide() }));
  menu.popup();
}

/**
 * Webパネルのアイコン(レールのピン留め)を右クリックしたときのメニュー。
 * 追加・削除・編集はすべてこのメニュー(+レール右クリック/「+」)から行う(管理画面は無い)。
 * 名前・アイコン・URLの変更はパネルUIのモーダルへ、削除はその場で実行する。
 */
function showWebPanelMenu(panel, id) {
  if (!panel || !panel.webPanels.find((p) => p.id === id)) return;
  const menu = new Menu();
  menu.append(new MenuItem({ label: '名前を変更...', click: () => panel.editWeb(id, 'name') }));
  menu.append(new MenuItem({ label: 'アイコンを変更...', click: () => panel.editWeb(id, 'icon') }));
  menu.append(new MenuItem({ label: 'URLを変更...', click: () => panel.editWeb(id, 'url') }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: 'ウェブパネルを追加...', click: () => panel.promptAddWeb() }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: '削除', click: () => panel.removeWeb(id) }));
  menu.popup();
}

/**
 * ツールバーのユーティリティ群を右クリックしたときのメニュー。
 * 各項目の表示/非表示をチェックボックスで切り替え、設定画面(並び替え)へも誘導する。
 */
function showToolbarMenu(ctx) {
  const bundle = bundleOf(ctx);
  if (!bundle) return;
  const items = normalizeToolbarItems(bundle.settings.data.toolbarItems);
  const visibleById = new Map(items.map((it) => [it.id, it.visible]));
  const menu = new Menu();
  for (const { id, label } of TOOLBAR_ITEMS) {
    menu.append(
      new MenuItem({
        label,
        type: 'checkbox',
        checked: visibleById.get(id) !== false,
        click: () => {
          const next = items.map((it) => (it.id === id ? { ...it, visible: !it.visible } : it));
          bundle.settings.data.toolbarItems = next;
          bundle.settings.save();
          browser.sendSettingsFor(bundle.profileId);
        },
      })
    );
  }
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(
    new MenuItem({
      label: 'ツールバーをカスタマイズ...',
      click: () => ctx?.tabManager.createTab('roopie://settings'),
    })
  );
  menu.popup();
}

module.exports = { showSidePanelPositionMenu, showSidePanelRailMenu, showToolbarMenu, showWebPanelMenu };
