// AIアシスタント(Webパネルとして開く外部サービス)のプリセット一覧。
// ここに追加すればサイドパネルのクイック追加に自動で並ぶ。
// url は各サービスの新規チャット画面。ログインはWebパネル(プロファイルのセッション)で行う。
const AI_PROVIDERS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { id: 'manus', name: 'Manus', url: 'https://manus.im/' },
];

function findProvider(id) {
  return AI_PROVIDERS.find((p) => p.id === id) || null;
}

module.exports = { AI_PROVIDERS, findProvider };
