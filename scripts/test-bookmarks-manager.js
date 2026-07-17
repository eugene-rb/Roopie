// ブックマーク管理画面(1ツリー化)のE2E検証(再利用可能)。
// 実行: npx electron scripts/test-bookmarks-manager.js
// 前半: 本物の Bookmarks クラス(src/main/bookmarks.js)のロジック検証(move/all/removeガード)。
// 後半: bookmarks.html を実DOMで描画し、ツリー表示・折りたたみ・名前変更・移動・削除・検索を検証。
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'src', 'renderer', 'pages');
const PORT = 8939;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

// ---- 前半: Bookmarks クラスのロジック検証 ----
function testMainLogic() {
  const Bookmarks = require(path.join(__dirname, '..', 'src', 'main', 'bookmarks.js'));
  const fakeStore = { data: [], save: () => {}, flush: () => {} };
  const bm = new Bookmarks(fakeStore, null);

  bm.add('https://a.example/', 'A', null);
  const root = bm.ensureStartFolder();
  const page1 = bm.startPages()[0];
  const shortcut = bm.addShortcut(page1.id, { kind: 'url', name: 'S', target: 'https://s.example/' });

  check('all()が全アイテムを返す(A+start+ページ1+S)', bm.all().length, 4);

  const a = bm.find('https://a.example/');
  bm.move(a.id, page1.id);
  check('ルートのブックマークをページへ移動できる', bm.children(page1.id).some((b) => b.id === a.id), true);
  check('移動後はルート一覧から消える', bm.list().length, 0);

  bm.move(a.id, null);
  check('ページからルートへ戻せる', bm.list().length, 1);

  bm.move(shortcut.id, root.id);
  check('startルート直下への移動は拒否される', bm.children(root.id).some((b) => b.id === shortcut.id), false);

  bm.move(page1.id, null);
  check('フォルダの移動は拒否される', bm.startPages().length, 1);

  bm.remove(root.id);
  check('startルートは削除できない', bm.all().some((b) => b.startRoot), true);

  // ルートに同一URLがある状態でのルートへの移動は拒否(星ボタンのトグル誤動作防止)
  const dup = bm.addShortcut(page1.id, { kind: 'url', name: 'A2', target: 'https://a.example/' });
  bm.move(dup.id, null);
  check('同一URLがルートに既にあるときの移動は拒否される', bm.children(page1.id).some((b) => b.id === dup.id), true);

  // フォルダの新規作成(パネルのエクスプローラー用)
  const rootFolder = bm.addFolder(null, '仕事');
  check('ルートにフォルダを作れる', !!rootFolder && rootFolder.parentId === null, true);
  const pageFolder = bm.addFolder(root.id, '');
  check('startルート直下のフォルダは新しいページになる', bm.startPages().some((p) => p.id === pageFolder.id), true);
  check('フォルダ名省略時は既定名になる', pageFolder.title, '新しいフォルダ');
  check('存在しない親へのフォルダ作成は失敗する', bm.addFolder('no-such-id', 'X'), null);
  bm.move(a.id, rootFolder.id);
  check('ルートのフォルダへブックマークを移動できる', bm.children(rootFolder.id).some((b) => b.id === a.id), true);
}

