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

// アクション(ツールバーアイコン)を持つ最小の拡張機能を作る
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
    })
  );
  fs.writeFileSync(path.join(dir, 'popup.html'), '<!doctype html><title>popup</title>ポップアップ');
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

    const initial = await toolbarState(uiWc);
    console.log('   初期:', JSON.stringify(initial));
    check('ツールバーにアイコンが出る', initial.shown, 1);
    check('パズルボタンが出る', initial.puzzleHidden, false);

    // 通常ページのタブと内部ページのタブを用意して行き来する
    const tabA = ctx.tabManager.tabs[0];
    const tabB = ctx.tabManager.createTab('roopie://newtab');
    await sleep(1500);
    const onInternal = await toolbarState(uiWc);
    console.log('   内部ページ:', JSON.stringify(onInternal));
    check('内部ページのタブでもアイコンが残る', onInternal.shown, 1);
    check('内部ページのタブでもパズルボタンが残る', onInternal.puzzleHidden, false);

    ctx.tabManager.switchTab(tabA.id);
    await sleep(1200);
    const backToA = await toolbarState(uiWc);
    console.log('   戻り:', JSON.stringify(backToA));
    check('元のタブへ戻してもアイコンが残る', backToA.shown, 1);

    // 裏で開いたタブ(休止中=未読み込み)へ切り替える
    const tabC = ctx.tabManager.createTab('https://example.com', { background: true });
    await sleep(800);
    ctx.tabManager.switchTab(tabC.id);
    await sleep(1500);
    const onHibernated = await toolbarState(uiWc);
    console.log('   休止復帰:', JSON.stringify(onHibernated));
    check('休止から復帰したタブでもアイコンが残る', onHibernated.shown, 1);

    // 2つ目のウィンドウを開いてから、1つ目のウィンドウでタブを切り替える
    const ctx2 = browser.createWindow();
    await sleep(2000);
    ctx.window.focus();
    ctx.tabManager.switchTab(tabB.id);
    await sleep(1200);
    const afterSecondWindow = await toolbarState(uiWc);
    console.log('   2窓目あり(1窓目):', JSON.stringify(afterSecondWindow));
    check('2つ目のウィンドウを開いた後も1つ目にアイコンが残る', afterSecondWindow.shown, 1);
    const secondWindowState = await toolbarState(ctx2.window.webContents);
    console.log('   2窓目:', JSON.stringify(secondWindowState));
    check('2つ目のウィンドウにもアイコンが出る', secondWindowState.shown, 1);

    for (const [name, wc] of [
      ['ext-toolbar-win1.png', uiWc],
      ['ext-toolbar-win2.png', ctx2.window.webContents],
    ]) {
      const image = await wc.capturePage();
      fs.writeFileSync(path.join(shotDir, name), image.toPNG());
      console.log(`   📸 ${path.join(shotDir, name)}`);
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
