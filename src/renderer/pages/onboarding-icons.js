// イントロ(welcome)と変更点(whatsnew)で共通のアイコン。
// release-notes.json の highlights[].icon がこのキーを指す。
// 静的なインラインSVG文字列(外部参照なし)なのでCSPに抵触しない。
(() => {
  const ICONS = {
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    gesture: '<path d="M4 16h9a4 4 0 0 0 0-8H8"/><path d="M10 5L7 8l3 3"/>',
    update: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  };

  window.roopieObIcon = (key) => {
    const el = document.createElement('div');
    el.className = 'ob-card-icon';
    el.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[key] || ICONS.sparkle}</svg>`;
    return el;
  };

  // { icon, title, body } の配列から機能カードを作る
  window.roopieObCards = (items) => {
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'ob-card';
      const title = document.createElement('div');
      title.className = 'ob-card-title';
      title.textContent = item.title;
      const body = document.createElement('div');
      body.className = 'ob-card-body';
      body.textContent = item.body;
      card.append(window.roopieObIcon(item.icon), title, body);
      frag.appendChild(card);
    }
    return frag;
  };
})();
