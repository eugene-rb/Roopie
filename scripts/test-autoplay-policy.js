// バックグラウンドで開いたタブ(ホイールクリック等)がユーザーの見ていない/まだ触れていない間に
// 自動再生を始めても、始まった瞬間に一時停止されることの検証(再利用可能)。
// 実行: npx electron scripts/test-autoplay-policy.js
//
// 検証の結果、Electronの autoplayPolicy: 'document-user-activation-required' は
// メインプロセスからの loadURL() による遷移(=タブの新規作成やタブ復帰)には効かず、
// 実際のサイト(http/https)では自動再生を止められないことが分かった
// (data: URLでは効くが、これは実運用では起きないケース)。
// そのうえ「自分で押した再読み込み」まで巻き添えで止めてしまうため、この指定自体を外した
// (裏タブは今はそもそも読み込まないので不要になった)。経緯は scripts/test-reload-autoplay.js。
// ミュートで塞ぐ方式も試したが「勝手にミュートにされるのは嫌」というフィードバックにより、
// 実際に再生を止める(pause)方式に変更した。media-started-playing をきっかけに
// video/audioを一時停止し、そのタブ自身への実際の操作(クリック等)があるまでそれを続ける。
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

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// YouTubeなど実サイトが行うのと同じ「ページ自身のスクリプトが読み込み時にplay()を呼ぶ」形を
// 再現する(<audio autoplay>属性はブラウザネイティブの、より厳格な自動再生ゲートを通るため、
// document-user-activation-requiredでもloadURL()由来のナビゲーションでは素通りしてしまう
// script実行由来のplay()とは挙動が違う。実際のバグ報告と同じ経路で検証する)
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

    // ホイールクリック相当: background:true で裏に開いたタブは、切り替えるまで読み込まれない
    const bg = tm.createTab(`http://localhost:${PORT}/bg`, { background: true });
    check('自動一時停止フラグが立つ', bg.autoPauseMedia, true);
    check('裏で開いてもアクティブタブは変わらない', tm.activeTabId, initialActiveId);

    // タブへ切り替える → ここで初めて読み込まれ、ページのaudio autoplayが動き出す
    tm.switchTab(bg.id);
    await Promise.race([new Promise((r) => bg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500); // media-started-playing → 一時停止までの反映を待つ

    const pausedAfterAutoplay = await js(bg.view.webContents, `document.getElementById('a').paused`);
    check('自動再生されても一時停止される(ミュートはしない)', pausedAfterAutoplay, true);
    check('ミュートはされていない', bg.view.webContents.isAudioMuted(), false);

    // そのタブの中身へ実際に触れる(クリック)と、以後は自動一時停止の対象から外れる
    clickAt(bg.view.webContents, 10, 10);
    await sleep(200);
    check('クリックすると自動一時停止フラグが下りる', bg.autoPauseMedia, false);

    // 以後、その要素を自分で再生してももう止められない
    await js(bg.view.webContents, `document.getElementById('a').play()`);
    await sleep(400);
    const playingAfterInteraction = await js(bg.view.webContents, `!document.getElementById('a').paused`);
    check('操作後に自分で再生すればそのまま再生され続ける', playingAfterInteraction, true);

    // 比較用: 前面で開いた通常のタブは自動一時停止の対象にならない。
    // (このテスト用オリジンは自動再生ポリシー自体にも阻まれ実際には再生できないため、
    //  再生の有無ではなく「一時停止処理が呼ばれないこと」を直接確かめる)
    let pauseCalled = false;
    const originalPause = tm.pauseAutoplayedMedia.bind(tm);
    tm.pauseAutoplayedMedia = (t) => {
      pauseCalled = true;
      return originalPause(t);
    };
    const fg = tm.createTab(`http://localhost:${PORT}/fg`);
    check('前面で開いたタブに自動一時停止フラグは立たない', fg.autoPauseMedia, false);
    fg.view.webContents.emit('media-started-playing'); // 実際に再生が始まった状況を模す
    await sleep(200);
    check('前面タブでは一時停止処理が呼ばれない', pauseCalled, false);
    tm.pauseAutoplayedMedia = originalPause;

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
