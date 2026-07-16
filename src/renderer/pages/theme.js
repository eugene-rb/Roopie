// 全内部ページ共通のヘルパー: Preline風の空状態(アイコン+文言)を1関数で作る。
// 各内部ページ(履歴/DL/ブックマーク/サイドパネル等)が同じ見た目の空状態を出せるようにする。
// text: 表示文言 / opts.icon: 下のICONSのキー / opts.variant: 'block'(全面) | 'note'(パネル内の小型)
(() => {
  const ICONS = {
    inbox: '<path d="M3 12h5l1.5 3h5L16 12h5"/><path d="M4 12l2.5-7h11L20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 1 2-2h11"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  };

  window.roopieEmptyState = (text, opts = {}) => {
    const el = document.createElement('div');
    el.className = opts.variant === 'note' ? 'empty-note' : 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    // 静的なインラインSVG文字列(外部参照なし)なのでCSPに抵触しない
    icon.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[opts.icon] || ICONS.inbox}</svg>`;
    const label = document.createElement('div');
    label.className = 'empty-title';
    label.textContent = text;
    el.append(icon, label);
    return el;
  };
})();

// 全内部ページ共通のテーマ適用スクリプト。
// アクセントカラーをCSS変数へ、カスタムCSSをadoptedStyleSheetsへ反映する。
// (adoptedStyleSheets はCSSOM経由なので、CSPの style-src 'self' に妨げられない)
(() => {
  const customSheet = new CSSStyleSheet();

  function applyTheme(theme) {
    if (!theme) return;
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.dataset.background = theme.background;
    try {
      customSheet.replaceSync(theme.customCss || '');
    } catch {
      // 不正なCSSは無視(パースできた分だけ反映される)
    }
    document.adoptedStyleSheets = [customSheet];
    // ページ固有の追随処理(新しいタブの背景など)。
    // newtab.js側のスクリプト読み込みより先にこのPromiseが解決した場合に備えて
    // 直近のテーマを保持しておき、フック登録後すぐに拾えるようにする
    window.__roopieLastTheme = theme;
    window.onRoopieTheme?.(theme);
  }

  window.roopieInternal.onThemeState(applyTheme);
  window.roopieInternal.getTheme().then(applyTheme);
})();
