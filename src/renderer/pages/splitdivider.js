// 画面分割のペイン間リサイズ用の仕切り。透明な小さいWebContentsViewとして
// 2ペインの隙間に重なる。ドラッグの物理移動量(movementX/Y)を積算してメインへ送り、
// メイン側が分割比率(splitRatio)へ変換してレイアウトし直す(Viewの再配置に強い方式)。
const body = document.body;
const handle = document.getElementById('divider-handle');
let direction = 'row';

window.roopieInternal.onSplitDivider((info) => {
  direction = info?.direction === 'column' ? 'column' : 'row';
  body.dataset.direction = direction;
});

let dragging = false;
let accX = 0;
let accY = 0;

handle.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  accX = 0;
  accY = 0;
  body.classList.add('dragging');
  window.roopieInternal.splitResizeStart();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  accX += e.movementX;
  accY += e.movementY;
  window.roopieInternal.splitResize(accX, accY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  body.classList.remove('dragging');
  window.roopieInternal.splitResizeEnd();
});
