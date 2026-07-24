const crypto = require('crypto');

const MAX_NAME = 100;
const DEFAULT_DURATION_MS = 5 * 60_000;

/**
 * サイドパネルの「タイマー」機能。カウントダウン/ストップウォッチ/時刻指定の3種を
 * プロファイル単位の配列で保持する(readlist.jsと同じ骨格: 配列+CRUD+changed()で保存/通知)。
 * Electron非依存。実際のOS操作(音・タブ休止・シャットダウン等)は onFire 経由でbrowser.js側に委譲する。
 *
 * 状態遷移: idle -(start)-> running -(発火)-> ringing -(acknowledge/グレース満了)-> finished | running(繰り返し)
 *           running -(pause)-> paused -(start)-> running
 * tick()はグローバルで1本(browser.js)から呼ばれ、ウィンドウが開いているプロファイルの分だけ進む。
 */
class Timers {
  constructor(store, { onChange, onFire } = {}) {
    this.store = store;
    this.onChange = onChange;
    this.onFire = onFire;
    this.graces = new Map(); // fireId -> { timerId, timeout, graceEndsAt, dangerous }
    this.normalize();
    this.catchUp(Date.now());
  }

  // プロファイル切り替え時に保存先を差し替える(readlist.jsと同型。現状は共有トグル対象外のため未使用)
  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalize();
    this.onChange?.();
  }

  get items() {
    return this.store.data;
  }

  normalize() {
    if (!Array.isArray(this.store.data)) this.store.data = [];
    this.store.data = this.store.data.map((t) => sanitize(t, t));
  }

  find(id) {
    return this.items.find((t) => t.id === id) || null;
  }

  // 保存データに壁時計から計算した remainingMs/elapsedMs/ringing 等を合成して返す(永続化はしない)
  list() {
    const now = Date.now();
    return this.items.map((t) => this.present(t, now));
  }

  present(t, now) {
    const out = { ...t };
    delete out._nextAfterRing;
    if (t.type === 'countdown') {
      if (t.status === 'running') out.remainingMs = Math.max(0, t.nextFireAt - now);
      else if (t.status === 'paused') out.remainingMs = t.remainingAtPauseMs;
      else out.remainingMs = t.durationMs;
    } else if (t.type === 'stopwatch') {
      if (t.status === 'running') out.elapsedMs = now - t.startedAt + (t.elapsedAtPauseMs || 0);
      else out.elapsedMs = t.elapsedAtPauseMs || 0;
    } else if (t.type === 'clock') {
      out.remainingMs = t.status === 'running' && t.nextFireAt != null ? Math.max(0, t.nextFireAt - now) : null;
    }
    const grace = [...this.graces.values()].find((g) => g.timerId === t.id);
    out.ringing = t.status === 'ringing';
    out.fireId = grace?.fireId ?? null;
    out.graceEndsAt = grace?.graceEndsAt ?? null;
    return out;
  }

  add(payload) {
    const t = sanitize(payload, null);
    this.items.push(t);
    this.changed();
    return this.present(t, Date.now());
  }

  update(id, patch) {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const existing = this.items[idx];
    const merged = sanitize(
      { ...existing, ...patch, actions: patch?.actions ? { ...existing.actions, ...patch.actions } : existing.actions },
      existing
    );
    this.items[idx] = merged;
    this.changed();
    return this.present(merged, Date.now());
  }

  remove(id) {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return;
    this.clearGraceFor(id);
    this.items.splice(idx, 1);
    this.changed();
  }

  // ---- 実行制御 ----

  start(id) {
    const t = this.find(id);
    if (!t || t.status === 'running') return;
    const now = Date.now();
    if (t.type === 'countdown') {
      const remaining = t.status === 'paused' && t.remainingAtPauseMs != null ? t.remainingAtPauseMs : t.durationMs;
      t.nextFireAt = now + remaining;
      t.remainingAtPauseMs = null;
    } else if (t.type === 'stopwatch') {
      t.startedAt = now;
    } else if (t.type === 'clock') {
      t.nextFireAt = nextOccurrence(t, now);
    }
    t.status = 'running';
    this.changed();
  }

  pause(id) {
    const t = this.find(id);
    if (!t || t.status !== 'running') return;
    const now = Date.now();
    if (t.type === 'countdown') {
      t.remainingAtPauseMs = Math.max(0, (t.nextFireAt ?? now) - now);
    } else if (t.type === 'stopwatch') {
      t.elapsedAtPauseMs = (t.elapsedAtPauseMs || 0) + (now - (t.startedAt ?? now));
      t.startedAt = null;
    }
    // clockは一時停止中もnextFireAtを保持したまま止める(再開時に再計算する)
    t.status = 'paused';
    this.changed();
  }

  reset(id) {
    const t = this.find(id);
    if (!t) return;
    this.clearGraceFor(id);
    t.status = 'idle';
    t.startedAt = null;
    t.remainingAtPauseMs = null;
    t.elapsedAtPauseMs = null;
    t.nextFireAt = null;
    t._nextAfterRing = null;
    t.laps = [];
    this.changed();
  }

  // カウントダウンの「+1分」。実行中は次回発火を後ろへ、停止中は残り/設定時間そのものを伸ばす
  addTime(id, deltaMs) {
    const t = this.find(id);
    if (!t || t.type !== 'countdown' || !Number.isFinite(deltaMs)) return;
    const delta = clamp(Math.round(deltaMs), -3600_000, 3600_000);
    const now = Date.now();
    if (t.status === 'running') {
      t.nextFireAt = Math.max(now + 1000, (t.nextFireAt ?? now) + delta);
    } else if (t.status === 'paused') {
      t.remainingAtPauseMs = clamp((t.remainingAtPauseMs || 0) + delta, 1000, 24 * 3600_000);
    } else {
      // 未開始(idle/finished)は設定時間そのものを変える=次に開始したときも伸びたまま
      t.durationMs = clamp((t.durationMs || 0) + delta, 1000, 24 * 3600_000);
      t.status = 'idle';
    }
    this.changed();
  }

  // ストップウォッチのラップ。押した瞬間の累積経過ミリ秒を積む(通算値。表示側で差分=各ラップを計算)
  lap(id) {
    const t = this.find(id);
    if (!t || t.type !== 'stopwatch' || t.status !== 'running') return;
    const elapsed = Date.now() - (t.startedAt ?? Date.now()) + (t.elapsedAtPauseMs || 0);
    t.laps = [...(t.laps || []), elapsed];
    this.changed();
  }

  // ---- 発火 ----

  // グローバルtickから呼ばれる。実時間を待たずテストできるよう now を注入可能にする
  tick(now = Date.now()) {
    for (const t of this.items) {
      if (t.status !== 'running' || t.type === 'stopwatch') continue;
      if (t.nextFireAt != null && t.nextFireAt <= now) this.fire(t, now);
    }
  }

  // アプリが閉じていた間に予定時刻を過ぎていたタイマーは、発火させず状態だけ進める
  catchUp(now) {
    let changed = false;
    for (const t of this.items) {
      if (t.status !== 'running' || t.type === 'stopwatch') continue;
      if (t.nextFireAt != null && t.nextFireAt <= now) {
        if (t.type === 'clock' && t.repeat?.enabled) {
          t.nextFireAt = nextOccurrence(t, now);
        } else {
          t.status = 'finished';
          t.nextFireAt = null;
        }
        changed = true;
      }
    }
    if (changed) this.store.save();
  }

  fire(t, now) {
    const fireId = crypto.randomUUID();
    t.status = 'ringing';
    t.lastFiredAt = now;
    t._nextAfterRing = t.type === 'clock' && t.repeat?.enabled ? nextOccurrence(t, now) : null;
    this.changed();
    this.onFire?.({ ...t, fireId });
    return fireId;
  }

  // 危険アクション(ウィンドウを閉じる/シャットダウン)向けの猶予。戻り値で外からキャンセル/即時実行できる
  registerGrace(timerId, fireId, graceMs, run, dangerous) {
    const graceEndsAt = Date.now() + graceMs;
    const entry = { timerId, fireId, dangerous, graceEndsAt };
    entry.timeout = setTimeout(() => {
      this.graces.delete(fireId);
      run();
      this.settleAfterRing(timerId);
    }, graceMs);
    this.graces.set(fireId, entry);
    return {
      cancel: () => {
        clearTimeout(entry.timeout);
        this.graces.delete(fireId);
      },
      runNow: () => {
        clearTimeout(entry.timeout);
        this.graces.delete(fireId);
        run();
        this.settleAfterRing(timerId);
      },
    };
  }

  // 音のみ・危険アクション無しの発火をユーザーが確認した(鳴動を止めた)
  acknowledge(id) {
    const t = this.find(id);
    if (!t || t.status !== 'ringing') return;
    this.clearGraceFor(id);
    this.settleAfterRing(id);
  }

  cancelFire(fireId) {
    const entry = this.graces.get(fireId);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.graces.delete(fireId);
    this.settleAfterRing(entry.timerId);
  }

  settleAfterRing(timerId) {
    const t = this.find(timerId);
    if (!t) return;
    if (t._nextAfterRing != null) {
      t.nextFireAt = t._nextAfterRing;
      t.status = 'running';
    } else {
      t.status = 'finished';
      t.nextFireAt = null;
    }
    t._nextAfterRing = null;
    this.changed();
  }

  clearGraceFor(timerId) {
    for (const [fireId, entry] of this.graces) {
      if (entry.timerId === timerId) {
        clearTimeout(entry.timeout);
        this.graces.delete(fireId);
      }
    }
  }

  destroy() {
    for (const entry of this.graces.values()) clearTimeout(entry.timeout);
    this.graces.clear();
  }

  changed() {
    this.store.save();
    this.onChange?.();
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// 次回発火時刻を計算する。単発(repeat無効)なら今日/明日のclockTimeで直近未来、
// 繰り返しONなら曜日マスクに合う直近未来の日を8日先まで探す
function nextOccurrence(t, from) {
  const { hour, minute } = t.clockTime;
  const weekdays = t.repeat?.enabled ? t.repeat.weekdays : null;
  for (let addDays = 0; addDays < 8; addDays++) {
    const d = new Date(from);
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= from) continue;
    if (weekdays && !weekdays[d.getDay()]) continue;
    return d.getTime();
  }
  return null;
}

