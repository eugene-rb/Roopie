// 「自分で押した再読み込み(F5)の後もページの再生が続けられる」ことの検証(再利用可能)。
// 実行: npx electron scripts/test-reload-autoplay.js
//
// 以前は webPreferences に autoplayPolicy: 'document-user-activation-required' を指定していたため、
// ユーザー操作の有無が**ドキュメント単位**でナビゲーションのたびに捨てられ、
// 自分で押した再読み込みの後ですら YouTube等が NotAllowedError で止まったままになっていた。
// 既定(no-user-gesture-required)に戻し、裏タブの勝手な再生は media-guard
// (読み込むが、そのタブを選ぶまで play()/autoplay を塞ぐ)で止める。
// ここではその両立(再読み込みでは再生できる/裏タブは鳴らない)を確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 8953;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-reload-autoplay-'));
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
const js = (wc, code) => wc.executeJavaScript(code, true);
const waitLoad = (wc, ms = 8000) => Promise.race([new Promise((r) => wc.once('did-finish-load', r)), sleep(ms)]);

// 読み込みと同時に、音のある(ミュートでない)audioを自動再生しようとするページ。
// 自動再生ポリシーに引っかかると play() が NotAllowedError で reject される。
// 実際のバグ報告と同じ「ページ自身のスクリプトが読み込み時に play() を呼ぶ」形で試す
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const AUTOPLAY_PAGE = `<!doctype html><meta charset="utf-8"><title>自動再生ページ</title><body>再生テスト
<audio id="a" loop src="${SILENT_WAV}"></audio>
<script>
  const audio = document.getElementById('a');
  window.__err = null;
  audio.play().catch((e) => { window.__err = e.name; });
  window.__state = () => ({ paused: audio.paused, err: window.__err });
</script>`;

app.whenReady().then(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(AUTOPLAY_PAGE);
    })
    .listen(PORT);

  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    // 最初のタブが出来るまで待つ
    for (let i = 0; i < 40 && ctx.tabManager.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    const url = `http://localhost:${PORT}/`;

    // ---- 1. 前面で開いたタブは自動再生できる ----
    const tab = ctx.tabManager.createTab(url);
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('前面タブは自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // ---- 2. 再読み込みしても再生できる(本題) ----
    ctx.tabManager.reload();
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('再読み込み後も自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // 2回続けて再読み込みしても同じ(ユーザー操作の持ち越しに頼っていないこと)
    ctx.tabManager.reload();
    await waitLoad(tab.view.webContents);
    await sleep(800);
    check('続けて再読み込みしても自動再生できる', await js(tab.view.webContents, 'window.__state()'), { paused: false, err: null });

    // ---- 3. 裏で開いたタブは読み込むが、再生は始まらない(media-guard) ----
    const bg = ctx.tabManager.createTab(url, { background: true });
    await waitLoad(bg.view.webContents);
    await sleep(1200);
    check('裏で開いたタブは読み込まれる', bg.view.webContents.getURL(), url);
    check('裏で開いたタブは自動再生を塞がれる', bg.mediaGuarded, true);
    check('裏で開いてもアクティブタブは変わらない', ctx.tabManager.activeTabId, tab.id);
    // ページから見ると、Chromeが自動再生を止めたときと同じ NotAllowedError になる
    check('裏タブでは鳴らずNotAllowedErrorになる', await js(bg.view.webContents, 'window.__state()'), {
      paused: true,
      err: 'NotAllowedError',
    });

    // ---- 4. 裏タブへ切り替えれば、そこで解除されて再生が始まる ----
    ctx.tabManager.switchTab(bg.id);
    await sleep(1200);
    check('切り替えると抑止が解ける', bg.mediaGuarded, false);
    // err は「塞がれていた時にページが受け取った例外」の記録なので残ったままで正しい。
    // 見るべきは実際に鳴り始めたか(paused: false)
    check('切り替えた後は再生されている', (await js(bg.view.webContents, 'window.__state()')).paused, false);
    check('ミュートはされていない', bg.view.webContents.isAudioMuted(), false);

    // ---- 5. 元は裏で開いたタブでも、再読み込み後にちゃんと再生できる ----
    ctx.tabManager.reload();
    await waitLoad(bg.view.webContents);
    await sleep(800);
    check('元裏タブも再読み込み後に再生できる', await js(bg.view.webContents, 'window.__state()'), { paused: false, err: null });

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    server.close();
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
