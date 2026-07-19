// GitHub Releases からの自動アップデート(electron-updater)。
// インストーラー版でのみ動く。開発中(npm start)は何もしない。
// 公開リポジトリ(eugene-rb/Roopie)のReleasesを起動時+一定間隔で確認し、
// 新しいバージョンがあれば裏でダウンロード → 完了したら再起動を促す。
// 「後で」を選んでも次回の終了時に自動で適用される。
//
// masterへpushするたびにGitHub Actionsが新しいリリースを出す(.github/workflows/release.yml)ので、
// 変更が早く行き渡るよう確認間隔は短めにしている。
const { app, dialog } = require('electron');

const FIRST_CHECK_DELAY = 10 * 1000; // 起動直後は描画を優先して少し待つ
const CHECK_INTERVAL = 15 * 60 * 1000;

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let prompted = false;
  autoUpdater.on('update-downloaded', async (info) => {
    if (prompted) return;
    prompted = true;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'アップデート',
      message: `Roopie ${info.version} をダウンロードしました`,
      detail: '再起動すると新しいバージョンに更新されます。',
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.error('自動アップデートの確認に失敗:', err.message));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { setupAutoUpdater };
