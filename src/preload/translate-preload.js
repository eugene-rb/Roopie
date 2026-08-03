/**
 * ページ翻訳の本体(全ページのpreload。**分離ワールド**で走る)。
 *
 * DOMのテキストノードだけを訳文に差し替える。メインワールドには何も置かない
 * (media-guard-preload.js はページ側のAPIを塞ぐためメインワールドへ入るが、
 *  こちらはDOMを触るだけなので分離ワールドで足りる)。
 *
 * 訳文の取得はメイン(`translate:texts`)に任せる。ここは「どの文を訳すか」「どう戻すか」だけを持つ。
 * 原文はノードごとに控えるので、元に戻すのは逆翻訳ではなく**控えた原文の書き戻し**。
 *
 * メインからの指示は `webContents.send` = メインフレームにしか届かない。iframeの中のこの
 * preloadは何もせず待つ(将来フレームごとに送るなら framesInSubtree + frame.send)。
 */

const { ipcRenderer } = require('electron');

const MAX_NODES = 4000; // 1回の走査で拾うテキストノードの上限(巨大なページで固まらないように)
const CHUNK_SEGMENTS = 48; // 1回の要求に渡す本数。訳し終えた分から順に反映していく
const CHUNK_CHARS = 1200;
const RETRANSLATE_LIMIT = 6; // 同じノードを訳し直す上限。ページ側の書き戻しとの綱引きを止める
const OBSERVE_DELAY = 700; // 増えた文をまとめて訳すまでの待ち
const SAMPLE_CHARS = 600; // 言語の当たりを付けるための本文の見本
const HAS_LETTER = /\p{L}/u;

// 中身を訳さない要素(コードやプログラムの断片、入力欄、図形)
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TT', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'MATH',
]);

const isTop = window === window.top;
const isWeb = location.protocol === 'http:' || location.protocol === 'https:';

let state = 'none'; // 'none' | 'translating' | 'done' | 'error'
let sourceLang = null; // 訳文と一緒に返ってくる検出結果(表示用)
let records = new Map(); // テキストノード -> { original, translated, count }
let observer = null;
let observeTimer = null;
let busy = false;
let queued = false; // 訳している間に増えた分。終わってからもう一度走る
let generation = 0; // 元に戻す/やり直しで世代を上げ、古い応答を捨てる

// ---- メインとのやりとり ----

ipcRenderer.on('translate:start', (_e, payload) => {
  if (!isWeb) return;
  // 別の言語へ訳し直すときは先に原文へ戻す(訳文をさらに訳さないため)
  if (payload?.retranslate) restore();
  translatePage().catch(() => {});
});

ipcRenderer.on('translate:restore', () => restore());

function report(error) {
  ipcRenderer.send('translate:progress', {
    state,
    source: sourceLang,
    nodes: records.size,
    error: error ? String(error.message ?? error) : null,
  });
}

// ---- 訳す対象を集める ----

// 祖先に「訳さない要素」があるか。translate="no" と contenteditable も尊重する
function isSkipped(element) {
  for (let el = element; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName?.toUpperCase?.() ?? '')) return true;
    if (el.isContentEditable) return true;
    if (el.translate === false) return true;
    if (el.classList?.contains('notranslate')) return true;
  }
  return false;
}

// 訳す価値があるテキストノードか
function wanted(node) {
  const value = node.nodeValue;
  if (!value || !HAS_LETTER.test(value)) return false;
  const record = records.get(node);
  if (record) {
    if (record.translated === value) return false; // 自分が書いた訳文のまま
    if (record.count >= RETRANSLATE_LIMIT) return false; // ページ側と綱引きになっている
  }
  return !isSkipped(node.parentElement);
}

// 訳す断片。前後の空白は訳文から落ちてしまう(要素の間の空きが詰まる)ので、
// 中身だけを訳して空白は自分で付け直す
function segmentFor(node) {
  const value = node.nodeValue;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  return { node, lead: match[1], core: match[2], trail: match[3] };
}

