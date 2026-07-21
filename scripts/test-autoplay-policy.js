// バックグラウンドで開いたタブ(ホイールクリック等)がユーザーの見ていない間に勝手に
// 音声/動画を自動再生しないことの検証(再利用可能)。実行: npx electron scripts/test-autoplay-policy.js
//
// Electronのwebviewの既定(no-user-gesture-required)は無条件に自動再生を許すため、
// Chrome/Firefox既定と同じ autoplayPolicy: 'document-user-activation-required' に変更した。
// これは「そのタブ自身への操作(クリック等)」が要る方式で、タブを開いた側(親ページ)への
// クリックはカウントされない。よってホイールクリックで裏に開いたタブは自動再生できず、
// そのタブへ切り替えて何か操作すれば以後は再生できるようになる。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
// 第2引数trueは「このスクリプト実行自体をユーザー操作とみなす」指定のため、これで自動再生の
// 可否を調べると常に許可扱いになってしまう。判定用の呼び出しは合成ジェスチャーを与えない
const probe = (wc) => wc.executeJavaScript(PROBE, false);

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// autoplay属性ではなく明示的にplay()を呼び、NotAllowedErrorかどうかで判定する
// (muted要素は常に自動再生できてしまうため、あえてミュートしない状態で試す。
//  src には最小構成の有効なWAV(無音・0バイトの音声データ)を使い、フォーマットエラーと
//  自動再生ブロックを区別できるようにする)
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const PROBE = `(() => {
  const a = document.createElement('audio');
  a.src = '${SILENT_WAV}';
  a.muted = false;
  document.body.appendChild(a);
  return a.play().then(() => 'played', (e) => e.name);
})()`;

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);

    // ホイールクリック相当: background:true で裏に開いたタブは、そのタブ自身への
    // 操作を一度も受けていないため自動再生がブロックされるはず
    const bg = tm.createTab('data:text/html,<title>bg</title>', { background: true });
    await Promise.race([new Promise((r) => bg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    const bgResult = await probe(bg.view.webContents).catch((e) => `threw: ${e.message}`);
    check('裏で開いたタブ(未操作)は自動再生がブロックされる', bgResult, 'NotAllowedError');

    // そのタブへ切り替えてクリックする(=そのタブ自身へのユーザー操作)と、以後は再生できる
    tm.switchTab(bg.id);
    await sleep(300);
    clickAt(bg.view.webContents, 10, 10);
    await sleep(200);
    const afterClickResult = await probe(bg.view.webContents).catch((e) => `threw: ${e.message}`);
    check('切り替えて操作した後は再生できる', afterClickResult, 'played');

    // 比較用: 普通に(裏で開かず)ナビゲーションしたタブでも、直接の操作が無ければ同様にブロックされる
    // (「裏タブだから」ではなく仕様どおりdocument-user-activation-requiredが効いていることの確認)
    const fg = tm.createTab('data:text/html,<title>fg</title>');
    await Promise.race([new Promise((r) => fg.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    const fgResult = await probe(fg.view.webContents).catch((e) => `threw: ${e.message}`);
    check('前面のタブでも未操作なら同様にブロックされる', fgResult, 'NotAllowedError');

    browser.flushAll();
    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
