// マウスジェスチャーの割り当て設定を管理する。
// パターンは U/D/L/R の並び(例: "DR" = 下→右)で、アクションIDに対応付ける。

// 割り当てられるアクション。categoryは設定画面のプルダウンの見出しに使う。
// scroll系はページ内で完結するのでレンダラー(gesture-preload.js)が実行し、
// それ以外はメイン(ipc.js の gestures:perform)が実行する
const ACTIONS = [
  { id: 'back', label: '戻る', category: 'ページ移動' },
  { id: 'forward', label: '進む', category: 'ページ移動' },
  { id: 'reload', label: '再読み込み', category: 'ページ移動' },
  { id: 'reloadHard', label: '再読み込み(キャッシュ無視)', category: 'ページ移動' },
  { id: 'stop', label: '読み込みを中止', category: 'ページ移動' },
  { id: 'home', label: 'スタートページを開く', category: 'ページ移動' },
  { id: 'scrollTop', label: 'ページの先頭へ', category: 'ページ移動' },
  { id: 'scrollBottom', label: 'ページの末尾へ', category: 'ページ移動' },
  { id: 'scrollPageUp', label: '1画面戻る', category: 'ページ移動' },
  { id: 'scrollPageDown', label: '1画面進む', category: 'ページ移動' },

  { id: 'newTab', label: '新しいタブ', category: 'タブ' },
  { id: 'closeTab', label: 'タブを閉じる', category: 'タブ' },
  { id: 'reopenTab', label: '閉じたタブを再度開く', category: 'タブ' },
  { id: 'duplicateTab', label: 'タブを複製', category: 'タブ' },
  { id: 'closeOtherTabs', label: '他のタブを閉じる', category: 'タブ' },
  { id: 'nextTab', label: '次のタブ', category: 'タブ' },
  { id: 'prevTab', label: '前のタブ', category: 'タブ' },
  { id: 'muteTab', label: 'タブのミュート切り替え', category: 'タブ' },
  { id: 'detachTab', label: 'タブを新しいウィンドウへ', category: 'タブ' },

  { id: 'newWindow', label: '新しいウィンドウ', category: 'ウィンドウ' },
  { id: 'incognitoWindow', label: 'シークレットウィンドウ', category: 'ウィンドウ' },
  { id: 'closeWindow', label: 'ウィンドウを閉じる', category: 'ウィンドウ' },
  { id: 'minimizeWindow', label: 'ウィンドウを最小化', category: 'ウィンドウ' },
  { id: 'toggleFullscreen', label: '全画面表示の切り替え', category: 'ウィンドウ' },

  { id: 'bookmarkPage', label: 'このページをブックマーク', category: 'ページ操作' },
  { id: 'copyUrl', label: 'URLをコピー', category: 'ページ操作' },
  { id: 'findInPage', label: 'ページ内検索', category: 'ページ操作' },
  { id: 'print', label: '印刷', category: 'ページ操作' },
  { id: 'zoomIn', label: '拡大', category: 'ページ操作' },
  { id: 'zoomOut', label: '縮小', category: 'ページ操作' },
  { id: 'zoomReset', label: 'ズームを戻す', category: 'ページ操作' },

  { id: 'toggleSidePanel', label: 'サイドパネルの表示切り替え', category: 'ブラウザ' },
  { id: 'openHistory', label: '履歴を開く', category: 'ブラウザ' },
  { id: 'openDownloads', label: 'ダウンロードを開く', category: 'ブラウザ' },
  { id: 'openBookmarks', label: 'ブックマーク管理を開く', category: 'ブラウザ' },
  { id: 'openSettings', label: '設定を開く', category: 'ブラウザ' },
];

const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));

const DEFAULT_MAPPINGS = {
  L: 'back',
  R: 'forward',
  UD: 'reload',
  DR: 'closeTab',
  D: 'newTab',
};

// パターンは最大8方向。同じ方向の連続は検出上あり得ないので弾く
const PATTERN_RE = /^(?!.*(.)\1)[UDLR]{1,8}$/;

class Gestures {
  constructor(store) {
    this.setStore(store);
  }

  static defaults() {
    return { enabled: true, mappings: { ...DEFAULT_MAPPINGS } };
  }

  // プロファイル切り替え時に保存先を差し替える
  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalize();
  }

  // 破損・旧形式のデータを補正する
  normalize() {
    const data = this.store.data;
    if (typeof data?.enabled !== 'boolean' || typeof data?.mappings !== 'object' || !data.mappings) {
      this.store.data = Gestures.defaults();
      return;
    }
    data.mappings = sanitizeMappings(data.mappings);
  }

  get data() {
    return this.store.data;
  }

  // preload/設定画面へ渡す形(アクションの表示名も含める)
  config() {
    return { ...this.data, actions: ACTIONS };
  }

  update({ enabled, mappings } = {}) {
    this.store.data = {
      enabled: !!enabled,
      mappings: sanitizeMappings(mappings ?? {}),
    };
    this.store.save();
  }

  reset() {
    this.store.data = Gestures.defaults();
    this.store.save();
  }
}

function sanitizeMappings(mappings) {
  const result = {};
  for (const [pattern, action] of Object.entries(mappings)) {
    if (PATTERN_RE.test(pattern) && ACTION_IDS.has(action)) result[pattern] = action;
  }
  return result;
}

module.exports = Gestures;
module.exports.ACTIONS = ACTIONS; // 検証用(scripts/test-gesture-actions.js)
