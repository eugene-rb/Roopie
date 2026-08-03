// ウェブストア以外の拡張機能(manifest.jsonのあるフォルダ)の読み込みの検証(再利用可能)。
// 実行: npx electron scripts/test-extensions-unpacked.js
//
// 元フォルダは消えたり動いたりするので、読み込み時にプロファイルの extensions/ 配下へ
// コピーする。次回起動時の読み込みは attach() の installChromeWebStore
// (allowUnpackedExtensions)任せなので、「再起動」も含めて確かめる。
const { app, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-unpacked-'));
app.setPath('userData', tmp);

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function checkThrows(name, fn, expectedFragment) {
  try {
    await fn();
    check(name, '例外なし', `「${expectedFragment}」を含む例外`);
  } catch (err) {
    check(name, String(err.message).includes(expectedFragment), true);
  }
}

// ウェブストアを介さない拡張機能(=manifestにkeyが無い)を作る。
// MV3のバックグラウンドを持たせて、service workerまで起動するかも見る
function makeFixture(dir, { version = '1.0.0', name = 'ローカル拡張' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name,
      version,
      description: 'フォルダ読み込みの検証用',
      permissions: ['storage'],
      background: { service_worker: 'sw.js' },
    })
  );
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("install", () => {});\n');
  return dir;
}

app.whenReady().then(async () => {
  try {
    const ExtensionSupport = require('../src/main/extension-support');
    const ext = new ExtensionSupport();
    const profileId = 'profile-unpacked';
    const extensionsDir = path.join(tmp, 'profiles', profileId, 'extensions');
    const testSession = session.fromPartition('persist:ext-unpacked-test');

    const srcDir = makeFixture(path.join(tmp, 'src-extension'));

    // ---- 読み込み ----
    const loaded = await ext.loadUnpacked(testSession, profileId, srcDir);
    const id = loaded.id;
    check('読み込むとsession.extensionsに入る', !!testSession.extensions.getExtension(id), true);

    const dirs = fs.readdirSync(extensionsDir).filter((n) => n.startsWith('local-'));
    check('extensions/ 配下へコピーされる', dirs.length, 1);
    check('コピー先にmanifestがある', fs.existsSync(path.join(extensionsDir, dirs[0], 'manifest.json')), true);

    let item = ext.list(testSession).find((i) => i.id === id);
    check('一覧に出る', !!item, true);
    check('unpackedフラグが立つ', item?.unpacked, true);
    check('読み込み元のパスを覚えている', item?.source, srcDir);
    check('有効状態で出る', item?.enabled, true);

    // MV3のバックグラウンドは loadExtension だけでは動き出さない(明示的に起動している)
    const running = testSession.serviceWorkers.getAllRunning();
    const workerScopes = Object.values(running).map((w) => w.scope);
    check('MV3のservice workerが起動する', workerScopes.some((s) => s.includes(id)), true);

    // ---- 元フォルダが消えても動く(コピーしているため) ----
    fs.rmSync(srcDir, { recursive: true, force: true });
    check('元フォルダを消しても読み込まれたまま', !!testSession.extensions.getExtension(id), true);

    // ---- 「再起動」: 別セッションへ attach すると自動で読み込まれる ----
    const freshSession = session.fromPartition('persist:ext-unpacked-restart');
    const fresh = new ExtensionSupport();
    await fresh.attach(freshSession, profileId, []);
    const freshItem = fresh.list(freshSession).find((i) => i.unpacked);
    check('起動時に自動で読み込まれる', !!freshItem, true);
    check('起動時の読み込みでも同じID', freshItem?.id, id);
    check('起動時の読み込みでも読み込み元が引き継がれる', freshItem?.source, srcDir);
    // 一括読み込み(installChromeWebStore)側のworker起動は必ず失敗するので、attachで起こし直している
    await sleep(600);
    check(
      '起動時の読み込みでもservice workerが動き出す',
      Object.values(freshSession.serviceWorkers.getAllRunning()).some((w) => w.scope.includes(id)),
      true
    );
    // 無効にしていたものが起動時に動き出さない(ストアの拡張機能と同じ扱い)
    const disabledSession = session.fromPartition('persist:ext-unpacked-disabled');
    const disabledSupport = new ExtensionSupport();
    await disabledSupport.attach(disabledSession, profileId, [id]);
    check('無効にしていれば起動時に外れる', !!disabledSession.extensions.getExtension(id), false);
    check(
      '無効でも一覧には残る',
      disabledSupport.list(disabledSession).find((i) => i.id === id)?.enabled,
      false
    );

    // ---- 同じフォルダを読み込み直すと入れ替わる(=更新) ----
    makeFixture(srcDir, { version: '2.0.0' });
    const updated = await ext.loadUnpacked(testSession, profileId, srcDir);
    check('読み込み直してもIDは変わらない', updated.id, id);
    check('バージョンが上がる', updated.version, '2.0.0');
    check(
      'コピー先が増えない(同じフォルダ名を使い回す)',
      fs.readdirSync(extensionsDir).filter((n) => n.startsWith('local-')).length,
      1
    );

    // ---- 無効化 / 再有効化 ----
    await ext.setEnabled(testSession, profileId, id, false);
    check('無効化できる', !!testSession.extensions.getExtension(id), false);
    await ext.setEnabled(testSession, profileId, id, true);
    check('再有効化できる', !!testSession.extensions.getExtension(id), true);

    // ---- 読み込めないフォルダ ----
    const emptyDir = fs.mkdtempSync(path.join(tmp, 'empty-'));
    await checkThrows(
      'manifest.jsonが無ければ理由付きで失敗する',
      () => ext.loadUnpacked(testSession, profileId, emptyDir),
      'manifest.json がありません'
    );
    const brokenDir = fs.mkdtempSync(path.join(tmp, 'broken-'));
    fs.writeFileSync(path.join(brokenDir, 'manifest.json'), '{ これはJSONではない');
    await checkThrows(
      '壊れたmanifest.jsonも理由付きで失敗する',
      () => ext.loadUnpacked(testSession, profileId, brokenDir),
      'JSONの形式が正しくありません'
    );
    check(
      '失敗した読み込みはコピーを残さない',
      fs.readdirSync(extensionsDir).filter((n) => n.startsWith('local-')).length,
      1
    );

    // ---- 削除(uninstallExtensionはextensions/<ID>/を消すのでローカルには効かない) ----
    await ext.remove(testSession, profileId, id);
    check('削除するとsession.extensionsから消える', !!testSession.extensions.getExtension(id), false);
    check(
      '削除するとコピー先のフォルダも消える',
      fs.readdirSync(extensionsDir).filter((n) => n.startsWith('local-')).length,
      0
    );
    check('削除すると一覧からも消える', ext.list(testSession).some((i) => i.id === id), false);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
