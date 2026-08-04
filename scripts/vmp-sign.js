// electron-builderの afterPack フック。パッケージング直後(NSIS化前)のディレクトリに対して
// castLabs EVS で VMP(Verified Media Path)署名をかける。
//
// これが無いと、配布ビルド(castLabs ECS = Widevine対応Electron)は本番のWidevineライセンス
// サーバーに認証できず、DRM動画が「エラーは出ずバッファリングホイールが回り続ける」または
// 「この映画のライセンスに問題が発生しました」で失敗する。詳細: docs/decisions/ADR-0001-widevine-castlabs.md
//
// EVS_ACCOUNT_NAME / EVS_PASSWORD 環境変数(CIでは GitHub Secrets)が無い場合は署名をスキップする。
// ローカルの `npm run dist` のたびに約200MBのアップロード・署名(数分)が走らないようにするため、
// ローカルで実際に署名済みビルドを試したいときだけ手動でこの2つの環境変数を設定して実行する。
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  const account = process.env.EVS_ACCOUNT_NAME;
  const password = process.env.EVS_PASSWORD;
  if (!account || !password) {
    console.log('[vmp-sign] EVS_ACCOUNT_NAME/EVS_PASSWORD が未設定のため、VMP署名をスキップします');
    return;
  }
  console.log(`[vmp-sign] VMP署名を実行します: ${context.appOutDir}`);
  execFileSync(
    'python',
    ['-m', 'castlabs_evs.vmp', 'sign-pkg', '-n', '-A', account, '-P', password, context.appOutDir],
    { stdio: 'inherit' }
  );
};
