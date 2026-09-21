// 実セッションでDNSとページ読み込みを検証する(ネットワーク必須)。
// npx electron scripts/test-site-connectivity.js [--system-dns] [https://example.com/ ...]
// 本文・Cookie・画像は出力しない。HTTPエラーや空ページは成功扱いしない。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-connectivity-')));
const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const args = process.argv.slice(2);
const urls = args.filter((arg) => /^https?:\/\//.test(arg));
if (!urls.length) urls.push('https://example.com/');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function deadline(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout (${ms}ms)`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function inspect(ctx, url) {
  const ses = ctx.tabManager.session;
  const host = new URL(url).hostname;
  let dns;
  try { dns = await deadline(ses.resolveHost(host), 10000); }
  catch (error) { dns = { error: error.message }; }
  const proxy = await ses.resolveProxy(url);
  const tab = ctx.tabManager.createTab('about:blank');
  const wc = tab.view.webContents;
  wc.setAudioMuted(true);
  // createTab 内部の最初の about:blank 読み込みと競合させない。
  await sleep(300);
  const responses = [];
  wc.on('did-navigate', (_event, target, status) => responses.push({ url: target, status }));
  let error = null;
  wc.on('did-fail-load', (_event, code, description, _target, mainFrame) => {
    if (mainFrame && code !== -3) error = `${code} ${description}`;
  });
  try {
    await deadline(wc.loadURL(url), 25000);
  } catch (e) { error = e.message; wc.stop(); }
  const page = await deadline(wc.executeJavaScript(`({
    url: location.href,
    textLength: document.body?.innerText.length || 0,
    links: document.querySelectorAll('a[href]').length,
    challenge: /just a moment|attention required|access denied/i.test(document.title)
  })`), 5000).catch(() => null);
  const ok = !error && proxy === 'DIRECT' && responses.at(-1)?.status === 200 && page?.textLength > 100 && !page.challenge;
  console.log(JSON.stringify({ url, proxy, dns, responses, page, error, ok }));
  ctx.tabManager.closeTab(tab.id);
  return ok;
}

app.whenReady().then(async () => {
  let ctx;
  let server;
  let failed = 0;
  try {
    registerIpc();
    browser.initData();
    if (args.includes('--system-dns')) {
      app.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
    }
    await browser.adblock.ready;
    ctx = browser.createWindow({ url: 'about:blank' });
    ctx.window.hide();
    for (let i = 0; i < 100 && !ctx.tabManager.tabs.length; i++) await sleep(100);
    if (!ctx.tabManager.tabs.length) throw new Error('initial tab timeout');
    await browser.adblock.apply(ctx.tabManager.session, true);
    console.log(`DNS mode: ${args.includes('--system-dns') || process.env.ROOPIE_SYSTEM_DNS === '1' ? 'system' : 'DoH (production default)'}`);
    // DoHを有効にしても、開発用のlocalhostへ接続できることを確認する。
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body>${'Local connectivity test. '.repeat(8)}</body></html>`);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    urls.push(`http://localhost:${server.address().port}/`);
    for (const url of urls) if (!await inspect(ctx, url)) failed++;
  } catch (error) {
    console.error(error);
    failed++;
  } finally {
    if (ctx && !ctx.window.isDestroyed()) ctx.window.destroy();
    server?.close();
    browser.tor.stop();
    app.exit(failed ? 1 : 0);
  }
});
app.on('window-all-closed', () => {});
