const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { app, session: electronSession, nativeImage, BrowserWindow } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, installExtension, uninstallExtension } = require('electron-chrome-web-store');

// ウェブストアを介さない(=フォルダから読み込んだ)拡張機能の置き場所につける印。
// ストアの拡張機能は必ずID(a〜pの32文字)のフォルダに入るので、これで確実に区別できる
const LOCAL_DIR_PREFIX = 'local-';
// 読み込み元フォルダの控え(extensions/ 直下。manifest.jsonが無いのでスキャンには拾われない)
const LOCAL_INDEX_FILE = '.roopie-local.json';

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
    // session -> attach中のPromise。取り付けは非同期(ディスクからの読み込み)なので、
    // 2つ目以降のウィンドウや install() も「読み込み完了」まで待てるようにする
    this.attaching = new Map();
    // session -> Map(extensionId -> メタデータ)。無効化するとsession.extensionsから
    // 消えて情報が引けなくなる(名前もパスも)ため、読み込まれるたびにここへ控えておく。
    // 一覧表示(無効化中も出す)と再有効化(パスが要る)の両方に使う
    this.metaBySession = new Map();
    // session -> profileId。フォルダから読み込んだ拡張機能かどうかは置き場所で判定するため、
    // 一覧を作るときにもプロファイルの extensions/ の場所が要る
    this.profileBySession = new Map();
    // 開いているウィンドウ(1つのExtensionSupportを全ウィンドウで共有するため、
    // 「最後に作られたウィンドウ」1つだけを覚えていると、後から作ったタブが別ウィンドウの
    // ものとして拡張機能システムに登録されてしまい、ツールバーのアイコンが
    // 別ウィンドウのタブの状態(アイコン/バッジ)を映してしまう)
    this.contexts = new Set(); // { tabManager, window }
    // 別ウィンドウへ移動中のタブ。electron-chrome-extensions の removeTab は
    // こちらの removeTab 実装(= タブを閉じる)を呼び返すため、移動中だけ閉じないようにする
    this.movingTabs = new Set();
  }

  setBrowser({ tabManager, window }) {
    const entry = { tabManager, window };
    this.contexts.add(entry);
    window.on('closed', () => this.contexts.delete(entry));
  }

  liveContexts() {
    return [...this.contexts].filter((c) => !c.window.isDestroyed());
  }

  // このwebContents(タブ)を持っているウィンドウ
  contextForTab(wc) {
    return this.liveContexts().find((c) => c.tabManager.tabs.some((t) => t.view.webContents === wc)) ?? null;
  }

  // 拡張機能からの新規タブ作成先。指定が無ければフォーカス中(なければ最後に作られた)ウィンドウ
  contextForWindowId(windowId) {
    const live = this.liveContexts();
    const byId = typeof windowId === 'number' ? live.find((c) => c.window.id === windowId) : null;
    if (byId) return byId;
    const focused = BrowserWindow.getFocusedWindow();
    return live.find((c) => c.window === focused) ?? live[live.length - 1] ?? null;
  }

  extensionsDir(profileId) {
    return path.join(app.getPath('userData'), 'profiles', profileId, 'extensions');
  }

  // タブとその持ち主のウィンドウをまとめて引く(ウィンドウをまたいで探す)
  findTab(wc) {
    const ctx = this.contextForTab(wc);
    if (!ctx) return null;
    const tab = ctx.tabManager.tabs.find((t) => t.view.webContents === wc);
    return tab ? { tab, tabManager: ctx.tabManager, window: ctx.window } : null;
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
    const profileId = this.profileBySession.get(session);
    const sources = profileId ? this._localIndex(profileId) : {};
    for (const e of session.extensions?.getAllExtensions() ?? []) {
      const localDir = profileId ? this._localDirNameOf(profileId, e.path) : null;
      map.set(e.id, {
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.manifest?.description ?? '',
        icon: iconDataFor(e),
        path: e.path,
        permissions: [...new Set([...(e.manifest?.permissions ?? []), ...(e.manifest?.host_permissions ?? [])])],
        optionsUrl: optionsUrlFor(e),
        localDir,
        source: localDir ? sources[localDir] ?? null : null,
      });
    }
    return map;
  }

  // 読み込み元フォルダの控え(フォルダ名 -> 元のパス)
  _localIndex(profileId) {
    try {
      const json = fs.readFileSync(path.join(this.extensionsDir(profileId), LOCAL_INDEX_FILE), 'utf8');
      const data = JSON.parse(json);
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  _saveLocalIndex(profileId, index) {
    try {
      fs.writeFileSync(
        path.join(this.extensionsDir(profileId), LOCAL_INDEX_FILE),
        JSON.stringify(index, null, 2)
      );
    } catch (err) {
      console.error('拡張機能の読み込み元の記録に失敗:', err);
    }
  }

  // その拡張機能が「フォルダから読み込んだもの」なら extensions/ 直下のフォルダ名を返す
  _localDirNameOf(profileId, extPath) {
    if (!extPath) return null;
    const root = this.extensionsDir(profileId);
    const rel = path.relative(root, extPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const [first] = rel.split(path.sep);
    return first.startsWith(LOCAL_DIR_PREFIX) ? first : null;
  }

  // 読み込み + MV3のバックグラウンド(service worker)の起動。
  // loadExtension だけでは chrome.runtime.onInstalled などが走らないまま
  // 一覧には出るのに何もしない状態になりうる
  async _load(session, dir) {
    const ext = await session.extensions.loadExtension(dir);
    if (ext?.manifest?.manifest_version === 3 && ext.manifest.background?.service_worker) {
      await startWorker(session, ext.id);
    }
    return ext;
  }

  // セッションに拡張機能サポートを取り付け、保存済み拡張を読み込む。
  // disabledIds に含まれるものは一度読み込んでメタデータを控えたうえで、すぐ外す
  // (=次回起動時に有効化していないものが勝手に動き出さない)
  attach(session, profileId, disabledIds = []) {
    const pending = this.attaching.get(session);
    if (pending) return pending; // 取り付け中: 完了を共有する(空の一覧のまま先へ進ませない)
    if (this.bySession.has(session)) return Promise.resolve();
    const task = this._attach(session, profileId, disabledIds).finally(() => this.attaching.delete(session));
    this.attaching.set(session, task);
    return task;
  }

  async _attach(session, profileId, disabledIds) {
    this.profileBySession.set(session, profileId);
    // crx://<id>/... のアイコン配信(ツールバーの <browser-action-list> 用)。
    // アイコンURLは ?partition= で対象セッションを自前解決するため、
    // <browser-action-list> を表示するメインUI(デフォルトセッション)側への登録が必須
    ElectronChromeExtensions.handleCRXProtocol(session);
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession);

    const extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session,
      createTab: async (details) => {
        const target = this.contextForWindowId(details.windowId);
        if (!target) throw new Error('タブを開けるウィンドウがありません');
        const tab = target.tabManager.createTab(details.url || undefined);
        return [tab.view.webContents, target.window];
      },
      selectTab: (wc) => {
        const found = this.findTab(wc);
        if (found) found.tabManager.switchTab(found.tab.id);
      },
      removeTab: (wc) => {
        if (this.movingTabs.has(wc)) return; // 別ウィンドウへの移動に伴う登録解除(閉じてはいけない)
        const found = this.findTab(wc);
        if (found) found.tabManager.closeTab(found.tab.id);
      },
    });
    this.bySession.set(session, extensions);

    // Chromeウェブストアからのインストールを有効化(保存済み拡張の読み込みも行われる)。
    // allowUnpackedExtensions はウェブストア以外(=フォルダから読み込んだもの)を読み込むのに必須。
    // ストアの拡張機能は manifest に key が入っているのでこのフラグでは扱いが変わらない
    await installChromeWebStore({
      session,
      extensionsPath: this.extensionsDir(profileId),
      allowUnpackedExtensions: true,
    });

    this._cacheMeta(session);
    for (const id of disabledIds) {
      if (session.extensions?.getExtension(id)) session.extensions.removeExtension(id);
    }

    // 起動時の一括読み込み(installChromeWebStore)はservice workerの登録が済む前に
    // 起こそうとして失敗するので、ここで起こし直す。待つと起動が遅くなるのでawaitしない
    for (const e of session.extensions?.getAllExtensions() ?? []) {
      if (e.manifest?.manifest_version === 3 && e.manifest.background?.service_worker) {
        startWorker(session, e.id);
      }
    }

    // 取り付け完了前に開かれたタブも拡張機能システムへ登録する(全ウィンドウ分)
    for (const ctx of this.liveContexts()) {
      for (const tab of ctx.tabManager.tabs) {
        if (tab.view.webContents.session === session) this.addTab(tab.view.webContents);
      }
    }
  }

  // タブ作成時に呼ぶ(chrome.tabs APIで見えるようにする)。
  // 「どのウィンドウのタブか」を間違えると、そのウィンドウのアクティブタブが
  // 追跡できなくなり、ツールバーのアイコンが別タブの状態を映してしまう
  addTab(wc) {
    const ctx = this.contextForTab(wc);
    if (!ctx) return;
    this.bySession.get(wc.session)?.addTab(wc, ctx.window);
  }

  // タブが別ウィンドウへ移ったときに呼ぶ。addTab は登録済みのタブだと何もしないため、
  // 一度外してから付け直さないと「どのウィンドウのタブか」が古いままになり、
  // ツールバーのアイコンが別ウィンドウのタブの状態を映してしまう
  moveTab(wc) {
    const extensions = this.bySession.get(wc.session);
    const ctx = this.contextForTab(wc);
    if (!extensions || !ctx) return;
    this.movingTabs.add(wc);
    try {
      extensions.removeTab(wc);
      extensions.addTab(wc, ctx.window);
    } finally {
      this.movingTabs.delete(wc);
    }
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

  // ウェブストアを介さない拡張機能(展開済みのフォルダ)を読み込む。
  // 元フォルダを消したり移動したりしても壊れないよう、プロファイルの extensions/ 配下へ
  // コピーしてから読み込む(次回起動時は _attach の一括読み込みがそのまま拾う)。
  // 同じフォルダをもう一度読み込むと入れ替わる(=更新)
  async loadUnpacked(session, profileId, sourceDir) {
    await this.attach(session, profileId);
    const manifest = await readManifest(sourceDir);
    const dirName = localDirNameFor(manifest.name, sourceDir);
    const dest = path.join(this.extensionsDir(profileId), dirName);

    // 入れ直し: 読み込んだままのフォルダは消せないので、先に読み込みを解除する
    const previous = [...this._metaMapFor(session).values()].find((m) => m.localDir === dirName);
    if (previous && session.extensions?.getExtension(previous.id)) {
      session.extensions.removeExtension(previous.id);
    }
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    // コピーの途中で失敗した残骸を置いていくと、次の起動から毎回読み込みに失敗する
    // (一覧にも出ないので消す手立てが無くなる)。コピーも含めて後始末する
    let ext;
    try {
      await fsp.cp(sourceDir, dest, { recursive: true });
      ext = await this._load(session, dest);
    } catch (err) {
      await fsp.rm(dest, { recursive: true, force: true });
      throw err;
    }
    this._saveLocalIndex(profileId, { ...this._localIndex(profileId), [dirName]: sourceDir });
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
      unpacked: !!m.localDir,
      source: m.source,
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
      await this._load(session, meta.path);
      this._cacheMeta(session);
    } else if (session.extensions?.getExtension(extensionId)) {
      session.extensions.removeExtension(extensionId);
    }
  }

  async remove(session, profileId, extensionId) {
    // フォルダから読み込んだものは uninstallExtension(extensions/<ID>/ を消す)では消えない
    const localDir = this._metaMapFor(session).get(extensionId)?.localDir;
    if (localDir) {
      if (session.extensions?.getExtension(extensionId)) session.extensions.removeExtension(extensionId);
      await fsp.rm(path.join(this.extensionsDir(profileId), localDir), { recursive: true, force: true });
      const index = this._localIndex(profileId);
      delete index[localDir];
      this._saveLocalIndex(profileId, index);
    } else {
      await uninstallExtension(extensionId, { session, extensionsPath: this.extensionsDir(profileId) });
    }
    this.metaBySession.get(session)?.delete(extensionId);
  }
}

