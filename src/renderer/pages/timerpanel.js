const rowsEl = document.getElementById('timerp-rows');
const panelEl = document.getElementById('timerp');
const dockBtn = document.getElementById('timerp-dock');
const dismissBtn = document.getElementById('timerp-dismiss');

let timers = [];
let receivedAt = Date.now();
let audioCtx = null;
let beepTimer = null;

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function rowTime(t, elapsed) {
  if (t.type === 'stopwatch') return formatDuration(t.status === 'running' ? t.elapsedMs + elapsed : t.elapsedMs);
  if (t.remainingMs == null) return '';
  return formatDuration(Math.max(0, t.remainingMs - elapsed));
}

function defaultName(t) {
  return t.type === 'clock' ? '時刻指定タイマー' : t.type === 'stopwatch' ? 'ストップウォッチ' : 'カウントダウン';
}

const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function render() {
  rowsEl.textContent = '';
  const elapsed = Date.now() - receivedAt;
  const visible = timers.filter((t) => t.status === 'running' || t.ringing);

  for (const t of visible) {
    const row = document.createElement('div');
    row.className = 'timerp-row' + (t.ringing ? ' ringing' : '');

    const btn = document.createElement('button');
    btn.className = 'timerp-circle' + (t.ringing ? ' ringing' : '');
    btn.innerHTML = t.ringing ? ICON_STOP : ICON_PAUSE;
    if (t.ringing) {
      btn.title = '止める';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.fireId) window.roopieInternal.cancelTimerFire(t.fireId);
        else window.roopieInternal.acknowledgeTimer(t.id);
      });
    } else {
      btn.title = '一時停止';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.pauseTimer(t.id);
      });
    }
    row.appendChild(btn);

    const info = document.createElement('div');
    info.className = 'timerp-info';
    const name = document.createElement('div');
    name.className = 'timerp-name';
    name.textContent = t.name || defaultName(t);
    info.appendChild(name);
    row.appendChild(info);

    const time = document.createElement('div');
    time.className = 'timerp-time';
    if (t.ringing) {
      const remain = t.graceEndsAt ? Math.max(0, Math.ceil((t.graceEndsAt - Date.now()) / 1000)) : null;
      time.textContent = remain != null ? `あと${remain}秒` : '時間です';
    } else {
      time.textContent = rowTime(t, elapsed);
    }
    row.appendChild(time);

    // 行クリック(ボタン以外)でサイドパネルのタイマーセクションを開く
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      window.roopieInternal.openSidePanelSection('timers');
    });

    rowsEl.appendChild(row);
  }

  updateBeep(timers.some((t) => t.ringing && t.actions?.sound !== false));
}

function beepOnce() {
  audioCtx = audioCtx || new AudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.22, audioCtx.currentTime + 0.02);
  gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.32);
}

function updateBeep(shouldBeep) {
  if (shouldBeep && !beepTimer) {
    beepOnce();
    beepTimer = setInterval(beepOnce, 900);
  } else if (!shouldBeep && beepTimer) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
}

window.roopieInternal.onTimerState((items) => {
  timers = items;
  receivedAt = Date.now();
  render();
});
// このViewは表示されるまで作られないため、直後に状態変化が無いと何も描画されないまま
// になっていた(pushのみでpull無し)。表示された時点の状態を明示的に取得しておく
window.roopieInternal.listTimers().then((items) => {
  timers = items;
  receivedAt = Date.now();
  render();
});

setInterval(render, 1000);

dockBtn.addEventListener('click', () => window.roopieInternal.setSetting('timerDocked', true));
dismissBtn.addEventListener('click', () => window.roopieInternal.timerDismiss());

// ---- ドラッグで四隅に移動(mediaplayer.jsと同型。Viewの再配置に影響されない
// movementX/Y の積算値を送る) ----
const DRAG_THRESHOLD = 4;
let dragging = false;
let accX = 0;
let accY = 0;

panelEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  dragging = true;
  accX = 0;
  accY = 0;
  window.roopieInternal.timerDragStart();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  accX += e.movementX;
  accY += e.movementY;
  window.roopieInternal.timerDrag(accX, accY);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  window.roopieInternal.timerDragEnd();
});
