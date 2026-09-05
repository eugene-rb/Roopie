/**
 * Chrome拡張機能向け chrome.commands API のメインプロセス側実装。
 *
 * electron-chrome-extensions は commands.* をほぼ実装していない
 * (README の対応表でも commands.getAll / commands.onCommand の両方が未実装)。
 * ライブラリの CommandsAPI は commands.getAll に対して shortcut:"" を返すだけで、
 * キー入力の監視も onCommand の発火もしないため、DarkReader の Alt+Shift+D
 * (拡張のオン/オフ)のような拡張機能のショートカットキーが一切効かない。
 *
 * ここではタブ(ページ)の webContents の before-input-event を監視し、
 * 読み込み済み拡張の manifest.commands の suggested_key と突き合わせて、
 *   - _execute_action / _execute_browser_action / _execute_page_action
 *       → ツールバーのポップアップを開く(browserAction のクリックと同じ経路)
 *   - それ以外の名前付きコマンド
 *       → ctx.router.sendEvent(extId, 'commands.onCommand', name, tab) で
 *         拡張のバックグラウンドへ配送する
 * を行う。node_modules には手を入れず、ElectronChromeExtensions インスタンスの
 * 公開プロパティ(api / ctx)経由で実装する(extension-downloads.js と同じ方針)。
 *
 * 有効範囲はページ(タブ)にフォーカスがあるときのみ。Roopie 自身の chrome
 * (アドレスバー等)にフォーカスがあるときは対象外。
 */
const { normalizeAccel } = require('./keybindings');

// KeyboardEvent.code(物理キー)→ Electron アクセラレータ表記のキートークン。
// Chrome は suggested_key を文字ではなく物理キーで照合する。Alt 併用時は
// input.key がレイアウト依存で当てにならないため code を基準にする。
const CODE_TO_KEY = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Esc',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
  Minus: '-', Equal: '=',
};

// before-input-event の input からアクセラレータの正規形を作る。
// 修飾キーのみ・非対応キーのときは null。
function accelFromInput(input) {
  if (!input || input.type !== 'keyDown') return null;
  const code = input.code || '';
  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^(?:Digit|Numpad)([0-9])$/.exec(code))) key = m[1];
  else if ((m = /^(F[1-9]|F1[0-9]|F2[0-4])$/.exec(code))) key = m[1];
  else if (CODE_TO_KEY[code]) key = CODE_TO_KEY[code];
  else if (input.key && input.key.length === 1 && input.key !== ' ') key = input.key.toUpperCase();
  if (!key) return null;

  const parts = [];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Super');
  parts.push(key);
  return normalizeAccel(parts.join('+'));
}

// manifest の suggested_key(Windows 優先 → default)を取り出して正規化する。
// Chrome の修飾子表記(Ctrl/Alt/Shift/Command/MacCtrl/Search)のうち Windows で
// 使えるのは Ctrl/Alt/Shift のみ。MacCtrl/Command/Search は Ctrl/Super に寄せる。
function accelFromSuggestedKey(suggested) {
  const raw = suggested?.windows || suggested?.default;
  if (!raw || typeof raw !== 'string') return null;
  const mapped = raw
    .split('+')
    .map((p) => p.trim())
    .map((p) => (/^MacCtrl$/i.test(p) ? 'Ctrl' : /^Command$/i.test(p) ? 'Super' : /^Search$/i.test(p) ? 'Super' : p))
    .join('+');
  return normalizeAccel(mapped) || null;
}

const EXECUTE_ACTION_NAMES = new Set([
  '_execute_action',
  '_execute_browser_action',
  '_execute_page_action',
]);

class ExtensionCommandsAPI {
  /**
   * @param {Electron.Session} session
   * @param {ElectronChromeExtensions} extensions electron-chrome-extensions のインスタンス
   */
  constructor(session, extensions) {
    this.session = session;
    this.extensions = extensions;
    this.ctx = extensions.ctx;
    // accel(正規形) -> { extensionId, name }。同じキーが複数拡張にあるときは先勝ち。
    this.table = new Map();
    // extensionId -> [{ name, description, accel }](commands.getAll 用)
    this.byExtension = new Map();
    // before-input-event を張り済みの webContents(二重登録防止)
    this.attached = new WeakSet();

    const sessionExtensions = session.extensions || session;
    this._onLoaded = () => this.rebuild();
    this._onUnloaded = () => this.rebuild();
    sessionExtensions.on('extension-loaded', this._onLoaded);
    sessionExtensions.on('extension-unloaded', this._onUnloaded);

    // ライブラリの CommandsAPI が登録した commands.getAll を上書きし、
    // 実際に効いているショートカットを返す(拡張ポップアップの Hotkeys 表示が空にならない)。
    this.ctx.router.handle('commands.getAll', ({ extension }) => this.getAllFor(extension?.id));

    this.rebuild();
  }

