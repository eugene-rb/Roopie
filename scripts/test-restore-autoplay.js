// セッション復元(前回のタブ構成を復元)や休止タブの復帰でも、フォーカスしていない
// タブが自動再生を始めても一時停止されることの検証(再利用可能)。
// 実行: npx electron scripts/test-restore-autoplay.js
//
// restoreTabs()はフォーカスするタブ以外を background:true で開くようにしてあるため、
// tab-manager.jsのautoPauseMedia機構(裏で開いた/フォーカスしなかったタブは、実際に選ぶまで
// 読み込まず、選んだ後も自動再生が始まった瞬間に一時停止する。ミュートはしない。
// そのタブ自身への実操作があれば以後は普通に再生できる)がそのまま効く。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8952;
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

// YouTubeなど実サイトと同じ「ページ自身のスクリプトが読み込み時にplay()を呼ぶ」形を再現する
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const AUTOPLAY_PAGE = (label) => `<!doctype html><meta charset="utf-8"><title>ページ${label}</title>
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>document.getElementById('a').play().catch(() => {});</script>`;

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(AUTOPLAY_PAGE(req.url));
      })
      .listen(PORT);

    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    // ---- セッション復元(起動時に前回のタブ構成を戻す)----
    tm.restoreTabs([
      { url: `http://localhost:${PORT}/a`, active: false },
      { url: `http://localhost:${PORT}/b`, active: true },
      { url: `http://localhost:${PORT}/c`, active: false },
    ]);
    await sleep(300);

    check('復元後は3タブ+元の初期タブ', tm.tabs.length, 4);
    const [, tabA, tabB, tabC] = tm.tabs;
    check('指定したタブ(b)がアクティブになる', tm.activeTabId, tabB.id);

    // アクティブにしたタブ(b)は普通に読み込まれ、自動再生も一時停止されない。
    // (このテスト用オリジンは自動再生ポリシー自体にも阻まれ実際には再生できないことがあるため、
    //  再生の有無ではなく「一時停止処理が呼ばれないこと」を直接確かめる)
    let pauseCalledForB = false;
    const originalPause = tm.pauseAutoplayedMedia.bind(tm);
    tm.pauseAutoplayedMedia = (t) => {
      if (t === tabB) pauseCalledForB = true;
      return originalPause(t);
    };
    await Promise.race([new Promise((r) => tabB.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    await sleep(500);
    check('アクティブなタブは休止扱いにならない', tabB.hibernated, false);
    check('アクティブなタブに自動一時停止フラグは立たない', tabB.autoPauseMedia, false);
    tabB.view.webContents.emit('media-started-playing'); // 実際に再生が始まった状況を模す
    await sleep(200);
    check('アクティブなタブでは一時停止処理が呼ばれない', pauseCalledForB, false);
    tm.pauseAutoplayedMedia = originalPause;

    // フォーカスしなかったタブ(a, c)は不活性化されたまま(まだ読み込まれてすらいない)
    check('非アクティブのタブ(a)は休止中', tabA.hibernated, true);
    check('非アクティブのタブ(c)は休止中', tabC.hibernated, true);

    // 後からタブaへ切り替える → ここで初めて読み込まれ、自動再生は始まった瞬間に止められる。
    // 「止まるまで」はメイン側が media-started-playing を受けて全フレームへスクリプトを流す往復ぶん
    // かかるので、固定時間で1回見るのではなく止まるまで待つ(かかった時間も出す)
    let playStartedAt = null; // 実際に音が出てしまう時間を測る起点
    tabA.view.webContents.once('media-started-playing', () => {
      playStartedAt = Date.now();
    });
    tm.switchTab(tabA.id);
    await Promise.race([new Promise((r) => tabA.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    const pauseStart = Date.now();
    let aPausedAfterSwitch = false;
    while (Date.now() - pauseStart < 4000) {
      aPausedAfterSwitch = await js(tabA.view.webContents, `document.getElementById('a').paused`);
      if (aPausedAfterSwitch) break;
      await sleep(50);
    }
    const pausedAt = Date.now();
    console.log(
      `   (読み込み完了から止まるまで ${pausedAt - pauseStart}ms` +
        (playStartedAt ? ` / 実際に鳴っていたのは ${pausedAt - playStartedAt}ms` : '') +
        ')'
    );
    check('切り替え後、自動再生されても一時停止される', aPausedAfterSwitch, true);
    check('ミュートはされていない', tabA.view.webContents.isAudioMuted(), false);

    // 中身をクリックすれば、以後は自動一時停止の対象から外れる
    clickAt(tabA.view.webContents, 10, 10);
    await sleep(200);
    check('中身をクリックすると自動一時停止フラグが下りる', tabA.autoPauseMedia, false);

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