function collect() {
  const root = document.body ?? document.documentElement;
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (wanted(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const segments = [];
  while (segments.length < MAX_NODES && walker.nextNode()) segments.push(segmentFor(walker.currentNode));
  return segments;
}

// 本数と文字数で小分けにする(訳し終えた分から順に画面へ出す)
function chunk(segments) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const segment of segments) {
    if (current.length >= CHUNK_SEGMENTS || (current.length && chars + segment.core.length > CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.core.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ---- 差し替えと書き戻し ----

// 書き込みの間だけ見張りを外す。付けたままだと自分の書き込みで走査が走り、
// 訳す→書く→走査→訳す…の無限ループになる(disconnectは溜まった通知も捨てる)
function apply(segments, texts) {
  stopObserving();
  for (let i = 0; i < segments.length; i++) {
    const { node, lead, core, trail } = segments[i];
    if (!node.isConnected) continue;
    const translated = texts[i];
    const original = records.get(node)?.original ?? lead + core + trail;
    const value = translated ? lead + translated + trail : node.nodeValue;
    const count = (records.get(node)?.count ?? 0) + 1;
    if (node.nodeValue !== value) node.nodeValue = value;
    // 訳文が原文と同じ(訳す必要が無かった)場合も控えておく。控えないと毎回また拾ってしまう
    records.set(node, { original, translated: value, count });
  }
  startObserving();
}

// 原文へ書き戻す。**状態の報告はしない**(戻す指示はメイン発で、向こうが先に
// 状態を決めている。ここから 'none' を送るとその判断を上書きしてしまう)
function restore() {
  generation++;
  stopObserving();
  clearTimeout(observeTimer);
  for (const [node, record] of records) {
    // ページ側が後から書き換えたノードは触らない(訳文のままのものだけ戻す)
    if (node.isConnected && node.nodeValue === record.translated) node.nodeValue = record.original;
  }
  records = new Map();
  state = 'none';
  sourceLang = null;
  busy = false;
  queued = false;
}

// ---- 翻訳の実行 ----

async function translatePage() {
  if (busy) {
    queued = true;
    return;
  }
  const first = state !== 'done'; // 最初の翻訳(途中で失敗したら全部戻す)
  busy = true;
  const myGeneration = generation;
  if (first) {
    state = 'translating';
    report();
  }
  try {
    const chunks = chunk(collect());
    for (const segments of chunks) {
      const result = await ipcRenderer.invoke('translate:texts', { texts: segments.map((s) => s.core) });
      if (myGeneration !== generation) return; // 元に戻された/やり直された
      if (!result?.ok) throw new Error(result?.error || '翻訳できませんでした');
      apply(segments, result.texts ?? []);
      if (result.source && !sourceLang) sourceLang = result.source;
    }
    state = 'done';
    startObserving();
    report();
  } catch (err) {
    if (myGeneration !== generation) return;
    // 最初の翻訳で失敗したら中途半端に訳された画面を残さない(戻してからエラーを伝える)
    if (first) {
      const restoreOnly = records;
      records = new Map();
      stopObserving();
      for (const [node, record] of restoreOnly) {
        if (node.isConnected && node.nodeValue === record.translated) node.nodeValue = record.original;
      }
      state = 'error';
    }
    report(err);
  } finally {
    busy = false;
    if (queued) {
      queued = false;
      if (state === 'done') schedulePass();
    }
  }
}

// ---- 後から増えた文 ----

function startObserving() {
  if (state !== 'done' && state !== 'translating') return;
  const root = document.body ?? document.documentElement;
  if (!root) return;
  if (!observer) observer = new MutationObserver(onMutations);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}

function stopObserving() {
  observer?.disconnect();
}

function onMutations() {
  if (state !== 'done') return;
  schedulePass();
}

function schedulePass() {
  clearTimeout(observeTimer);
  observeTimer = setTimeout(() => {
    if (state === 'done') translatePage().catch(() => {});
  }, OBSERVE_DELAY);
}

// ---- 言語の当たり(自動提案の判定材料) ----
//
// 本文の見本をメインへ渡すだけ。判定(読める言語か)と提案の可否はメインが持つ。
// 見本は textContent ではなく走査で集める(scriptやstyleの中身が混ざると英語だと誤判定する)
function sample() {
  const root = document.body;
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeValue && HAS_LETTER.test(node.nodeValue) && !isSkipped(node.parentElement)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  let text = '';
  while (text.length < SAMPLE_CHARS && walker.nextNode()) text += `${walker.currentNode.nodeValue.trim()} `;
  return text.slice(0, SAMPLE_CHARS);
}

function reportPageInfo() {
  ipcRenderer.send('translate:page-info', {
    lang: document.documentElement?.getAttribute('lang') ?? '',
    sample: sample(),
  });
}

if (isTop && isWeb) {
  // 2回送る(1回目は本文がまだ空のことがある。メインは中身のある方を採る)
  window.addEventListener('DOMContentLoaded', () => setTimeout(reportPageInfo, 0));
  window.addEventListener('load', () => setTimeout(reportPageInfo, 400));
}
