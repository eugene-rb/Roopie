// キーボードショートカット(アプリメニューのアクセラレータ)の割り当て管理。
// アプリメニューはグローバルなので、ブラウザ全体で1つ(プロファイル別ではない)。
// electron に依存しない純ロジックのみ(検証しやすく、menu.js から安全に使える)。

// 割り当て変更が可能なコマンド。ここが唯一の既定アクセラレータの定義源。
// menu.js は accelFor(id) で実効アクセラレータを引く(ラベル・click は menu.js 側)。
const COMMANDS = [
  { id: 'newTab', label: '新しいタブ', category: 'ファイル', default: 'CmdOrCtrl+T' },
  { id: 'newWindow', label: '新しいウィンドウ', category: 'ファイル', default: 'CmdOrCtrl+N' },
  { id: 'newIncognito', label: '新しいシークレットウィンドウ', category: 'ファイル', default: 'CmdOrCtrl+Shift+N' },
  { id: 'closeTab', label: 'タブを閉じる', category: 'ファイル', default: 'CmdOrCtrl+W' },
  { id: 'reopenTab', label: '閉じたタブを再度開く', category: 'ファイル', default: 'CmdOrCtrl+Shift+T' },
  { id: 'closeWindow', label: 'ウィンドウを閉じる', category: 'ファイル', default: 'CmdOrCtrl+Shift+W' },
  { id: 'print', label: '印刷', category: 'ファイル', default: 'CmdOrCtrl+P' },
  { id: 'find', label: 'ページ内を検索', category: '編集', default: 'CmdOrCtrl+F' },
  { id: 'reload', label: '再読み込み', category: '表示', default: 'CmdOrCtrl+R' },
  { id: 'back', label: '戻る', category: '表示', default: 'Alt+Left' },
  { id: 'forward', label: '進む', category: '表示', default: 'Alt+Right' },
  { id: 'zoomIn', label: '拡大', category: '表示', default: 'CmdOrCtrl+Plus' },
  { id: 'zoomOut', label: '縮小', category: '表示', default: 'CmdOrCtrl+-' },
  { id: 'zoomReset', label: '実際のサイズ', category: '表示', default: 'CmdOrCtrl+0' },
  { id: 'toggleBookmarkBar', label: 'ブックマークバーを表示', category: '表示', default: 'CmdOrCtrl+Shift+B' },
  { id: 'toggleSidePanel', label: 'サイドパネル', category: '表示', default: 'F4' }, // Vivaldiのパネルと同じ
  { id: 'toggleCompact', label: 'UIを隠す(集中モード)', category: '表示', default: 'CmdOrCtrl+Shift+H' },
  { id: 'focusAddressBar', label: 'アドレスバーにフォーカス', category: '表示', default: 'CmdOrCtrl+L' },
  { id: 'nextTab', label: '次のタブ', category: '表示', default: 'Ctrl+Tab' },
  { id: 'prevTab', label: '前のタブ', category: '表示', default: 'Ctrl+Shift+Tab' },
  { id: 'devTools', label: 'デベロッパーツール', category: '表示', default: 'F12' },
  { id: 'bookmarkPage', label: 'このページをブックマーク', category: 'ブックマーク', default: 'CmdOrCtrl+D' },
  { id: 'bookmarkManager', label: 'ブックマークマネージャ', category: 'ブックマーク', default: 'CmdOrCtrl+Shift+O' },
  { id: 'history', label: '履歴を表示', category: '履歴', default: 'CmdOrCtrl+H' },
  { id: 'downloads', label: 'ダウンロード', category: '履歴', default: 'CmdOrCtrl+J' },
  { id: 'settings', label: 'プロファイルと設定', category: 'プロファイル', default: 'CmdOrCtrl+,' },
];

const COMMAND_IDS = new Set(COMMANDS.map((c) => c.id));

// 修飾子の別名を正規化(競合比較用)。Windows前提で CmdOrCtrl 系は Ctrl に寄せる。
const MOD_ALIAS = {
  CMDORCTRL: 'CTRL', COMMANDORCONTROL: 'CTRL', COMMAND: 'CTRL', CMD: 'CTRL',
  CONTROL: 'CTRL', CTRL: 'CTRL', OPTION: 'ALT', ALT: 'ALT', ALTGR: 'ALT',
  SHIFT: 'SHIFT', SUPER: 'SUPER', META: 'SUPER',
};
const MOD_ORDER = ['CTRL', 'ALT', 'SHIFT', 'SUPER'];

