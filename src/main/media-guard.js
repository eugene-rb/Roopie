// 裏で開いたタブの「読み込むけれど再生は始めさせない」仕組み(メイン側)。
// レンダラー側の実体は src/preload/media-guard-preload.js。
//
// block(wc) を呼んでから loadURL すると、そのwebContentsの各ドキュメントは
// preloadの同期問い合わせ(media-guard:blocked)で true を受け取り、メインワールドに
// ガードを入れる。タブが選ばれたら release(wc) で解除する(そこで初めて再生が始まる)。
//
// 対象の記録に WeakSet を使うのは、タブを閉じたときに後始末を書かずに済ませるため。
const blocked = new WeakSet();

const RELEASE_SOURCE = 'window.__roopieMediaGuard && window.__roopieMediaGuard.release()';

function block(wc) {
  if (!wc || wc.isDestroyed()) return;
  blocked.add(wc);
}

function isBlocked(wc) {
  return !!wc && !wc.isDestroyed() && blocked.has(wc);
}

// 解除して、塞いでいた再生を始めさせる。preloadはメインフレームでしか走らないが、
// 念のため全フレームへ解除を投げる(nodeIntegrationInSubFrames が有効なタブ向け)
function release(wc) {
  if (!wc || wc.isDestroyed()) return;
  if (!blocked.delete(wc)) return;
  let frames = [];
  try {
    frames = wc.mainFrame?.framesInSubtree ?? [];
  } catch (e) {
    return;
  }
  for (const frame of frames) {
    if (frame.isDestroyed?.()) continue;
    // userGesture=true: 解除直後の play() が別の理由で弾かれないようにする
    frame.executeJavaScript(RELEASE_SOURCE, true).catch(() => {});
  }
}

module.exports = { block, isBlocked, release };
