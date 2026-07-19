// マウスジェスチャーに割り当てられるアクションの検証(再利用可能)。
// 実行: npx electron scripts/test-gesture-actions.js
//
// アクションの定義(gestures.js の ACTIONS)と、実際に動くタブ操作
// (閉じたタブを再度開く・複製・他を閉じる・ミュート)を確かめる。
const { app, BrowserWindow, session } = require('electron');
const http = require('http');

const PORT = 8941;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- アクション定義とジェスチャー設定の整合 ----
function testActionDefinitions() {
  const Gestures = require('../src/main/gestures');
  const ACTIONS = Gestures.ACTIONS;

  check('アクションが十分に増えている(20件以上)', ACTIONS.length >= 20, true);
  check('IDが重複していない', new Set(ACTIONS.map((a) => a.id)).size, ACTIONS.length);
  check('すべてにラベルとカテゴリがある', ACTIONS.every((a) => a.label && a.category), true);
  check('「閉じたタブを再度開く」がある', !!ACTIONS.find((a) => a.id === 'reopenTab'), true);

  // 既定の割り当ては必ず存在するアクションを指していること
  const store = { data: null, save: () => {}, flush: () => {} };
  store.data = Gestures.defaults();
  const gestures = new Gestures(store);
  const ids = new Set(ACTIONS.map((a) => a.id));
  check('既定の割り当てはすべて実在するアクション', Object.values(gestures.data.mappings).every((id) => ids.has(id)), true);

  // 知らないアクションIDは保存されない
  gestures.update({ enabled: true, mappings: { L: 'back', R: 'ないやつ' } });
  check('未知のアクションIDは弾かれる', gestures.data.mappings.R, undefined);
  check('正しいアクションIDは保存される', gestures.data.mappings.L, 'back');

  // 設定画面へ渡す形にラベル・カテゴリが載っていること(プルダウンの見出しに使う)
  const config = gestures.config();
  check('設定画面向けの形にアクション一覧が入る', config.actions.length, ACTIONS.length);
  check('カテゴリも渡している', config.actions.every((a) => !!a.category), true);
}

app.whenReady().then(async () => {
  testActionDefinitions();

  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>ページ${req.url}</title>本文`);
    })
    .listen(PORT);

  const TabManager = require('../src/main/tab-manager');
  const window = new BrowserWindow({ show: true, width: 900, height: 700 });
  const history = { add: () => {}, update: () => {}, has: () => false };
  const bookmarks = { find: () => null, toggle: () => {} };
  const tabManager = new TabManager(window, { history, bookmarks, session: session.defaultSession });

  const openAndWait = async (path) => {
    const tab = tabManager.createTab(`http://localhost:${PORT}${path}`);
    await Promise.race([new Promise((r) => tab.view.webContents.once('did-finish-load', r)), sleep(6000)]);
    return tab;
  };

  const a = await openAndWait('/a');
  const b = await openAndWait('/b');
  const c = await openAndWait('/c');
  check('3つのタブを開いた', tabManager.tabs.length, 3);

  // ---- 閉じたタブを再度開く ----
  const bIndex = tabManager.tabs.indexOf(b);
  tabManager.closeTab(b.id);
  await sleep(300);
  check('タブを閉じた', tabManager.tabs.length, 2);

  const reopened = tabManager.reopenClosedTab();
  await sleep(600);
  check('閉じたタブが戻る', tabManager.tabs.length, 3);
  check('閉じたときのURLで開く', reopened.view.webContents.getURL(), `http://localhost:${PORT}/b`);
  check('元の位置に戻る', tabManager.tabs.indexOf(reopened), bIndex);

  // 続けて呼んでも、もう履歴が無ければ何も起きない
  check('履歴が空なら何もしない', tabManager.reopenClosedTab(), null);
  check('タブ数は変わらない', tabManager.tabs.length, 3);

  // 新しいタブページは履歴に残さない(開き直しても意味がないため)
  const blank = tabManager.createTab();
  await sleep(400);
  tabManager.closeTab(blank.id);
  await sleep(200);
  check('新しいタブページは「閉じたタブ」に残さない', tabManager.reopenClosedTab(), null);

  // ---- タブの複製 ----
  const before = tabManager.tabs.length;
  const dup = tabManager.duplicateTab(a.id);
  await sleep(600);
  check('タブを複製できる', tabManager.tabs.length, before + 1);
  check('複製元と同じURL', dup.view.webContents.getURL(), a.view.webContents.getURL());

  // ---- ミュート ----
  tabManager.toggleMute(a.id);
  check('ミュートできる', a.view.webContents.isAudioMuted(), true);
  tabManager.toggleMute(a.id);
  check('ミュートを解除できる', a.view.webContents.isAudioMuted(), false);

  // ---- 他のタブを閉じる ----
  tabManager.closeOtherTabs(c.id);
  await sleep(600);
  check('他のタブを閉じると1つだけ残る', tabManager.tabs.length, 1);
  check('残るのは指定したタブ', tabManager.tabs[0].id, c.id);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
