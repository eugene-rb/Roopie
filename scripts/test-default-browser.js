// 既定のブラウザ化のお願いバーの検証(再利用可能)。
// 実行: npx electron scripts/test-default-browser.js [スクショ保存先dir]
// 一時userDataで本物のメインプロセスを動かし、
//   1) 出し分けロジック(decidePrompt: 2回見送ったら2週間は再度出さない)
//   2) 起動時に実ウィンドウのバーが自動で出て、「閉じる」で隠れて見送りが記録されること
//   3) 「既定のブラウザにする」クリックでOSへの登録・設定アプリを開く処理が呼ばれ、見送り履歴がリセットされること
//     (実際のレジストリ変更やms-settings起動はスタブに差し替えて行わない)
//   4) 設定アプリから戻って既定になっていたら完了を出して自動で閉じること
//   5) 既定のブラウザとして渡された引数からURLを取り出し、既存ウィンドウの末尾のタブに開くこと
// を確認する。
// ※ 最後の「既定に設定する」だけはWindowsの保護(UserChoice)でアプリからは押せない=手動。
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-defbrowser-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const defaultBrowser = require('../src/main/default-browser');
const { urlFromArgv } = require('../src/main/url-args');
const registry = require('../src/main/default-browser-registry');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// レジストリの中身を読む。日本語は文字化けするので、判定はASCII部分だけで行う
function regQuery(key) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/s'], { windowsHide: true, encoding: 'latin1' }, (_err, stdout) =>
      resolve(stdout || '')
    );
  });
}

// 検証で書いた登録を消す(実際のアンインストールは build/installer.nsh が同じことをする)
async function cleanupRegistration() {
  const targets = [
    ['delete', 'HKCU\\Software\\Clients\\StartMenuInternet\\Roopie', '/f'],
    ['delete', 'HKCU\\Software\\Classes\\RoopieHTML', '/f'],
    ['delete', 'HKCU\\Software\\RegisteredApplications', '/v', 'Roopie', '/f'],
  ];
  for (const args of targets) {
    await new Promise((resolve) => execFile('reg.exe', args, { windowsHide: true }, () => resolve()));
  }
}

