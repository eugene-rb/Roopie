const { screen } = require('electron');
const { attachContextMenu } = require('./context-menu');

/**
 * ポップアップウィンドウ(Chrome/Edge相当)。
 *
 * `window.open(url, name, 'width=500,height=600')` のように「ウィンドウの見た目」の指定が
 * 付いた window.open は、Chrome/Edgeでは独立した小さなウィンドウになる。Googleログインの
 * ような認証はこの形で開き、開いた側へ window.opener 経由で結果を返して自分で window.close()
 * する。タブとして開き直す(action:'deny' + createTab)と opener との縁が切れるため、
 * 認証が終わらない・ポップアップが閉じない、という状態になる。
 * そのため、この形の window.open だけは action:'allow' で本物の子ウィンドウを開く。
 */

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;
// features にサイズが無いとき(popup=yes だけのとき)の既定サイズ
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

// "width=500,height=600,menubar=no" → { width: '500', height: '600', menubar: 'no' }
function parseFeatures(features) {
  const out = {};
  for (const part of String(features || '').split(',')) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    if (!key) continue;
    // 値なし("popup" 単体)は yes 扱い(HTML仕様と同じ)
    out[key] = rawValue === undefined ? 'yes' : rawValue.trim().toLowerCase();
  }
  return out;
}

function num(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

// ウィンドウの形を指定するキー。1つでもあればポップアップ扱い(Chromiumと同じ判定)
const SHAPE_KEYS = ['width', 'height', 'innerwidth', 'innerheight', 'left', 'top', 'screenx', 'screeny'];

/**
 * setWindowOpenHandler の details を見て、ポップアップウィンドウにすべきかを返す。
 * Shift+クリックも disposition は 'new-window' で来るが features が空なので、
 * ここで従来どおりのタブと分かれる。
 */
function isPopupRequest({ disposition, features } = {}) {
  if (disposition !== 'new-window') return false;
  const f = parseFeatures(features);
  if (f.popup !== undefined) return f.popup !== 'no' && f.popup !== '0';
  return SHAPE_KEYS.some((key) => key in f);
}

// features の位置・大きさを、開いた側のモニタの作業領域に収めて返す
function boundsFor(features, ownerWindow) {
  const f = parseFeatures(features);
  const width = Math.max(MIN_WIDTH, num(f.width) ?? num(f.innerwidth) ?? DEFAULT_WIDTH);
  const height = Math.max(MIN_HEIGHT, num(f.height) ?? num(f.innerheight) ?? DEFAULT_HEIGHT);
  const x = num(f.left) ?? num(f.screenx);
  const y = num(f.top) ?? num(f.screeny);

  const area = (() => {
    if (x !== null && y !== null) return screen.getDisplayNearestPoint({ x, y }).workArea;
    const owner = ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow.getBounds() : null;
    return (owner ? screen.getDisplayMatching(owner) : screen.getPrimaryDisplay()).workArea;
  })();

  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  if (x === null || y === null) return { width: w, height: h };
  return {
    width: w,
    height: h,
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - w)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - h)),
  };
}

/**
 * setWindowOpenHandler の戻り値。
 * webPreferences は指定しない(セッション・preload・sandboxは開いた側から引き継がれる。
 * partition を書くと別セッションになってログイン状態が渡らず、preload を渡すと
 * 内部APIが通常のWebページから見えてしまう)。
 */
function responseFor(details, ownerWindow) {
  return {
    action: 'allow',
    // 開いた側のタブを閉じてもポップアップは残す(Chrome/Edgeと同じ)
    outlivesOpener: true,
    overrideBrowserWindowOptions: {
      ...boundsFor(details.features, ownerWindow),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      // width/height はページ側の指定なので、枠込みではなく中身の大きさとして扱う
      useContentSize: true,
      // Windowsではアプリメニューが全ウィンドウに出るので、ポップアップからは外す
      autoHideMenuBar: true,
    },
  };
}

// ポップアップの webContents → 開いた側のウィンドウ
const owners = new Map();

function ownerWindowFor(webContents) {
  const owner = owners.get(webContents);
  return owner && !owner.isDestroyed() ? owner : null;
}

// ポップアップから普通のリンクを開いたとき。親ウィンドウのタブで開く(Chrome/Edgeと同じ)
function openInOwner(tabManager, url, background = false) {
  if (tabManager && !tabManager.window.isDestroyed()) {
    tabManager.createTab(url, { background });
    tabManager.window.focus();
    return;
  }
  // 親ウィンドウがもう無い場合(先に閉じられた)は新しいウィンドウで開く
  require('./browser').createWindow({ url });
}

/**
 * did-create-window で呼ぶ。開いたポップアップの中身を整える。
 * tabManager は開いた側(親)のもの。
 */
function setup(win, details, tabManager) {
  // アプリメニュー(とそのショートカット)をこのウィンドウから外す
  win.setMenu(null);

  const wc = win.webContents;
  // 右クリックメニューがプロファイル(ウィンドウごとに異なる)を引けるように、
  // どのウィンドウから開かれたポップアップなのかを控えておく
  owners.set(wc, tabManager?.window ?? null);
  win.on('closed', () => owners.delete(wc));

  // シークレットウィンドウから開いたポップアップだけは、親ウィンドウと一緒に閉じる。
  // browser.js は最後のシークレットウィンドウが閉じた時点でセッションを消すので、
  // 残すと「消えたはずのセッション」の上でポップアップだけが生き残ってしまう
  // (Chrome/Edgeも、最後のシークレットウィンドウを閉じるとポップアップごと閉じる)。
  // closed ではなく close で拾い、セッションが消される前に閉じる
  const owner = tabManager?.window;
  if (owner && !owner.isDestroyed() && require('./windows').contextFor(owner.webContents)?.incognito) {
    const closeWithOwner = () => {
      if (!win.isDestroyed()) win.close();
    };
    owner.on('close', closeWithOwner);
    win.on('closed', () => {
      if (!owner.isDestroyed()) owner.off('close', closeWithOwner);
    });
  }

  attachContextMenu(wc, tabManager);

  // ポップアップの中のリンクは親ウィンドウのタブへ。
  // ポップアップがさらにサイズ指定付きの window.open を呼んだら、それもポップアップにする
  wc.setWindowOpenHandler((d) => {
    if (isPopupRequest(d)) return responseFor(d, win);
    openInOwner(tabManager, d.url, d.disposition === 'background-tab');
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child, d) => setup(child, d, tabManager));

  // 内部ページ(roopie://)はpreloadを持たないポップアップでは動かないので親のタブへ回す
  wc.on('will-navigate', (event, url) => {
    if (url.startsWith('roopie:')) {
      event.preventDefault();
      openInOwner(tabManager, url);
    }
  });
}

module.exports = { isPopupRequest, responseFor, setup, ownerWindowFor, parseFeatures };
