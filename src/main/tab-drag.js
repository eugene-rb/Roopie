/**
 * タブのドラッグ終了時に「新しいウィンドウへ切り離すか」を決める判定(副作用なし)。
 *
 * 以前は dragend の clientY が「タブバーの下端+40px」より下かどうかで判定していたが、
 * ドラッグが速いとイベントの座標が実際のドロップ位置とずれる・ウィンドウの外や上側へ
 * 落とすと座標が範囲外になる、といった理由で切り離しが不発になっていた。
 * 現在はメイン側で screen.getCursorScreenPoint() を取り直し、スクリーン座標で判定する。
 *
 * 切り離す条件(並べ替えとして処理済みでないこと):
 *   - ウィンドウの外(上下左右どこでも)へ落とした
 *   - ウィンドウ内でも、タブバー/ツールバーより下=ページ領域へ落とした
 *     (ページ領域の四辺は分割のドロップゾーンが受け取るため、ここへ来るのは中央の抜け)
 */
function shouldDetach({ contentBounds, chromeHeight = 0, point, reordered = false } = {}) {
  if (reordered) return false;
  if (!contentBounds || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const { x, y, width, height } = contentBounds;
  const inside = point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  if (!inside) return true;
  return point.y > y + chromeHeight;
}

module.exports = { shouldDetach };
