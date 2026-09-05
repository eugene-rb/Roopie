// 拡張機能のショートカットキー(chrome.commands)実装の検証(再利用可能)。
// 実行: npx electron scripts/test-extensions-commands.js
//
// electron-chrome-extensions は chrome.commands をほぼ実装していない
// (キー監視も onCommand 発火もしない)。extension-commands.js がそれを補い、
// タブ(ページ)の before-input-event を拾って
//   - 名前付きコマンド → ctx.router.sendEvent('commands.onCommand') でバックグラウンドへ
//   - _execute_action 系 → ツールバーのポップアップを開く
// を行う。ここでは
//   1) キー変換(accelFromInput / accelFromSuggestedKey)の単体
//   2) フィクスチャ拡張を実際に読み込み、実タブへ Alt+Shift+D を送って
//      バックグラウンド SW が onCommand を受け取るか(= DarkReader が動く経路)
//   3) 一致しないキーはページへ素通しされること
//   4) commands.getAll が実効ショートカットを返すこと
// を確かめる。
const { app, session, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-cmd-'));
app.setPath('userData', tmp);

// browser.js は app ready 前に protocol.registerSchemesAsPrivileged を呼ぶので、
// require はトップレベル(whenReady より前)で行う必要がある
const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function secondaryDisplayOrigin() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find((d) => d.id !== primary.id) || primary;
  return { x: secondary.bounds.x + 60, y: secondary.bounds.y + 60 };
}

// Alt+Shift+D と Alt+Shift+P のコマンドを持つ最小 MV3 拡張。
// バックグラウンド SW は受け取ったコマンド名を storage.local に貯める。
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-cmd-fixture-'));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'コマンド検証拡張',
      version: '1.0.0',
      permissions: ['storage'],
      background: { service_worker: 'bg.js' },
      action: { default_title: 'cmd' },
      commands: {
        'do-thing': { suggested_key: { default: 'Alt+Shift+D' }, description: 'やる' },
        'do-other': { suggested_key: { default: 'Alt+Shift+P' }, description: 'べつ' },
        'no-key': { description: 'キーなし' },
        _execute_action: { suggested_key: { default: 'Alt+Shift+E' } },
      },
    })
  );
  fs.writeFileSync(
    path.join(dir, 'bg.js'),
    `chrome.commands.onCommand.addListener(async (command) => {
       const { fired = [] } = await chrome.storage.local.get('fired');
       fired.push(command);
       await chrome.storage.local.set({ fired });
     });`
  );
  fs.writeFileSync(path.join(dir, 'probe.html'), '<!doctype html><title>probe</title>');
  return dir;
}

