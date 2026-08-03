const listEl = document.getElementById('list');
const clearBtn = document.getElementById('clear-btn');

const STATE_LABELS = {
  progressing: 'ダウンロード中',
  paused: '一時停止中',
  completed: '完了',
  cancelled: 'キャンセル済み',
  interrupted: '中断されました',
};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function render(items) {
  listEl.textContent = '';

  if (items.length === 0) {
    listEl.appendChild(window.roopieEmptyState('ダウンロードしたファイルはありません', { icon: 'download' }));
    return;
  }

  for (const item of items) {
    listEl.appendChild(createRow(item));
  }
}

function createRow(item) {
  const row = document.createElement('div');
  row.className = 'row';

  const main = document.createElement('div');
  main.className = 'main';

  const name = document.createElement('span');
  name.className = 'title';
  name.textContent = item.filename;
  main.appendChild(name);

  const inProgress = item.state === 'progressing' || item.state === 'paused';
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = inProgress
    ? `${STATE_LABELS[item.state]} — ${formatBytes(item.receivedBytes)} / ${
        item.totalBytes ? formatBytes(item.totalBytes) : '不明'
      }`
    : `${STATE_LABELS[item.state] ?? item.state} — ${item.savePath || item.url}`;
  main.appendChild(sub);

  if (inProgress && item.totalBytes) {
    const progress = document.createElement('div');
    progress.className = 'progress';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.round((item.receivedBytes / item.totalBytes) * 100)}%`;
    progress.appendChild(fill);
    main.appendChild(progress);
  }

  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const addAction = (label, onClick) => {
    const btn = document.createElement('button');
    btn.className = 'row-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    actions.appendChild(btn);
  };

  if (item.state === 'progressing') {
    addAction('一時停止', () => window.roopieInternal.pauseDownload(item.id));
    addAction('キャンセル', () => window.roopieInternal.cancelDownload(item.id));
  } else if (item.state === 'paused') {
    addAction('再開', () => window.roopieInternal.resumeDownload(item.id));
    addAction('キャンセル', () => window.roopieInternal.cancelDownload(item.id));
  } else {
    if (item.state === 'completed') {
      addAction('開く', () => window.roopieInternal.openDownload(item.id));
      addAction('フォルダを表示', () => window.roopieInternal.showDownloadInFolder(item.id));
    }
    addAction('削除', () => window.roopieInternal.removeDownload(item.id));
  }

  row.appendChild(actions);
  return row;
}

clearBtn.addEventListener('click', () => window.roopieInternal.clearDownloads());
window.roopieInternal.onDownloadsState((state) => render(state.items));

window.roopieInternal.listDownloads().then(render);
