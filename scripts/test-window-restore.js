// ウィンドウを閉じて戻したとき、中身が丸ごとそのまま戻るかの検証(再利用可能)。
// 実行: npx electron scripts/test-window-restore.js
// 見るもの: 戻る/進むの履歴・ズーム・ミュート・タブグループ・画面分割・アクティブなタブ・
//           位置と大きさ。復元タブは選ぶまで読み込まない(休止)ままであることも確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-winrestore-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const windows = require('../src/main/windows');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const checkTrue = (name, value, detail) => check(name, value === true ? true : [value, detail], true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ネットワークに出ずに「履歴のあるページ」を作る
const page = (name, n) =>
  `data:text/html,<title>${name}${n}</title><body style="height:2000px">${name} ${n}</body>`;

async function navigate(tab, url) {
  const wc = tab.view.webContents;
  const done = new Promise((r) => wc.once('did-finish-load', r));
  wc.loadURL(url);
  await Promise.race([done, sleep(3000)]);
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    await sleep(2000);

    // ---- 元のウィンドウを作り込む ----
    const t1 = tm.tabs[0];
    await navigate(t1, page('A', 1));
    await navigate(t1, page('A', 2));
    await navigate(t1, page('A', 3)); // 3ページぶんの履歴
    t1.view.webContents.setZoomLevel(1.5);

    const t2 = tm.createTab(page('B', 1));
    await sleep(800);
    await navigate(t2, page('B', 2));
    t2.view.webContents.setAudioMuted(true);
    t2.view.webContents.setZoomLevel(-1);

    const t3 = tm.createTab(page('C', 1));
    await sleep(800);
    const group = tm.createGroup([t2.id, t3.id], { name: '仕事', color: 'green' });

    // 画面分割(主ペイン=t1、相方=t3)
    tm.switchTab(t1.id);
    tm.splitWith(t3.id, 'column');
    await sleep(600);
    check('分割の前提', [tm.activeTabId, tm.splitTabId, tm.splitDirection], [t1.id, t3.id, 'column']);

    const bounds = { x: 60, y: 40, width: 1100, height: 780 };
    ctx.window.setBounds(bounds);
    await sleep(400);

    // ---- ×で閉じる → Ctrl+Shift+T 相当で戻す ----
    // 2枚目のウィンドウを開いておく(最後の1枚を閉じるとアプリが終わってしまうため)
    const keeper = browser.createWindow();
    await sleep(1500);
    ctx.window.close();
    await sleep(1200);
    check('閉じたウィンドウは1件として覚える', keeper.tabManager.closedTabs.filter((e) => e.type === 'window').length, 1);
    const saved = keeper.tabManager.closedTabs.find((e) => e.type === 'window');
    // 1枚目は「新しいタブ」から A1→A2→A3 と辿ったが、内部ページ(roopie://newtab)は
    // 落とすので3件になる
    checkTrue(
      '記録に履歴が入っている',
      saved?.tabs?.[0]?.history?.entries?.length === 3,
      saved?.tabs?.map((t) => t.history?.entries?.length ?? null)
    );

    const reopened = keeper.tabManager.reopenClosedTab();
    await sleep(2500);
    const ctx2 = windows.normal().find((c) => c !== keeper);
    checkTrue('ウィンドウが開き直される', !!ctx2, windows.normal().length);
    const tm2 = ctx2.tabManager;

    check('タブの数が同じ', tm2.tabs.length, 3);
    check(
      'タイトルの並びが同じ',
      tm2.tabs.map((t) => t.hibernatedTitle ?? t.view.webContents.getTitle()),
      ['A3', 'B2', 'C1']
    );
    check('アクティブなタブも同じ(1枚目)', tm2.activeTabId, tm2.tabs[0].id);
    // 画面に出ているぶん(アクティブ+分割の相方)は読み込む。裏のタブは休止のまま
    check(
      '画面に出ないタブは読み込まないまま',
      tm2.tabs.map((t) => t.hibernated),
      [false, true, false]
    );
    const b = ctx2.window.getBounds();
    check('位置と大きさが同じ', [b.width, b.height], [bounds.width, bounds.height]);

    // グループ
    check('グループも戻る', tm2.groups.length, 1);
    check(
      'グループ名と色',
      [tm2.groups[0].name, tm2.groups[0].color],
      [group.name, group.color]
    );
    check('グループの中身は2枚', tm2.tabsInGroup(tm2.groups[0].id).length, 2);

    // 画面分割(相方のペインは画面に出るので、誰も選ばなくても中身が入っていること)
    check('画面分割も戻る', [tm2.splitTabId, tm2.splitDirection], [tm2.tabs[2].id, 'column']);
    await sleep(1200);
    check('分割の相方も読み込まれている', tm2.tabs[2].view.webContents.getTitle(), 'C1');

    // 履歴・ズーム(アクティブなタブは読み込み済み)
    await sleep(1500);
    const wc1 = tm2.tabs[0].view.webContents;
    check('アクティブなタブは最後に見ていたページ', wc1.getTitle(), 'A3');
    check('戻る/進むの履歴も戻る', wc1.navigationHistory.getAllEntries().length, 3);
    check('戻れる', wc1.navigationHistory.canGoBack(), true);
    check('ズームも戻る', Math.round(wc1.getZoomLevel() * 10) / 10, 1.5);
    wc1.navigationHistory.goBack();
    await sleep(1200);
    check('実際に1つ戻れる', wc1.getTitle(), 'A2');

    // 休止中のタブを選ぶと、そこで履歴ごと復元される
    tm2.switchTab(tm2.tabs[1].id);
    await sleep(2000);
    const wc2 = tm2.tabs[1].view.webContents;
    check('休止中のタブも選べば読み込まれる', wc2.getTitle(), 'B2');
    check('休止中だったタブの履歴も戻る', wc2.navigationHistory.getAllEntries().length, 2);
    check('休止中だったタブも戻れる', wc2.navigationHistory.canGoBack(), true);
    check('ミュートも戻る', wc2.isAudioMuted(), true);
    check('休止中だったタブのズームも戻る', Math.round(wc2.getZoomLevel() * 10) / 10, -1);

    // ---- 閉じたタブ1枚を戻したときも履歴つき ----
    tm2.switchTab(tm2.tabs[0].id);
    await sleep(500);
    const closingId = tm2.tabs[1].id;
    tm2.closeTab(closingId);
    await sleep(600);
    const back = tm2.reopenClosedTab();
    await sleep(2000);
    checkTrue('閉じたタブが戻る', !!back, back);
    check('閉じたタブの履歴も戻る', back?.view.webContents.navigationHistory.getAllEntries().length, 2);
    check('閉じたタブのミュートも戻る', back?.view.webContents.isAudioMuted(), true);

    // ---- 履歴が上限より長く、しかも「戻った状態」で閉じた場合 ----
    // 直近ぶんだけ切り出すと、今見ているページが窓から外れて別のページで復元されてしまう
    const long = tm2.createTab(page('D', 0));
    await sleep(800);
    for (let i = 1; i <= 30; i++) await navigate(long, page('D', i));
    for (let i = 0; i < 27; i++) long.view.webContents.navigationHistory.goBack();
    await sleep(1500);
    const nowTitle = long.view.webContents.getTitle();
    const history = tm2.tabHistory(long);
    check('上限を超えた履歴は切り詰める', history.entries.length <= 25, true);
    check(
      '戻った状態で閉じても、今見ているページが記録の現在位置になる',
      history.entries[history.index]?.url,
      long.view.webContents.getURL()
    );
    console.log(`   (履歴 ${history.entries.length}件・現在位置 ${history.index}・タイトル ${nowTitle})`);

    // 内部ページ(roopie://newtab)は外部ページのタブの履歴からは落とす
    // (復元先のタブは内部preloadを持たないので、戻ると何も動かないスタート画面になる)
    check(
      '外部ページのタブの履歴に内部ページを混ぜない',
      tm2.tabHistory(tm2.tabs[0]).entries.some((e) => e.url.startsWith('roopie:')),
      false
    );

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
