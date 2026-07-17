const crypto = require('crypto');
const { net } = require('electron');

/**
 * スタート画面のウィジェットとグリッド配置の管理。
 * 配置(layouts)は「ページID → アイテム配列」。アイテムはショートカット参照かウィジェット本体:
 *   { type: 'shortcut', refId: <bookmarkId> }
 *   { type: 'widget', id, widgetType: 'weather'|'notepad'|'calendar'|'news', config: {...} }
 * ショートカットの実体はbookmarks(startフォルダ)のままで、ここでは並び順だけを持つ。
 * 天気・ニュース(RSS)の取得は内部ページのCSP(connect-src 'self')を通れないため、
 * メインプロセスで代理取得してキャッシュする。
 */
const WIDGET_TYPES = ['weather', 'notepad', 'calendar', 'news'];
const MAX_ITEMS = 300;
const MAX_NOTE_LENGTH = 50_000;
const MAX_FEEDS = 10;
const MAX_COORD = 500; // グリッド座標(x,y)の上限(暴走防止。実際のグリッドはずっと小さい)
const MIN_WIDGET_SPAN = 1;
const MAX_WIDGET_SPAN = 6;

// 整数として妥当ならクランプして返す。無効/未指定ならundefined(=座標なし。レンダラー側で自動配置)
function clampCoord(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

class Widgets {
  constructor(store) {
    this.store = store;
    this.normalize();
  }

  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalize();
  }

  normalize() {
    if (!this.store.data || typeof this.store.data !== 'object') this.store.data = {};
    if (!this.store.data.layouts || typeof this.store.data.layouts !== 'object') {
      this.store.data.layouts = {};
    }
  }

  layoutFor(pageId) {
    return this.store.data.layouts[String(pageId)] ?? [];
  }

  sanitizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    const x = clampCoord(item.x, 0, MAX_COORD);
    const y = clampCoord(item.y, 0, MAX_COORD);
    if (item.type === 'shortcut' && typeof item.refId === 'string') {
      const out = { type: 'shortcut', refId: item.refId };
      if (x !== undefined) out.x = x;
      if (y !== undefined) out.y = y;
      return out;
    }
    if (
      item.type === 'widget' &&
      typeof item.id === 'string' &&
      WIDGET_TYPES.includes(item.widgetType)
    ) {
      const out = {
        type: 'widget',
        id: item.id,
        widgetType: item.widgetType,
        config: this.sanitizeConfig(item.widgetType, item.config),
      };
      if (x !== undefined) out.x = x;
      if (y !== undefined) out.y = y;
      const w = clampCoord(item.w, MIN_WIDGET_SPAN, MAX_WIDGET_SPAN);
      const h = clampCoord(item.h, MIN_WIDGET_SPAN, MAX_WIDGET_SPAN);
      if (w !== undefined) out.w = w;
      if (h !== undefined) out.h = h;
      return out;
    }
    return null;
  }

  sanitizeConfig(widgetType, config) {
    const c = config && typeof config === 'object' ? config : {};
    const out = {};
    if (widgetType === 'weather') {
      if (typeof c.name === 'string') out.name = c.name.slice(0, 80);
      if (Number.isFinite(c.lat)) out.lat = c.lat;
      if (Number.isFinite(c.lon)) out.lon = c.lon;
    } else if (widgetType === 'notepad') {
      if (typeof c.text === 'string') out.text = c.text.slice(0, MAX_NOTE_LENGTH);
    } else if (widgetType === 'news') {
      if (Array.isArray(c.feeds)) {
        out.feeds = c.feeds
          .filter((f) => typeof f === 'string' && /^https?:\/\//i.test(f))
          .slice(0, MAX_FEEDS)
          .map((f) => f.slice(0, 500));
      }
    }
    return out;
  }

  setLayout(pageId, items) {
    if (!Array.isArray(items)) return;
    this.store.data.layouts[String(pageId)] = items
      .map((item) => this.sanitizeItem(item))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    this.store.save();
  }

  addWidget(pageId, widgetType) {
    if (!WIDGET_TYPES.includes(widgetType)) return null;
    const item = { type: 'widget', id: crypto.randomUUID(), widgetType, config: {} };
    const layout = this.layoutFor(pageId).slice();
    layout.push(item);
    this.store.data.layouts[String(pageId)] = layout;
    this.store.save();
    return item;
  }

  removeWidget(pageId, id) {
    const layout = this.layoutFor(pageId);
    const index = layout.findIndex((item) => item.type === 'widget' && item.id === id);
    if (index === -1) return;
    layout.splice(index, 1);
    this.store.save();
  }

  updateConfig(pageId, id, patch) {
    const item = this.layoutFor(pageId).find((i) => i.type === 'widget' && i.id === id);
    if (!item) return;
    item.config = this.sanitizeConfig(item.widgetType, { ...item.config, ...patch });
    this.store.save();
  }
}

// ---- 天気・RSSの代理取得(キャッシュつき) ----

const fetchCache = new Map(); // url -> { at, value }

async function cachedFetchText(url, ttlMs, maxBytes = 1_000_000) {
  const hit = fetchCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    fetchCache.set(url, { at: Date.now(), value: text });
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 地名検索(Open-Meteo Geocoding API。キー不要)
async function geocode(query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=ja&format=json`;
  const text = await cachedFetchText(url, 60_000);
  try {
    const json = JSON.parse(text);
    return (json.results ?? []).map((r) => ({
      name: r.name,
      admin: r.admin1 ?? '',
      country: r.country ?? '',
      lat: r.latitude,
      lon: r.longitude,
    }));
  } catch {
    return [];
  }
}

// 現在の天気+3日分の予報(Open-Meteo。キー不要)。15分キャッシュ
async function weather(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code' +
    '&timezone=auto&forecast_days=3';
  const text = await cachedFetchText(url, 15 * 60_000);
  try {
    const json = JSON.parse(text);
    return {
      current: { temp: json.current?.temperature_2m, code: json.current?.weather_code },
      daily: (json.daily?.time ?? []).map((date, i) => ({
        date,
        max: json.daily.temperature_2m_max?.[i],
        min: json.daily.temperature_2m_min?.[i],
        code: json.daily.weather_code?.[i],
      })),
    };
  } catch {
    return null;
  }
}

// RSS/AtomのXMLをそのまま返す(パースはレンダラーのDOMParserで行う)。10分キャッシュ
async function fetchRss(url) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) return null;
  return cachedFetchText(String(url), 10 * 60_000, 512_000);
}

module.exports = { Widgets, geocode, weather, fetchRss };
