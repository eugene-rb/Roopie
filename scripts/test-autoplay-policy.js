// 裏で開いたタブが「読み込まれるが再生は始めない」ことの検証(再利用可能)。
// 実行: npx electron scripts/test-autoplay-policy.js
//
// 経緯:
//  1. webPreferences の autoplayPolicy: 'document-user-activation-required' は、
//     メインプロセスの loadURL() 由来の遷移では実サイト(http/https)に効かず、
//     そのうえ user activation はドキュメント単位なので自分で押した再読み込みまで巻き添えにする → 不採用
//  2. 「再生が始まった瞬間に一時停止する」(autoPauseMedia)は、自分で開いたタブが
//     1秒鳴ってから止まる不自然な挙動になった → 廃止
//  3. 「裏タブはそもそも読み込まない」(hibernated)は確実だが、切り替えるたびに読み込み待ちが出る
//  4. 現在: 裏タブも読み込む。ただし media-guard がメインワールドで play()/autoplay を塞ぐので
//     一度も鳴らない。タブを選んだ時点で解除し、そこで初めて再生が始まる
//     (src/preload/media-guard-preload.js / src/main/media-guard.js)
// セッション復元だけは今も hibernate(起動時に数十タブを一斉に読み込ませないため)。
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

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
// 実サイトが使う2つの経路を両方置く: ページのスクリプトが play() を呼ぶ / autoplay 属性だけ
const AUTOPLAY_PAGE = `<!doctype html><meta charset="utf-8"><title>autoplay</title>
<audio id="a" loop src="${SILENT_WAV}"></audio>
<audio id="attr" loop autoplay src="${SILENT_WAV}"></audio>
<iframe id="f" src="/frame" width="200" height="100"></iframe>
<script>document.getElementById('a').play().catch(() => {});</script>`;
const FRAME_PAGE = `<!doctype html><meta charset="utf-8"><title>frame</title>
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>document.getElementById('a').play().catch(() => {});</script>`;

// iframeの中の状態はメインフレームからは読めないので、フレームを名指しして実行する
async function inFrame(wc, code) {
  const frames = (wc.mainFrame?.framesInSubtree ?? []).filter((f) => !f.isDestroyed?.());
  const sub = frames.find((f) => f !== wc.mainFrame && f.url.includes('/frame'));
  if (!sub) return 'フレームが見つからない';
  return sub.executeJavaScript(code, false).catch((e) => `失敗: ${e.message}`);
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(req.url.startsWith('/frame') ? FRAME_PAGE : AUTOPLAY_PAGE);
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);
    const initialActiveId = tm.activeTabId;

    // ---- ホイールクリック相当: 裏で開く ----
    const bg = tm.createTab(`http://localhost:${PORT}/bg`, { background: true });
    const bgWc = bg.view.webContents;
    await Promise.race([new Promise((r) => bgWc.once('did-finish-load', r)), sleep(8000)]);
    await sleep(1200); // autoplayが始まるとしたらこの間に始まる

    check('裏で開いてもアクティブタブは変わらない', tm.activeTabId, initialActiveId);
    check('裏で開いたタブは休止しない(読み込む)', bg.hibernated, false);
    check('裏で開いたタブのURLが読み込まれている', bgWc.getURL().endsWith('/bg'), true);
    check('裏で開いたタブのタイトルが取れている', bgWc.getTitle(), 'autoplay');
    check('自動再生を塞いでいる印が立つ', bg.mediaGuarded, true);
    check('script の play() は始まっていない', await js(bgWc, `document.getElementById('a').paused`), true);
    check('autoplay 属性も始まっていない', await js(bgWc, `document.getElementById('attr').paused`), true);
    check('autoplay 属性は外されている', await js(bgWc, `document.getElementById('attr').hasAttribute('autoplay')`), false);
    check('ページから見た el.autoplay は true のまま', await js(bgWc, `document.getElementById('attr').autoplay`), true);
    check('一度も再生していない(currentTime=0)', await js(bgWc, `document.getElementById('a').currentTime`), 0);
    check('ミュートはしていない', bgWc.isAudioMuted(), false);
    check('音は出ていない', bg.isAudible, false);
    check('iframe の中も再生していない', await inFrame(bgWc, `document.getElementById('a').paused`), true);

    // ---- タブへ切り替える → ここで解除、初めて再生が始まる ----
    tm.switchTab(bg.id);
    await sleep(1200);
    check('切り替えたら塞ぐのをやめる', bg.mediaGuarded, false);
    check('切り替えると script の play() 分が鳴り始める', await js(bgWc, `!document.getElementById('a').paused`), true);
    check('切り替えると autoplay 属性の分も鳴り始める', await js(bgWc, `!document.getElementById('attr').paused`), true);
    check('切り替え後は autoplay 属性も戻る', await js(bgWc, `document.getElementById('attr').hasAttribute('autoplay')`), true);
    check('切り替えると iframe の中も鳴り始める', await inFrame(bgWc, `!document.getElementById('a').paused`), true);
    check('切り替えてもミュートしない', bgWc.isAudioMuted(), false);
    // 解除後は普通のページと同じ。ページ内から play() を呼べば止められも再生もできる
    await js(bgWc, `document.getElementById('a').pause()`);
    check('解除後は普通に止められる', await js(bgWc, `document.getElementById('a').paused`), true);

    // ---- 前面で開いたタブは最初からそのまま再生できる ----
    const fg = tm.createTab(`http://localhost:${PORT}/fg`);
    const fgWc = fg.view.webContents;
    await Promise.race([new Promise((r) => fgWc.once('did-finish-load', r)), sleep(8000)]);
    await sleep(800);
    check('前面で開いたタブは塞がない', fg.mediaGuarded, false);
    check('前面で開いたタブは自動再生できる', await js(fgWc, `!document.getElementById('a').paused`), true);
    check('前面で開いたタブは autoplay 属性も効く', await js(fgWc, `!document.getElementById('attr').paused`), true);

    // ---- 再読み込み(自分で押したF5)は前面タブなので止まらない ----
    fgWc.reload();
    await Promise.race([new Promise((r) => fgWc.once('did-finish-load', r)), sleep(8000)]);
    await sleep(800);
    check('再読み込み後も自動再生できる', await js(fgWc, `!document.getElementById('a').paused`), true);

    // ---- 解除済みのタブを再読み込みしても、塞ぎ直さない ----
    bgWc.reload();
    await Promise.race([new Promise((r) => bgWc.once('did-finish-load', r)), sleep(8000)]);
    await sleep(800);
    check('解除済みタブの再読み込みでは塞がない', await js(bgWc, `!document.getElementById('a').paused`), true);

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
