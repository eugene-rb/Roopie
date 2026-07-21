// 拡張機能管理のリッチ化(一時無効化・詳細/権限・オプションページ・ピン留め集約)の検証
// (再利用可能)。実行: npx electron scripts/test-extensions-rich.js
//
// Electron自体には拡張機能の「無効化」概念が無い(読み込み/読み込み解除のみ)ため、
// disabledExtensions設定+読み込み解除/再読み込みで実現した。無効化すると
// session.extensions からは消えるため、一覧表示・再有効化用にメタデータを
// ExtensionSupport側でキャッシュしている。ここではその一連の挙動を確かめる。
const { app, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 最小構成の拡張機能をローカルに作る(Chromeウェブストア経由ではなく、直接loadExtensionで
// 読み込む=ネットワーク不要で検証できる)
function makeFixtureExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-fixture-'));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'テスト拡張',
      version: '1.0.0',
      description: 'リッチ化検証用のダミー拡張',
      permissions: ['storage', 'tabs'],
      options_page: 'options.html',
    })
  );
  fs.writeFileSync(path.join(dir, 'options.html'), '<!doctype html><title>options</title>');
  return dir;
}

app.whenReady().then(async () => {
  try {
    const ExtensionSupport = require('../src/main/extension-support');
    const ext = new ExtensionSupport();
    const testSession = session.fromPartition('persist:ext-rich-test');

    const fixtureDir = makeFixtureExtension();
    const loaded = await testSession.extensions.loadExtension(fixtureDir);
    const id = loaded.id;

    let items = ext.list(testSession);
    let item = items.find((i) => i.id === id);
    check('読み込み直後は一覧に出る', !!item, true);
    check('有効状態で出る', item.enabled, true);
    check('権限一覧が入る', item.permissions.sort(), ['storage', 'tabs'].sort());
    check('オプションページのURLが組み立てられる', item.optionsUrl, `chrome-extension://${id}/options.html`);

    // ---- 無効化 ----
    await ext.setEnabled(testSession, 'dummy-profile', id, false);
    check('無効化するとsession.extensionsから消える', !!testSession.extensions.getExtension(id), false);

    items = ext.list(testSession);
    item = items.find((i) => i.id === id);
    check('無効化後も一覧には残る(キャッシュ済みメタデータで)', !!item, true);
    check('enabled:false になる', item?.enabled, false);
    check('無効化してもID等の情報は保持される', item?.name, 'テスト拡張');

    // ---- 再度有効化 ----
    await ext.setEnabled(testSession, 'dummy-profile', id, true);
    check('再有効化するとsession.extensionsに戻る', !!testSession.extensions.getExtension(id), true);
    items = ext.list(testSession);
    item = items.find((i) => i.id === id);
    check('再有効化後は enabled:true', item?.enabled, true);

    // ---- attach()のdisabledIds: 次回起動を模す ----
    // (installChromeWebStoreは対象ディレクトリに何も無ければ素通りするだけなので、
    //  「起動時に既にsession.extensionsへ読み込まれている」ところから始めれば
    //  attach()側の無効化フィルタだけを切り出して確かめられる)
    const freshSession = session.fromPartition('persist:ext-rich-test-restart');
    await freshSession.extensions.loadExtension(fixtureDir); // 起動時の自動読み込み相当
    check('(前提)起動直後は読み込まれている', !!freshSession.extensions.getExtension(id), true);
    await ext.attach(freshSession, 'dummy-profile-2', [id]);
    check('disabledIdsに入っていれば起動時に外される', !!freshSession.extensions.getExtension(id), false);
    const freshItems = ext.list(freshSession);
    check('それでも一覧にはメタデータ付きで残る', freshItems.find((i) => i.id === id)?.enabled, false);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
