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