function normalizeOpenUrl(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return '';
  const url = /^https?:/i.test(text) ? text : `https://${text}`;
  try {
    new URL(url);
    return url;
  } catch {
    return '';
  }
}

// 入力(追加/更新のpayload)を正規化して保存用オブジェクトを作る。不正な値は既存値かデフォルトに丸める
function sanitize(input, existing) {
  const now = Date.now();
  const type = ['countdown', 'clock', 'stopwatch'].includes(input?.type) ? input.type : existing?.type || 'countdown';

  const t = existing
    ? { ...existing }
    : {
        id: crypto.randomUUID(),
        createdAt: now,
        status: 'idle',
        startedAt: null,
        remainingAtPauseMs: null,
        elapsedAtPauseMs: null,
        nextFireAt: null,
        lastFiredAt: null,
        _nextAfterRing: null,
        laps: [],
      };

  t.type = type;
  t.name = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME) : t.name || '';
  t.updatedAt = now;
  // フローティング表示の明示ピン(ユーザーが📌でこのタイマーを常時フロートさせる)。永続。
  t.float = input?.float !== undefined ? !!input.float : t.float ?? false;
  // ラップは lap()/reset() が更新する。update時は input(=既存を含む)から素通し、なければ既存維持
  t.laps = Array.isArray(input?.laps) ? input.laps.filter((n) => Number.isFinite(n)) : t.laps || [];

  if (type === 'countdown') {
    t.durationMs = Number.isFinite(input?.durationMs) ? clamp(Math.round(input.durationMs), 1000, 24 * 3600_000) : t.durationMs || DEFAULT_DURATION_MS;
  }

  if (type === 'clock') {
    const hour = Number.isInteger(input?.clockTime?.hour) ? clamp(input.clockTime.hour, 0, 23) : t.clockTime?.hour ?? 9;
    const minute = Number.isInteger(input?.clockTime?.minute) ? clamp(input.clockTime.minute, 0, 59) : t.clockTime?.minute ?? 0;
    t.clockTime = { hour, minute };
    const weekdaysInput = input?.repeat?.weekdays;
    const weekdays = Array.isArray(weekdaysInput) && weekdaysInput.length === 7 ? weekdaysInput.map(Boolean) : t.repeat?.weekdays || Array(7).fill(false);
    const enabled = !!input?.repeat?.enabled && weekdays.some(Boolean);
    t.repeat = { enabled, weekdays };
  }

  if (type === 'countdown' || type === 'clock') {
    const a = input?.actions || {};
    // シャットダウンは設定時の追加確認(shutdownConfirmed)が無いと保存できない
    const shutdown = !!a.shutdown && !!a.shutdownConfirmed;
    const openUrl = a.openPage?.enabled ? normalizeOpenUrl(a.openPage?.url) : '';
    t.actions = {
      sound: a.sound !== undefined ? !!a.sound : t.actions?.sound ?? true,
      hibernateTabs: !!a.hibernateTabs,
      closeWindow: !!a.closeWindow,
      openPage: { enabled: !!openUrl, url: openUrl },
      shutdown,
      shutdownConfirmed: shutdown,
    };
  } else {
    t.actions = null;
  }

  return t;
}

module.exports = Timers;
