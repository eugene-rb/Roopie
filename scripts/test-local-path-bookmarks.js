// ブックマーク・ショートカットへのローカルファイル/フォルダパス対応の実UI検証(再利用可能)。
// 実行: npx electron scripts/test-local-path-bookmarks.js
// 一時userDataで本物のウィンドウ(サイドパネル+roopie://newtabタブ)を開き、
// - サイドパネルの「ブックマークを追加」モーダルで、生のWindowsパス(空白・日本語混じり)を
//   入力/ネイティブダイアログで選択したときに正しく file:// URLへ変換されて保存されること
// - 既存のhttps系URLの追加が壊れていないこと(looksLikeUrlの修正の副作用が無いこと)
// - スタート画面のショートカット追加モーダルで「ファイル/フォルダ」種別を選び、
//   ネイティブダイアログでファイルを選んだときに正しく保存され、タイルクリックで
//   (URLナビゲーションではなく)shell.openPathへ生パスのまま渡されること
// をそれぞれ本物のIPC経路(main側の fs:pick-path / fs:path-to-file-url / bookmarks:* )で確認する。
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-localpath-'));
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

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 });
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(1500);
    const profileId = ctx.profileId;
    const bookmarks = browser.bundleFor(profileId).bookmarks;

    // ---- サイドパネルの「ブックマークを追加」モーダル ----
    ctx.sidePanel.openSection('bookmarks');
    await sleep(500);
    const panelWc = ctx.sidePanel.panelView.webContents;

    // 1) 生のWindowsパス(空白+日本語)を直接入力 → file:// URLに変換されて保存される
    const rawPath = 'C:\\Users\\Test User\\ドキュメント\\メモ.txt';
    await clickSelector(panelWc, '#bookmark-new-btn');
    await sleep(200);
    check('追加モーダルが開く', await js(panelWc, `!document.getElementById('bookmark-add').classList.contains('hidden')`), true);
    await js(panelWc, `document.getElementById('bookmark-add-url').value = ${JSON.stringify(rawPath)}`);
    await clickSelector(panelWc, '#bookmark-add-apply');
    await sleep(300);
    check('エラー無く保存される(パス直接入力)', await js(panelWc, `document.getElementById('bookmark-add').classList.contains('hidden')`), true);
    let list = bookmarks.list();
    check('件数1件(パス直接入力)', list.length, 1);
    check('file:// URLに正しくエンコードされる(空白/日本語)', list[0]?.url, pathToFileURL(rawPath).href);
    check('名前欄が空欄なら元のパス表記がタイトルになる', list[0]?.title, rawPath);

    // 2) 既存のhttps系(スキーム省略)がこれまで通り動く(looksLikeUrl修正の回帰確認)
    await clickSelector(panelWc, '#bookmark-new-btn');
    await sleep(200);
    await js(panelWc, `document.getElementById('bookmark-add-url').value = 'example.com'`);
    await js(panelWc, `document.getElementById('bookmark-add-name').value = 'Example'`);
    await clickSelector(panelWc, '#bookmark-add-apply');
    await sleep(300);
    list = bookmarks.list();
    check('件数2件(https追加も継続して動く)', list.length, 2);
    check('スキーム省略はhttps://が前置される', list.find((b) => b.title === 'Example')?.url, 'https://example.com');

    // 3) 不正な文字列(URLでもパスでもない)はエラーになる
    await clickSelector(panelWc, '#bookmark-new-btn');
    await sleep(200);
    await js(panelWc, `document.getElementById('bookmark-add-url').value = 'これは URL でも パスでもない 文字列'`);
    await clickSelector(panelWc, '#bookmark-add-apply');
    await sleep(200);
    check('不正な入力はエラー表示のまま閉じない', await js(panelWc, `document.getElementById('bookmark-add').classList.contains('hidden')`), false);
    check('エラーメッセージが出る', await js(panelWc, `!document.getElementById('bookmark-add-error').classList.contains('hidden')`), true);
    await clickSelector(panelWc, '#bookmark-add-cancel');
    await sleep(150);

    // 4) 「ファイルを選択…」「フォルダを選択…」ボタン → WindowsではopenFile+openDirectory同時指定だと
    //    フォルダ選択優先になりファイルが選べなくなるため、それぞれ単独のダイアログ設定で呼ばれることを確認する
    const pickedFile2 = 'D:\\Projects\\Roopie Test\\index.html';
    const realShowOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async (win, opts) => {
      check('ファイル選択ダイアログはopenFile単独', opts.properties, ['openFile']);
      return { canceled: false, filePaths: [pickedFile2] };
    };
    await clickSelector(panelWc, '#bookmark-new-btn');
    await sleep(200);
    await clickSelector(panelWc, '#bookmark-add-pick-file');
    await sleep(300);
    check('ファイルダイアログで選んだパスが入力欄に反映される', await js(panelWc, `document.getElementById('bookmark-add-url').value`), pickedFile2);
    await clickSelector(panelWc, '#bookmark-add-apply');
    await sleep(300);
    list = bookmarks.list();
    check('件数3件(ファイル選択分)', list.length, 3);
    check('選んだhtmlファイルも正しくfile:// URLになる', list.find((b) => b.url?.includes('index.html'))?.url, pathToFileURL(pickedFile2).href);

    const pickedFolder = 'D:\\Projects\\Roopie Test\\Sample Folder';
    dialog.showOpenDialog = async (win, opts) => {
      check('フォルダ選択ダイアログはopenDirectory単独', opts.properties, ['openDirectory']);
      return { canceled: false, filePaths: [pickedFolder] };
    };
    await clickSelector(panelWc, '#bookmark-new-btn');
    await sleep(200);
    await clickSelector(panelWc, '#bookmark-add-pick-folder');
    await sleep(300);
    check('フォルダダイアログで選んだパスが入力欄に反映される', await js(panelWc, `document.getElementById('bookmark-add-url').value`), pickedFolder);
    await clickSelector(panelWc, '#bookmark-add-apply');
    await sleep(300);
    dialog.showOpenDialog = realShowOpenDialog;
    list = bookmarks.list();
    check('件数4件(フォルダ選択分)', list.length, 4);
    check('ダイアログで選んだフォルダも正しくfile:// URLになる', list.find((b) => b.url?.includes('Sample%20Folder'))?.url, pathToFileURL(pickedFolder).href);

    // ---- スタート画面のショートカット追加モーダル(ファイル/フォルダ種別) ----
    const tab = ctx.tabManager.createTab('roopie://newtab');
    await sleep(800);
    const tabWc = tab.view.webContents;

    await js(tabWc, `document.getElementById('clock').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }))`);
    await sleep(150);
    await js(tabWc, `[...document.querySelectorAll('.grid-popup-item')].find((b) => b.textContent.includes('ショートカット')).click()`);
    await sleep(200);
    check('ショートカット追加モーダルが開く', await js(tabWc, `document.querySelector('.shortcut-modal h3')?.textContent`), 'ショートカットを追加');

    // 「ファイル/フォルダ」ラベルに変わっている(フォルダ専用だった表記の更新)
    check('種別ラベルが「ファイル/フォルダ」になっている', await js(tabWc, `[...document.querySelectorAll('.shortcut-kind-option span')].map((s) => s.textContent)`), ['ページ', 'ファイル/フォルダ']);

    await js(tabWc, `document.querySelector('input[name="shortcut-kind"][value="folder"]').click()`);
    await sleep(100);
    check(
      'ファイル用/フォルダ用のボタンが分かれている',
      await js(tabWc, `[...document.querySelectorAll('.shortcut-folder-row .btn')].map((b) => b.textContent)`),
      ['ファイルを選択', 'フォルダを選択']
    );

    // .html ファイルを選択(実機で「ダイアログでhtmlファイルを選択できない」と報告された症状の再現確認。
    // openFile単独のダイアログなら選べる)
    const pickedFile = 'C:\\Tools\\メモ.html';
    dialog.showOpenDialog = async (win, opts) => {
      check('ショートカットのファイル選択もopenFile単独', opts.properties, ['openFile']);
      return { canceled: false, filePaths: [pickedFile] };
    };
    await clickSelector(tabWc, '.shortcut-folder-row .btn:first-child');
    await sleep(300);
    check('選んだhtmlファイルパスがプレビューに出る', await js(tabWc, `document.querySelector('.shortcut-folder-path')?.textContent`), pickedFile);
    dialog.showOpenDialog = realShowOpenDialog;

    // 名前欄を空欄のまま保存 → 以前は「フォルダ/ファイル種別で名前が空だと何も起きない」サイレント失敗があったが、
    // ファイル名(拡張子込み)が既定名として自動的に入って保存できることを確認する
    await clickSelector(tabWc, '.shortcut-actions .btn.primary');
    await sleep(400);

    const startPage = bookmarks.startPages()[0];
    const savedShortcut = bookmarks.children(startPage.id).find((b) => b.url === `file://${pickedFile}`);
    check('名前が空欄でもファイル名が既定名になり保存される(以前はサイレント失敗)', savedShortcut?.title, 'メモ.html');
    check('ショートカットが「ファイル/フォルダ」種別で保存される(内部kindはfolder互換)', savedShortcut?.url, `file://${pickedFile}`);

    // タイルをクリックすると、URLナビゲーションではなくshell.openPathへ生パスのまま渡される
    let openedPath = null;
    const realOpenPath = shell.openPath;
    shell.openPath = async (p) => {
      openedPath = p;
      return '';
    };
    await js(tabWc, `[...document.querySelectorAll('.quick-link .label')].find((l) => l.textContent === 'メモ.html')?.closest('.quick-link').click()`);
    await sleep(200);
    shell.openPath = realOpenPath;
    check('タイルクリックでshell.openPathに生パスのまま渡る(file://の解析崩れなし)', openedPath, pickedFile);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
