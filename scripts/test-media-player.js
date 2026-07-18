// メディアプレイヤーの表示条件の検証(再利用可能)。
// 実行: npx electron scripts/test-media-player.js
// 確認内容: 再生中タブがアクティブな間はフローティング非表示 / タブを離れると表示 /
// 分割相手として見えている間も非表示 / 「一時的に非表示」とその自動解除(再生終了・別タブ再生)
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

// フローティングの実表示状態(layout()がsetVisibleした結果)を返す
function playerVisible(ctx) {
  const view = ctx.mediaPlayer.view;
  return !!view && view.getVisible();
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
  const play = (tabId, title) => {
    ctx.media = { title, artist: '', playing: true, duration: 100, currentTime: 0, tabId };
    browser.sendMedia(ctx);
  };
  const stop = () => {
    ctx.media = null;
    browser.sendMedia(ctx);
  };

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

  // 一時的に非表示(右クリックメニュー相当)
  ctx.mediaPlayer.hideTemporarily();
  check('一時的に非表示', playerVisible(ctx), false);
  tm.switchTab(tabA.id);
  tm.switchTab(tabB.id);
  check('タブを行き来しても非表示のまま', playerVisible(ctx), false);

  // 同じタブの再生が続く限り非表示のまま(状態更新では解除されない)
  play(tabA.id, '曲1');
  check('同じタブの状態更新では解除されない', playerVisible(ctx), false);

  // 別タブの再生に変わったら解除
  play(tabB.id, '曲2');
  tm.switchTab(tabA.id);
  check('別タブの再生に変わったら解除', playerVisible(ctx), true);

  // 再生終了→再開でも解除
  ctx.mediaPlayer.hideTemporarily();
  check('再度、一時的に非表示', playerVisible(ctx), false);
  stop();
  play(tabB.id, '曲3');
  check('再生終了→再開で解除', playerVisible(ctx), true);

  console.log(failed === 0 ? '\nすべてOK' : `\n${failed}件のNG`);
  app.exit(failed === 0 ? 0 : 1);
}).catch((err) => {
  // 例外でapp.exitに届かないとプロセスが残り続けるため、必ず終了させる
  console.error('NG  テスト実行中に例外:', err);
  app.exit(1);
});
