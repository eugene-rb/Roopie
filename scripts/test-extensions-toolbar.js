// ツールバーの拡張機能UI(ピン留めアイコン + パズルボタン)がタブ切り替えで
// 消えたり出たりしないかを実UIで確認する(再利用可能)。
// 実行: npx electron scripts/test-extensions-toolbar.js [スクショ保存先dir]
const { app, session: electronSession, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-toolbar-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// アクション(ツールバーアイコン)を持つ最小の拡張機能を作る。
// 実物の拡張(uBlock等)と同じく、アクティブタブが変わるたびに chrome.action.setIcon({tabId})
// でタブ単位のアイコンを設定する = ツールバー側が「今どのタブか」を正しく持てているかを試せる
function makeFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-act-'));
  // 16x16の単色BGRAビットマップからPNGを作る(外部ファイルに依存しない)
  const bitmap = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = 0x40; // B
    bitmap[i + 1] = 0x90; // G
    bitmap[i + 2] = 0xf0; // R
    bitmap[i + 3] = 0xff; // A
  }
  const png = nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 });
  fs.writeFileSync(path.join(dir, 'icon.png'), png.toPNG());
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name,
      version: '1.0.0',
      description: 'ツールバー表示の検証用',
      icons: { 16: 'icon.png' },
      action: { default_icon: { 16: 'icon.png' }, default_title: name, default_popup: 'popup.html' },
      permissions: ['tabs'],
      background: { service_worker: 'bg.js' },
    })
  );
  fs.writeFileSync(path.join(dir, 'popup.html'), '<!doctype html><title>popup</title>ポップアップ');
  // アクティブタブが変わるたびにタブ単位のアイコン・バッジを設定する
  fs.writeFileSync(
    path.join(dir, 'bg.js'),
    `const mark = (tabId) => {
       chrome.action.setIcon({ tabId, path: { 16: 'icon.png' } });
       chrome.action.setBadgeText({ tabId, text: String(tabId).slice(-2) });
     };
     chrome.tabs.onActivated.addListener(({ tabId }) => mark(tabId));
     chrome.tabs.onUpdated.addListener((tabId) => mark(tabId));`
  );
  return dir;
}

