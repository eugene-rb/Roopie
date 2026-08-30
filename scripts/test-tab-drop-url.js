// タブバーへのURL/テキストドラッグ&ドロップ(tabs:search-new-tab IPC)の検証(再利用可能)。
// 実行: npx electron scripts/test-tab-drop-url.js
// URLらしい文字列はそのまま開き、それ以外は検索エンジンへ回すことを、
// 1) toUrl() の判定ロジック単体と、2) 本物のipcMain経路(ウィンドウ実体) の両方で確認する。
const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-drop-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const TabManager = require('../src/main/tab-manager');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    // 1) 判定ロジック単体(TabManager.toUrl: アドレスバーと同じ判定を使い回している)
    check('完全なURLはそのまま', TabManager.toUrl('https://example.com/path', 'google'), 'https://example.com/path');
    check('ホスト名だけならhttps://を補う', TabManager.toUrl('example.com', 'google'), 'https://example.com');
    check('前後の空白は無視してURL判定', TabManager.toUrl('  example.com  ', 'google'), 'https://example.com');
    check(
      '空白を含む文章は検索エンジンへ(URLに化けない)',
      /example\.com/.test(TabManager.toUrl('hello world', 'google')),
      false
    );

    // 2) 本物のipcMain経路: tabs:search-new-tab をドロップと同じ形で発火させ、実際にタブが作られるか確認
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    // 起動直後の最初のタブが出来るまで待つ(1500ms固定だと稀に間に合わず数がずれる)
    for (let i = 0; i < 40 && ctx.tabManager.tabs.length === 0; i++) await sleep(100);
    await sleep(500);
    const fakeEvent = { sender: ctx.window.webContents };
    const tabsBefore = ctx.tabManager.tabs.length;

    ipcMain.emit('tabs:search-new-tab', fakeEvent, 'https://example.com/path', null);
    await sleep(400);
    check('URLドロップでタブが1枚増える', ctx.tabManager.tabs.length, tabsBefore + 1);
    let last = ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1];
    check('URLドロップは検索を経由せず直接そのURLで開く', last.view.webContents.getURL(), 'https://example.com/path');

    ipcMain.emit('tabs:search-new-tab', fakeEvent, 'hello world', null);
    await sleep(400);
    last = ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1];
    check(
      'URLでない文章のドロップは検索する(example.comへ直接飛ばない)',
      last.view.webContents.getURL().startsWith('https://example.com'),
      false
    );

    // 3) レンダラー側: 空き領域を落とせるようにする dnd-armed の武装/解除。
    //    実際の -webkit-app-region 切替がドラッグ中に効くかはOS依存で手動確認が要るが、
    //    「空き領域へ入った瞬間の dragleave で武装が外れて永久に落とせなくなる」旧バグの
    //    再発と、リンク(text/uri-listのみ)がドロップ経路に乗らない退行はここで止める。
    const js = (code) => ctx.window.webContents.executeJavaScript(code, true);
    const armed = () => js(`document.getElementById('tab-bar').classList.contains('dnd-armed')`);
    const fire = (node, type, data) =>
      js(`(() => {
        const dt = new DataTransfer();
        ${Object.entries(data || {}).map(([k, v]) => `dt.setData(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')}
        const el = ${node === 'document' ? 'document' : `document.getElementById(${JSON.stringify(node)})`};
        el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: dt }));
      })()`);

    await fire('toolbar', 'dragenter', { 'text/uri-list': 'https://example.com' });
    check('リンクのドラッグがクロームに入ると #tab-bar が武装する', await armed(), true);

    await fire('document', 'dragleave', {});
    check('空き領域へ入る途中の dragleave では武装を外さない', await armed(), true);

    await js(`document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
    check('ドラッグ後の mousemove で武装が外れる', await armed(), false);

    const beforeUriDrop = ctx.tabManager.tabs.length;
    const uriListUrl = 'https://uri-list-only.example/x';
    await fire('tab-bar', 'dragover', { 'text/uri-list': uriListUrl });
    await fire('tab-bar', 'drop', { 'text/uri-list': uriListUrl });
    await sleep(500);
    check('text/uri-listだけのリンクでもドロップでタブが増える', ctx.tabManager.tabs.length, beforeUriDrop + 1);
    check(
      'text/uri-listのリンクは検索を経由せずそのURLで開く',
      ctx.tabManager.tabs.some((t) => t.view.webContents.getURL() === uriListUrl),
      true
    );

    console.log(failed === 0 ? '\n✅ 全て成功' : `\n❌ ${failed}件失敗`);
  } catch (err) {
    console.error('テスト実行エラー:', err);
    failed = 1;
  } finally {
    app.exit(failed === 0 ? 0 : 1);
  }
});
app.on('window-all-closed', () => {});
