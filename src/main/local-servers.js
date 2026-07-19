const http = require('http');

// 走査する「Webサーバー」のよくある開発ポート(DB等の非Webポートは含めない)。
// TCPが開いているだけでなく、HTTP応答が返ったポートだけを候補にする。
const WEB_PORTS = [
  // 開発サーバー
  1234, // Parcel
  1313, // Hugo
  3000, 3001, 3002, // React/Next/Express/Grafana/Uptime Kuma
  3030, 3333, // 汎用/Nx
  4000, // Phoenix/Gatsby
  4173, // Vite preview
  4200, // Angular
  4321, // Astro
  5000, 5001, // Flask/ASP.NET
  5173, 5174, 5175, // Vite
  5500, // Live Server
  5555, // Prisma Studio
  6006, // Storybook
  7860, // Gradio/Stable Diffusion WebUI
  8000, 8001, // Django/汎用
  8080, 8081, 8088, // 汎用/qBittorrent
  8100, // Ionic
  8501, // Streamlit
  8787, // Wrangler/RStudio
  8888, // Jupyter
  9000, // Portainer/SonarQube
  9090, // Prometheus
  19006, // Expo web
  // セルフホスト系
  1880, // Node-RED
  2368, // Ghost
  5601, // Kibana
  5678, // n8n
  7575, // Homarr
  7878, // Radarr
  8083, // Calibre-Web
  8096, // Jellyfin
  8112, // Deluge
  8123, // Home Assistant
  8200, // Duplicati
  8384, // Syncthing
  8686, // Lidarr
  8989, // Sonarr
  9091, // Transmission
  9117, // Jackett
  9696, // Prowlarr
  11434, // Ollama
  13378, // Audiobookshelf
  15672, // RabbitMQ管理画面
  25600, // Komga
  32400, // Plex
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
    let title = extractTitle(res.body);
    // Jellyfin等は / が /web/ へのリダイレクトでタイトルが取れない。
    // 同一サーバー内へのリダイレクトに限り1回だけ追う(外部へは追わない)
    if (!title && res.status >= 300 && res.status < 400) {
      const path = localRedirectPath(res.headers?.location, port);
      if (path) {
        const r2 = await httpGet(res.host, res.family, port, path, PROBE_TIMEOUT).catch(() => null);
        if (r2) title = extractTitle(r2.body);
      }
    }
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
        res.on('end', () => resolve({ host, family, status: res.statusCode, headers: res.headers, body }));
        res.on('close', () => resolve({ host, family, status: res.statusCode, headers: res.headers, body }));
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

// リダイレクト先が同じlocalhostサーバー内のパスならそれを返す(外部・別ポートへは追わない)
function localRedirectPath(location, port) {
  if (!location) return null;
  try {
    const u = new URL(location, `http://localhost:${port}`);
    if (u.protocol !== 'http:') return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    if (Number(u.port || 80) !== port) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

module.exports = LocalServers;
