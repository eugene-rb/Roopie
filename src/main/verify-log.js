// 検証用ログ: ROOPIE_LOG_CONSOLE=1 のときだけ、全レンダラーのコンソールメッセージや
// クラッシュ・ロード失敗をターミナルへ出力する(npm run start:verify)。
// 製品動作には影響しない(環境変数が無ければ何もしない)。
const { app } = require('electron');

// 旧API(数値)と新API(文字列)のどちらのlevel表現にも対応する
const NUMERIC_LEVELS = ['debug', 'log', 'warning', 'error'];

function shortUrl(webContents) {
  try {
    return (webContents.getURL() || '(no url)').slice(0, 100);
  } catch {
    return '(destroyed)';
  }
}

function setupVerifyLog() {
  if (!process.env.ROOPIE_LOG_CONSOLE) return;
  const onlyErrors = process.env.ROOPIE_LOG_CONSOLE === 'errors';

  app.on('web-contents-created', (_e, contents) => {
    contents.on('console-message', (event) => {
      const { level, message, lineNumber, sourceId } = event;
      const levelName = typeof level === 'number' ? NUMERIC_LEVELS[level] || String(level) : level;
      if (onlyErrors && levelName !== 'error' && levelName !== 'warning') return;
      console.log(
        `[renderer:${levelName}] (${shortUrl(contents)}) ${message}` +
          (sourceId ? `\n    at ${sourceId}:${lineNumber}` : '')
      );
    });
    contents.on('render-process-gone', (_ev, details) => {
      console.log(`[renderer:GONE] (${shortUrl(contents)}) reason=${details.reason} exitCode=${details.exitCode}`);
    });
    contents.on('preload-error', (_ev, preloadPath, error) => {
      console.log(`[preload:ERROR] ${preloadPath}: ${error.message}`);
    });
    contents.on('did-fail-load', (_ev, code, desc, url, isMainFrame) => {
      // -3 (ABORTED) はリダイレクト等で普通に起きるノイズなので除外
      if (isMainFrame && code !== -3) console.log(`[load:FAIL] ${url} (${code} ${desc})`);
    });
  });

  process.on('unhandledRejection', (reason) => {
    console.log(`[main:unhandledRejection] ${reason?.stack || reason}`);
  });
  process.on('uncaughtException', (err) => {
    console.log(`[main:uncaughtException] ${err.stack || err}`);
  });
}

module.exports = { setupVerifyLog };
