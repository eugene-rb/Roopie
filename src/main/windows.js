const { BrowserWindow } = require('electron');

/**
 * ウィンドウ(=ブラウザウィンドウ1枚)のコンテキスト管理。
 * 各ウィンドウは独自の TabManager / サイドパネル / オーバーレイを持つ。
 * IPCは送信元のWebContentsから、それが属するウィンドウを引いて処理する。
 */
const contexts = [];

function add(ctx) {
  contexts.push(ctx);
  ctx.window.on('closed', () => remove(ctx));
  return ctx;
}

function remove(ctx) {
  const index = contexts.indexOf(ctx);
  if (index !== -1) contexts.splice(index, 1);
}

function all() {
  return contexts.filter((c) => !c.window.isDestroyed());
}

// 通常(非シークレット)ウィンドウだけ。プロファイル切り替えの対象になる
function normal() {
  return all().filter((c) => !c.incognito);
}

/**
 * IPCの送信元がどのウィンドウのものかを判定する。
 * 送信元は「UI(ウィンドウ本体)」「タブ」「サイドパネル」「オーバーレイ」のいずれか。
 * WebContentsView の webContents は BrowserWindow.fromWebContents では引けないため、
 * 各コンテキストが持つViewを総当たりで照合する。
 */
function contextFor(sender) {
  if (!sender) return focused();
  const found = all().find((ctx) => {
    if (ctx.window.webContents === sender) return true;
    if (ctx.tabManager.tabs.some((t) => t.view.webContents === sender)) return true;
    if (ctx.tabManager.overlay?.webContents === sender) return true;
    if (ctx.sidePanel?.panelView?.webContents === sender) return true;
    if (ctx.sidePanel?.webView?.webContents === sender) return true;
    return false;
  });
  return found ?? focused();
}

function focused() {
  const window = BrowserWindow.getFocusedWindow();
  return all().find((c) => c.window === window) ?? all()[0] ?? null;
}

module.exports = { add, all, normal, contextFor, focused };