// 保存はデバウンス(300ms)されるので、期待の内容が書き出されるまで待って読む
async function readState(matches) {
  const file = path.join(tmp, 'default-browser-state.json');
  for (let i = 0; i < 12; i++) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!matches || matches(data)) return data;
    } catch {
      // まだ書き出されていない
    }
    await sleep(250);
  }
  return null;
}

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
    // 一度でも設定しに行ったら(=settled)、既定になっていなくても二度と出さない
    check(
      '設定しに行った後は出さない',
      defaultBrowser.decidePrompt({ isDefault: false, settled: true, dismissCount: 0, dismissedAt: null, now: NOW }),
      false
    );
    check(
      '設定しに行った後は2週間経っても出さない',
      defaultBrowser.decidePrompt({ isDefault: false, settled: true, dismissCount: 2, dismissedAt: NOW - 30 * DAY, now: NOW }),
      false
    );
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
    const saved1 = (await readState((d) => d.dismissCount === 1)) ?? {};
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
    // ※ スタブはここから終了まで外さない。本物を呼ぶと検証用のelectron.exeが
    //    HKCU\Software\Classes\http のハンドラとして登録されてしまう(このPCにゴミが残る)
    const calls = { protocol: [], openExternal: null };
    app.setAsDefaultProtocolClient = (protocol) => {
      calls.protocol.push(protocol);
      return true;
    };
    shell.openExternal = async (url) => {
      calls.openExternal = url;
    };
    // ゲートを通さず直接プロンプトを出させて「既定にする」ボタンを押す
    ctx2.window.webContents.send('default-browser:prompt');
    await sleep(400);
    await clickSelector(ctx2.window.webContents, '#default-browser-set');
    await sleep(600);
    // WindowsではHKCU\Software\Classes\httpを自分で書かない。
    // 書くと app.isDefaultProtocolClient がそれを見て true を返し、
    // ユーザーが設定アプリで何も押していなくても「設定済み」に見えてしまう
    check(
      'Windowsではhttp/httpsのハンドラを自分で書き換えない',
      calls.protocol.sort(),
      process.platform === 'win32' ? [] : ['http', 'https']
    );
    check('押しただけでは「既定になった」と判定しない', defaultBrowser.refresh(), false);
    // 未パッケージ(electron.exe)ではOSへのブラウザ登録を行わないので、一覧のほうを開く
    check('Windowsでは設定アプリを開く', calls.openExternal, process.platform === 'win32' ? 'ms-settings:defaultapps' : null);
    check(
      '「既定にする」でもバーは残る(戻ってきたときの手順として)',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-bar').classList.contains('hidden')`),
      false
    );
    check(
      '手順の案内に変わる',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-text').textContent.includes('既定に設定する')`),
      true
    );
    check(
      '押した後は「既定のブラウザにする」ボタンを出さない',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-set').classList.contains('hidden')`),
      true
    );
    await shot(ctx2.window.webContents, 'default-browser-2-instructions.png');
    // 押した後は「もうお願いしない」状態にする(設定アプリで実際に押したかは分からないため)
    const saved2 = (await readState((d) => d.settled === true)) ?? {};
    check('設定しに行ったことを覚える', saved2.settled, true);
    check('見送り履歴もリセットされる', [saved2.dismissCount, saved2.dismissedAt], [0, null]);
    check('以後はお願いを出さない', defaultBrowser.shouldPrompt(), false);

    // ---- 4. 設定アプリから戻って既定になっていたら、完了を出して自分で閉じる ----
    ctx2.window.webContents.send('default-browser:state', { isDefault: true });
    await sleep(400);
    check(
      '完了の表示に変わる',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-text').textContent.includes('既定のブラウザになりました')`),
      true
    );
    await shot(ctx2.window.webContents, 'default-browser-3-done.png');
    // 背面ウィンドウのタイマーはChromiumに間引かれるので、余裕をもって待つ
    await sleep(6000);
    check(
      '少し経つと自動で閉じる',
      await js(ctx2.window.webContents, `document.getElementById('default-browser-bar').classList.contains('hidden')`),
      true
    );

    // ---- 5. 他アプリから渡された引数のURL(既定のブラウザとして開かれたとき) ----
    const exe = process.execPath;
    check('URLを拾う', urlFromArgv([exe, 'https://example.com/a']), 'https://example.com/a');
    check('スイッチは飛ばす', urlFromArgv([exe, '--updated', '--foo=bar', 'http://example.com/b']), 'http://example.com/b');
    check('引数が無ければnull', urlFromArgv([exe]), null);
    check('実行ファイル自身は拾わない', urlFromArgv(['https://example.com/exe']), null);
    check('http/https以外は拾わない', urlFromArgv([exe, 'javascript:alert(1)', 'roopie://settings']), null);
    check('存在しないHTMLファイルは拾わない', urlFromArgv([exe, path.join(tmp, 'nope.html')]), null);
    const localHtml = path.join(tmp, 'ろーぴー.html');
    fs.writeFileSync(localHtml, '<!doctype html><title>t</title>');
    check('HTMLファイルはfile URLにする', urlFromArgv([exe, localHtml]), pathToFileURL(localHtml).href);

    // 二重起動で渡されたURLは、シークレットではない既存ウィンドウの末尾のタブに開く
    // 開く先は「フォーカス中のウィンドウ、無ければ最初のウィンドウ」なので、
    // どちらに開いたかはテスト環境のフォーカス次第。合計が1つ増えること・その末尾に入ることを見る
    const targets = [ctx1, ctx2];
    const before = targets.map((c) => c.tabManager.tabs.length);
    // 通信しないよう、さきほど作ったローカルのHTMLを開く(既定のブラウザには .html も渡ってくる)
    const externalUrl = pathToFileURL(localHtml).href;
    browser.openExternalUrl(externalUrl);
    await sleep(1200);
    const after = targets.map((c) => c.tabManager.tabs.length);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    check('タブが1つ増える', sum(after) - sum(before), 1);
    const target = targets.find((_c, i) => after[i] > before[i]);
    const opened = target ? target.tabManager.snapshotTabs().tabs : [];
    check('末尾のタブに開く', opened[opened.length - 1]?.url, externalUrl);

    // ---- 6. 設定画面(お願いバーを見送った後でも、ここからいつでも設定できる) ----
    const settingsTab = ctx1.tabManager.createTab('roopie://settings');
    await sleep(2500);
    const swc = settingsTab.view.webContents;
    check(
      '設定画面に「既定のブラウザ」がある',
      await js(swc, `document.getElementById('default-browser-btn').textContent.trim()`),
      '既定のブラウザにする'
    );
    check('既定でなければ押せる', await js(swc, `document.getElementById('default-browser-btn').disabled`), false);
    calls.openExternal = null;
    await js(swc, `document.getElementById('default-browser-btn').click()`);
    await sleep(800);
    check(
      '設定画面からも設定アプリを開く',
      calls.openExternal,
      process.platform === 'win32' ? 'ms-settings:defaultapps' : null
    );
    check(
      '設定画面にも手順が出る',
      await js(swc, `document.getElementById('default-browser-desc').textContent.includes('既定に設定する')`),
      true
    );
    // 設定アプリから戻ってきて(=フォーカスで再確認)まだ既定でなければ、手順を出したままにする
    await js(swc, `window.dispatchEvent(new Event('focus'))`);
    await sleep(400);
    check(
      '戻ってきても手順が消えない',
      await js(swc, `document.getElementById('default-browser-desc').textContent.includes('既定に設定する')`),
      true
    );

    // ---- 7. OSへのブラウザ登録(設定アプリの一覧にRoopieが出るための下準備) ----
    // パッケージ版だけで行う処理なので isPackaged を一時的に立てて実際に走らせ、
    // 検証用のelectron.exeが「Roopie」として残らないよう最後に必ず消す
    if (process.platform === 'win32') {
      const wasPackaged = app.isPackaged;
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
      try {
        check('レジストリ登録が成功する', await registry.register(), true);
        check(
          'RegisteredApplicationsに載る(設定アプリの一覧に出る)',
          (await regQuery('HKCU\\Software\\RegisteredApplications')).includes('Roopie'),
          true
        );
        check(
          'URLを引数で受け取る形で登録する',
          (await regQuery('HKCU\\Software\\Classes\\RoopieHTML\\shell\\open\\command')).includes('"%1"'),
          true
        );
        const caps = await regQuery('HKCU\\Software\\Clients\\StartMenuInternet\\Roopie\\Capabilities');
        check('http/httpsと.htm/.htmlに関連付ける', ['http', 'https', '.htm', '.html'].every((k) => caps.includes(k)), true);
        check('ブラウザとしてスタートメニューに載る', caps.includes('StartMenuInternet'), true);
        // InstallInfoが無いと、Capabilitiesまで書いても設定アプリの一覧にRoopieが出てこない
        const install = await regQuery('HKCU\\Software\\Clients\\StartMenuInternet\\Roopie\\InstallInfo');
        check(
          'InstallInfoを書く(これが無いと一覧に出ない)',
          ['ReinstallCommand', 'HideIconsCommand', 'ShowIconsCommand', 'IconsVisible'].every((k) => install.includes(k)),
          true
        );
        // 登録は「一覧に出す」だけ。実際に切り替わるのはユーザーが設定アプリで選んだとき(UserChoice)
        check('登録しただけでは既定にならない', defaultBrowser.refresh(), false);
      } finally {
        Object.defineProperty(app, 'isPackaged', { value: wasPackaged, configurable: true });
        await cleanupRegistration();
        check(
          '後始末: 検証用の登録が残っていない',
          (await regQuery('HKCU\\Software\\RegisteredApplications')).includes('Roopie'),
          false
        );
      }
    }

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
