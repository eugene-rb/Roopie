const artImg = document.getElementById('player-art-img');
const artFallback = document.getElementById('player-art-fallback');
const titleEl = document.getElementById('player-title');
const artistEl = document.getElementById('player-artist');
const toggleBtn = document.getElementById('player-toggle');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const rangeEl = document.getElementById('player-range');
const pipBtn = document.getElementById('player-pip');
const dockBtn = document.getElementById('player-dock');
const dismissBtn = document.getElementById('player-dismiss');
const playerEl = document.getElementById('player');
const mainEl = document.getElementById('player-main');

let state = null;
let seeking = false; // シークバーをドラッグ中は、届いた状態で上書きしない

function render() {
  if (!state) return;
  titleEl.textContent = state.title || '';
  artistEl.textContent = state.artist || '';

  if (state.artwork) {
    artImg.src = state.artwork;
    artImg.classList.remove('hidden');
    artFallback.classList.add('hidden');
  } else {
    artImg.classList.add('hidden');
    artFallback.classList.remove('hidden');
  }

  iconPlay.classList.toggle('hidden', state.playing);
  iconPause.classList.toggle('hidden', !state.playing);
  pipBtn.classList.toggle('hidden', !state.hasVideo);

  if (!seeking && state.duration > 0) {
    rangeEl.value = String(Math.round((state.currentTime / state.duration) * 1000));
  }
  rangeEl.disabled = !(state.duration > 0);
}

window.roopieInternal.onMediaState((next) => {
  state = next;
  render();
});

toggleBtn.addEventListener('click', () => window.roopieInternal.mediaToggle());
pipBtn.addEventListener('click', () => window.roopieInternal.mediaPip());
dismissBtn.addEventListener('click', () => window.roopieInternal.mediaDismiss());
dockBtn.addEventListener('click', () => window.roopieInternal.setSetting('mediaDocked', true));

// タイトル/アートワーク部分をクリックすると、再生中のタブへ切り替える(ドラッグ直後は無視)
mainEl.addEventListener('click', (e) => {
  if (e.target.closest('#player-actions') || wasDragged) return;
  window.roopieInternal.mediaSwitchToTab();
});

rangeEl.addEventListener('mousedown', () => {
  seeking = true;
});
rangeEl.addEventListener('change', () => {
  if (state?.duration > 0) {
    window.roopieInternal.mediaSeek((Number(rangeEl.value) / 1000) * state.duration);
  }
  seeking = false;
});

// ---- ドラッグで四隅に移動 ----
// Viewの再配置に影響されない movementX/Y(直前のイベントからの相対移動量)を積算して送る
const DRAG_THRESHOLD = 4; // これ未満の移動は「クリック」として扱う
let dragging = false;
let wasDragged = false;
let accX = 0;
let accY = 0;

playerEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button, input')) return;
  dragging = true;
  wasDragged = false;
  accX = 0;
  accY = 0;
  window.roopieInternal.mediaDragStart();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  accX += e.movementX;
  accY += e.movementY;
  if (Math.abs(accX) > DRAG_THRESHOLD || Math.abs(accY) > DRAG_THRESHOLD) wasDragged = true;
  window.roopieInternal.mediaDrag(accX, accY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  window.roopieInternal.mediaDragEnd();
});
