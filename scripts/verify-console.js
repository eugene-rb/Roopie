// 再利用可能な検証スクリプト: CDP(9222)に接続し、全ターゲットのコンソールメッセージと
// 実行時例外を収集して表示する。
// 使い方: npm run start:debug でアプリを起動した状態で
//   node scripts/verify-console.js [--wait 秒数] [--all]
//   --wait: 収集する秒数(既定 5)
//   --all : warning/error 以外(log/info)も表示する
const DEBUG_PORT = 9222;
const args = process.argv.slice(2);
const waitSec = (() => {
  const i = args.indexOf('--wait');
  return i >= 0 ? Number(args[i + 1]) || 5 : 5;
})();
const showAll = args.includes('--all');

async function main() {
  const res = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) {
    console.log('ターゲットが見つかりません。npm run start:debug で起動していますか?');
    process.exit(1);
  }
  console.log(`${pages.length} 個のページターゲットに接続します (${waitSec}秒間収集)`);

  const results = [];
  await Promise.all(pages.map((t) => collect(t, results)));
  await new Promise((r) => setTimeout(r, waitSec * 1000));

  const shown = results.filter((m) => showAll || m.level === 'error' || m.level === 'warning');
  if (shown.length === 0) {
    console.log('\n=== エラー/警告なし ===');
  } else {
    console.log(`\n=== ${shown.length} 件のメッセージ ===`);
    for (const m of shown) {
      console.log(`[${m.level}] (${m.target}) ${m.text}${m.url ? `\n    at ${m.url}:${m.line}` : ''}`);
    }
  }
  process.exit(0);
}

function collect(target, results) {
  return new Promise((resolve) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const name = (target.title || target.url || '').slice(0, 60);
    let id = 0;
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: ++id, method: 'Log.enable' }));
      resolve();
    };
    ws.onerror = () => resolve();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const p = msg.params;
        results.push({
          target: name,
          level: p.type === 'error' ? 'error' : p.type === 'warning' ? 'warning' : p.type,
          text: p.args.map((a) => a.value ?? a.description ?? '').join(' '),
          url: p.stackTrace?.callFrames?.[0]?.url,
          line: p.stackTrace?.callFrames?.[0]?.lineNumber,
        });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        results.push({
          target: name,
          level: 'error',
          text: `未捕捉例外: ${d.exception?.description || d.text}`,
          url: d.url,
          line: d.lineNumber,
        });
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        results.push({ target: name, level: e.level, text: e.text, url: e.url, line: e.lineNumber });
      }
    };
  });
}

main().catch((e) => {
  console.error('接続エラー:', e.message);
  process.exit(1);
});
