// Chromeウェブストアからのインストール(crxのダウンロード → 展開 → 読み込み)の検証(再利用可能)。
// 実行: npx electron scripts/test-extension-install.js [拡張機能ID]
//
// **ネットワークが必要**(ウェブストアから実際にcrxを取ってくる)。
// 展開は electron-chrome-web-store が adm-zip で行うので、adm-zip のバージョンを
// 上げた(overridesを入れた)ときはここで壊れていないか確かめる。
const { app, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ext-install-'));
app.setPath('userData', tmp);

// 既定は「AD Skipper for Youtube」(MV3・約110KBと小さい)
const extensionId = process.argv[2] || 'gideponcmplkbifbmopkmhncghnkpjng';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

app.whenReady().then(async () => {
  try {
    const ExtensionSupport = require('../src/main/extension-support');
    const ext = new ExtensionSupport();
    const profileId = 'profile-install';
    const extensionsDir = path.join(tmp, 'profiles', profileId, 'extensions');
    const testSession = session.fromPartition('persist:ext-install-test');

    console.log(`   ウェブストアから ${extensionId} を取得中...`);
    const installed = await ext.install(testSession, profileId, extensionId);
    console.log('   インストール:', installed.name, installed.version);

    check('読み込まれる', !!testSession.extensions.getExtension(extensionId), true);

    // 展開できていれば extensions/<ID>/<version>_0/manifest.json がある
    const versionDir = path.join(extensionsDir, extensionId, `${installed.version}_0`);
    check('crxが展開される', fs.existsSync(path.join(versionDir, 'manifest.json')), true);
    check('中身のファイルがある', fs.readdirSync(versionDir).length > 1, true);

    // ストアの拡張機能は展開時に manifest へ key が入る。
    // これが無いと allowUnpackedExtensions での分類が「フォルダから読み込んだもの」に変わる
    const manifest = JSON.parse(fs.readFileSync(path.join(versionDir, 'manifest.json'), 'utf8'));
    check('manifestにkeyが入る(ストア扱いの目印)', typeof manifest.key === 'string' && manifest.key.length > 0, true);

    const item = ext.list(testSession).find((i) => i.id === extensionId);
    check('一覧に出る', !!item, true);
    check('有効状態で出る', item?.enabled, true);
    check('フォルダから読み込んだ扱いにならない', item?.unpacked, false);

    // ---- 削除 ----
    await ext.remove(testSession, profileId, extensionId);
    check('削除すると読み込みが外れる', !!testSession.extensions.getExtension(extensionId), false);
    check('削除するとファイルも消える', fs.existsSync(path.join(extensionsDir, extensionId)), false);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
