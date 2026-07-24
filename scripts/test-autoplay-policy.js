// バックグラウンドで開いたタブ(ホイールクリック等)がユーザーの見ていない間に
// 勝手に音を鳴らさないことの検証(再利用可能)。
// 実行: npx electron scripts/test-autoplay-policy.js
//
// 経緯: 当初は webPreferences の autoplayPolicy: 'document-user-activation-required' で塞ごうとしたが、
// メインプロセスからの loadURL() 由来の遷移では実サイト(http/https)に効かず、
// そのうえ user activation はドキュメント単位でナビゲーションのたびに捨てられるため
// **自分で押した再読み込みまで巻き添えで止めてしまう**ことが分かり、この指定は外した
// (詳細は scripts/test-reload-autoplay.js)。
// 次に「再生が始まった瞬間に一時停止する」方式(autoPauseMedia)を入れたが、裏タブを
// そもそも読み込まない(hibernated)ようにした結果、これが発動するのは
// **ユーザーが切り替えた直後のタブだけ**になってしまい、自分で開いたタブが1秒鳴ってから
// 勝手に止まる不自然な挙動になったので廃止した。
// 現在の保護は1つだけ:「裏で開いたタブはそもそも読み込まない」。
// 読み込まれていなければ音は出ようがなく、切り替えれば Chrome と同じく普通に再生できる。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8951;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, false);

// YouTubeなど実サイトが行うのと同じ「ページ自身のスクリプトが読み込み時にplay()を呼ぶ」形を再現する
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const AUTOPLAY_PAGE = `<!doctype html><meta charset="utf-8"><title>autoplay</title>
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>document.getElementById('a').play().catch(() => {});</script>`;

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(AUTOPLAY_PAGE);
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);
    const initialActiveId = tm.activeTabId;

    // ホイールクリック相当: background:true で裏に開いたタブは、切り替えるまで読み込まれない。
    // 読み込まれない = ページのスクリプトが動かない = 音が出ようがない、というのが唯一の保護
    const bg = tm.createTab(`http://localhost:${PORT}/bg`, { background: true });
    await sleep(1500);
    check('裏で開いたタブは休止中', bg.hibernated, true);
    check('裏で開いたタブは読み込まれない(URLが空)', bg.view.webContents.getURL(), '');
    check('裏で開いてもアクティブタブは変わらない', tm.activeTabId, initialActiveId);
    check('裏で開いたタブから音は出ていない', bg.isAudible, false);

    // タブへ切り替える → ここで初めて読み込まれる。以後はユーザーが見ているタブなので、
    // Chrome同様そのまま再生させる(勝手に止めない・勝手にミュートしない)
    tm.switchTab(bg.id);
    await Promise.race([new Promise((r) => bg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(600);
    check('切り替えると読み込まれる', bg.hibernated, false);
    check('切り替えた後は普通に再生できる', await js(bg.view.webContents, `!document.getElementById('a').paused`), true);
    check('ミュートはされていない', bg.view.webContents.isAudioMuted(), false);

    // 前面で開いたタブはもちろんそのまま再生できる
    const fg = tm.createTab(`http://localhost:${PORT}/fg`);
    await Promise.race([new Promise((r) => fg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(600);
    check('前面で開いたタブは休止しない', fg.hibernated, false);
    check('前面で開いたタブは自動再生できる', await js(fg.view.webContents, `!document.getElementById('a').paused`), true);

    server.close();
    browser.flushAll();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
