const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');

// Roopie自身が起動するTorのSOCKSポート(Tor Browserの9150や素のTorの9050と衝突しないように専用ポート)
const OWN_SOCKS_PORT = 9152;
// 既に動いているTorを検出するために調べるポート(素のTor / Tor Browser)
const KNOWN_PORTS = [9050, 9150];

/**
 * Torプロキシの管理。
 * プロファイルごとに「Torで接続する」をONにできるようにするための土台で、
 * SOCKS5プロキシのアドレス(127.0.0.1:port)を提供する。
 *
 * 方針:
 *  1. 既に動いているTor(9050/9150)があればそれを使う(Tor Browser併用など)
 *  2. なければ tor.exe を探して自前で起動する
 *  3. どちらも無ければ status='error'(設定画面に導入方法を表示する)
 *
 * status: 'disabled' | 'starting' | 'ready' | 'error'
 */
class Tor extends EventEmitter {
  constructor() {
    super();
    this.status = 'disabled';
    this.socksPort = null;
    this.error = null;
    this.process = null;
    this.starting = null; // 起動処理のPromise(多重起動防止)
  }

  get proxyRules() {
    return this.socksPort ? `socks5://127.0.0.1:${this.socksPort}` : null;
  }

  setStatus(status, { error = null, socksPort = null } = {}) {
    this.status = status;
    this.error = error;
    if (socksPort) this.socksPort = socksPort;
    this.emit('status', this.state());
  }

  state() {
    return { status: this.status, socksPort: this.socksPort, error: this.error };
  }

  // 少なくとも1つのプロファイルがTorを有効にしたときに呼ぶ。準備できたらproxyRulesが使える
  async ensureRunning() {
    if (this.status === 'ready') return this.proxyRules;
    if (this.starting) return this.starting;

    this.setStatus('starting');
    this.starting = this._start()
      .then((port) => {
        this.setStatus('ready', { socksPort: port });
        return this.proxyRules;
      })
      .catch((err) => {
        this.setStatus('error', { error: err.message });
        return null;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  async _start() {
    // 1. 既に動いているTorを探す
    for (const port of KNOWN_PORTS) {
      if (await isPortOpen(port)) return port;
    }

    // 2. tor.exe を探して起動する
    const torExe = this.findTorExecutable();
    if (!torExe) {
      throw new Error(
        'Torが見つかりません。Tor Browserを起動しておくか、tor.exeを %APPDATA%/Roopie/tor/ に配置してください'
      );
    }

    if (await isPortOpen(OWN_SOCKS_PORT)) return OWN_SOCKS_PORT; // 前回起動したtorが生きている
    await this.spawnTor(torExe);
    await waitForPort(OWN_SOCKS_PORT, 60_000); // Torのブートストラップは時間がかかることがある
    return OWN_SOCKS_PORT;
  }

  // tor.exe の在りかを順に探す
  findTorExecutable() {
    const candidates = [
      path.join(app.getPath('userData'), 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor'),
    ];
    if (process.platform === 'win32') {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localApp = process.env['LOCALAPPDATA'] || '';
      for (const base of [pf, pf86, path.join(localApp, 'Programs')]) {
        candidates.push(path.join(base, 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe'));
      }
    }
    return candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
  }

  spawnTor(torExe) {
    const dataDir = path.join(app.getPath('userData'), 'tor', 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    return new Promise((resolve, reject) => {
      this.process = spawn(
        torExe,
        ['--SocksPort', String(OWN_SOCKS_PORT), '--DataDirectory', dataDir],
        { stdio: 'ignore', windowsHide: true }
      );
      this.process.once('spawn', resolve);
      // イベントハンドラ内でthrowするとuncaughtExceptionでアプリごと落ちるため、rejectで返す
      this.process.once('error', (err) => {
        this.process = null;
        reject(new Error(`Torを起動できません: ${err.message}`));
      });
      this.process.on('exit', () => {
        this.process = null;
        // 実行中に落ちたらエラー状態にする(利用中のプロファイルは直接接続に戻す判断は呼び出し側)
        if (this.status === 'ready') this.setStatus('error', { error: 'Torプロセスが終了しました' });
      });
    });
  }

  // アプリ終了時。自前で起動したTorだけ止める(既存のTor Browserは触らない)
  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// 指定ポートで待ち受けているものがあるか(=Torが動いているか)を調べる
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// ポートが開くまで待つ(Torのブートストラップ完了待ち)
async function waitForPort(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Torの起動がタイムアウトしました');
}

module.exports = Tor;
