// 同梱したTorが実際に動くかの検証(再利用可能)。
// 実行: npx electron scripts/test-tor.js
//
// 1) tor.js が同梱の tor.exe を見つけられるか
// 2) その tor.exe を実際に起動して **Bootstrapped 100%(Torネットワークへの接続完了)** まで行くか
// 3) SOCKSポートが待ち受け状態になるか
// を確認する。ネットワークに出るため30〜90秒かかる。
//
// 「ポートが開いた」だけでは不十分(torはブートストラップ前からSOCKSポートを開く)なので、
// 標準出力のブートストラップ進捗を見ている。
const { app } = require('electron');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-tor-'));
app.setPath('userData', tmp);

const Tor = require('../src/main/tor');

const TEST_PORT = 9153; // 本体(9152)や既存のTor(9050/9150)と衝突しない検証用ポート
const TIMEOUT = 120_000;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (r) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// tor本体を起動し、Bootstrapped 100% を待つ
function bootstrap(exe, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, ['--SocksPort', String(TEST_PORT), '--DataDirectory', dataDir], {
      windowsHide: true,
    });
    let last = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`ブートストラップがタイムアウトしました(最後の進捗: ${last || 'なし'})`));
    }, TIMEOUT);

    proc.stdout.on('data', (buf) => {
      const text = buf.toString();
      for (const m of text.matchAll(/Bootstrapped (\d+)%[^\n]*/g)) {
        last = m[0];
        process.stdout.write(`   ${m[0]}\n`);
      }
      if (/Bootstrapped 100%/.test(text)) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`起動できません: ${err.message}`));
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`torが終了しました (code=${code})`));
    });
  });
}

app.whenReady().then(async () => {
  let proc = null;
  try {
    const tor = new Tor();

    // 1. 同梱のtor.exeを見つけられるか
    const exe = tor.findTorExecutable();
    console.log(`   見つけたtor: ${exe ?? 'なし'}`);
    check('tor.exeが見つかる', !!exe, true);
    if (!exe) throw new Error('vendor/tor/tor.exe がありません。先に node scripts/fetch-tor.js を実行してください');
    check(
      '同梱のもの(vendor/tor か resources/tor)を使う',
      /[\\/](vendor|resources)[\\/]tor[\\/]/.test(exe),
      true
    );
    check('バージョンを読める', /^\d+\.\d+\.\d+/.test(tor.bundledVersion() ?? ''), true);
    console.log(`   同梱バージョン: ${tor.bundledVersion()}`);

    // 2. 実際に起動してTorネットワークへ接続できるか
    console.log('   Torネットワークに接続中(30〜90秒かかります)…');
    proc = await bootstrap(exe, path.join(tmp, 'tor-data'));
    check('Bootstrapped 100%(Torネットワークに接続できた)', true, true);

    // 3. SOCKSポートが使える
    check('SOCKSポートが待ち受けている', await isPortOpen(TEST_PORT), true);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  } catch (err) {
    console.error('NG 検証が失敗:', err.message);
    failed++;
  } finally {
    proc?.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});

app.on('window-all-closed', () => {});
