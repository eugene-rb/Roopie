// ツールバーで表示/非表示・並び替えができる項目(ユーティリティ群)。
// 戻る/進む/再読み込み/アドレスバー/拡張機能/設定は固定(Chrome/Edgeと同様)。
// サイドパネルボタン(状態で自動表示)・画面分割コントロール(分割中のみ)は対象外。
const TOOLBAR_ITEMS = [
  { id: 'downloads', label: 'ダウンロード' },
  { id: 'history', label: '履歴' },
  { id: 'qr', label: 'QRコード' },
  { id: 'zoom', label: 'ズーム' },
];

const IDS = TOOLBAR_ITEMS.map((it) => it.id);

function defaultToolbarItems() {
  return IDS.map((id) => ({ id, visible: true }));
}

// 保存値を正規化する。全ての利用側(renderer適用 / ネイティブメニュー / 設定画面)は
// メインが正規化した値を受け取るため、判断がずれない。
//  (a) 配列でない/空なら既定順を返す
//  (b) 未知IDは除去、重複は除去
//  (c) 欠けている既定IDは既定の並び順の位置に補完する
//      → 将来 configurable な項目を増やしても既存プロファイルに自動で現れる
function normalizeToolbarItems(value) {
  if (!Array.isArray(value)) return defaultToolbarItems();
  const seen = new Map();
  const ordered = [];
  for (const entry of value) {
    if (entry && IDS.includes(entry.id) && !seen.has(entry.id)) {
      const item = { id: entry.id, visible: entry.visible !== false };
      seen.set(entry.id, item);
      ordered.push(item);
    }
  }
  IDS.forEach((id, defaultIndex) => {
    if (seen.has(id)) return;
    // defaultIndex より後ろに来るべき既存項目の直前に挿入する
    let insertAt = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      if (IDS.indexOf(ordered[i].id) > defaultIndex) {
        insertAt = i;
        break;
      }
    }
    ordered.splice(insertAt, 0, { id, visible: true });
  });
  return ordered.length ? ordered : defaultToolbarItems();
}

module.exports = { TOOLBAR_ITEMS, defaultToolbarItems, normalizeToolbarItems };
