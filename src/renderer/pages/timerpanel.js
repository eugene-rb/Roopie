const rowsEl = document.getElementById('timerp-rows');
const panelEl = document.getElementById('timerp');
const dockBtn = document.getElementById('timerp-dock');
const dismissBtn = document.getElementById('timerp-dismiss');

// main(timer-panel.js)側でフロート対象に絞った行だけが届く。ここでは受け取った行を
// 機能別(カウントダウン=進捗リング / ストップウォッチ=経過 / アラーム=鳴動のみ)に描画する。
let timers = [];
let receivedAt = Date.now();
let audioCtx = null;
let beepTimer = null;

const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function remainingOf(t, elapsed) {
  if (t.remainingMs == null) return 0;
  return Math.max(0, t.status === 'running' ? t.remainingMs - elapsed : t.remainingMs);
}

function elapsedOf(t, elapsed) {
  return t.status === 'running' ? (t.elapsedMs || 0) + elapsed : t.elapsedMs || 0;
}

function rowTime(t, elapsed) {
  if (t.type === 'stopwatch') return formatDuration(elapsedOf(t, elapsed));
  return formatDuration(remainingOf(t, elapsed));
}

function defaultName(t) {
  return t.type === 'clock' ? 'アラーム' : t.type === 'stopwatch' ? 'ストップウォッチ' : 'タイマー';
}

const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5l12 7-12 7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_BELL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const ICON_LAP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 21V4h9l-1 3h8v9h-8l-1-3H4"/></svg>';

function formatClockTime(t) {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

// カウントダウンの残り割合をリングで表す。時間が減るとアークも短くなる(上から時計回り)
function progressRing(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const wrap = document.createElement('span');
  wrap.className = 'timerp-btnwrap';
  wrap.innerHTML =
    `<svg class="timerp-ring" viewBox="0 0 34 34">` +
    `<circle class="timerp-ring-track" cx="17" cy="17" r="${RING_R}"/>` +
    `<circle class="timerp-ring-prog" cx="17" cy="17" r="${RING_R}" ` +
    `stroke-dasharray="${(RING_C * f).toFixed(2)} ${RING_C.toFixed(2)}"/>` +
    `</svg>`;
  return wrap;
}

function render() {
  rowsEl.textContent = '';
  const elapsed = Date.now() - receivedAt;

  for (const t of timers) {
    const row = document.createElement('div');
    row.className = 'timerp-row' + (t.ringing ? ' ringing' : '');
    row.dataset.type = t.type;

    // 左のボタンは機能ごとに意味を変える:
    //   鳴動中 = 止める / カウントダウン・ストップウォッチ = 一時停止・再開 /
    //   予約中のアラーム = 押しても止めないベル表示(誤操作で予定を消さないため)
    const alarmIdle = t.type === 'clock' && !t.ringing;
    const btn = document.createElement(alarmIdle ? 'div' : 'button');
    btn.className = 'timerp-circle' + (t.ringing ? ' ringing' : '') + (alarmIdle ? ' alarm' : '');
    if (t.ringing) {
      btn.innerHTML = ICON_STOP;
      btn.title = '止める';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.fireId) window.roopieInternal.cancelTimerFire(t.fireId);
        else window.roopieInternal.acknowledgeTimer(t.id);
      });
    } else if (alarmIdle) {
      btn.innerHTML = ICON_BELL;
    } else if (t.status === 'paused') {
      btn.innerHTML = ICON_PLAY;
      btn.classList.add('paused');
      btn.title = '再開';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.startTimer(t.id);
      });
    } else {
      btn.innerHTML = ICON_PAUSE;
      btn.title = '一時停止';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.pauseTimer(t.id);
      });
    }

    if (t.type === 'countdown' && !t.ringing && t.durationMs) {
      const wrap = progressRing(remainingOf(t, elapsed) / t.durationMs);
      wrap.appendChild(btn);
      row.appendChild(wrap);
    } else {
      row.appendChild(btn);
    }

    const info = document.createElement('div');
    info.className = 'timerp-info';
    const name = document.createElement('div');
    name.className = 'timerp-name';
    // アラームは名前より「何時に鳴るか」が主役なので時刻を出す
    name.textContent = alarmIdle ? `${formatClockTime(t.clockTime)} ${t.name || ''}`.trim() : t.name || defaultName(t);
    info.appendChild(name);
    row.appendChild(info);

    // ストップウォッチは実行中だけラップを打てるようにする(フロートしたまま計測できる)
    if (t.type === 'stopwatch' && t.status === 'running' && !t.ringing) {
      const lap = document.createElement('button');
      lap.className = 'timerp-lap';
      lap.innerHTML = ICON_LAP;
      lap.title = 'ラップ';
      lap.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopieInternal.lapTimer(t.id);
      });
      row.appendChild(lap);
    }

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

setInterval(render, 1000);

dockBtn.addEventListener('click', () => window.roopieInternal.setSetting('timerDocked', true));
dismissBtn.addEventListener('click', () => window.roopieInternal.timerDismiss());

// ---- ドラッグで四隅に移動(mediaplayer.jsと同型。Viewの再配置に影響されない
// movementX/Y の積算値を送る) ----
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
