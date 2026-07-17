const MAX_QUICK_LINKS = 10;

const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const greetingEl = document.getElementById('greeting');
const searchEl = document.getElementById('search');
const quickLinksEl = document.getElementById('quick-links');

// ---- 背景(テーマ設定が auto なら時間帯で切り替え) ----
const bgEl = document.getElementById('bg');
let themeBackground = 'auto';
let themeBackgroundImage = '';

function backgroundByHour(hour) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}

function applyBackground() {
  const key =
    themeBackground === 'auto' ? backgroundByHour(new Date().getHours()) : themeBackground;
  document.body.dataset.bg = key;
  bgEl.style.backgroundImage = key === 'image' && themeBackgroundImage ? `url("${themeBackgroundImage}")` : '';
}

// theme.js から呼ばれる(初期化時とテーマ変更時)
window.onRoopieTheme = (theme) => {
  themeBackground = theme.background || 'auto';
  themeBackgroundImage = theme.backgroundImage || '';
  applyBackground();
};
// theme.jsのgetTheme()がこのスクリプトの読み込みより先に解決していた場合に備える
if (window.__roopieLastTheme) window.onRoopieTheme(window.__roopieLastTheme);

// ---- 時計 ----
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]})`;

  const hour = now.getHours();
  greetingEl.textContent =
    hour < 5 ? 'おやすみなさい' : hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';

  applyBackground();
}

updateClock();
setInterval(updateClock, 10_000);

// ---- 検索 ----
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchEl.value.trim()) {
    window.roopieInternal.navigate(searchEl.value);
  }
});

// ---- ショートカット(bookmarksの "start" フォルダ以下。ページ=サブフォルダ) ----
// ショートカットのURLは file:// で始まればローカルフォルダ、それ以外はページ
let pages = [];
let currentPageId = null;
let shortcuts = [];

function shortcutKind(shortcut) {
  return shortcut.url.startsWith('file://') ? 'folder' : 'url';
}

function shortcutTarget(shortcut) {
  return shortcutKind(shortcut) === 'folder' ? shortcut.url.slice('file://'.length) : shortcut.url;
}

// 入力URL(スキーム省略可)のホスト名。取れなければ空文字
function hostnameOf(target) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`).hostname;
  } catch {
    return '';
  }
}

// リンク先のfavicon URL(既定アイコン)。ホストが取れないURLはnull
function faviconUrlFor(url) {
  try {
    const host = new URL(url).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
  } catch {
    return null;
  }
}

function letterPlaceholderEl(title) {
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  placeholder.textContent = (title[0] || '?').toUpperCase();
  return placeholder;
}

const FOLDER_ICON_SVG =
  '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// タイルの中身(アイコン部分)を作る。iconOverride はモーダルのプレビュー用
// (undefined = shortcut.icon を使う / null = 既定に戻した状態を表示)
function tileIconContent(tile, shortcut, iconOverride) {
  const icon = iconOverride !== undefined ? iconOverride : shortcut.icon ?? null;

  if (icon?.type === 'emoji' && icon.value) {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = icon.value;
    tile.appendChild(span);
  } else if (icon?.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.className = 'custom-image'; // アップロード画像はタイル全体に敷く(プロファイルのアバターと同じ見せ方)
    img.src = icon.value;
    tile.appendChild(img);
  } else if (shortcutKind(shortcut) === 'folder') {
    tile.innerHTML = FOLDER_ICON_SVG;
  } else {
    // 既定はリンク先のfavicon(訪問時に取得済みならそれ、なければfaviconサービス)。
    // 読み込めなければ頭文字にフォールバック
    const src = shortcut.favicon || faviconUrlFor(shortcut.url);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.addEventListener('error', () => img.replaceWith(letterPlaceholderEl(shortcut.title)));
      tile.appendChild(img);
    } else {
      tile.appendChild(letterPlaceholderEl(shortcut.title));
    }
  }
}

function shortcutTileEl(shortcut) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tileIconContent(tile, shortcut, undefined);
  return tile;
}