  // 読み込み済み拡張の manifest.commands からキー表を作り直す
  rebuild() {
    const sessionExtensions = this.session.extensions || this.session;
    const all = sessionExtensions.getAllExtensions?.() ?? [];
    this.table.clear();
    this.byExtension.clear();
    for (const ext of all) {
      const commands = ext.manifest?.commands;
      if (!commands || typeof commands !== 'object') continue;
      const list = [];
      for (const [name, details] of Object.entries(commands)) {
        const accel = accelFromSuggestedKey(details?.suggested_key);
        list.push({ name, description: details?.description ?? '', accel });
        if (accel && !this.table.has(accel)) {
          this.table.set(accel, { extensionId: ext.id, name });
        }
      }
      this.byExtension.set(ext.id, list);
    }
  }

  // commands.getAll の応答(shortcut は実効アクセラレータ、無ければ "")
  getAllFor(extensionId) {
    const list = this.byExtension?.get(extensionId) ?? [];
    return list.map((c) => ({
      name: c.name,
      description: c.description,
      shortcut: c.accel ? accelToChrome(c.accel) : '',
    }));
  }

  // タブの webContents にキー監視を張る(ExtensionSupport.addTab から呼ぶ)
  attachTab(wc) {
    if (!wc || wc.isDestroyed() || this.attached.has(wc)) return;
    this.attached.add(wc);
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      if (this.table.size === 0) return;
      const accel = accelFromInput(input);
      if (!accel) return;
      const hit = this.table.get(accel);
      if (!hit) return; // 一致しないキーはページへ素通し
      event.preventDefault();
      this.dispatch(hit.extensionId, hit.name, wc);
    });
  }

  async dispatch(extensionId, name, wc) {
    try {
      if (EXECUTE_ACTION_NAMES.has(name)) {
        this.openPopup(extensionId, wc);
        return;
      }
      await this.sendCommand(extensionId, name, wc);
    } catch (err) {
      console.error(`拡張機能コマンド ${extensionId}/${name} の実行に失敗:`, err);
    }
  }

  // _execute_action 系: ツールバーのポップアップを開く(browserAction クリックと同じ)
  openPopup(extensionId, wc) {
    const browserAction = this.extensions.api?.browserAction;
    if (!browserAction?.activateClick || wc.isDestroyed()) return;
    const win = this.ctx.store.tabToWindow?.get(wc);
    const width = win && !win.isDestroyed() ? win.getSize()[0] : 1280;
    const anchor = 64;
    browserAction.activateClick({
      eventType: 'click',
      extensionId,
      tabId: wc.id,
      anchorRect: { x: width - anchor, y: 0, width: anchor, height: anchor },
    });
  }

  // 名前付きコマンド: 拡張のバックグラウンドへ commands.onCommand を配送する。
  // バックグラウンド(SW)がまだ onCommand.addListener を済ませていないと
  // router に listener が無く sendEvent が空振りするため、起動を待って一度だけ再試行する。
  async sendCommand(extensionId, name, wc) {
    const tab = this.ctx.store.tabDetailsCache?.get(wc.id);
    const router = this.ctx.router;
    const hasListener = () =>
      (router.listeners?.get?.('commands.onCommand') ?? []).some((l) => l.extensionId === extensionId);

    if (!hasListener()) {
      const scope = `chrome-extension://${extensionId}/`;
      try {
        await this.session.serviceWorkers.startWorkerForScope(scope);
      } catch {
        /* 既に起動済みなら例外になることがある。listener の有無で判断する */
      }
      for (let i = 0; i < 10 && !hasListener(); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    router.sendEvent(extensionId, 'commands.onCommand', name, tab);
  }

  destroy() {
    const sessionExtensions = this.session.extensions || this.session;
    sessionExtensions.removeListener?.('extension-loaded', this._onLoaded);
    sessionExtensions.removeListener?.('extension-unloaded', this._onUnloaded);
  }
}

// 正規形(CTRL+ALT+SHIFT+KEY)を Chrome の getAll が返す表記(Ctrl+Shift+D 等)へ。
// 表示専用。Chrome は Mac 以外では "Ctrl" "Alt" "Shift" 表記。
function accelToChrome(accel) {
  return accel
    .split('+')
    .map((p) => {
      if (p === 'CTRL') return 'Ctrl';
      if (p === 'ALT') return 'Alt';
      if (p === 'SHIFT') return 'Shift';
      if (p === 'SUPER') return 'Search';
      return p;
    })
    .join('+');
}

module.exports = ExtensionCommandsAPI;
module.exports.accelFromInput = accelFromInput;
module.exports.accelFromSuggestedKey = accelFromSuggestedKey;
