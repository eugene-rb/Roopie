// 既定のブラウザ化のリクエスト。
// Windows 8以降は既定ブラウザの切り替えが「設定」アプリでのユーザー操作に限定されている
// (UserChoiceの保護)ため、アプリ側から直接切り替えることはできない。できるのは
//   1) OSに「Roopieはブラウザです」と正しく登録しておく(default-browser-registry.js)
//   2) 設定アプリのRoopieのページを直接開く(ms-settings:defaultapps?registeredAppUser=Roopie)
// の2つで、ここまでやればユーザーの操作は「既定に設定する」の1クリックで済む。
//
// うざくならないよう、2回連続で見送られたら2週間は再度出さない(1回目・2回目は毎起動で出す)。
// **「既定にする」を一度でも押したら、その後は二度と出さない**。最後の「既定に設定する」は
// 設定アプリでの手動操作なので、押したかどうかはアプリからは分からない。押さずに閉じた場合でも
// ユーザーとしては「設定しに行った」ので、また同じお願いが出るのは体験が悪い。
const { app, shell, BrowserWindow } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');
const Store = require('./store');
const registry = require('./default-browser-registry');

// Windowsが実際に使っている既定のブラウザ(UserChoice)。ここのProgIdだけが答え
const USER_CHOICE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations';

const SNOOZE_AFTER = 2; // この回数見送られたら間隔を空ける
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 2週間
const RECHECK_MS = 1500; // 設定アプリから戻った直後は反映が間に合わないことがあるので少し待って再確認

const DEFAULT_STATE = {
  dismissCount: 0,
  dismissedAt: null, // 最後に見送った時刻(epoch ms)
  registeredStamp: null, // OSへのブラウザ登録を済ませた実行ファイル・バージョンの目印
  settled: false, // 既定にしたか、設定アプリまで行ったか(=もうお願いしない)
};

let store = null;
let shownThisSession = false; // 1起動につき1回だけ(複数ウィンドウが同時に開いてもしつこくしない)
let registered = null; // OSへのブラウザ登録(Promise<boolean>)
let watching = false; // 「既定にする」を押した後だけ、戻ってきたときに切り替わったか確かめる

function init() {
  store = new Store(path.join(app.getPath('userData'), 'default-browser-state.json'), {
    ...DEFAULT_STATE,
  });
  refresh();
  // 起動のたびに書き直さないよう、実行ファイルの場所とバージョンが変わったときだけ登録する
  registered = ensureRegistered();
  app.on('browser-window-focus', () => {
    if (!watching) return;
    recheck();
    setTimeout(recheck, RECHECK_MS);
  });
}

async function ensureRegistered() {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const stamp = registry.stamp();
  if (store.data.registeredStamp === stamp) return true;
  const ok = await registry.register();
  if (ok) {
    store.data.registeredStamp = stamp;
    store.save();
  }
  return ok;
}

// 現在の既定ブラウザのProgIdを読む。
// app.isDefaultProtocolClient() は HKCU\Software\Classes\http のコマンドしか見ないため、
// **自分で書いたその場で true になってしまう**(実際にはWindowsの既定はEdgeのまま)。
// ユーザーが「既定に設定する」を押したかどうかはUserChoiceにしか出ないので、そちらを読む
function userChoiceProgId(protocol) {
  try {
    const out = execFileSync('reg.exe', ['query', `${USER_CHOICE_KEY}\\${protocol}\\UserChoice`, '/v', 'ProgId'], {
      windowsHide: true,
      encoding: 'latin1',
      timeout: 3000,
    });
    return /ProgId\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? null;
  } catch {
    return null; // まだ一度も選ばれていない(キーが無い)
  }
}

let cachedDefault = false;

// レジストリを読み直す(起動時・ウィンドウのフォーカス時・設定画面を開いたとき)
function refresh() {
  try {
    cachedDefault =
      process.platform === 'win32'
        ? ['http', 'https'].every((p) => userChoiceProgId(p) === registry.PROG_ID)
        : app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
  } catch {
    cachedDefault = false;
  }
  return cachedDefault;
}

function isDefault() {
  return cachedDefault;
}

// 出すかどうかの判定(検証しやすいよう副作用のない関数にしてある)
function decidePrompt({ isDefault, settled, dismissCount, dismissedAt, now }) {
  if (isDefault || settled) return false;
  if (dismissCount < SNOOZE_AFTER) return true;
  return !dismissedAt || now - dismissedAt >= SNOOZE_MS;
}

// もうお願いしない状態にする(既定になった / 設定アプリまで行った)
function settle() {
  if (!store || store.data.settled) return;
  store.data.settled = true;
  store.data.dismissCount = 0;
  store.data.dismissedAt = null;
  store.save();
}

function shouldPrompt() {
  if (shownThisSession || !store) return false;
  // Windowsの設定から直接変えていた場合もここで拾って、以後は二度と出さない
  if (isDefault()) {
    settle();
    return false;
  }
  return decidePrompt({ isDefault: false, ...store.data, now: Date.now() });
}

function markShown() {
  shownThisSession = true;
}

function dismiss() {
  store.data.dismissCount += 1;
  store.data.dismissedAt = Date.now();
  store.save();
}

// 既定になっていたら各ウィンドウのお願いバーへ知らせる(自分で消えて「完了」を出せるように)
function recheck() {
  if (!watching || !refresh()) return;
  watching = false;
  settle();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('default-browser:state', { isDefault: true });
  }
}

async function setAsDefault() {
  // Windowsでは setAsDefaultProtocolClient を使わない。
  // HKCU\Software\Classes\http を自分で書くだけで実際の既定は変わらないうえ、
  // isDefaultProtocolClient がそれを見て true を返す(=押しただけで「設定済み」に見える)
  if (process.platform !== 'win32') {
    try {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
    } catch (err) {
      console.error('既定のブラウザ登録に失敗:', err.message);
    }
  }
  const ok = await (registered ?? Promise.resolve(false)).catch(() => false);
  if (process.platform === 'win32') {
    // 登録できていれば設定アプリのRoopieのページへ直行する(「既定に設定する」を押すだけ)。
    // できていない(開発中・登録に失敗)ときは一覧を開いて自分で選んでもらう
    const url = ok ? `ms-settings:defaultapps?registeredAppUser=${registry.APP_NAME}` : 'ms-settings:defaultapps';
    try {
      await shell.openExternal(url);
    } catch (err) {
      // Windowsのビルドによってはアプリ指定のパラメータが効かないことがある。何も開かないよりは一覧を出す
      console.error('設定アプリを開けませんでした:', err.message);
      await shell.openExternal('ms-settings:defaultapps').catch(() => {});
    }
  }
  // 設定アプリまで開いたらユーザーの意思表示は済んでいる。実際に「既定に設定する」を
  // 押したかはアプリからは分からないので、押していなくてもこれ以上お願いはしない
  watching = true;
  settle();
  return ok;
}

module.exports = {
  init,
  isDefault,
  refresh,
  shouldPrompt,
  markShown,
  dismiss,
  setAsDefault,
  decidePrompt,
  settle,
  SNOOZE_AFTER,
  SNOOZE_MS,
};
