/**
 * 翻訳の下請け。言語の表・訳文の取得・キャッシュ・「読めない言語か」の判定を持つ。
 *
 * 訳文は Google翻訳のWebエンドポイント(`translate_a/t`)から取る。キーは不要で、
 * `q` を複数並べればまとめて訳せる(応答は `[["訳文","検出した言語"], ...]` の並び)。
 *
 * **通信は要求元と同じ経路(プロキシ)で行う**。既定セッションで投げると、Torを
 * 有効にしたプロファイルのページの文面がTorの外へ出てしまう。ただし**ページの
 * セッションそのものでは投げない**(`fetchSessionFor` の注意書きを参照)。
 */

const { session: electronSession } = require('electron');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/t';
// 1回の要求に詰める上限。多すぎると414/413で落ちるので、文字数と本数の両方で切る
const MAX_SEGMENTS = 64;
const MAX_CHARS = 1600;
// 1本が長すぎる文(巨大なテキストノード)はエンドポイントが受け取れないので諦める
const MAX_SEGMENT_CHARS = 4000;
const TIMEOUT = 20000;
// 同じ文面(ナビゲーションのラベルなど)を訳し直さないためのキャッシュ
const CACHE_LIMIT = 4000;
// 訳す価値がある断片か(数字・記号・空白だけの断片は送らない)
const HAS_LETTER = /\p{L}/u;

// 翻訳先に選べる言語。Chrome/Edgeの一覧からよく使うものを抜いたもの
const LANGS = [
  { code: 'ja', name: '日本語' },
  { code: 'en', name: '英語' },
  { code: 'zh-CN', name: '中国語(簡体)' },
  { code: 'zh-TW', name: '中国語(繁体)' },
  { code: 'ko', name: '韓国語' },
  { code: 'fr', name: 'フランス語' },
  { code: 'de', name: 'ドイツ語' },
  { code: 'es', name: 'スペイン語' },
  { code: 'pt', name: 'ポルトガル語' },
  { code: 'it', name: 'イタリア語' },
  { code: 'ru', name: 'ロシア語' },
  { code: 'uk', name: 'ウクライナ語' },
  { code: 'pl', name: 'ポーランド語' },
  { code: 'nl', name: 'オランダ語' },
  { code: 'sv', name: 'スウェーデン語' },
  { code: 'tr', name: 'トルコ語' },
  { code: 'ar', name: 'アラビア語' },
  { code: 'he', name: 'ヘブライ語' },
  { code: 'hi', name: 'ヒンディー語' },
  { code: 'th', name: 'タイ語' },
  { code: 'vi', name: 'ベトナム語' },
  { code: 'id', name: 'インドネシア語' },
  { code: 'ms', name: 'マレー語' },
  { code: 'fil', name: 'フィリピン語' },
  { code: 'el', name: 'ギリシャ語' },
  { code: 'cs', name: 'チェコ語' },
  { code: 'hu', name: 'ハンガリー語' },
  { code: 'ro', name: 'ルーマニア語' },
  { code: 'fi', name: 'フィンランド語' },
  { code: 'da', name: 'デンマーク語' },
  { code: 'no', name: 'ノルウェー語' },
  { code: 'fa', name: 'ペルシア語' },
  { code: 'bn', name: 'ベンガル語' },
  { code: 'ta', name: 'タミル語' },
];
const LANG_NAMES = new Map(LANGS.map((l) => [l.code, l.name]));
const DEFAULT_TARGET = 'ja';

// 表記に使う文字の系統。宣言(<html lang>)が無いページを見分けるのに使う
const SCRIPTS = [
  ['kana', /[぀-ヿ]/u],
  ['han', /[㐀-䶿一-鿿豈-﫿]/u],
  ['hangul', /[ᄀ-ᇿ가-힯㄰-㆏]/u],
  ['cyrillic', /[Ѐ-ӿ]/u],
  ['greek', /[Ͱ-Ͽ]/u],
  ['arabic', /[؀-ۿݐ-ݿ]/u],
  ['hebrew', /[֐-׿]/u],
  ['devanagari', /[ऀ-ॿ]/u],
  ['bengali', /[ঀ-৿]/u],
  ['tamil', /[஀-௿]/u],
  ['thai', /[฀-๿]/u],
  ['latin', /[A-Za-zÀ-ɏ]/u],
];
// 言語ごとに「その言語ならこの系統で書かれているはず」という対応
const LANG_SCRIPTS = {
  ja: ['kana', 'han'],
  zh: ['han'],
  ko: ['hangul', 'han'],
  ru: ['cyrillic'],
  uk: ['cyrillic'],
  el: ['greek'],
  ar: ['arabic'],
  fa: ['arabic'],
  he: ['hebrew'],
  hi: ['devanagari'],
  bn: ['bengali'],
  ta: ['tamil'],
  th: ['thai'],
};
// 系統を見て判定するのに必要な最低の文字数(短すぎる本文では判定しない)
const MIN_SAMPLE_LETTERS = 24;
// 系統が一致する文字の割合。これを下回ったら「別の言語で書かれている」とみなす
const SAME_SCRIPT_RATIO = 0.1;

