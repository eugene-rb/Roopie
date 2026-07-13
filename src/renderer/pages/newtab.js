const MAX_QUICK_LINKS = 10;

const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const greetingEl = document.getElementById('greeting');
const searchEl = document.getElementById('search');
const quickLinksEl = document.getElementById('quick-links');

// ---- 背景(テーマ設定が auto なら時間帯で切り替え) ----
let themeBackground = 'auto';

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
}

// theme.js から呼ばれる(初期化時とテーマ変更時)
window.onRoopieTheme = (theme) => {
  themeBackground = theme.background || 'auto';
  applyBackground();
};

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

// ---- クイックリンク(ブックマーク) ----
async function renderQuickLinks(items) {
  const bookmarks = items ?? (await window.roopieInternal.listBookmarks());
  quickLinksEl.textContent = '';

  for (const bookmark of bookmarks.slice(0, MAX_QUICK_LINKS)) {
    const link = document.createElement('a');
    link.className = 'quick-link';
    link.href = bookmark.url;
    link.title = `${bookmark.title}\n${bookmark.url}`;

    const tile = document.createElement('div');
    tile.className = 'tile';
    if (bookmark.favicon) {
      const icon = document.createElement('img');
      icon.src = bookmark.favicon;
      tile.appendChild(icon);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = (bookmark.title[0] || '?').toUpperCase();
      tile.appendChild(placeholder);
    }
    link.appendChild(tile);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = bookmark.title;
    link.appendChild(label);

    quickLinksEl.appendChild(link);
  }
}

window.roopieInternal.onBookmarksState((items) => renderQuickLinks(items));
renderQuickLinks();
