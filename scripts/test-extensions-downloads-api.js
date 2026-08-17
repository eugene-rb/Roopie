// chrome.downloads API 実装(extension-downloads.js)の検証(再利用可能なハーネス)。
// Link-Copy拡張機能を読み込み、実際のタブで画像を右クリック→「画像保存」モードの
// フル経路(content.js → runtime.sendMessage → background.js の saveImage() →
// chrome.downloads.download()/search())を通し、ファイルが実際に保存されるかを見る。
// 実行: npx electron scripts/test-extensions-downloads-api.js
//
// 本物のRoopieが起動中でも実行できる(userDataを一時dirに分離しているため別インスタンス
// として動く)。検証ウィンドウは作業の邪魔にならないよう2台目のモニターに表示する。
const { app, session, BrowserWindow, screen } = require('electron');
const { createServer } = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-dl-'));
app.setPath('userData', tmp);
const downloadDir = path.join(tmp, 'downloads');
fs.mkdirSync(downloadDir, { recursive: true });
app.setPath('downloads', downloadDir);

function secondaryDisplayOrigin() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find((d) => d.id !== primary.id) || primary;
  return { x: secondary.bounds.x + 60, y: secondary.bounds.y + 60 };
}

const LINK_COPY_DIR = 'D:\\Dev\\Link-Copy';

// 1x1のPNGを配信する最小フィクスチャページ
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const HTML = `<!doctype html><meta charset="utf-8"><img id="a" src="/a.png" style="width:80px;height:80px">`;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const server = createServer((req, res) => {
      if (req.url.endsWith('.png')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_1PX);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(HTML);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const ExtensionSupport = require('../src/main/extension-support');
    const ext = new ExtensionSupport();
    const profileId = 'profile-dl-e2e';
    const testSession = session.fromPartition('persist:ext-dl-e2e');

    const loaded = await ext.loadUnpacked(testSession, profileId, LINK_COPY_DIR);
    console.log('読み込んだ拡張機能:', loaded.id, loaded.manifest.version);
    await sleep(1000);

    // このサイトを「画像保存」モードにしてからタブを開く(サイト別モードはstorage.localに保存される)。
    // service worker には executeJavaScript が無いため、拡張機能ページ(options.html)経由で設定する
    const settingsWin = new BrowserWindow({ show: false, webPreferences: { session: testSession, sandbox: true, contextIsolation: true } });
    await settingsWin.loadURL(`chrome-extension://${loaded.id}/options.html`);
    await settingsWin.webContents.executeJavaScript(
      `chrome.storage.local.set({ modes: { 'localhost': 'image' } })`, true
    );
    settingsWin.destroy();

    const origin = secondaryDisplayOrigin();
    const win = new BrowserWindow({
      x: origin.x,
      y: origin.y,
      width: 900,
      height: 700,
      show: true,
      webPreferences: { session: testSession, sandbox: true, contextIsolation: true },
    });
    win.webContents.on('console-message', (e, level, message) => {
      console.log('[page console]', level, message);
    });
    testSession.serviceWorkers.on('console-message', (event, messageDetails) => {
      console.log('[SW console]', JSON.stringify(messageDetails));
    });

    await win.loadURL(`http://localhost:${port}/`);
    await sleep(1000);

    const rect = await win.webContents.executeJavaScript(
      `(() => { const r = document.getElementById('a').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
    );
    console.log('右クリック対象:', rect);

    win.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'right', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'right', clickCount: 1 });

    // saveImage()の応答(started/saved)が来るまで少し待ってから、最終的な保存結果を見る
    await sleep(4000);

    const files = fs.readdirSync(downloadDir);
    check('画像ファイルが保存される', files.length >= 1, true);
    console.log('保存されたファイル:', files);

    const checkWin = new BrowserWindow({ show: false, webPreferences: { session: testSession, sandbox: true, contextIsolation: true } });
    await checkWin.loadURL(`chrome-extension://${loaded.id}/options.html`);
    const imageLog = await checkWin.webContents.executeJavaScript(`chrome.storage.local.get('imageLog').then((r) => r.imageLog)`, true);
    check('imageLogに1件追加される', Array.isArray(imageLog) && imageLog.length, 1);
    console.log('imageLog:', imageLog);

    const pending = await checkWin.webContents.executeJavaScript(`chrome.storage.local.get('pendingDownloads').then((r) => r.pendingDownloads)`, true);
    check('pendingDownloadsが残っていない', !pending || Object.keys(pending).length === 0, true);
    checkWin.destroy();

    server.close();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