app.whenReady().then(async () => {
  testMainLogic();

  const server = http
    .createServer((req, res) => {
      const file = path.join(PAGES_DIR, path.basename(new URL(req.url, 'http://x').pathname) || 'bookmarks.html');
      try {
        const body = fs.readFileSync(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'text/plain' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })
    .listen(PORT);

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { preload: path.join(__dirname, 'stub-bookmarks-preload.js') },
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadURL(`http://localhost:${PORT}/bookmarks.html`);
  await sleep(400);

  // ---- ツリー表示 ----
  check('ルートのブックマーク2件が表示される', await js(`[...document.querySelectorAll('#list > .row:not(.bm-folder)')].length`), 2);
  check('スタート画面フォルダが表示される', await js(`[...document.querySelectorAll('.bm-folder .title')].some((t) => t.textContent.includes('スタート画面'))`), true);
  check('ページフォルダが2つ表示される', await js(`[...document.querySelectorAll('.bm-folder .title')].filter((t) => t.textContent.includes('ページ')).length`), 2);
  check('ショートカットがツリー内に表示される', await js(`[...document.querySelectorAll('.row .title')].some((t) => t.textContent === 'ショートカットA')`), true);
  check('ショートカットの絵文字アイコンが出る', await js(`[...document.querySelectorAll('.bm-emoji')].some((el) => el.textContent === '🚀')`), true);

  // ---- 折りたたみ ----
  await js(`[...document.querySelectorAll('.bm-folder .title')].find((t) => t.textContent.includes('スタート画面')).click()`);
  await sleep(100);
  check('折りたたむと中身が隠れる', await js(`[...document.querySelectorAll('.row .title')].some((t) => t.textContent === 'ショートカットA')`), false);
  await js(`[...document.querySelectorAll('.bm-folder .title')].find((t) => t.textContent.includes('スタート画面')).click()`);
  await sleep(100);
  check('再クリックで中身が戻る', await js(`[...document.querySelectorAll('.row .title')].some((t) => t.textContent === 'ショートカットA')`), true);

  // ---- スタート画面フォルダには削除・名前変更が無い ----
  const startRowBtns = await js(`(() => {
    const row = [...document.querySelectorAll('.bm-folder')].find((r) => r.querySelector('.title').textContent.includes('スタート画面'));
    return row.querySelectorAll('.row-btn').length;
  })()`);
  check('スタート画面フォルダに操作ボタンが無い', startRowBtns, 0);

  // ---- 移動(ルートのExample→ページ2) ----
  await js(`(() => {
    const row = [...document.querySelectorAll('#list > .row')].find((r) => r.querySelector('.title')?.textContent === 'Example');
    [...row.querySelectorAll('.row-btn')].find((b) => b.textContent === '移動').click();
  })()`);
  await sleep(100);
  check('移動ボタンがセレクトに変わる', await js(`!!document.querySelector('select.row-btn')`), true);
  const moveOptions = await js(`[...document.querySelector('select.row-btn').options].map((o) => o.textContent)`);
  check('移動先にスタート画面の各ページが並ぶ', moveOptions.some((t) => t.includes('ページ2')), true);
  await js(`(() => {
    const sel = document.querySelector('select.row-btn');
    sel.value = [...sel.options].find((o) => o.textContent.includes('ページ2')).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(200);
  const moved = await js(`window.roopieInternal.__stubState().calls.moves`);
  check('移動が保存される(b1→p2)', moved.some((m) => m.id === 'b1' && m.parentId === 'p2'), true);
  check('移動後はページ2の中に表示される', await js(`(() => {
    const boxes = [...document.querySelectorAll('.bm-children')];
    return boxes.some((box) => [...box.querySelectorAll('.title')].some((t) => t.textContent === 'Example'));
  })()`), true);

  // ---- 検索(所在パス付きのフラット表示) ----
  await js(`(() => { const s = document.getElementById('search'); s.value = 'ショートカット'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  check('検索でショートカットもヒットする', await js(`document.querySelectorAll('#list .row').length`), 1);
  check('検索結果に所在パスが出る', await js(`document.querySelector('#list .row .sub').textContent.includes('スタート画面 / ページ1')`), true);
  await js(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);

  // ---- 名前変更(ショートカット) ----
  await js(`(() => {
    const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title')?.textContent === 'ショートカットA');
    [...row.querySelectorAll('.row-btn')].find((b) => b.textContent === '名前を変更').click();
  })()`);
  await sleep(100);
  await js(`(() => {
    const input = document.querySelector('#list input.search');
    input.value = '改名済み';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(200);
  const renames = await js(`window.roopieInternal.__stubState().calls.renames`);
  check('名前変更が保存される', renames.some((r) => r.id === 's1' && r.title === '改名済み'), true);

  // ---- 削除(ページフォルダ) ----
  await js(`(() => {
    const row = [...document.querySelectorAll('.bm-folder')].find((r) => r.querySelector('.title').textContent.includes('ページ2'));
    [...row.querySelectorAll('.row-btn')].find((b) => b.textContent === '削除').click();
  })()`);
  await sleep(200);
  check('フォルダ削除が反映される', await js(`[...document.querySelectorAll('.bm-folder .title')].filter((t) => t.textContent.includes('ページ')).length`), 1);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