// MV3のバックグラウンドを起こす。読み込んだ直後はservice workerの登録がまだ済んでおらず
// 1回目は必ず失敗するので、少し待ってやり直す(Chromium側でも遅れて自動起動するため、
// 最後まで失敗しても致命傷ではない)
async function startWorker(session, id, attempts = 5) {
  const scope = `chrome-extension://${id}`;
  for (let i = 0; i < attempts; i++) {
    try {
      await session.serviceWorkers.startWorkerForScope(scope);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  console.error(`拡張機能 ${id} のバックグラウンドを起動できませんでした`);
  return false;
}

// 読み込む前に manifest.json を確かめる(コピーしてから失敗するより、先に理由を返す)
async function readManifest(dir) {
  let json;
  try {
    json = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8');
  } catch {
    throw new Error('選んだフォルダに manifest.json がありません(拡張機能のフォルダを選んでください)');
  }
  let manifest;
  try {
    manifest = JSON.parse(json);
  } catch {
    throw new Error('manifest.json を読めませんでした(JSONの形式が正しくありません)');
  }
  if (!manifest?.name || !manifest.version) {
    throw new Error('manifest.json に name か version がありません');
  }
  return manifest;
}

// コピー先のフォルダ名。同じ名前の別フォルダが衝突しないよう元パスのハッシュを付ける。
// 逆に同じフォルダを読み込み直したときは同じ名前になり、拡張機能IDも変わらない
// (=ピン留めや有効/無効の設定が引き継がれる)
function localDirNameFor(name, sourceDir) {
  const slug =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'extension';
  const hash = crypto
    .createHash('sha256')
    .update(path.resolve(sourceDir).toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `${LOCAL_DIR_PREFIX}${slug}-${hash}`;
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