// =========================================================
// グリッド(ショートカット+ウィジェットをスマホのホーム画面風に配置)
// 並び順は widgets:layout(ページ単位)が持ち、ショートカットの実体はbookmarksのまま
// =========================================================
let gridItems = []; // [{type:'shortcut', shortcut} | {type:'widget', id, widgetType, config}]
let gridElToItem = new Map();

const WIDGET_META = {
  weather: { name: '天気', icon: '🌤️' },
  notepad: { name: 'ノート', icon: '📝' },
  calendar: { name: 'カレンダー', icon: '📅' },
  news: { name: 'ニュース', icon: '📰' },
};

function layoutForSave() {
  return gridItems.map((item) =>
    item.type === 'shortcut'
      ? { type: 'shortcut', refId: item.shortcut.id }
      : { type: 'widget', id: item.id, widgetType: item.widgetType, config: item.config }
  );
}

// 保存済みの並びとブックマークの現状を突き合わせる(消えた参照は落とし、新規は末尾へ)
function reconcileLayout(rawLayout, list) {
  const byId = new Map(list.map((s) => [s.id, s]));
  const seen = new Set();
  const items = [];
  for (const it of rawLayout ?? []) {
    if (it.type === 'shortcut') {
      const shortcut = byId.get(it.refId);
      if (shortcut && !seen.has(shortcut.id)) {
        items.push({ type: 'shortcut', shortcut });
        seen.add(shortcut.id);
      }
    } else if (it.type === 'widget' && WIDGET_META[it.widgetType]) {
      items.push({ type: 'widget', id: it.id, widgetType: it.widgetType, config: it.config ?? {} });
    }
  }
  for (const shortcut of list.slice(0, MAX_QUICK_LINKS)) {
    if (!seen.has(shortcut.id)) items.push({ type: 'shortcut', shortcut });
  }
  return items;
}

function shortcutItemEl(shortcut) {
  const kind = shortcutKind(shortcut);
  const target = shortcutTarget(shortcut);
  const el = document.createElement(kind === 'folder' ? 'div' : 'a');
  el.className = 'quick-link';
  el.title = `${shortcut.title}\n${target}`;
  if (kind === 'url') {
    el.href = shortcut.url;
  } else {
    el.addEventListener('click', () => window.roopieInternal.openShortcutFolder(target));
  }

  el.appendChild(shortcutTileEl(shortcut));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = shortcut.title;
  el.appendChild(label);

  const editBtn = document.createElement('button');
  editBtn.className = 'quick-link-edit';
  editBtn.title = '編集';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openShortcutModal(shortcut);
  });
  el.appendChild(editBtn);
  return el;
}

function widgetItemEl(item) {
  const el = document.createElement('div');
  el.className = `widget widget-${item.widgetType}`;

  const head = document.createElement('div');
  head.className = 'widget-head';
  const title = document.createElement('span');
  title.className = 'widget-title';
  title.textContent =
    item.widgetType === 'weather' && item.config.name ? item.config.name : WIDGET_META[item.widgetType].name;
  const menuBtn = document.createElement('button');
  menuBtn.className = 'widget-menu-btn';
  menuBtn.textContent = '⋮';
  menuBtn.title = 'メニュー';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openWidgetMenu(menuBtn, el, item);
  });
  head.append(title, menuBtn);

  const body = document.createElement('div');
  body.className = 'widget-body';
  el.append(head, body);
  WIDGET_RENDERERS[item.widgetType](body, item);
  return el;
}

function renderGrid() {
  quickLinksEl.textContent = '';
  gridElToItem = new Map();

  for (const item of gridItems) {
    const el = item.type === 'shortcut' ? shortcutItemEl(item.shortcut) : widgetItemEl(item);
    el.classList.add('grid-item');
    gridElToItem.set(el, item);
    attachGridDrag(el, item);
    quickLinksEl.appendChild(el);
  }

  const addTile = document.createElement('button');
  addTile.className = 'quick-link quick-link-add';
  addTile.title = 'ショートカットやウィジェットを追加';
  addTile.innerHTML = '<div class="tile"><span class="plus">+</span></div><span class="label">追加</span>';
  addTile.addEventListener('click', () => openAddMenu(addTile));
  quickLinksEl.appendChild(addTile);
}

