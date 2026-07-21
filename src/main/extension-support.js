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
    // session -> Map(extensionId -> メタデータ)。無効化するとsession.extensionsから
    // 消えて情報が引けなくなる(名前もパスも)ため、読み込まれるたびにここへ控えておく。
    // 一覧表示(無効化中も出す)と再有効化(パスが要る)の両方に使う
    this.metaBySession = new Map();
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

  _metaMapFor(session) {
    let map = this.metaBySession.get(session);
    if (!map) {
      map = new Map();
      this.metaBySession.set(session, map);
    }
    return map;
  }

  // 現在読み込まれている拡張機能のメタデータを控えておく(list/setEnabledで使う)
  _cacheMeta(session) {
    const map = this._metaMapFor(session);
    for (const e of session.extensions?.getAllExtensions() ?? []) {
      map.set(e.id, {
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.manifest?.description ?? '',
        icon: iconDataFor(e),
        path: e.path,
        permissions: [...new Set([...(e.manifest?.permissions ?? []), ...(e.manifest?.host_permissions ?? [])])],
        optionsUrl: optionsUrlFor(e),
      });
    }
    return map;
  }

  // セッションに拡張機能サポートを取り付け、保存済み拡張を読み込む。
  // disabledIds に含まれるものは一度読み込んでメタデータを控えたうえで、すぐ外す
  // (=次回起動時に有効化していないものが勝手に動き出さない)
  async attach(session, profileId, disabledIds = []) {
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

    this._cacheMeta(session);
    for (const id of disabledIds) {
      if (session.extensions?.getExtension(id)) session.extensions.removeExtension(id);
    }

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
    const ext = await installExtension(extensionId, {
      session,
      extensionsPath: this.extensionsDir(profileId),
    });
    this._cacheMeta(session);
    return ext;
  }

  // インストール済み拡張の一覧(管理画面用)。無効化中のものも(直前まで持っていた
  // メタデータのまま)出す。enabled は「今読み込まれているか」で判定する
  list(session) {
    const map = this._cacheMeta(session);
    return [...map.values()].map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      icon: m.icon,
      permissions: m.permissions,
      optionsUrl: m.optionsUrl,
      enabled: !!session.extensions?.getExtension(m.id),
    }));
  }

  // 削除せずに有効/無効を切り替える(Electron自体には「無効化」の概念が無いため、
  // 無効化は読み込み解除、有効化はディスク上のパスから読み込み直すことで実現する)
  async setEnabled(session, profileId, extensionId, enabled) {
    if (enabled) {
      if (session.extensions?.getExtension(extensionId)) return;
      const meta = this._metaMapFor(session).get(extensionId);
      if (!meta?.path) return;
      await session.extensions.loadExtension(meta.path);
      this._cacheMeta(session);
    } else if (session.extensions?.getExtension(extensionId)) {
      session.extensions.removeExtension(extensionId);
    }
  }

  async remove(session, profileId, extensionId) {
    await uninstallExtension(extensionId, { session, extensionsPath: this.extensionsDir(profileId) });
    this.metaBySession.get(session)?.delete(extensionId);
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

// MV2(options_page)/MV3(options_ui.page)どちらの形式にも対応する
function optionsUrlFor(extension) {
  const page = extension.manifest?.options_page || extension.manifest?.options_ui?.page;
  return page ? `chrome-extension://${extension.id}/${page}` : null;
}

module.exports = ExtensionSupport;
