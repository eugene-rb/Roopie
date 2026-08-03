/**
 * ページ翻訳・選択テキストの翻訳の取り回し(Edge準拠)。
 *
 * - 状態は **タブごと**(`tab.translate`)に持つ。タブのオブジェクトに載せるので、
 *   ウィンドウ間でタブを移しても一緒に運ばれる(URLで作り直す方式ではないため)。
 * - 差し替えの実務は分離ワールドのpreload(`src/preload/translate-preload.js`)。
 *   ここは「訳す/戻す」の指示と、訳文の取得(要求元のセッションで通信)を担う。
 * - 設定は**プロファイル単位**(`translateTargetLang` ほか)。翻訳先の言語やサイトの除外は
 *   プロファイルごとに別で持つ。
 * - 確認のドロップダウンはオーバーレイ(`roopie://menu` の #translate-popup)。
 *   アンカー(アドレスバーの翻訳アイコン)の位置はツールバーしか知らないので、
 *   サイトの権限と同じく「ツールバーへ知らせる → 測って戻してもらう」経路で開く。
 */

const windows = require('./windows');
const translate = require('./translate');

const MAX_SITES = 300; // 「このサイトは翻訳しない」の記憶件数
const MAX_LANGS = 60;
const MAX_SELECTION = 2000; // 選択テキストの翻訳で受け付ける長さ
const MAX_TEXTS = 200; // preloadから1回に受け取る本数
const MAX_TEXT_CHARS = 5000;
const OFFERED_LIMIT = 300;

// 選択テキストの翻訳結果(ポップアップを開くまでの預かり)。ctx -> { text, translated, source, error }
const pendingSelection = new Map();
// 上の預かりを捨てるリスナを張ったウィンドウ(張るのはウィンドウにつき1本だけ)
const selectionCleanup = new WeakSet();
// 自動提案を出したサイト(起動中のみ)。同じサイトで開くたびに出さないため
const offered = new Set();

function tabFor(ctx, wc) {
  return ctx?.tabManager.tabs.find((t) => t.view.webContents === wc) ?? null;
}

