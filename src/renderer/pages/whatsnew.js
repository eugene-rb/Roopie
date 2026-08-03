// アップデート後の初回起動で開く「変更点」。release-notes.json の内容を表示する。
// 開いた時点で「見た」と記録するので、次の起動からは出ない。
// 設定画面の「変更履歴」からはいつでも(?all を付けて全件)開ける。
const api = window.roopieInternal;
const showAll = location.search.includes('all');

api.getAppInfo().then((info) => {
  document.getElementById('version-badge').textContent = `バージョン ${info.version}`;

  // 前回見たところより新しいものだけを出す(初回・?all のときは全件)
  const seenAt = info.notes.findIndex((n) => n.version === info.seenNotes);
  const fresh = showAll || seenAt < 0 ? info.notes : info.notes.slice(0, seenAt);
  const list = fresh.length ? fresh : info.notes.slice(0, 1);

  if (list[0]) {
    document.getElementById('title').textContent = list[0].title;
    document.getElementById('summary').textContent = list[0].summary || '';
  }

  const host = document.getElementById('notes');
  list.forEach((note, i) => {
    // 2件目以降は見出しを付けて区切る(何世代かまとめて上がったとき用)
    if (i > 0) {
      const heading = document.createElement('h2');
      heading.className = 'ob-title';
      heading.textContent = note.title;
      host.appendChild(heading);
    }
    const cards = document.createElement('div');
    cards.className = 'ob-cards';
    cards.appendChild(window.roopieObCards(note.highlights || []));
    host.appendChild(cards);
  });

  if (!showAll) api.notesSeen();
});

document.getElementById('close').addEventListener('click', () => {
  api.navigate('roopie://newtab');
});