// ツールバーの拡張機能まわりの見え方をまとめて取る
const toolbarState = (wc) =>
  js(
    wc,
    `(() => {
       const list = document.getElementById('extensions-list');
       const nodes = list?.shadowRoot ? [...list.shadowRoot.querySelectorAll('.action')] : [];
       return {
         listExists: !!list,
         actions: nodes.length,
         shown: nodes.filter((n) => n.style.display !== 'none').length,
         // no-icon = アイコンの読み込みに失敗して灰色の文字アイコンになっている状態
         noIcon: nodes.filter((n) => n.classList.contains('no-icon')).length,
         tab: nodes[0]?.getAttribute('tab') ?? null,
         puzzleHidden: document.getElementById('extensions-menu-btn').classList.contains('hidden'),
       };
     })()`
  );

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    await sleep(2000);
    const uiWc = ctx.window.webContents;
    const profileSession = browser.profiles.sessionFor(browser.profiles.active());

    // 拡張機能を読み込み、ツールバーへピン留めする(ピン留めしないと出ないのが仕様)
    const loaded = await profileSession.extensions.loadExtension(makeFixture('検証拡張'));
    const bundle = browser.bundleFor(ctx.profileId);
    bundle.settings.data.pinnedExtensions = [loaded.id];
    bundle.settings.save();
    browser.sendSettingsFor(ctx.profileId);
    browser.sendExtensionsFor(ctx.profileId);
    await sleep(1500);

    const wcIdOf = (tab) => String(tab.view.webContents.id);

    const initial = await toolbarState(uiWc);
    console.log('   初期:', JSON.stringify(initial));
    check('ツールバーにアイコンが出る', initial.shown, 1);
    check('パズルボタンが出る', initial.puzzleHidden, false);
    check('アイコンの読み込みに失敗していない', initial.noIcon, 0);

    // 通常ページのタブと内部ページのタブを用意して行き来する
    const tabA = ctx.tabManager.tabs[0];
    const tabB = ctx.tabManager.createTab('roopie://newtab');
    await sleep(1500);
    const onInternal = await toolbarState(uiWc);
    console.log('   内部ページ:', JSON.stringify(onInternal));
    check('内部ページのタブでもアイコンが残る', onInternal.shown, 1);
    check('内部ページのタブでもパズルボタンが残る', onInternal.puzzleHidden, false);
    check('内部ページのタブでもアイコンが読める', onInternal.noIcon, 0);
    check('アイコンが今のタブを指している(内部ページ)', onInternal.tab, wcIdOf(tabB));

    ctx.tabManager.switchTab(tabA.id);
    await sleep(1200);
    const backToA = await toolbarState(uiWc);
    console.log('   戻り:', JSON.stringify(backToA));
    check('元のタブへ戻してもアイコンが残る', backToA.shown, 1);
    check('アイコンが今のタブを指している(戻り)', backToA.tab, wcIdOf(tabA));

    // 裏で開いたタブ(休止中=未読み込み)へ切り替える
    const tabC = ctx.tabManager.createTab('https://example.com', { background: true });
    await sleep(800);
    ctx.tabManager.switchTab(tabC.id);
    await sleep(1500);
    const onHibernated = await toolbarState(uiWc);
    console.log('   休止復帰:', JSON.stringify(onHibernated));
    check('休止から復帰したタブでもアイコンが残る', onHibernated.shown, 1);
    check('アイコンが今のタブを指している(休止復帰)', onHibernated.tab, wcIdOf(tabC));

    // 2つ目のウィンドウを開いてから、1つ目のウィンドウでタブを切り替える
    // (拡張機能システムへのタブ登録がウィンドウ単位で正しくないと、ここで参照するタブがずれる)
    const ctx2 = browser.createWindow();
    await sleep(2500);
    ctx.window.focus();
    ctx.tabManager.switchTab(tabB.id);
    await sleep(1500);
    const afterSecondWindow = await toolbarState(uiWc);
    console.log('   2窓目あり(1窓目):', JSON.stringify(afterSecondWindow));
    check('2つ目のウィンドウを開いた後も1つ目にアイコンが残る', afterSecondWindow.shown, 1);
    check('2つ目のウィンドウを開いた後もアイコンが読める', afterSecondWindow.noIcon, 0);
    check('1窓目のアイコンが1窓目の今のタブを指している', afterSecondWindow.tab, wcIdOf(tabB));

    const secondWindowState = await toolbarState(ctx2.window.webContents);
    console.log('   2窓目:', JSON.stringify(secondWindowState));
    check('2つ目のウィンドウにもアイコンが出る', secondWindowState.shown, 1);
    check('2窓目のアイコンが2窓目のタブを指している', secondWindowState.tab, wcIdOf(ctx2.tabManager.tabs[0]));

    // 1窓目で新しいタブを開いて切り替える(2窓目ができた後に作られたタブの登録先が正しいか)
    const tabD = ctx.tabManager.createTab('https://example.org');
    await sleep(1500);
    const afterNewTab = await toolbarState(uiWc);
    console.log('   2窓目あり+新タブ:', JSON.stringify(afterNewTab));
    check('後から開いたタブでもアイコンが今のタブを指している', afterNewTab.tab, wcIdOf(tabD));
    check('後から開いたタブでもアイコンが読める', afterNewTab.noIcon, 0);

    // タブを2窓目へ移す(WebContentsViewごと載せ替える)。拡張機能システム側の
    // 「どのウィンドウのタブか」も付け替えないと、ツールバーが別ウィンドウのタブを映す
    await js(ctx2.window.webContents, `window.roopie.moveTabFromWindow(${ctx.window.id}, ${tabD.id}, 0)`);
    await sleep(2000);
    const movedTarget = await toolbarState(ctx2.window.webContents);
    console.log('   移動先(2窓目):', JSON.stringify(movedTarget));
    check('移動先でもアイコンが出る', movedTarget.shown, 1);
    check('移動先のアイコンが移ってきたタブを指している', movedTarget.tab, wcIdOf(tabD));
    check('移動先でもアイコンが読める', movedTarget.noIcon, 0);
    check('移動してもWebContentsは同じ(再読み込みされない)', ctx2.tabManager.tabs[0]?.id, tabD.id);

    const movedSource = await toolbarState(uiWc);
    console.log('   移動元(1窓目):', JSON.stringify(movedSource));
    check('移動元のアイコンは残りのタブを指す', movedSource.tab, wcIdOf(ctx.tabManager.getTab(ctx.tabManager.activeTabId)));

    for (const [name, wc] of [
      ['ext-toolbar-win1.png', uiWc],
      ['ext-toolbar-win2.png', ctx2.window.webContents],
    ]) {
      // 初回は UnknownVizError になることがあるので数回試す(検証本体には影響しない)
      for (let i = 0; i < 4; i++) {
        try {
          const image = await wc.capturePage();
          fs.writeFileSync(path.join(shotDir, name), image.toPNG());
          console.log(`   📸 ${path.join(shotDir, name)}`);
          break;
        } catch (err) {
          if (i === 3) console.log(`   (スクショ失敗: ${name} ${err.message})`);
          await sleep(400);
        }
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