function settingsOf(ctx) {
  const browser = require('./browser');
  return browser.bundleFor(ctx?.profileId ?? browser.profiles?.activeId)?.settings ?? null;
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** 翻訳できるタブか(内部ページ・file:// は対象外) */
function canTranslate(tab) {
  if (!tab || tab.isInternal || tab.hibernated) return false;
  const wc = tab.view.webContents;
  return !wc.isDestroyed() && !!hostOf(wc.getURL());
}

function targetFor(ctx) {
  return translate.normalizeLang(settingsOf(ctx)?.data.translateTargetLang);
}

/** タブの状態(tabs:state に載せる形)。翻訳していないタブは null */
function stateFor(tab) {
  const value = tab?.translate;
  if (!value || value.state === 'none') return null;
  return { state: value.state, source: value.source ?? null, target: value.target ?? null };
}

function setState(ctx, tab, patch) {
  tab.translate = { state: 'none', source: null, target: null, ...(tab.translate ?? {}), ...patch };
  ctx?.tabManager.sendState();
}

/** ページを移動したら状態を捨てる(tab-manager の did-navigate から) */
function reset(tab) {
  if (tab) tab.translate = null;
}

// ---- 訳す / 戻す ----

function start(ctx, tabId, targetLang) {
  const tab = ctx?.tabManager.getTab(tabId ?? ctx?.tabManager.activeTabId);
  if (!tab || !canTranslate(tab)) return;
  const settings = settingsOf(ctx);
  const target = translate.normalizeLang(targetLang ?? settings?.data.translateTargetLang);
  // 選んだ翻訳先は次回の既定にする(Edgeと同じ)。**シークレットでは書かない**
  if (settings && !ctx.incognito && settings.data.translateTargetLang !== target) {
    settings.data.translateTargetLang = target;
    settings.save();
    require('./browser').sendSettingsFor(ctx.profileId);
  }
  // 訳し終えたページを別の言語へ訳し直すときは、先に原文へ戻してもらう
  // (訳文をさらに訳すことになるため)。戻す報告は要らないので retranslate で伝える
  const retranslate = tab.translate?.state === 'done';
  setState(ctx, tab, { state: 'translating', target, source: tab.translate?.source ?? null });
  tab.view.webContents.send('translate:start', { retranslate });
}

function restore(ctx, tabId) {
  const tab = ctx?.tabManager.getTab(tabId ?? ctx?.tabManager.activeTabId);
  if (!tab) return;
  // 戻した後もアドレスバーの翻訳アイコンは残す(Edgeと同じ。そこからまた訳せる)。
  // アイコンを消すのは「このサイト/この言語は翻訳しない」を選んだときだけ
  setState(ctx, tab, { state: 'offer', source: tab.translate?.source ?? null, error: null });
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send('translate:restore');
}

/** ショートカット・メニューから: 訳す ⇄ 元に戻す(tabId 省略でアクティブなタブ) */
function toggle(ctx, tabId) {
  const tab = ctx?.tabManager.getTab(tabId ?? ctx?.tabManager.activeTabId);
  if (!tab || !canTranslate(tab)) return;
  if (tab.translate?.state === 'done') restore(ctx, tab.id);
  else start(ctx, tab.id);
}

// ---- preload からの報告 ----

/** 訳文の取得(preloadの `translate:texts`)。**通信は要求元タブのセッションで行う** */
async function handleTexts(sender, payload) {
  const ctx = windows.contextFor(sender);
  const tab = tabFor(ctx, sender);
  if (!tab) return { ok: false, error: '翻訳できませんでした' };
  const texts = Array.isArray(payload?.texts)
    ? payload.texts.slice(0, MAX_TEXTS).map((t) => String(t ?? '').slice(0, MAX_TEXT_CHARS))
    : [];
  if (!texts.length) return { ok: true, texts: [], source: null };
  const targetLang = tab.translate?.target ?? targetFor(ctx);
  try {
    const { texts: translated, source } = await translate.translateTexts(texts, {
      targetLang,
      session: sender.session,
    });
    return { ok: true, texts: translated, source };
  } catch (err) {
    console.error('翻訳に失敗:', err.message);
    return { ok: false, error: err.message };
  }
}

/** 進み具合(preloadの `translate:progress`) */
function handleProgress(sender, payload) {
  const ctx = windows.contextFor(sender);
  const tab = tabFor(ctx, sender);
  if (!tab) return;
  const state = ['translating', 'done', 'error', 'none'].includes(payload?.state) ? payload.state : 'none';
  const source = typeof payload?.source === 'string' && payload.source ? payload.source : tab.translate?.source ?? null;
  setState(ctx, tab, { state, source, error: payload?.error ?? null });
  // 訳し終わり/失敗をポップアップにも反映する(開いたままのことがある)
  sendPopupUpdate(ctx, tab);
}

/**
 * 読み込み直後の言語の当たり(preloadの `translate:page-info`)。
 * ここでは通信しない。宣言(<html lang>)と本文の文字づかいだけで「読めない言語か」を決める。
 */
function handlePageInfo(sender, payload) {
  const ctx = windows.contextFor(sender);
  const tab = tabFor(ctx, sender);
  if (!tab || !canTranslate(tab)) return;
  const settings = settingsOf(ctx);
  if (!settings) return;
  const data = settings.data;
  // 訳している/訳し終えたタブには何もしない(2回目の page-info で提案に戻さない)
  if (tab.translate?.state === 'translating' || tab.translate?.state === 'done') return;

  const target = translate.normalizeLang(data.translateTargetLang);
  const host = hostOf(tab.view.webContents.getURL());
  const declared = translate.baseLang(payload?.lang);
  const foreign = translate.looksForeign(target, payload?.lang, payload?.sample);
  if (!foreign) {
    if (tab.translate) setState(ctx, tab, { state: 'none' });
    return;
  }

  // 「常に翻訳する言語」に入っていれば尋ねずに訳す(Edgeと同じ。宣言のあるページに限る)
  if (declared && normalizeLangs(data.translateAlwaysLangs).includes(declared)) {
    start(ctx, tab.id, target);
    return;
  }
  const blockedSite = !!host && normalizeHosts(data.translateNeverSites).includes(host);
  const blockedLang = !!declared && normalizeLangs(data.translateNeverLangs).includes(declared);
  if (data.translateAutoOffer === false || blockedSite || blockedLang) {
    if (tab.translate) setState(ctx, tab, { state: 'none' });
    return;
  }

  setState(ctx, tab, { state: 'offer', source: declared || null, target });
  // 提案のドロップダウンは、同じサイトでは起動中1度だけ自動で開く(見ているタブのときだけ)。
  // シークレットは別枠にする(通常ウィンドウで出したかどうかを持ち込まない)
  const key = `${ctx.profileId}|${ctx.incognito ? 'private' : 'normal'}|${host}`;
  if (ctx.tabManager.activeTabId === tab.id && !offered.has(key)) {
    if (offered.size >= OFFERED_LIMIT) offered.clear();
    offered.add(key);
    requestPopup(ctx, 'page');
  }
}

// ---- ドロップダウン ----

/** ツールバーへ「翻訳のドロップダウンを開きたい」と伝える(向こうがアンカーを測って戻してくる) */
function requestPopup(ctx, mode) {
  if (!ctx || ctx.window.isDestroyed()) return;
  ctx.window.webContents.send('translate:prompt', { mode: mode === 'selection' ? 'selection' : 'page' });
}

/** オーバーレイに渡す中身。アクティブなタブの状態から組む */
function popupPayload(ctx, mode) {
  const tab = ctx?.tabManager.getTab(ctx.tabManager.activeTabId);
  const settings = settingsOf(ctx);
  const data = settings?.data ?? {};
  const url = tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents.getURL() : '';
  const selection = mode === 'selection' ? pendingSelection.get(ctx) ?? null : null;
  const state = tab?.translate?.state ?? 'none';
  const source = selection?.source ?? tab?.translate?.source ?? null;
  const target = translate.normalizeLang(tab?.translate?.target ?? data.translateTargetLang);
  return {
    mode: selection ? 'selection' : 'page',
    host: hostOf(url) ?? '',
    state,
    error: tab?.translate?.error ?? null,
    source,
    sourceName: source ? translate.langName(source) : null,
    target,
    langs: translate.LANGS,
    // シークレットでは覚える系の項目(「…」と「常に翻訳する」)を出さない
    incognito: !!ctx?.incognito,
    autoOffer: data.translateAutoOffer !== false,
    alwaysLang: !!source && normalizeLangs(data.translateAlwaysLangs).includes(translate.baseLang(source)),
    selection: selection
      ? { text: selection.text, translated: selection.translated, error: selection.error ?? null }
      : null,
  };
}

/** 開いたままのドロップダウンへ、訳し終わり/失敗を反映する */
function sendPopupUpdate(ctx, tab) {
  const overlay = ctx?.tabManager?.overlay?.webContents;
  if (!overlay || overlay.isDestroyed()) return;
  if (ctx.tabManager.activeTabId !== tab?.id) return;
  overlay.send('translate:update', popupPayload(ctx, 'page'));
}

// ---- 選択テキストの翻訳(右クリックメニューから) ----

async function translateSelection(ctx, wc, text) {
  const trimmed = String(text ?? '').trim().slice(0, MAX_SELECTION);
  if (!ctx || !trimmed) return;
  const targetLang = targetFor(ctx);
  let result = { text: trimmed, translated: null, source: null, error: null };
  try {
    const { texts, source } = await translate.translateTexts([trimmed], {
      targetLang,
      session: wc?.session ?? ctx.tabManager.activeWebContents()?.session,
    });
    result = { text: trimmed, translated: texts[0] ?? '', source, error: null };
  } catch (err) {
    result = { text: trimmed, translated: null, source: null, error: err.message };
  }
  if (ctx.window.isDestroyed()) return;
  // 後始末のリスナはウィンドウにつき1本だけ張る(選択のたびに張ると溜まって警告が出る)
  if (!selectionCleanup.has(ctx)) {
    selectionCleanup.add(ctx);
    ctx.window.once('closed', () => pendingSelection.delete(ctx));
  }
  pendingSelection.set(ctx, result);
  requestPopup(ctx, 'selection');
}

function clearSelection(ctx) {
  pendingSelection.delete(ctx);
}

// ---- 設定の書き換え(ドロップダウンの「…」メニューから) ----

function normalizeHosts(value) {
  if (!Array.isArray(value)) return [];
  const hosts = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const host = item.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return [...hosts].slice(0, MAX_SITES);
}

function normalizeLangs(value) {
  if (!Array.isArray(value)) return [];
  const langs = new Set();
  for (const item of value) {
    const code = translate.baseLang(item);
    if (code) langs.add(code);
  }
  return [...langs].slice(0, MAX_LANGS);
}

function updateSettings(ctx, mutate) {
  const settings = settingsOf(ctx);
  // シークレットでは覚えない(見ていたサイト名や言語をディスクへ残さないため。
  // ドロップダウン側でも「…」と「常に翻訳する」を出さない)
  if (!settings || ctx?.incognito) return;
  mutate(settings.data);
  settings.save();
  require('./browser').sendSettingsFor(ctx.profileId);
}

/** 「このサイトは翻訳しない」 */
function neverSite(ctx) {
  const tab = ctx?.tabManager.getTab(ctx.tabManager.activeTabId);
  const host = tab ? hostOf(tab.view.webContents.getURL()) : null;
  if (!host) return;
  updateSettings(ctx, (data) => {
    data.translateNeverSites = normalizeHosts([...normalizeHosts(data.translateNeverSites), host]);
  });
  // 訳してあれば原文に戻す。restore は「提案中」に戻すので、そのあとで状態を消して
  // アイコンごと引っ込める(選んだ人にまた提案しない)
  if (tab?.translate?.state === 'done') restore(ctx, tab.id);
  if (tab) setState(ctx, tab, { state: 'none', source: null });
}

/** 「<言語>は翻訳しない」 */
function neverLang(ctx, lang) {
  const code = translate.baseLang(lang);
  if (!code) return;
  updateSettings(ctx, (data) => {
    data.translateNeverLangs = normalizeLangs([...normalizeLangs(data.translateNeverLangs), code]);
    // 「常に翻訳」と両立しないので、そちらからは外す
    data.translateAlwaysLangs = normalizeLangs(data.translateAlwaysLangs).filter((l) => l !== code);
  });
  const tab = ctx?.tabManager.getTab(ctx.tabManager.activeTabId);
  if (tab?.translate?.state === 'done') restore(ctx, tab.id);
  if (tab) setState(ctx, tab, { state: 'none', source: null });
}

/** 「<言語>のページを常に翻訳する」のチェックボックス */
function setAlwaysLang(ctx, lang, on) {
  const code = translate.baseLang(lang);
  if (!code) return;
  updateSettings(ctx, (data) => {
    const list = normalizeLangs(data.translateAlwaysLangs).filter((l) => l !== code);
    data.translateAlwaysLangs = on ? normalizeLangs([...list, code]) : list;
    if (on) data.translateNeverLangs = normalizeLangs(data.translateNeverLangs).filter((l) => l !== code);
  });
}

module.exports = {
  canTranslate,
  stateFor,
  reset,
  start,
  restore,
  toggle,
  handleTexts,
  handleProgress,
  handlePageInfo,
  requestPopup,
  popupPayload,
  translateSelection,
  clearSelection,
  neverSite,
  neverLang,
  setAlwaysLang,
  normalizeHosts,
  normalizeLangs,
  MAX_SELECTION,
};
