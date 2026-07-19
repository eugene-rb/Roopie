const http = require('http');

// 走査する「Webサーバー」のよくある開発ポート(DB等の非Webポートは含めない)。
// TCPが開いているだけでなく、HTTP応答が返ったポートだけを候補にする。
const WEB_PORTS = [
  3000, 3001, 3002, 4000, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888, 9000, 1313, 3333,
  25600, // Komga
];

const PROBE_TIMEOUT = 600;
const FAVICON_TIMEOUT = 500;
const MAX_FAVICON_BYTES = 150_000;

/**
 * ローカルで起動中のWebサーバーを検知する。スタートページのサジェスト用。
 * ブラウザ全体で1つ(マシン単位)。非表示(dismiss)にしたポートは候補から外す。
 */
class LocalServers {
  constructor(store) {
    this.store = store;
    if (!this.store.data || typeof this.store.data !== 'object') this.store.data = {};
    if (!Array.isArray(this.store.data.dismissed)) this.store.data.dismissed = [];
  }

  get dismissed() {
    return this.store.data.dismissed;
  }

  dismiss(port) {
    const p = Number(port);
    if (Number.isInteger(p) && !this.dismissed.includes(p)) {
      this.dismissed.push(p);
      this.store.save();
    }
  }

  resetDismissed() {
    this.store.data.dismissed = [];
    this.store.save();
  }

  async detect() {
    const ports = WEB_PORTS.filter((p) => !this.dismissed.includes(p));
    const results = await Promise.all(ports.map((p) => this.probePort(p)));
    return results.filter(Boolean).sort((a, b) => a.port - b.port);
  }

  async probePort(port) {
    // 127.0.0.1 と ::1 の両方を試し、先にHTTP応答した方を採用する
    // (Vite/Next等はIPv4のみ/IPv6のみでbindすることがあるため両系統を見る)
    let res;
    try {
      res = await Promise.any([
        httpGet('127.0.0.1', 4, port, '/', PROBE_TIMEOUT),
        httpGet('::1', 6, port, '/', PROBE_TIMEOUT),
      ]);
    } catch {
      return null; // どちらも応答なし=そのポートにWebサーバーはいない
    }
    const title = extractTitle(res.body);
    const favicon = await fetchFavicon(res.host, res.family, port).catch(() => null);
    return { port, url: `http://localhost:${port}`, title, favicon };
  }
}

// HTTP応答があれば {host, family, status, body} で解決、無ければreject
function httpGet(host, family, port, path, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host, family, port, path, timeout, agent: false, headers: { Accept: 'text/html' } },
      (res) => {
        let body = '';
        let n = 0;
        res.on('data', (c) => {
          n += c.length;
          if (n <= 30000) body += c;
          else res.destroy();
        });
        res.on('end', () => resolve({ host, family, status: res.statusCode, body }));
        res.on('close', () => resolve({ host, family, status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

// /favicon.ico を取得できれば data URI に、無ければ null
function fetchFavicon(host, family, port) {
  return new Promise((resolve) => {
    const req = http.get({ host, family, port, path: '/favicon.ico', timeout: FAVICON_TIMEOUT, agent: false }, (res) => {
      if (res.statusCode !== 200) {
        res.destroy();
        return resolve(null);
      }
      const chunks = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > MAX_FAVICON_BYTES) {
          res.destroy();
          resolve(null);
        } else {
          chunks.push(c);
        }
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return resolve(null);
        const ct = res.headers['content-type'] || '';
        const type = ct.startsWith('image/') ? ct.split(';')[0].trim() : 'image/x-icon';
        resolve(`data:${type};base64,${buf.toString('base64')}`);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

module.exports = LocalServers;