// 非修飾キーとして許可するトークン(Electronのアクセラレータ表記)
const VALID_KEY =
  /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|PLUS|SPACE|TAB|BACKSPACE|DELETE|INSERT|RETURN|ENTER|UP|DOWN|LEFT|RIGHT|HOME|END|PAGEUP|PAGEDOWN|ESC|ESCAPE|[,.\/;'`\[\]\\=\-])$/;

// アクセラレータを比較用の正規形へ("Ctrl+Shift+K" と "CmdOrCtrl+shift+k" を同一視)
function normalizeAccel(accel) {
  if (!accel || typeof accel !== 'string') return '';
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = new Set();
  let key = '';
  for (const p of parts) {
    const up = p.toUpperCase();
    if (MOD_ALIAS[up]) mods.add(MOD_ALIAS[up]);
    else key = up; // 非修飾キーは最後に現れたものを採用
  }
  if (!key) return '';
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

// メニューに渡して安全か(修飾子なしの印字キーは通常入力を奪うため禁止。Fキー/Escは可)
function isValidAccelerator(accel) {
  const norm = normalizeAccel(accel);
  if (!norm) return false;
  const parts = norm.split('+');
  const key = parts[parts.length - 1];
  if (!VALID_KEY.test(key)) return false;
  const hasMod = parts.length > 1;
  const isFunctionish = /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || key === 'ESC' || key === 'ESCAPE';
  return hasMod || isFunctionish;
}

// OS標準やタブ番号など、割り当てを避ける組み合わせ
const RESERVED = new Set(
  [
    'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
    'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9',
  ].map(normalizeAccel)
);

class Keybindings {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
    this.overrides = {};
    // 未知IDの上書きは読み込み時に捨てる(コマンドを削除・改名しても壊れないように)
    for (const [id, accel] of Object.entries(store.data || {})) {
      if (COMMAND_IDS.has(id) && typeof accel === 'string') this.overrides[id] = accel;
    }
    store.data = this.overrides;
  }

  // 実効アクセラレータ(上書きがあればそれ、なければ既定)。'' は「割り当てなし」
  accelFor(id) {
    if (Object.prototype.hasOwnProperty.call(this.overrides, id)) return this.overrides[id];
    return COMMANDS.find((c) => c.id === id)?.default ?? undefined;
  }

  config() {
    return COMMANDS.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      default: c.default,
      accelerator: this.accelFor(c.id),
      isDefault: !Object.prototype.hasOwnProperty.call(this.overrides, c.id),
    }));
  }

  // 割り当てを設定する。'' は割り当てなし。競合・予約・不正は理由付きで拒否する。
  set(id, accel) {
    if (!COMMAND_IDS.has(id)) return { ok: false };
    if (accel === '') {
      this.overrides[id] = '';
      this._commit();
      return { ok: true };
    }
    if (!isValidAccelerator(accel)) return { ok: false, reason: 'invalid' };
    const target = normalizeAccel(accel);
    if (RESERVED.has(target)) return { ok: false, reason: 'reserved' };
    for (const c of COMMANDS) {
      if (c.id === id) continue;
      const eff = this.accelFor(c.id);
      if (eff && normalizeAccel(eff) === target) {
        return { ok: false, reason: 'conflict', conflict: { id: c.id, label: c.label } };
      }
    }
    this.overrides[id] = accel;
    this._commit();
    return { ok: true };
  }

  reset(id) {
    if (COMMAND_IDS.has(id)) {
      delete this.overrides[id];
      this._commit();
    }
    return { ok: true };
  }

  resetAll() {
    this.overrides = {};
    this._commit();
    return { ok: true };
  }

  _commit() {
    this.store.data = this.overrides;
    this.store.save();
    this.onChange?.();
  }
}

module.exports = { Keybindings, COMMANDS, normalizeAccel, isValidAccelerator };
