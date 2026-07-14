const path = require('path');
const { app, session: electronSession, nativeImage } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, installExtension, uninstallExtension } = require('electron-chrome-web-store');

/**
 * Chrome拡張機能サポート(electron-chrome-extensions + electron-chrome-web-store)。
 * セッション(=プロファイル)ごとに取り付ける。拡張機能はプロファイル別に
 * profiles/<id>/extensions/ へ保存される。
 *
 * ライセンス注意: electron-chrome-extensions は GPL-3.0(または有償ライセンス)。
 * 本プロジェクトを配布する場合はGPL-3.0の条件が適用される。
 */
class ExtensionSupport {
  constructor() {
    this.bySession = new Map(); // session -> ElectronChromeExtensions
    this.tabManager = null;
    this.window = null;
  }

  setBrowser({ tabManager, window }) {
    this.tabManager = tabManager;
    this.window = window;
  }

  extensionsDir(profileId) {
    return path.join(app.getPath('userData'), 'profiles', profileId, 'extensions');
  }

  findTab(wc) {
    return this.tabManager?.tabs.find((t) => t.view.webContents === wc) ?? null;
  }

  // セッションに拡張機能サポートを取り付け、保存済み拡張を読み込む
  async attach(session, profileId) {
    if (this.bySession.has(session)) return;

    // crx://<id>/... のアイコン配信(ツールバーの <browser-action-list> 用)。
    // アイコンURLは ?partition= で対象セッションを自前解決するため、
    // <browser-action-list> を表示するメインUI(デフォルトセッション)側への登録が必須
    ElectronChromeExtensions.handleCRXProtocol(session);
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession);

    const extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session,
      createTab: async (details) => {
        const tab = this.tabManager.createTab(details.url || undefined);
        return [tab.view.webContents, this.window];
      },
      selectTab: (wc) => {
        const tab = this.findTab(wc);
        if (tab) this.tabManager.switchTab(tab.id);
      },
      removeTab: (wc) => {
        const tab = this.findTab(wc);
        if (tab) this.tabManager.closeTab(tab.id);
      },
    });
    this.bySession.set(session, extensions);

    // Chromeウェブストアからのインストールを有効化(保存済み拡張の読み込みも行われる)
    await installChromeWebStore({
      session,
      extensionsPath: this.extensionsDir(profileId),
    });

    // 取り付け完了前に開かれたタブも拡張機能システムへ登録する
    for (const tab of this.tabManager?.tabs ?? []) {
      if (tab.view.webContents.session === session) this.addTab(tab.view.webContents);
    }
  }

  // タブ作成時に呼ぶ(chrome.tabs APIで見えるようにする)
  addTab(wc) {
    this.bySession.get(wc.session)?.addTab(wc, this.window);
  }

  // アクティブタブの変更を通知する
  selectTab(wc) {
    this.bySession.get(wc.session)?.selectTab(wc);
  }

  // ウェブストアの拡張IDを指定してインストールする
  async install(session, profileId, extensionId) {
    await this.attach(session, profileId);
    return installExtension(extensionId, {
      session,
      extensionsPath: this.extensionsDir(profileId),
    });
  }

  // インストール済み拡張の一覧(管理画面用)。
  // アイコンは chrome-extension:// だと web_accessible_resources 制限で
  // 通常ページから読めないため、ファイルから読んでdata URIにして渡す
  list(session) {
    return (session.extensions?.getAllExtensions() ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      description: e.manifest?.description ?? '',
      icon: iconDataFor(e),
    }));
  }

  async remove(session, profileId, extensionId) {
    await uninstallExtension(extensionId, { session, extensionsPath: this.extensionsDir(profileId) });
  }
}

// manifestのicons定義から一番大きいものを選び、64pxのdata URIにする
function iconDataFor(extension) {
  const icons = extension.manifest?.icons;
  if (!icons || typeof icons !== 'object') return null;
  const sizes = Object.keys(icons)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => b - a);
  const largest = sizes[0];
  const iconPath = largest ? icons[largest] : Object.values(icons)[0];
  if (!iconPath) return null;
  try {
    const image = nativeImage.createFromPath(path.join(extension.path, iconPath));
    if (image.isEmpty()) return null;
    return (image.getSize().width > 64 ? image.resize({ width: 64 }) : image).toDataURL();
  } catch {
    return null;
  }
}

module.exports = ExtensionSupport;
