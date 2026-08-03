// メディアプレイヤーの表示条件の検証(再利用可能)。
// 実行: npx electron scripts/test-media-player.js
// 確認内容: 再生中タブがアクティブな間はそのタブの行だけ非表示(他タブは表示のまま) /
// タブを離れると表示 / 分割相手として見えている間も非表示 /
// 「一時的に非表示」(全タブぶんまとめて。再生が全部止まると自動解除)
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-media-'));
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
const fakeFrame = () => ({ isDestroyed: () => false });

// フローティングの実表示状態(layout()がsetVisibleした結果)を返す
function playerVisible(ctx) {
  const view = ctx.mediaPlayer.view;
  return !!view && view.getVisible();
}

// 現在フローティングに並んでいるタブ名一覧(visibleRows()準拠)
function visibleTitles(ctx) {
  return ctx.mediaPlayer.visibleRows().map((m) => m.title);
}

app.whenReady().then(async () => {
  registerIpc();
  browser.initData();

  const ctx = browser.createWindow();
  const tm = ctx.tabManager;
  // 初期タブはウィンドウのdid-finish-load後に作られるため、できるまで待つ(固定sleepだと環境次第で間に合わない)
  for (let i = 0; i < 100 && !tm.activeTabId; i++) await sleep(100);
  const tabA = tm.getTab(tm.activeTabId);
  if (!tabA) {
    console.log('NG  初期タブが作成されない(10秒待機)');
    app.exit(1);
    return;
  }
  const tabB = tm.createTab();
  await sleep(300);

  // createTabはBをアクティブにする → Aに戻してから、Aで再生が始まった状況を作る
  tm.switchTab(tabA.id);
  const play = (tabId, title) =>
    tm.onMediaReport(tabId, { title, artist: '', playing: true, duration: 100, currentTime: 0, canPrev: false, canNext: false, hasVideo: false }, fakeFrame());
  const stop = (tabId) => tm.onMediaReport(tabId, null, null);

  play(tabA.id, '曲1');
  await sleep(300);
  check('再生中タブがアクティブ → 非表示', playerVisible(ctx), false);

  tm.switchTab(tabB.id);
  check('別タブへ移動 → 表示', playerVisible(ctx), true);

  tm.switchTab(tabA.id);
  check('再生中タブへ戻る → 非表示', playerVisible(ctx), false);

  // 分割相手として再生中タブが見えている間も非表示
  tm.switchTab(tabB.id);
  tm.splitWith(tabA.id, 'right');
  check('再生中タブが分割相手 → 非表示', playerVisible(ctx), false);
  tm.switchTab(tabB.id); // 分割解除はされない(相手指定のまま)ため明示的に解除
  tm.splitTabId = null;
  tm.layout();
  check('分割解除 → 表示', playerVisible(ctx), true);

  // Bでも再生を始める → 2タブぶん独立して並ぶ(この時点のアクティブはB)
  play(tabB.id, '曲2');
  await sleep(300);
  check('アクティブ(B)の行だけ隠れ、他タブ(A)の行は出る', visibleTitles(ctx).sort(), ['曲1']);
  tm.switchTab(tabA.id);
  await sleep(300);
  check('タブ切り替えでAの行が隠れBの行が出る', visibleTitles(ctx).sort(), ['曲2']);
  stop(tabB.id);
  await sleep(200);

  // 一時的に非表示(右クリックメニュー相当。全タブぶんまとめて)
  tm.switchTab(tabB.id); // Aの行が出る状況にしておく
  await sleep(200);
  ctx.mediaPlayer.hideTemporarily();
  check('一時的に非表示', playerVisible(ctx), false);
  tm.switchTab(tabA.id);
  tm.switchTab(tabB.id);
  check('タブを行き来しても非表示のまま', playerVisible(ctx), false);

  // 再生が全部止まるまでは解除されない(別タブの再生が増えても)
  play(tabB.id, '曲2'); // 既にAが再生中の状態にBも追加
  await sleep(200);
  check('別タブの再生が増えても解除されない(まだ何か再生中)', playerVisible(ctx), false);

  // 再生が全部止まったら解除される
  stop(tabA.id);
  stop(tabB.id);
  await sleep(200);
  check('再生が全部止まると自動解除', ctx.mediaPlayer.tempHidden, false);

  play(tabA.id, '曲3');
  tm.switchTab(tabB.id);
  await sleep(200);
  check('再開後は通常通り表示される', playerVisible(ctx), true);

  console.log(failed === 0 ? '\nすべてOK' : `\n${failed}件のNG`);
  app.exit(failed === 0 ? 0 : 1);
}).catch((err) => {
  // 例外でapp.exitに届かないとプロセスが残り続けるため、必ず終了させる
  console.error('NG  テスト実行中に例外:', err);
  app.exit(1);
});
