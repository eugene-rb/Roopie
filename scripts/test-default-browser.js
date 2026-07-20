// 既定のブラウザ化のお願いバーの検証(再利用可能)。
// 実行: npx electron scripts/test-default-browser.js [スクショ保存先dir]
// 一時userDataで本物のメインプロセスを動かし、
//   1) 出し分けロジック(decidePrompt: 2回見送ったら2週間は再度出さない)
//   2) 起動時に実ウィンドウのバーが自動で出て、「閉じる」で隠れて見送りが記録されること
//   3) 「既定のブラウザにする」クリックでOSへの登録・設定アプリを開く処理が呼ばれ、見送り履歴がリセットされること
//     (実際のレジストリ変更やms-settings起動はスタブに差し替えて行わない)
// を確認する。
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-defbrowser-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const defaultBrowser = require('../src/main/default-browser');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

async function shot(wc, name) {
  for (let i = 0; i < 2; i++) {
    try {
      const image = await wc.capturePage();
      const file = path.join(shotDir, name);
      fs.writeFileSync(file, image.toPNG());
      console.log(`   📸 ${file}`);
      return;
    } catch (err) {
      if (i === 1) console.log(`   ⚠ スクショを撮れませんでした(${name}): ${err.message}`);
      else await sleep(600);
    }
  }
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
}

app.whenReady().then(async () => {
  try {
    // ---- 1. 出し分けロジック(純粋関数) ----
    const NOW = 1700000000000;
    const DAY = 24 * 60 * 60 * 1000;
    check('既定になっていれば出さない', defaultBrowser.decidePrompt({ isDefault: true, dismissCount: 0, dismissedAt: null, now: NOW }), false);
    check('未見送りなら出す', defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 0, dismissedAt: null, now: NOW }), true);
    check('1回見送っても毎回出す', defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 1, dismissedAt: NOW - DAY, now: NOW }), true);
    check(
      '2回見送った直後は出さない',
      defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 2, dismissedAt: NOW - DAY, now: NOW }),
      false
    );
    check(
      '2回見送って13日後はまだ出さない',
      defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 2, dismissedAt: NOW - 13 * DAY, now: NOW }),
      false
    );
    check(
      '2回見送って2週間後は出す',
      defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 2, dismissedAt: NOW - 14 * DAY, now: NOW }),
      true
    );
    check(
      '3回目以降も2週間隔で出す',
      defaultBrowser.decidePrompt({ isDefault: false, dismissCount: 3, dismissedAt: NOW - 14 * DAY, now: NOW }),
      true
    );

    // ---- 2. 実ウィンドウ: 起動直後にバーが自動で出る(このマシンではelectron.exeは既定ブラウザではない前提) ----
    registerIpc();
    browser.initData();
    defaultBrowser.init();
    check('未パッケージのelectronは既定のブラウザではない', defaultBrowser.isDefault(), false);

    const ctx1 = browser.createWindow();
    await sleep(1500);
    const wc1 = ctx1.window.webContents;
    check('起動時にバーが自動表示される', await js(wc1, `!document.getElementById('default-browser-bar').classList.contains('hidden')`), true);
    check(
      '案内文が入っている',
      await js(wc1, `document.getElementById('default-browser-text').textContent.length > 0`),
      true
    );
    await shot(wc1, 'default-browser-1-shown.png');

    // 「閉じる」→ バーが隠れ、見送りが1件記録される
    await clickSelector(wc1, '#default-browser-dismiss');
    await sleep(600);
    check('「閉じる」でバーが隠れる', await js(wc1, `document.getElementById('default-browser-bar').classList.contains('hidden')`), true);
    const saved1 = JSON.parse(fs.readFileSync(path.join(tmp, 'default-browser-state.json'), 'utf8'));
    check('見送り回数が1になる', saved1.dismissCount, 1);
    check('見送り時刻が記録される', typeof saved1.dismissedAt === 'number', true);

    // 同じ起動中は2枚目のウィンドウでは出さない(しつこくしない)
    const ctx2 = browser.createWindow();
    await sleep(1500);
    check(
      '同じ起動中の2枚目のウィンドウでは出さない',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-bar').classList.contains('hidden')`),
      true
    );

    // ---- 3. 「既定のブラウザにする」: OS呼び出しはスタブに差し替えて副作用なく検証 ----
    const calls = { protocol: [], openExternal: null };
    const origSetAsDefault = app.setAsDefaultProtocolClient;
    const origOpenExternal = shell.openExternal;
    app.setAsDefaultProtocolClient = (protocol) => {
      calls.protocol.push(protocol);
      return true;
    };
    shell.openExternal = async (url) => {
      calls.openExternal = url;
    };
    try {
      // ゲートを通さず直接プロンプトを出させて「既定にする」ボタンを押す
      ctx2.window.webContents.send('default-browser:prompt');
      await sleep(400);
      await clickSelector(ctx2.window.webContents, '#default-browser-set');
      await sleep(600);
    } finally {
      app.setAsDefaultProtocolClient = origSetAsDefault;
      shell.openExternal = origOpenExternal;
    }
    check('http/httpsの両方を登録する', calls.protocol.sort(), ['http', 'https']);
    check('Windowsでは設定アプリを開く', calls.openExternal, process.platform === 'win32' ? 'ms-settings:defaultapps' : null);
    check(
      '「既定にする」でバーが隠れる',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-bar').classList.contains('hidden')`),
      true
    );
    const saved2 = JSON.parse(fs.readFileSync(path.join(tmp, 'default-browser-state.json'), 'utf8'));
    check('見送り履歴がリセットされる', saved2, { dismissCount: 0, dismissedAt: null });

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
