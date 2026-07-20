const rowsEl = document.getElementById('player-rows');
const playerEl = document.getElementById('player');
const dockBtn = document.getElementById('player-dock');
const dismissBtn = document.getElementById('player-dismiss');

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5l12 7-12 7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const ICON_ART_FALLBACK =
  '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

let mediaList = [];

function render() {
  rowsEl.textContent = '';
  // 表示すべき行はメイン側(MediaPlayer.visibleRows())で既に絞り込み済み
  for (const m of mediaList) {
    const row = document.createElement('div');
    row.className = 'player-row';

    const art = document.createElement('div');
    art.className = 'player-row-art';
    if (m.artwork) {
      const img = document.createElement('img');
      img.src = m.artwork;
      art.appendChild(img);
    } else {
      art.innerHTML = ICON_ART_FALLBACK;
    }
    row.appendChild(art);

    const info = document.createElement('div');
    info.className = 'player-row-info';
    const title = document.createElement('div');
    title.className = 'player-row-title';
    title.textContent = m.title || '';
    const artist = document.createElement('div');
    artist.className = 'player-row-artist';
    artist.textContent = m.artist || '';
    info.appendChild(title);
    info.appendChild(artist);
    row.appendChild(info);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'pbtn';
    toggleBtn.title = '再生 / 一時停止';
    toggleBtn.innerHTML = m.playing ? ICON_PAUSE : ICON_PLAY;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.roopieInternal.mediaToggle(m.tabId);
    });
    row.appendChild(toggleBtn);

    // 行クリック(ボタン以外)で再生中のタブへ切り替える
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      window.roopieInternal.mediaSwitchToTab(m.tabId);
    });

    rowsEl.appendChild(row);
  }
}

window.roopieInternal.onMediaState((next) => {
  mediaList = next || [];
  render();
});
// このViewは表示されるまで作られないため、直後に状態変化(push)が無いと何も描画されない
// まま(timerpanel.jsと同型の不具合)になる。表示された時点の状態を明示的に取得しておく
window.roopieInternal.listMedia().then((next) => {
  mediaList = next || [];
  render();
});

dismissBtn.addEventListener('click', () => window.roopieInternal.mediaDismiss());
dockBtn.addEventListener('click', () => window.roopieInternal.setSetting('mediaDocked', true));

// ---- ドラッグで四隅に移動 ----
// Viewの再配置に影響されない movementX/Y(直前のイベントからの相対移動量)を積算して送る
const DRAG_THRESHOLD = 4; // これ未満の移動は「クリック」として扱う
let dragging = false;
let accX = 0;
let accY = 0;

playerEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  dragging = true;
  accX = 0;
  accY = 0;
  window.roopieInternal.mediaDragStart();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  accX += e.movementX;
  accY += e.movementY;
  window.roopieInternal.mediaDrag(accX, accY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  window.roopieInternal.mediaDragEnd();
});
