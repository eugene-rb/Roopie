// 動画プレイヤーの検出範囲の検証(再利用可能)。
// 実行: npx electron scripts/test-media-detect.js
//
// ニュースサイトなどはプレイヤーを iframe や shadow DOM の中に置くため、
// メインフレームだけを見ていると取りこぼす(preloadはメインフレームでしか走らない)。
// 本物のTabManagerを動かし、メインプロセスからの全フレーム探索が次を拾えることを確かめる:
//   1. iframeの中のプレイヤー
//   2. shadow DOM の中のプレイヤー
//   3. 後から差し込まれたプレイヤー
//   4. browser.pickMedia が「再生中のもの」を選ぶ
const { app, BrowserWindow, session } = require('electron');
const http = require('http');
// browser.js は app ready より前に protocol.registerSchemesAsPrivileged を呼ぶ
const browser = require('../src/main/browser');

const PORT = 8939;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 検証用の無音WAV(30秒)。実データが無いと即endedになり「再生中」にならないので自前で作る
function silentWav(seconds = 30) {
  const rate = 8000;
  const bytes = rate * seconds;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // モノラル
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  buf.fill(128, 44); // 8bit PCM の無音
  return buf;
}

// 検証中は自動再生の制限を外す(ユーザー操作なしでplay()させるため)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// メインフレームには動画が無く、iframeの中にプレイヤーがあるページ(ニュースサイトによくある形)
const PAGE_OUTER = `<!doctype html><meta charset="utf-8"><title>外側</title>
<h1>記事本文</h1><iframe src="/player" width="400" height="300"></iframe>`;

// shadow DOM の中にプレイヤーを作るページ
const PAGE_PLAYER = `<!doctype html><meta charset="utf-8"><title>プレイヤー</title>
<div id="host"></div>
<script>
  const root = document.getElementById('host').attachShadow({ mode: 'open' });
  const audio = document.createElement('audio');
  audio.id = 'a';
  audio.src = '/silent.wav';
  audio.loop = true;
  root.appendChild(audio);
  window.startPlay = () => root.getElementById('a').play();
</script>`;

// 後からプレイヤーを差し込むページ
const PAGE_LATE = `<!doctype html><meta charset="utf-8"><title>遅延</title>
<script>
  setTimeout(() => {
    const a = document.createElement('audio');
    a.src = '/silent.wav';
    a.loop = true;
    document.body.appendChild(a);
    a.play();
  }, 1000);
</script>`;

function testPickMedia() {
  // ctxのうち pickMedia が触る部分だけを用意する
  const ctx = {
    window: { isDestroyed: () => false },
    mediaPlayer: { setState: () => {} },
    tabManager: { getTab: (id) => ({ id }) },
    mediaFrames: new Map(),
    media: null,
    mediaFrame: null,
  };
  const frame = { isDestroyed: () => false };
  const realSendMedia = browser.sendMedia;
  browser.sendMedia = () => {}; // 実ウィンドウが無いので配信はしない

  ctx.mediaFrames.set(1, { state: { title: '止まっている', playing: false, currentTime: 0, tabId: 1 }, frame, tabId: 1 });
  ctx.mediaFrames.set(2, { state: { title: '再生中', playing: true, currentTime: 5, tabId: 2 }, frame, tabId: 2 });
  browser.pickMedia(ctx);
  check('再生中のものが選ばれる', ctx.media.title, '再生中');

  ctx.mediaFrames.set(2, { state: { title: '再生中', playing: false, currentTime: 5, tabId: 2 }, frame, tabId: 2 });
  browser.pickMedia(ctx);
  check('誰も再生中でなければ再生位置が進んでいるものを選ぶ', ctx.media.title, '再生中');

  ctx.tabManager.getTab = (id) => (id === 1 ? { id: 1 } : null);
  browser.pickMedia(ctx);
  check('無くなったタブの報告は捨てる', ctx.media.title, '止まっている');

  browser.forgetMediaForTab(ctx, 1);
  check('タブを閉じるとそのタブの報告は消える', ctx.media, null);
  browser.sendMedia = realSendMedia;
}

app.whenReady().then(async () => {
  testPickMedia();

  const server = http
    .createServer((req, res) => {
      if (req.url === '/silent.wav') {
        const wav = silentWav();
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length });
        res.end(wav);
        return;
      }
      const body = req.url === '/player' ? PAGE_PLAYER : req.url === '/late' ? PAGE_LATE : PAGE_OUTER;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    })
    .listen(PORT);

  const TabManager = require('../src/main/tab-manager');
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, toggle: () => {} };
  const tabManager = new TabManager(window, { history, bookmarks, session: session.defaultSession });

  // TabManagerが報告してくる再生状態を受け取る(browser.js がやっていること)
  let report = null;
  tabManager.onMediaReport = (tabId, state) => {
    report = state ? { ...state, tabId } : null;
  };

  const tab = tabManager.createTab(`http://localhost:${PORT}/`);
  const wc = tab.view.webContents;
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(800);
  check('再生前は報告が無い', report, null);

  // 1) iframe の中の shadow DOM にある audio を再生する
  const inner = wc.mainFrame.framesInSubtree.find((f) => f.url.endsWith('/player'));
  check('iframeが認識されている', !!inner, true);
  check(
    'shadow DOM内のaudioを再生できる',
    await inner.executeJavaScript(`window.startPlay().then(() => 'ok', (e) => String(e))`, true),
    'ok'
  );
  await sleep(1800);
  check('iframeの中のshadow DOMにあるプレイヤーを検出する', report?.playing, true);
  check('タイトルはそのフレームのものを使う', report?.title, 'プレイヤー');
  check('再生位置を取れている', report?.currentTime > 0, true);

  // 一時停止も追える
  await inner.executeJavaScript(`document.getElementById('host').shadowRoot.getElementById('a').pause()`, true);
  await sleep(1800);
  check('一時停止を検出する', report?.playing, false);

  // 2) 後から差し込まれたプレイヤー
  report = null;
  wc.loadURL(`http://localhost:${PORT}/late`);
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(3000);
  check('後から差し込まれたプレイヤーも検出する', report?.playing, true);

  // 3) プレイヤーが無いページへ移ると、報告が消えて監視も止まる
  wc.loadURL(`http://localhost:${PORT}/`);
  await Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(8000)]);
  await sleep(5000);
  check('プレイヤーが無くなったら報告もクリアされる', report, null);
  check('見張るのをやめる(タイマーが残らない)', !tab.mediaTimer, true);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
