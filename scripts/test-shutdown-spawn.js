// タイマーの「シャットダウン」がOSへ本当に届くかを検証する(再利用可能)。
// 実行: npx electron scripts/test-shutdown-spawn.js
//
// 実機を落とさずに検証するため、/t 0 の代わりに /t 600(10分後)で予約し、
// 直後に shutdown /a で中止する。予約が成功していれば /a は exit 0 を返し、
// システムログにイベント1074が残る(= メインプロセスからOSへ届いている証拠)。
const { app } = require('electron');
const { spawn, spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('SKIP  Windows専用の検証');
  process.exit(0);
}

app.whenReady().then(() => {
  let spawnError = null;
  // timer-actions.js の runShutdown() と同じ形(detached + stdio:ignore + unref)で投げる
  const child = spawn('shutdown', ['/s', '/t', '600'], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    spawnError = err;
    console.log(`NG  spawnに失敗: ${err.code} ${err.message}`);
  });
  child.unref();

  // 'error' は非同期に来るので少し待ってから中止を試す
  setTimeout(() => {
    const abort = spawnSync('shutdown', ['/a'], { windowsHide: true });
    const scheduled = abort.status === 0;
    console.log(`${scheduled ? 'OK ' : 'NG '} メインプロセスからのシャットダウン予約: ${scheduled ? '成功(中止済み)' : `届いていない(shutdown /a => ${abort.status})`}`);
    if (!scheduled && !spawnError) console.log('    → spawnはエラーを出さないがOSが受け付けていない');
    app.exit(scheduled && !spawnError ? 0 : 1);
  }, 2500);
});
