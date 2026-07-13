// マウスジェスチャーの割り当て設定を管理する。
// パターンは U/D/L/R の並び(例: "DR" = 下→右)で、アクションIDに対応付ける。

const ACTIONS = [
  { id: 'back', label: '戻る' },
  { id: 'forward', label: '進む' },
  { id: 'reload', label: '再読み込み' },
  { id: 'closeTab', label: 'タブを閉じる' },
  { id: 'newTab', label: '新しいタブ' },
  { id: 'nextTab', label: '次のタブ' },
  { id: 'prevTab', label: '前のタブ' },
  { id: 'scrollTop', label: 'ページの先頭へ' },
  { id: 'scrollBottom', label: 'ページの末尾へ' },
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
