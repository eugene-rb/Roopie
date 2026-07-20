const { spawn } = require('child_process');

// OS依存の危険アクションをここに閉じ込める。ROOPIE_TIMER_SHUTDOWN_DRYRUN=1 のときは
// 実コマンドを実行しない(検証ハーネス・開発機を誤ってシャットダウンしないためのガード)

function shutdownCommand() {
  if (process.platform === 'win32') return { cmd: 'shutdown', args: ['/s', '/t', '0'] };
  if (process.platform === 'darwin') return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] };
  return { cmd: 'shutdown', args: ['-h', 'now'] };
}

function runShutdown() {
  if (process.env.ROOPIE_TIMER_SHUTDOWN_DRYRUN === '1') {
    console.log('[timer] シャットダウン(dry-run): 実行しません');
    return;
  }
  const { cmd, args } = shutdownCommand();
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

// 対象ウィンドウの、アクティブタブ以外の非内部タブを退避する簡易実装(本格的なdiscardではなく、
// URLを保存してabout:blankへ逃がすだけ。TabManager.switchTabで選び直された時点で復元する)
function hibernateBackgroundTabs(ctx) {
  for (const tab of ctx.tabManager.tabs) {
    if (tab.id === ctx.tabManager.activeTabId || tab.isInternal || tab.hibernated) continue;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) continue;
    tab.hibernatedUrl = wc.getURL();
    tab.hibernated = true;
    wc.loadURL('about:blank');
  }
}

function closeWindow(ctx) {
  if (!ctx.window.isDestroyed()) ctx.window.close();
}

function openPage(ctx, url) {
  ctx.tabManager.createTab(url);
}

module.exports = { runShutdown, hibernateBackgroundTabs, closeWindow, openPage };
