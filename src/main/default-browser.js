// 既定のブラウザ化のリクエスト。
// Windows 8以降は既定ブラウザの切り替えが「設定」アプリでのユーザー操作に限定されている
// (UserChoiceの保護)ため、setAsDefaultProtocolClient で登録したうえで
// 設定アプリ(ms-settings:defaultapps)を開き、最終的な選択はユーザーに委ねる。
//
// うざくならないよう、2回連続で見送られたら2週間は再度出さない(1回目・2回目は毎起動で出す)。
const { app, shell } = require('electron');
const path = require('path');
const Store = require('./store');

const SNOOZE_AFTER = 2; // この回数見送られたら間隔を空ける
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 2週間

const DEFAULT_STATE = {
  dismissCount: 0,
  dismissedAt: null, // 最後に見送った時刻(epoch ms)
};

let store = null;
let shownThisSession = false; // 1起動につき1回だけ(複数ウィンドウが同時に開いてもしつこくしない)

function init() {
  store = new Store(path.join(app.getPath('userData'), 'default-browser-state.json'), {
    ...DEFAULT_STATE,
  });
}

function isDefault() {
  try {
    return app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
  } catch {
    return false;
  }
}

// 出すかどうかの判定(検証しやすいよう副作用のない関数にしてある)
function decidePrompt({ isDefault, dismissCount, dismissedAt, now }) {
  if (isDefault) return false;
  if (dismissCount < SNOOZE_AFTER) return true;
  return !dismissedAt || now - dismissedAt >= SNOOZE_MS;
}

function shouldPrompt() {
  if (shownThisSession) return false;
  const alreadyDefault = isDefault();
  if (alreadyDefault) {
    // Windowsの設定から直接変えていた場合など、見送り履歴を持ち越さない
    if (store.data.dismissCount || store.data.dismissedAt) {
      store.data.dismissCount = 0;
      store.data.dismissedAt = null;
      store.save();
    }
    return false;
  }
  return decidePrompt({ isDefault: alreadyDefault, ...store.data, now: Date.now() });
}

function markShown() {
  shownThisSession = true;
}

function dismiss() {
  store.data.dismissCount += 1;
  store.data.dismissedAt = Date.now();
  store.save();
}

async function setAsDefault() {
  try {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
  } catch (err) {
    console.error('既定のブラウザ登録に失敗:', err.message);
  }
  if (process.platform === 'win32') {
    // UserChoiceの保護で直接は切り替わらないため、設定アプリを開いて選んでもらう
    await shell.openExternal('ms-settings:defaultapps');
  }
  store.data.dismissCount = 0;
  store.data.dismissedAt = null;
  store.save();
}

module.exports = {
  init,
  isDefault,
  shouldPrompt,
  markShown,
  dismiss,
  setAsDefault,
  decidePrompt,
  SNOOZE_AFTER,
  SNOOZE_MS,
};