// ---- 追加メニュー / ウィジェットメニュー(小さなポップアップ) ----
function popupMenu(anchorEl, entries) {
  document.querySelector('.grid-popup')?.remove();
  const menu = document.createElement('div');
  menu.className = 'grid-popup';
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.className = 'grid-popup-item';
    btn.disabled = !!entry.disabled;
    btn.textContent = entry.label;
    btn.addEventListener('click', () => {
      close();
      entry.action();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, innerWidth - menuRect.width - 8)}px`;
  menu.style.top =
    rect.bottom + menuRect.height + 8 < innerHeight ? `${rect.bottom + 6}px` : `${rect.top - menuRect.height - 6}px`;

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey);
  }
  function onOutside(e) {
    if (!menu.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey);
}

function openAddMenu(anchorEl) {
  const shortcutCount = gridItems.filter((i) => i.type === 'shortcut').length;
  popupMenu(anchorEl, [
    {
      label: '🔗 ショートカット',
      disabled: shortcutCount >= MAX_QUICK_LINKS,
      action: () => openShortcutModal(null),
    },
    ...Object.entries(WIDGET_META).map(([type, meta]) => ({
      label: `${meta.icon} ${meta.name}`,
      action: async () => {
        await window.roopieInternal.addWidget(currentPageId, type);
        await loadShortcuts();
      },
    })),
  ]);
}

function openWidgetMenu(anchorEl, widgetEl, item) {
  const entries = [];
  const body = widgetEl.querySelector('.widget-body');
  if (item.widgetType === 'weather') {
    entries.push({
      label: '📍 場所を変更',
      action: () => renderWeatherSetup(body, item),
    });
  }
  if (item.widgetType === 'news') {
    entries.push({
      label: '📡 フィードを編集',
      action: () => renderNewsSetup(body, item),
    });
  }
  if (item.widgetType === 'weather' || item.widgetType === 'news') {
    entries.push({ label: '🔄 更新', action: () => WIDGET_RENDERERS[item.widgetType](body, item) });
  }
  entries.push({
    label: '🗑 削除',
    action: async () => {
      window.roopieInternal.removeWidget(currentPageId, item.id);
      await loadShortcuts();
    },
  });
  popupMenu(anchorEl, entries);
}

// ---- ドラッグ&ドロップ並べ替え(スマホのホーム画面風にライブで詰め直す) ----
let dragEl = null;

function flipMove(mutate) {
  const before = new Map();
  for (const el of quickLinksEl.children) before.set(el, el.getBoundingClientRect());
  mutate();
  for (const el of quickLinksEl.children) {
    const prev = before.get(el);
    if (!prev || el === dragEl) continue;
    const rect = el.getBoundingClientRect();
    const dx = prev.left - rect.left;
    const dy = prev.top - rect.top;
    if (dx || dy) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
    }
  }
}

function attachGridDrag(el, item) {
  // ウィジェットはヘッダーだけ、ショートカットはタイル全体をつまめる
  const handle = item.type === 'widget' ? el.querySelector('.widget-head') : el;
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => {
    dragEl = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.type === 'shortcut' ? item.shortcut.url : 'widget');
    if (item.type === 'widget') {
      const rect = el.getBoundingClientRect();
      e.dataTransfer.setDragImage(el, e.clientX - rect.left, e.clientY - rect.top);
    }
  });
  handle.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragEl = null;
    persistGridOrder();
  });
}

quickLinksEl.addEventListener('dragover', (e) => {
  if (!dragEl) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest?.('.grid-item');
  if (!target || target === dragEl) return;
  const rect = target.getBoundingClientRect();
  const before = e.clientX - rect.left < rect.width / 2;
  const ref = before ? target : target.nextSibling;
  if (ref === dragEl || (before ? target.previousSibling : target.nextSibling) === dragEl) return;
  flipMove(() => quickLinksEl.insertBefore(dragEl, ref));
});
quickLinksEl.addEventListener('drop', (e) => {
  if (dragEl) e.preventDefault();
});

function persistGridOrder() {
  const ordered = [];
  for (const el of quickLinksEl.children) {
    const item = gridElToItem.get(el);
    if (item) ordered.push(item);
  }
  gridItems = ordered;
  if (currentPageId) window.roopieInternal.setWidgetLayout(currentPageId, layoutForSave());
}

// =========================================================
// 各ウィジェットの描画
// =========================================================
function widgetNote(body, text) {
  body.textContent = '';
  const note = document.createElement('div');
  note.className = 'widget-note';
  note.textContent = text;
  body.appendChild(note);
  return note;
}

// ---- 天気(Open-Meteo。メイン経由で取得) ----
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

async function renderWeather(body, item) {
  const cfg = item.config ?? {};
  if (!Number.isFinite(cfg.lat)) {
    renderWeatherSetup(body, item);
    return;
  }
  widgetNote(body, '読み込み中…');
  const data = await window.roopieInternal.getWeather(cfg.lat, cfg.lon);
  if (!data || !Number.isFinite(data.current?.temp)) {
    widgetNote(body, '天気を取得できませんでした');
    return;
  }
  body.textContent = '';

  const now = document.createElement('div');
  now.className = 'weather-now';
  const icon = document.createElement('span');
  icon.className = 'weather-icon';
  icon.textContent = weatherEmoji(data.current.code);
  const temp = document.createElement('span');
  temp.className = 'weather-temp';
  temp.textContent = `${Math.round(data.current.temp)}°`;
  now.append(icon, temp);
  body.appendChild(now);

  const days = document.createElement('div');
  days.className = 'weather-days';
  for (const day of data.daily.slice(0, 3)) {
    const col = document.createElement('div');
    col.className = 'weather-day';
    const date = new Date(day.date + 'T00:00');
    const label = document.createElement('span');
    label.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    const em = document.createElement('span');
    em.textContent = weatherEmoji(day.code);
    const range = document.createElement('span');
    range.className = 'weather-range';
    range.textContent = `${Math.round(day.max)}°/${Math.round(day.min)}°`;
    col.append(label, em, range);
    days.appendChild(col);
  }
  body.appendChild(days);
}

function renderWeatherSetup(body, item) {
  body.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'widget-setup';
  const input = document.createElement('input');
  input.className = 'widget-input';
  input.type = 'text';
  input.placeholder = '都市名(例: 東京)';
  const results = document.createElement('div');
  results.className = 'widget-setup-results';

  async function search() {
    const query = input.value.trim();
    if (!query) return;
    results.textContent = '検索中…';
    const places = await window.roopieInternal.geocodeCity(query);
    results.textContent = '';
    if (!places.length) {
      results.textContent = '見つかりませんでした';
      return;
    }
    for (const place of places) {
      const btn = document.createElement('button');
      btn.className = 'widget-setup-result';
      btn.textContent = [place.name, place.admin, place.country].filter(Boolean).join(' / ');
      btn.addEventListener('click', () => {
        item.config = { name: place.name, lat: place.lat, lon: place.lon };
        window.roopieInternal.setWidgetConfig(currentPageId, item.id, item.config);
        const titleEl = body.parentElement.querySelector('.widget-title');
        if (titleEl) titleEl.textContent = place.name;
        renderWeather(body, item);
      });
      results.appendChild(btn);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search();
  });
  const searchBtn = document.createElement('button');
  searchBtn.className = 'widget-btn';
  searchBtn.textContent = '検索';
  searchBtn.addEventListener('click', search);

  const row = document.createElement('div');
  row.className = 'widget-setup-row';
  row.append(input, searchBtn);
  wrap.append(row, results);
  body.appendChild(wrap);
  input.focus();
}

// ---- ノートパッド(自動保存) ----
function renderNotepad(body, item) {
  body.textContent = '';
  const textarea = document.createElement('textarea');
  // クラス名はコンテナの .widget-notepad(widget-<type>)と衝突しないようにする
  textarea.className = 'notepad-textarea';
  textarea.placeholder = 'メモを入力…(自動保存)';
  textarea.value = item.config.text ?? '';
  let timer = null;
  textarea.addEventListener('input', () => {
    item.config.text = textarea.value;
    clearTimeout(timer);
    timer = setTimeout(
      () => window.roopieInternal.setWidgetConfig(currentPageId, item.id, { text: textarea.value }),
      500
    );
  });
  body.appendChild(textarea);
}

// ---- カレンダー(月表示) ----
function renderCalendar(body, item, offset = 0) {
  body.textContent = '';
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);

  const head = document.createElement('div');
  head.className = 'cal-head';
  const prev = document.createElement('button');
  prev.className = 'cal-nav';
  prev.textContent = '‹';
  prev.addEventListener('click', () => renderCalendar(body, item, offset - 1));
  const label = document.createElement('span');
  label.textContent = `${base.getFullYear()}年${base.getMonth() + 1}月`;
  const next = document.createElement('button');
  next.className = 'cal-nav';
  next.textContent = '›';
  next.addEventListener('click', () => renderCalendar(body, item, offset + 1));
  head.append(prev, label, next);
  body.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
    const cell = document.createElement('span');
    cell.className = 'cal-weekday';
    cell.textContent = w;
    grid.appendChild(cell);
  }
  const firstDay = base.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('span'));
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('span');
    cell.className = 'cal-day';
    cell.textContent = String(d);
    if (
      offset === 0 &&
      d === today.getDate()
    ) {
      cell.classList.add('today');
    }
    const dow = (firstDay + d - 1) % 7;
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');
    grid.appendChild(cell);
  }
  body.appendChild(grid);
}

// ---- ニュース(RSS。メイン経由で取得し、DOMParserでパース) ----
const NEWS_PRESETS = [
  { label: 'NHKニュース', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
  { label: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml' },
];

function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  const source = doc.querySelector('channel > title, feed > title')?.textContent?.trim() ?? '';
  // RSS 2.0
  let entries = [...doc.querySelectorAll('item')].map((item) => ({
    title: item.querySelector('title')?.textContent?.trim() ?? '',
    link: item.querySelector('link')?.textContent?.trim() ?? '',
    date: new Date(item.querySelector('pubDate, date')?.textContent ?? 0).getTime() || 0,
    source,
  }));
  // Atom
  if (!entries.length) {
    entries = [...doc.querySelectorAll('entry')].map((entry) => ({
      title: entry.querySelector('title')?.textContent?.trim() ?? '',
      link: entry.querySelector('link')?.getAttribute('href') ?? '',
      date: new Date(entry.querySelector('updated, published')?.textContent ?? 0).getTime() || 0,
      source,
    }));
  }
  return entries.filter((e) => e.title && /^https?:/i.test(e.link));
}

async function renderNews(body, item) {
  const feeds = item.config.feeds ?? [];
  if (!feeds.length) {
    renderNewsSetup(body, item);
    return;
  }
  widgetNote(body, '読み込み中…');
  const xmls = await Promise.all(feeds.map((url) => window.roopieInternal.getRss(url)));
  const entries = xmls
    .filter(Boolean)
    .flatMap(parseFeed)
    .sort((a, b) => b.date - a.date)
    .slice(0, 8);
  body.textContent = '';
  if (!entries.length) {
    widgetNote(body, 'ニュースを取得できませんでした');
    return;
  }
  const list = document.createElement('div');
  list.className = 'news-list';
  for (const entry of entries) {
    const a = document.createElement('a');
    a.className = 'news-item';
    a.href = entry.link;
    a.title = `${entry.title}\n${entry.source}`;
    a.textContent = entry.title;
    list.appendChild(a);
  }
  body.appendChild(list);
}

function renderNewsSetup(body, item) {
  body.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'widget-setup';

  const feeds = (item.config.feeds ?? []).slice();
  const listEl = document.createElement('div');
  listEl.className = 'widget-setup-results';

  function save() {
    item.config.feeds = feeds;
    window.roopieInternal.setWidgetConfig(currentPageId, item.id, { feeds });
  }
  function renderList() {
    listEl.textContent = '';
    for (const [index, url] of feeds.entries()) {
      const row = document.createElement('div');
      row.className = 'widget-feed-row';
      const label = document.createElement('span');
      label.textContent = url;
      const remove = document.createElement('button');
      remove.className = 'widget-btn';
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        feeds.splice(index, 1);
        save();
        renderList();
      });
      row.append(label, remove);
      listEl.appendChild(row);
    }
  }
  renderList();

  const input = document.createElement('input');
  input.className = 'widget-input';
  input.type = 'text';
  input.placeholder = 'RSSフィードのURL';
  const addBtn = document.createElement('button');
  addBtn.className = 'widget-btn';
  addBtn.textContent = '追加';
  function addFeed(url) {
    const clean = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(clean) || feeds.includes(clean)) return;
    feeds.push(clean);
    save();
    renderList();
    input.value = '';
  }
  addBtn.addEventListener('click', () => addFeed(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFeed(input.value);
  });

  const row = document.createElement('div');
  row.className = 'widget-setup-row';
  row.append(input, addBtn);

  const presets = document.createElement('div');
  presets.className = 'widget-setup-row';
  for (const preset of NEWS_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'widget-btn';
    btn.textContent = `+ ${preset.label}`;
    btn.addEventListener('click', () => addFeed(preset.url));
    presets.appendChild(btn);
  }

  const done = document.createElement('button');
  done.className = 'widget-btn widget-btn-primary';
  done.textContent = '表示する';
  done.addEventListener('click', () => renderNews(body, item));

  wrap.append(row, presets, listEl, done);
  body.appendChild(wrap);
}

const WIDGET_RENDERERS = {
  weather: renderWeather,
  notepad: renderNotepad,
  calendar: (body, item) => renderCalendar(body, item, 0),
  news: renderNews,
};

// ---- ページ切り替え(複数ページ=startフォルダ直下の各サブフォルダ) ----
const pageDotsEl = document.getElementById('shortcut-pages');

function renderPageDots() {
  pageDotsEl.textContent = '';
  if (pages.length > 1) {
    for (const page of pages) {
      const dot = document.createElement('button');
      dot.className = 'page-dot' + (page.id === currentPageId ? ' active' : '');
      dot.title = page.title;
      dot.addEventListener('click', () => {
        currentPageId = page.id;
        renderPageDots();
        loadShortcuts();
      });
      pageDotsEl.appendChild(dot);
    }
  }
  const addDot = document.createElement('button');
  addDot.className = 'page-dot page-dot-add';
  addDot.title = 'ページを追加';
  addDot.textContent = '+';
  addDot.addEventListener('click', async () => {
    const page = await window.roopieInternal.addStartPage('');
    if (page) {
      currentPageId = page.id;
      await loadPages();
    }
  });
  pageDotsEl.appendChild(addDot);
}

async function loadShortcuts() {
  if (!currentPageId) {
    shortcuts = [];
    gridItems = [];
    renderGrid();
    return;
  }
  const [list, rawLayout] = await Promise.all([
    window.roopieInternal.listShortcuts(currentPageId),
    window.roopieInternal.getWidgetLayout(currentPageId),
  ]);
  shortcuts = list;
  gridItems = reconcileLayout(rawLayout, list);
  renderGrid();
}

async function loadPages() {
  pages = await window.roopieInternal.listStartPages();
  if (!pages.find((p) => p.id === currentPageId)) currentPageId = pages[0]?.id ?? null;
  renderPageDots();
  await loadShortcuts();
}

// ---- 追加/編集モーダル ----
function radioOption(name, value, label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'shortcut-kind-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  wrap.append(input, Object.assign(document.createElement('span'), { textContent: label }));
  return { wrap, input };
}

function openShortcutModal(existing) {
  const backdrop = document.createElement('div');
  backdrop.className = 'shortcut-backdrop';

  const modal = document.createElement('div');
  modal.className = 'shortcut-modal';

  const existingKind = existing ? shortcutKind(existing) : 'url';
  const existingTarget = existing ? shortcutTarget(existing) : '';

  const title = document.createElement('h3');
  title.textContent = existing ? 'ショートカットを編集' : 'ショートカットを追加';
  modal.appendChild(title);

  const kindRow = document.createElement('div');
  kindRow.className = 'shortcut-kind-row';
  const kindUrl = radioOption('shortcut-kind', 'url', 'ページ', existingKind !== 'folder');
  const kindFolder = radioOption('shortcut-kind', 'folder', 'フォルダ', existingKind === 'folder');
  kindRow.append(kindUrl.wrap, kindFolder.wrap);
  modal.appendChild(kindRow);

  const nameInput = document.createElement('input');
  nameInput.className = 'search';
  nameInput.type = 'text';
  nameInput.placeholder = '名前(空欄ならページタイトルを自動取得)';
  nameInput.value = existing?.title ?? '';
  modal.appendChild(nameInput);

  const urlInput = document.createElement('input');
  urlInput.className = 'search';
  urlInput.type = 'text';
  urlInput.placeholder = 'URL(例: example.com)';
  urlInput.value = existingKind !== 'folder' ? existingTarget : '';
  modal.appendChild(urlInput);

  let pickedFolder = existingKind === 'folder' ? existingTarget : '';
  const folderRow = document.createElement('div');
  folderRow.className = 'shortcut-folder-row';
  const folderPathText = document.createElement('span');
  folderPathText.className = 'shortcut-folder-path';
  folderPathText.textContent = pickedFolder || '未選択';
  const folderPickBtn = document.createElement('button');
  folderPickBtn.className = 'btn';
  folderPickBtn.textContent = 'フォルダを選択';
  folderPickBtn.addEventListener('click', async () => {
    const picked = await window.roopieInternal.pickShortcutFolder();
    if (picked) {
      pickedFolder = picked;
      folderPathText.textContent = picked;
    }
  });
  folderRow.append(folderPickBtn, folderPathText);
  modal.appendChild(folderRow);

  function syncKindVisibility() {
    const isFolder = kindFolder.input.checked;
    urlInput.classList.toggle('hidden', isFolder);
    folderRow.classList.toggle('hidden', !isFolder);
  }
  kindUrl.input.addEventListener('change', syncKindVisibility);
  kindFolder.input.addEventListener('change', syncKindVisibility);
  syncKindVisibility();

  // アイコン: プロファイルと同じ共通ピッカー(絵文字グリッド+自由入力+画像クロップ)。
  // 既定はリンク先のfavicon。pendingIcon: undefined=変更なし / null=既定に戻す / {type,value}=変更
  let pendingIcon;
  const iconRow = document.createElement('div');
  iconRow.className = 'shortcut-icon-row';
  const iconPreview = document.createElement('div');
  iconPreview.className = 'tile shortcut-icon-preview';
  const iconLabel = document.createElement('span');
  iconLabel.className = 'shortcut-icon-label';
  const iconBtn = document.createElement('button');
  iconBtn.className = 'btn';
  iconBtn.textContent = 'アイコンを変更';
  iconRow.append(iconPreview, iconLabel, iconBtn);
  modal.appendChild(iconRow);

  function renderIconPreview() {
    iconPreview.textContent = '';
    // プレビューは現在の入力内容(URL/フォルダ)を反映した仮のショートカットで描く
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    const preview = {
      title: nameInput.value.trim() || existing?.title || '?',
      url: kind === 'folder' ? `file://${target}` : /^https?:/i.test(target) ? target : `https://${target}`,
      favicon: existing?.favicon ?? null,
      icon: existing?.icon ?? null,
    };
    tileIconContent(iconPreview, preview, pendingIcon);
    const effective = pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null;
    iconLabel.textContent = effective ? 'カスタムアイコン' : '既定(リンク先のfavicon)';
  }
  urlInput.addEventListener('input', () => {
    // 既定アイコン表示中はURLに追随してプレビューを更新する
    if ((pendingIcon !== undefined ? pendingIcon : existing?.icon ?? null) === null) renderIconPreview();
  });
  iconBtn.addEventListener('click', () => {
    window.roopieIconPicker.open({
      resetLabel: '既定に戻す(favicon)',
      onPick: (icon) => {
        pendingIcon = icon; // null = 既定(favicon)に戻す
        renderIconPreview();
      },
    });
  });
  renderIconPreview();

  const actions = document.createElement('div');
  actions.className = 'shortcut-actions';

  if (existing) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => {
      window.roopieInternal.removeShortcut(existing.id);
      loadShortcuts();
      close();
    });
    actions.appendChild(removeBtn);
  }
  actions.appendChild(document.createElement('div')).className = 'spacer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const kind = kindFolder.input.checked ? 'folder' : 'url';
    let name = nameInput.value.trim();
    const target = kind === 'folder' ? pickedFolder : urlInput.value.trim();
    if (!target) return;
    if (!name) {
      if (kind !== 'url') return;
      // 名前が空欄ならページのタイトルを自動取得(失敗時はホスト名)
      saveBtn.disabled = true;
      saveBtn.textContent = 'タイトル取得中…';
      name = (await window.roopieInternal.fetchPageTitle(target)) || hostnameOf(target) || target;
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }

    if (existing) {
      const patch = { kind, title: name, target };
      if (pendingIcon !== undefined) patch.icon = pendingIcon; // null = 既定(favicon)に戻す
      window.roopieInternal.updateShortcut(existing.id, patch);
    } else {
      await window.roopieInternal.addShortcut(currentPageId, { kind, name, target, icon: pendingIcon ?? null });
    }
    await loadShortcuts();
    close();
  });
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  nameInput.focus();

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);
}

