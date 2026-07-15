// アドレスバー・ドラッグ検索・右クリック検索で共通して使う検索エンジンの定義
const SEARCH_ENGINES = {
  google: { name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  duckduckgo: { name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  yahoo: { name: 'Yahoo!検索', url: (q) => `https://search.yahoo.co.jp/search?p=${encodeURIComponent(q)}` },
  bing: { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  ecosia: { name: 'Ecosia', url: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}` },
  startpage: { name: 'Startpage', url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
};

const DEFAULT_ENGINE = 'google';

function searchUrl(engineId, query) {
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES[DEFAULT_ENGINE];
  return engine.url(query);
}

module.exports = { SEARCH_ENGINES, DEFAULT_ENGINE, searchUrl };
