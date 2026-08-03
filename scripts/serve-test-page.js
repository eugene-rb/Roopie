// 検証用ページの簡易HTTPサーバー(再利用可能)。
// 実行: node scripts/serve-test-page.js [ファイル名] [ポート]
// 既定: test-autofill-page.html を http://localhost:8931 で配信
const http = require('http');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, process.argv[2] || 'test-autofill-page.html');
const port = Number(process.argv[3]) || 8931;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  })
  .listen(port, () => console.log(`http://localhost:${port} で ${path.basename(file)} を配信中`));
