const { spawn } = require('child_process');

// OS依存の危険アクションをここに閉じ込める。ROOPIE_TIMER_SHUTDOWN_DRYRUN=1 のときは
// 実コマンドを実行しない(検証ハーネス・開発機を誤ってシャットダウンしないためのガード)

function shutdownCommand() {
  // /f(アプリの強制終了)は付けない。他のアプリの未保存データを捨ててしまう副作用があり、
  // 終了をブロックするアプリがいてWindowsに中断された実例も無いため
  if (process.platform === 'win32') return { cmd: 'shutdown', args: ['/s', '/t', '0'] };
  if (process.platform === 'darwin') return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] };
  return { cmd: 'shutdown', args: ['-h', 'now'] };
}

function runShutdown() {
  // dry-runガードは開発時(electronコマンド経由)だけ有効。製品版では環境変数を引き継いでいても
  // 無効化しない(環境変数のせいでシャットダウンが黙って空振りするのを防ぐ)
  if (process.env.ROOPIE_TIMER_SHUTDOWN_DRYRUN === '1') {
    if (process.defaultApp) {
      console.log('[timer] シャットダウン(dry-run): 実行しません');
      return false;
    }
    console.warn('[timer] ROOPIE_TIMER_SHUTDOWN_DRYRUNは開発時のみ有効。シャットダウンを実行します');
  }
  const { cmd, args } = shutdownCommand();
  console.log(`[timer] シャットダウンを実行: ${cmd} ${args.join(' ')}`);
  // 失敗しても黙って空振りしないよう、起動エラーと終了コードを必ず記録する
  const child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
  child.on('error', (err) => logFailure(`起動に失敗: ${err.code} ${err.message}`));
  child.on('close', (code) => {
    if (code !== 0) logFailure(`コマンドが失敗 (exit=${code}) ${stderr.trim()}`);
  });
  child.unref();
  return true;
}

// シャットダウンは就寝時など無人・ターミナル無し(ショートカットから起動)で走るため、
// consoleだけでは失敗の証拠が残らない。失敗したときだけユーザーデータへ追記する
function logFailure(message) {
  console.error(`[timer] シャットダウンの${message}`);
  try {
    const { app } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const line = `${new Date().toISOString()} シャットダウンの${message}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'timer-shutdown-errors.log'), line);
  } catch {
    // ログを残せないこと自体で落とさない
  }
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