/** 'en-US' → 'en'。中国語だけは簡体/繁体を別扱いするため 'zh-CN' / 'zh-TW' のまま返す */
function baseLang(code) {
  const value = String(code ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('zh')) {
    if (/hant|tw|hk|mo/.test(value)) return 'zh-TW';
    return 'zh-CN';
  }
  return value.split(/[-_]/)[0];
}

/** 一覧に無いコードは既定(日本語)へ丸める。設定の保存・IPCの受け口で使う */
function normalizeLang(code, fallback = DEFAULT_TARGET) {
  const value = String(code ?? '').trim();
  if (LANG_NAMES.has(value)) return value;
  const base = baseLang(value);
  if (LANG_NAMES.has(base)) return base;
  // 'zh' 系は baseLang が zh-CN/zh-TW を返すのでここには来ない
  return fallback;
}

/** 言語の表示名。知らないコードはそのまま返す(検出結果は一覧より広いことがある) */
function langName(code) {
  const value = String(code ?? '').trim();
  return LANG_NAMES.get(value) ?? LANG_NAMES.get(baseLang(value)) ?? value;
}

/** その文字がどの系統か(該当なしは null) */
function scriptOf(char) {
  for (const [name, re] of SCRIPTS) if (re.test(char)) return name;
  return null;
}

/**
 * 本文の見本から「翻訳先の言語では書かれていない」と言えるか。
 * ネットワークを使わずに済ませるための当たりで、確定は最初の訳文が返す検出結果で行う。
 */
function looksForeign(target, declaredLang, sample) {
  const targetBase = baseLang(target) || DEFAULT_TARGET;
  const declared = baseLang(declaredLang);
  // ページが自分で言語を宣言しているならそれに従う(最も確実)
  if (declared) return declared !== targetBase;

  const text = String(sample ?? '');
  const expected = LANG_SCRIPTS[targetBase] ?? ['latin'];
  let letters = 0;
  let matched = 0;
  for (const char of text) {
    const script = scriptOf(char);
    if (!script) continue;
    letters++;
    if (expected.includes(script)) matched++;
  }
  if (letters < MIN_SAMPLE_LETTERS) return false; // 判断できるだけの本文が無い
  return matched / letters < SAME_SCRIPT_RATIO;
}

// ---- 訳文の取得 ----

const cache = new Map(); // `${target}\n${原文}` -> 訳文

function cacheGet(target, text) {
  return cache.get(`${target}\n${text}`);
}

function cacheSet(target, text, translated) {
  const key = `${target}\n${text}`;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, translated);
  // 溢れたら古いものから捨てる(Mapは挿入順)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function clearCache() {
  cache.clear();
}