app.whenReady().then(async () => {
  try {
    // ---- 1) キー変換の単体 ----
    const ExtensionCommandsAPI = require('../src/main/extension-commands');
    const { accelFromInput, accelFromSuggestedKey } = ExtensionCommandsAPI;
    const kd = (o) => ({ type: 'keyDown', code: '', key: '', control: false, alt: false, shift: false, meta: false, isAutoRepeat: false, ...o });

    check('accelFromInput: Alt+Shift+D', accelFromInput(kd({ code: 'KeyD', alt: true, shift: true })), 'ALT+SHIFT+D');
    check('accelFromInput: keyUp は無視', accelFromInput({ type: 'keyUp', code: 'KeyD', alt: true, shift: true }), null);
    check('accelFromInput: オートリピートは通す値だけ返す(呼び出し側で除外)', accelFromInput(kd({ code: 'KeyD', alt: true, shift: true, isAutoRepeat: true })), 'ALT+SHIFT+D');
    check('accelFromInput: Ctrl+Shift+9(数字)', accelFromInput(kd({ code: 'Digit9', control: true, shift: true })), 'CTRL+SHIFT+9');
    check('accelFromInput: F5', accelFromInput(kd({ code: 'F5' })), 'F5');
    check('accelFromInput: Alt+Left(矢印)', accelFromInput(kd({ code: 'ArrowLeft', alt: true })), 'ALT+LEFT');
    check('accelFromInput: Ctrl+,(記号)', accelFromInput(kd({ code: 'Comma', control: true })), 'CTRL+,');
    check('accelFromInput: 修飾キーのみは null', accelFromInput(kd({ code: 'ShiftLeft', key: 'Shift', shift: true })), null);

    check('accelFromSuggestedKey: default', accelFromSuggestedKey({ default: 'Alt+Shift+D' }), 'ALT+SHIFT+D');
    check('accelFromSuggestedKey: windows 優先', accelFromSuggestedKey({ windows: 'Ctrl+Shift+1', default: 'Alt+Shift+1' }), 'CTRL+SHIFT+1');
    check('accelFromSuggestedKey: MacCtrl → Ctrl', accelFromSuggestedKey({ default: 'MacCtrl+Shift+E' }), 'CTRL+SHIFT+E');
    check('accelFromSuggestedKey: 無し', accelFromSuggestedKey(undefined), null);

    // ---- 2) 実タブ + フィクスチャ拡張 で onCommand まで通す ----
    const ExtensionSupport = require('../src/main/extension-support');
    const ext = new ExtensionSupport();
    const profileId = 'profile-cmd-e2e';
    const testSession = session.fromPartition('persist:ext-cmd-e2e');

    const loaded = await ext.loadUnpacked(testSession, profileId, makeFixture());
    console.log('読み込んだ拡張機能:', loaded.id, loaded.manifest.version);
    const cmds = ext.commandsBySession.get(testSession);
    check('commandsBySession に登録される', !!cmds, true);
    await sleep(1200); // SW 起動 + onCommand.addListener 完了まで

    check('キー表に Alt+Shift+D が入る', cmds.table.get('ALT+SHIFT+D')?.name, 'do-thing');
    check('キー表に Alt+Shift+P が入る', cmds.table.get('ALT+SHIFT+P')?.name, 'do-other');
    check('キー表に _execute_action(Alt+Shift+E)が入る', cmds.table.get('ALT+SHIFT+E')?.name, '_execute_action');
    check('キーなしコマンドは表に入らない', [...cmds.table.values()].some((v) => v.name === 'no-key'), false);

    // _execute_action 系は onCommand ではなく browserAction のポップアップ経路へ振り分ける
    const activateCalls = [];
    const realActivate = cmds.extensions.api.browserAction.activateClick;
    cmds.extensions.api.browserAction.activateClick = (d) => activateCalls.push(d);
    await cmds.dispatch(loaded.id, '_execute_action', { id: 4242, isDestroyed: () => false });
    cmds.extensions.api.browserAction.activateClick = realActivate;
    check('_execute_action は activateClick(click)へ振り分けられる',
      activateCalls.length === 1 && activateCalls[0].eventType === 'click'
        && activateCalls[0].extensionId === loaded.id && activateCalls[0].tabId === 4242, true);

    const origin = secondaryDisplayOrigin();
    const win = new BrowserWindow({
      x: origin.x, y: origin.y, width: 800, height: 600, show: true,
      webPreferences: { session: testSession, sandbox: true, contextIsolation: true },
    });
    testSession.serviceWorkers.on('console-message', (_e, d) => console.log('[SW]', JSON.stringify(d.message || d)));
    await win.loadURL('data:text/html,<title>t</title><body style="margin:0"><input id="i" autofocus><script>window.__keys=[];addEventListener("keydown",e=>{if(e.altKey&&e.shiftKey)window.__keys.push(e.code)});</script>');
    // このタブは ExtensionSupport.addTab の context 解決を通らないので直接張る
    cmds.attachTab(win.webContents);
    win.webContents.focus();
    await sleep(300);

    const sendChord = (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['alt', 'shift'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['alt', 'shift'] });
    };

    sendChord('D');
    await sleep(800);
    sendChord('D'); // 2 回目(トグル拡張を続けて叩けるか)
    await sleep(800);

    // 一致しないキー(Alt+Shift+K)はページに届く
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['alt', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['alt', 'shift'] });
    await sleep(400);

    const pageKeys = await win.webContents.executeJavaScript('window.__keys');
    check('一致するキー(Alt+Shift+D)はページへ素通ししない', pageKeys.includes('KeyD'), false);
    check('一致しないキー(Alt+Shift+K)はページへ素通しする', pageKeys.includes('KeyK'), true);

    // バックグラウンドが onCommand を受け取ったか
    const probe = new BrowserWindow({ show: false, webPreferences: { session: testSession, sandbox: true, contextIsolation: true } });
    await probe.loadURL(`chrome-extension://${loaded.id}/probe.html`);
    const fired = await probe.webContents.executeJavaScript(`chrome.storage.local.get('fired').then(r => r.fired || [])`, true);
    check('バックグラウンドが do-thing を 2 回受け取る', fired.filter((c) => c === 'do-thing').length, 2);

    const getAll = await probe.webContents.executeJavaScript(`chrome.commands.getAll().then(list => list.map(c => [c.name, c.shortcut]))`, true);
    const getAllMap = Object.fromEntries(getAll);
    check('commands.getAll が Alt+Shift+D を返す', getAllMap['do-thing'], 'Alt+Shift+D');
    check('commands.getAll が _execute_action の Alt+Shift+E を返す', getAllMap['_execute_action'], 'Alt+Shift+E');
    check('commands.getAll: キーなしは空文字', getAllMap['no-key'], '');
    probe.destroy();

    win.destroy();

    // ---- 5) 実アプリ配線: browser.js のウィンドウでタブ生成時に attachTab されるか ----
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(2500);
    const appFired = await browser.extensions.loadUnpacked(ctx.session, ctx.profileId, makeFixture());
    await sleep(1200);
    const appCmds = browser.extensions.commandsBySession.get(ctx.session);
    check('実アプリ: commandsBySession が存在', !!appCmds, true);
    check('実アプリ: キー表に Alt+Shift+D', appCmds.table.get('ALT+SHIFT+D')?.name, 'do-thing');
    ctx.tabManager.createTab('data:text/html,<title>t</title><input autofocus>');
    await sleep(1500);
    const appTab = ctx.tabManager.activeWebContents();
    check('実アプリ: 新規タブに before-input-event が張られる', appCmds.attached.has(appTab), true);
    appTab.focus();
    await sleep(300);
    appTab.sendInputEvent({ type: 'keyDown', keyCode: 'D', modifiers: ['alt', 'shift'] });
    appTab.sendInputEvent({ type: 'keyUp', keyCode: 'D', modifiers: ['alt', 'shift'] });
    await sleep(1000);
    const probe2 = new BrowserWindow({ show: false, webPreferences: { session: ctx.session, sandbox: true, contextIsolation: true } });
    await probe2.loadURL(`chrome-extension://${appFired.id}/probe.html`);
    const fired2 = await probe2.webContents.executeJavaScript(`chrome.storage.local.get('fired').then(r => r.fired || [])`, true);
    check('実アプリ: タブから Alt+Shift+D でバックグラウンドが受け取る', fired2.filter((c) => c === 'do-thing').length, 1);
    probe2.destroy();
    ctx.window.destroy();

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
