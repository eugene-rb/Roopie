// インストール単位(プロファイル横断)の状態。
// - 初回起動 → roopie://welcome(イントロ)
// - VERSION_BASE が上がったあとの初回起動 → roopie://whatsnew(変更点)
//
// 変更点の出し分けは「アプリのバージョン」ではなく release-notes.json の先頭エントリの
// version(0.1 / 0.2 …)で行う。masterへpushするたびにビルド番号(0.1.<run>)が上がるため、
// バージョン一致で判定すると1コミットごとにポップアップが出てしまうため。
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('./store');

const NOTES_FILE = path.join(__dirname, '..', 'renderer', 'pages', 'release-notes.json');

const DEFAULT_STATE = {
  introDone: false, // イントロを最後まで見たか
  seenNotes: null, // 最後に見た変更点の version("0.1" など)
  installedVersion: null, // 最後に起動したときのアプリのバージョン
};

let store = null;
let startup = null; // 起動時に開くページ('welcome' | 'whatsnew' | null)。1回だけ消費する

function readNotes() {
  try {
    const data = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
    return Array.isArray(data.notes) ? data.notes : [];
  } catch (err) {
    console.error('変更履歴の読み込みに失敗:', err.message);
    return [];
  }
}

function latestNotesVersion() {
  return readNotes()[0]?.version ?? null;
}

// 起動時にどのページを開くかを決める(検証しやすいよう副作用のない関数にしてある)
function decideStartup(state, latestNotes) {
  if (!state.introDone) return 'welcome';
  if (latestNotes && state.seenNotes !== latestNotes) return 'whatsnew';
  return null;
}

function init() {
  store = new Store(path.join(app.getPath('userData'), 'app-state.json'), { ...DEFAULT_STATE });
  const state = store.data;

  startup = decideStartup(state, latestNotesVersion());

  // 開発中(npm start)はパッケージ版のバージョンにならず初回判定も一度きりなので、
  // 環境変数で強制的に出せるようにしておく: ROOPIE_ONBOARDING=welcome|whatsnew|off
  const forced = process.env.ROOPIE_ONBOARDING;
  if (forced === 'off') startup = null;
  else if (forced === 'welcome' || forced === 'whatsnew') startup = forced;

  state.installedVersion = app.getVersion();
  store.save();
}

// 最初のウィンドウの初期タブに使うURL(通常は undefined = 新しいタブ)
function takeStartupUrl() {
  const page = startup;
  startup = null;
  return page ? `roopie://${page}` : undefined;
}

function markIntroDone() {
  if (!store) return;
  store.data.introDone = true;
  store.data.seenNotes = latestNotesVersion();
  store.save();
}

function markNotesSeen() {
  if (!store) return;
  store.data.seenNotes = latestNotesVersion();
  store.save();
}

// welcome/whatsnew ページへ渡す情報
function info() {
  return {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    notes: readNotes(),
    // 「前回見たところより新しい分」だけを変更点として出す(初回はすべて)
    seenNotes: store?.data.seenNotes ?? null,
  };
}

function flush() {
  store?.flush();
}

module.exports = {
  init,
  takeStartupUrl,
  markIntroDone,
  markNotesSeen,
  info,
  flush,
  decideStartup,
  latestNotesVersion,
};