/** 文字数と本数で小分けにする(1回の要求の上限を超えないように) */
function chunk(texts) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length >= MAX_SEGMENTS || (current.length && chars + text.length > MAX_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * `translate_a/t` の応答を訳文の配列に開く。
 * `sl=auto` では `[["訳文","検出言語"], ...]`、言語を明示したときは文字列の配列で返る。
 */
function parseResponse(json, count) {
  if (!Array.isArray(json)) throw new Error('翻訳の応答が配列ではありません');
  const texts = [];
  const detected = [];
  for (const item of json) {
    if (Array.isArray(item)) {
      texts.push(String(item[0] ?? ''));
      if (typeof item[1] === 'string' && item[1]) detected.push(item[1]);
    } else {
      texts.push(String(item ?? ''));
    }
  }
  if (texts.length !== count) throw new Error(`翻訳の応答の数が合いません(${texts.length}/${count})`);
  return { texts, detected };
}

// ---- 訳文の取得に使うセッション ----
//
// **ページのセッションで直接 fetch してはいけない**。拡張機能を入れていると
// electron-chrome-extensions がそのセッションに webRequest を張っており、そこへ
// メインプロセスから(=どのタブにも紐づかない)要求を投げるとアプリごと落ちる。
// 「翻訳するとRoopieが終了する」の原因はこれだった(拡張が1つも無いと落ちない)。
//
// 一方で通信の経路は変えられない(Torのプロファイルの文面をTorの外へ出さない)。
// そこで**プロキシ設定だけ引き継いだ専用セッション**を使う。非永続なのでCookieも
// 履歴も残らず、ページのCookieを翻訳の要求に載せずに済む(こちらの方が望ましい)。

const fetchSessions = new WeakMap(); // ページのセッション -> { session, proxy }
let fetchSessionSeq = 0;

/** `resolveProxy` の書式("SOCKS5 127.0.0.1:9050" 等)を `setProxy` の proxyRules に直す */
function proxyRulesOf(resolved) {
  const first = String(resolved ?? '').split(';')[0].trim();
  if (!first || /^DIRECT$/i.test(first)) return '';
  const [type, hostPort] = first.split(/\s+/);
  const scheme = {
    PROXY: 'http',
    HTTPS: 'https',
    SOCKS: 'socks4',
    SOCKS4: 'socks4',
    SOCKS5: 'socks5',
  }[String(type).toUpperCase()];
  return scheme && hostPort ? `${scheme}://${hostPort}` : '';
}

/** ページのセッションと同じ経路で通信する、翻訳専用のセッションを返す */
async function fetchSessionFor(pageSession) {
  if (!pageSession) throw new Error('翻訳に使うセッションがありません');
  let entry = fetchSessions.get(pageSession);
  if (!entry) {
    entry = { session: electronSession.fromPartition(`roopie-translate-${++fetchSessionSeq}`), proxy: null };
    fetchSessions.set(pageSession, entry);
  }
  // Torのオン/オフはプロファイルの途中で変わるので、そのつど追随させる
  const rules = proxyRulesOf(await pageSession.resolveProxy(ENDPOINT));
  if (entry.proxy !== rules) {
    await entry.session.setProxy(rules ? { proxyRules: rules } : { mode: 'direct' });
    entry.proxy = rules;
  }
  return entry.session;
}

async function requestChunk(texts, { targetLang, session, signal }) {
  const params = new URLSearchParams();
  params.set('client', 'gtx');
  params.set('sl', 'auto');
  params.set('tl', targetLang);
  params.set('format', 'text');
  const body = new URLSearchParams();
  for (const text of texts) body.append('q', text);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await session.fetch(`${ENDPOINT}?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`翻訳の要求が失敗しました(HTTP ${res.status})`);
    return parseResponse(await res.json(), texts.length);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * まとめて訳す。キャッシュにある分は通信せず、残りだけを小分けにして順番に投げる。
 * 途中で失敗したら例外を投げる(呼び出し側はDOMを触らずに「翻訳できませんでした」を出す)。
 *
 * @returns {Promise<{ texts: string[], source: string|null }>} 入力と同じ並びの訳文と、検出した言語
 */
async function translateTexts(texts, { targetLang, session, signal } = {}) {
  const target = normalizeLang(targetLang);
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? ''));
  const result = new Array(list.length);
  const pending = [];
  for (let i = 0; i < list.length; i++) {
    const text = list[i];
    // 文字を含まない断片(空白・数字・記号だけ)は訳さずそのまま返す。
    // 送っても意味が無い上に、応答は前後の空白を落として返すので見た目が崩れる
    if (!HAS_LETTER.test(text) || text.length > MAX_SEGMENT_CHARS) {
      result[i] = text;
      continue;
    }
    const hit = cacheGet(target, text);
    if (hit !== undefined) result[i] = hit;
    else pending.push({ index: i, text });
  }

  const counts = new Map(); // 検出言語 -> 件数(いちばん多いものをページの言語とする)
  let done = 0; // pending のうち訳し終えた本数(小分けの並びは pending と同じ順)
  const fetchSession = pending.length ? await fetchSessionFor(session) : null;
  for (const group of chunk(pending.map((p) => p.text))) {
    if (signal?.aborted) throw new Error('翻訳を中断しました');
    const { texts: translated, detected } = await requestChunk(group, {
      targetLang: target,
      session: fetchSession,
      signal,
    });
    for (let i = 0; i < group.length; i++) {
      const { index, text } = pending[done + i];
      const value = translated[i] ?? text;
      result[index] = value;
      cacheSet(target, text, value);
    }
    done += group.length;
    for (const lang of detected) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }

  let source = null;
  let best = 0;
  for (const [lang, count] of counts) {
    if (count > best) {
      best = count;
      source = lang;
    }
  }
  return { texts: result, source };
}

module.exports = {
  translateTexts,
  fetchSessionFor,
  proxyRulesOf,
  looksForeign,
  normalizeLang,
  baseLang,
  langName,
  clearCache,
  LANGS,
  DEFAULT_TARGET,
  MAX_SEGMENTS,
  MAX_CHARS,
};