// ---- ローカルサーバーのサジェスト(起動中の localhost:PORT を検知して表示) ----
// 走査するのは代表的な開発ポートのみ。HTTP応答が返ったものだけを候補にする。
const localServersEl = document.getElementById('local-servers');
let localServerMenu = null;

function closeLocalServerMenu() {
  if (localServerMenu) {
    localServerMenu.remove();
    localServerMenu = null;
    document.removeEventListener('mousedown', onLocalServerDocDown, true);
    document.removeEventListener('keydown', onLocalServerKeydown, true);
  }
}
function onLocalServerDocDown(e) {
  if (localServerMenu && !localServerMenu.contains(e.target)) closeLocalServerMenu();
}
function onLocalServerKeydown(e) {
  if (e.key === 'Escape') closeLocalServerMenu();
}

// 右クリック:このサーバーを非表示にする(以後サジェストしない)
function showLocalServerMenu(x, y, port) {
  closeLocalServerMenu();
  const menu = document.createElement('div');
  menu.className = 'ls-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const hide = document.createElement('button');
  hide.className = 'ls-menu-item';
  hide.textContent = '非表示にする';
  hide.addEventListener('click', () => {
    window.roopieInternal.dismissLocalServer(port);
    closeLocalServerMenu();
    loadLocalServers();
  });
  menu.appendChild(hide);
  document.body.appendChild(menu);
  localServerMenu = menu;
  // 生成直後の同一クリックで閉じないよう、次のtickでリスナーを張る
  setTimeout(() => {
    document.addEventListener('mousedown', onLocalServerDocDown, true);
    document.addEventListener('keydown', onLocalServerKeydown, true);
  });
}

