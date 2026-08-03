const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const clearBtn = document.getElementById('clear-btn');

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) => a.toDateString() === b.toDateString();
  if (isSameDay(date, today)) return '今日';
  if (isSameDay(date, yesterday)) return '昨日';
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function render() {
  const entries = await window.roopieInternal.listHistory(searchEl.value);
  listEl.textContent = '';

  if (entries.length === 0) {
    listEl.appendChild(
      searchEl.value
        ? window.roopieEmptyState('一致する履歴はありません', { icon: 'search' })
        : window.roopieEmptyState('履歴はまだありません', { icon: 'clock' })
    );
    return;
  }

  let currentDate = null;
  for (const entry of entries) {
    const date = formatDate(entry.visitedAt);
    if (date !== currentDate) {
      currentDate = date;
      const heading = document.createElement('div');
      heading.className = 'date-heading';
      heading.textContent = date;
      listEl.appendChild(heading);
    }
    listEl.appendChild(createRow(entry));
  }
}

function createRow(entry) {
  const row = document.createElement('div');
  row.className = 'row';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(entry.visitedAt);
  row.appendChild(time);

  if (entry.favicon) {
    const icon = document.createElement('img');
    icon.className = 'favicon';
    icon.src = entry.favicon;
    row.appendChild(icon);
  }

  const main = document.createElement('div');
  main.className = 'main';

  const link = document.createElement('a');
  link.className = 'title';
  link.href = entry.url;
  link.textContent = entry.title;
  main.appendChild(link);

  const url = document.createElement('span');
  url.className = 'sub';
  url.textContent = entry.url;
  main.appendChild(url);
  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'row-btn';
  removeBtn.textContent = '削除';
  removeBtn.addEventListener('click', () => {
    window.roopieInternal.removeHistory(entry.id);
    render();
  });
  actions.appendChild(removeBtn);
  row.appendChild(actions);

  return row;
}

searchEl.addEventListener('input', render);
clearBtn.addEventListener('click', () => {
  window.roopieInternal.clearHistory();
  render();
});

render();
