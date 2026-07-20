// タイマー機能の検証(再利用可能)。
// 実行: npx electron scripts/test-timer.js
// 確認内容: CRUD、カウントダウン/時刻指定(繰り返し)のtick発火、アプリ再起動をまたいだ
// 取りこぼし(catchUpは発火させず状態だけ進める)、危険アクションの猶予・キャンセル、
// シャットダウンのdry-runガード(実機を落とさずに検証できること)
process.env.ROOPIE_TIMER_SHUTDOWN_DRYRUN = '1'; // 必須: これが無いとgraceEnd()で実際にシャットダウンしうる

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-timer-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const Timers = require('../src/main/timers');
const Store = require('../src/main/store');
const timerActions = require('../src/main/timer-actions');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  browser.initData();

  const ctx = browser.createWindow();
  const tm = ctx.tabManager;
  for (let i = 0; i < 100 && !tm.activeTabId; i++) await sleep(100);

  const bundle = browser.bundleFor(ctx.profileId);
  const timers = bundle.timers;

  // ---- CRUD ----
  const t1 = timers.add({ type: 'countdown', durationMs: 5000, name: 'テスト1' });
  check('追加できる', timers.list().length, 1);
  timers.update(t1.id, { name: '改名' });
  check('更新できる', timers.find(t1.id).name, '改名');

  // ---- カウントダウンの発火(tickへ未来時刻を注入し、実時間を待たない) ----
  timers.start(t1.id);
  check('開始でrunning', timers.find(t1.id).status, 'running');
  timers.tick(Date.now() + 10_000);
  check('発火でringing', timers.find(t1.id).status, 'ringing');
  timers.acknowledge(t1.id);
  check('確認でfinishedへ(繰り返し無し)', timers.find(t1.id).status, 'finished');

  timers.remove(t1.id);
  check('削除できる', timers.list().length, 0);

  // ---- 時刻指定・繰り返し ----
  const t2 = timers.add({
    type: 'clock',
    name: '毎日9時',
    clockTime: { hour: 9, minute: 0 },
    repeat: { enabled: true, weekdays: [true, true, true, true, true, true, true] },
  });
  timers.start(t2.id);
  const before = timers.find(t2.id).nextFireAt;
  timers.tick(before + 1000);
  check('繰り返しも発火直後はringing(確認するまで鳴り続ける)', timers.find(t2.id).status, 'ringing');
  timers.acknowledge(t2.id);
  const after = timers.find(t2.id);
  check('確認後、繰り返しはrunningへ戻る', after.status, 'running');
  check('繰り返しは次回時刻が未来へ進む', after.nextFireAt > before, true);
  timers.remove(t2.id);

  // ---- catchUp: アプリが閉じていた間に予定時刻を過ぎていたら、発火させず状態だけ進める ----
  const catchUpStore = new Store(path.join(tmp, 'catchup-test.json'), []);
  catchUpStore.data = [
    {
      id: 'catchup-1',
      type: 'countdown',
      name: '過去に満了',
      durationMs: 5000,
      status: 'running',
      nextFireAt: Date.now() - 60_000, // 1分前に満了していた(アプリが閉じていた想定)
      startedAt: Date.now() - 65_000,
      remainingAtPauseMs: null,
      elapsedAtPauseMs: null,
      lastFiredAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      actions: {
        sound: true,
        hibernateTabs: false,
        closeWindow: false,
        openPage: { enabled: false, url: '' },
        shutdown: false,
        shutdownConfirmed: false,
      },
    },
  ];
  let onFireCalled = false;
  const catchUpTimers = new Timers(catchUpStore, { onFire: () => (onFireCalled = true) });
  check('catchUpはonFireを呼ばない(発火させない)', onFireCalled, false);
  check('catchUpはfinishedへ状態だけ進める', catchUpTimers.list()[0].status, 'finished');
  catchUpTimers.destroy();

  // ---- 危険アクション: 発火→グレース登録→キャンセルでウィンドウは閉じない ----
  let fired = null;
  const originalFireTimer = browser.fireTimer;
  browser.fireTimer = (profileId, timer) => {
    fired = timer;
    originalFireTimer(profileId, timer);
  };

  const t3 = timers.add({ type: 'countdown', durationMs: 5000, name: '危険アクション', actions: { closeWindow: true } });
  timers.start(t3.id);
  timers.tick(Date.now() + 10_000);
  check('危険アクションの発火でringing', timers.find(t3.id).status, 'ringing');
  check('fireIdが払い出される', typeof fired?.fireId, 'string');
  check('猶予中はグレースが登録される', timers.graces.has(fired.fireId), true);
  check('猶予中はウィンドウを閉じない', ctx.window.isDestroyed(), false);

  timers.cancelFire(fired.fireId);
  check('キャンセルでfinishedへ', timers.find(t3.id).status, 'finished');
  check('キャンセルでグレースが消える', timers.graces.has(fired.fireId), false);
  check('キャンセル後もウィンドウは閉じない', ctx.window.isDestroyed(), false);
  timers.remove(t3.id);
  browser.fireTimer = originalFireTimer;

  // ---- シャットダウンのdry-runガード: 15秒待たずrunNow()で即時実行して安全性を確認 ----
  let shutdownRan = false;
  const graceHandle = timers.registerGrace(
    'dummy-timer-id',
    'dummy-fire-id',
    15_000,
    () => {
      timerActions.runShutdown(); // dry-run環境変数により実コマンドは実行されない
      shutdownRan = true;
    },
    true
  );
  graceHandle.runNow();
  check('runNow()で猶予を待たず即時実行できる', shutdownRan, true);
  check('dry-run中でもアプリは生きている(実機は落ちない)', app.isReady(), true);

  // ---- cancel()で即時実行を止められることの確認 ----
  let shouldNotRun = false;
  const cancelHandle = timers.registerGrace('dummy-2', 'dummy-fire-2', 15_000, () => (shouldNotRun = true), true);
  cancelHandle.cancel();
  await sleep(50);
  check('cancel()した猶予は実行されない', shouldNotRun, false);

  console.log(failed === 0 ? '\nすべてOK' : `\n${failed}件のNG`);
  app.exit(failed === 0 ? 0 : 1);
}).catch((err) => {
  console.error('NG  テスト実行中に例外:', err);
  app.exit(1);
});