function localServerTile(server) {
  const a = document.createElement('a');
  a.className = 'quick-link';
  a.href = server.url;
  a.title = `${server.title || ''}\n${server.url}`.trim();

  const tile = document.createElement('div');
  tile.className = 'tile';
  if (server.favicon) {
    const img = document.createElement('img');
    img.src = server.favicon;
    tile.appendChild(img);
  } else {
    // faviconが無ければポート番号をプレースホルダに(ショートカットの頭文字と同じ見た目)
    const ph = document.createElement('span');
    ph.className = 'placeholder ls-port';
    ph.textContent = String(server.port);
    tile.appendChild(ph);
  }
  a.appendChild(tile);

  const label = document.createElement('span');
  label.className = 'label';
  // タイトルは信頼できない任意プロセスの文字列なので textContent で入れる
  label.textContent = server.title || `localhost:${server.port}`;
  a.appendChild(label);

  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showLocalServerMenu(e.clientX, e.clientY, server.port);
  });
  return a;
}

async function loadLocalServers() {
  const servers = await window.roopieInternal.listLocalServers();
  localServersEl.textContent = '';
  if (!servers.length) return;

  const heading = document.createElement('div');
  heading.className = 'ls-heading';
  heading.textContent = 'ローカルサーバー';
  localServersEl.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'ls-grid';
  for (const server of servers) grid.appendChild(localServerTile(server));
  localServersEl.appendChild(grid);
}

// 長く開きっぱなしのタブでも、後から起動したサーバーを反映する
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadLocalServers();
});

// 他のタブでの変更(追加/削除/名前変更など)を拾って再読み込みする
window.roopieInternal.onBookmarksState(() => loadPages());
loadPages();
loadLocalServers();
