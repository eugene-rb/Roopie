const MAX_QUICK_LINKS = 10;

const timeEl = document.getElementById('time');
const greetingEl = document.getElementById('greeting');
const searchEl = document.getElementById('search');
const quickLinksEl = document.getElementById('quick-links');

// ---- 時計 ----
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${hh}:${mm}`;

  const hour = now.getHours();
  const greeting =
    hour < 5 ? 'おやすみなさい' : hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'こんばんは';
  greetingEl.textContent = greeting;
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
    link.title = bookmark.url;

    if (bookmark.favicon) {
      const icon = document.createElement('img');
      icon.src = bookmark.favicon;
      link.appendChild(icon);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = (bookmark.title[0] || '?').toUpperCase();
      link.appendChild(placeholder);
    }

    const label = document.createElement('span');
    label.textContent = bookmark.title;
    link.appendChild(label);

    quickLinksEl.appendChild(link);
  }
}

window.roopieInternal.onBookmarksState((items) => renderQuickLinks(items));
renderQuickLinks();
