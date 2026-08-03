// 他のアプリから渡されたコマンドライン引数から「開くURL」を1つ取り出す。
// 既定のブラウザになると、Windowsは `"Roopie.exe" "%1"` の形で起動してくるため、
// 起動時(process.argv)と二重起動時(second-instance の argv)の両方で拾う必要がある。
//
// 受け取るのは http/https と .htm/.html のファイルだけ。
// javascript: や roopie:// を外から渡されて内部ページ・スクリプトが動かないようにする。
const fs = require('fs');
const { pathToFileURL } = require('url');

function urlFromArgv(argv = []) {
  // argv[0] は実行ファイル。`--` で始まるものはElectron/Chromiumのスイッチなので飛ばす
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    if (/^https?:\/\//i.test(arg)) return arg;
    if (!/\.x?html?$/i.test(arg)) continue;
    try {
      if (fs.statSync(arg).isFile()) return pathToFileURL(arg).href;
    } catch {
      // 存在しないパスは無視する
    }
  }
  return null;
}

module.exports = { urlFromArgv };
