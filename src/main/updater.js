// GitHub Releases からの自動アップデート(electron-updater)。
// インストーラー版でのみ動く。開発中(npm start)は何もしない。
// 公開リポジトリ(eugene-rb/Roopie)のReleasesを起動時+4時間ごとに確認し、
// 新しいバージョンがあれば裏でダウンロード → 完了したら再起動を促す。
// 「後で」を選んでも次回の終了時に自動で適用される。
const { app, dialog } = require('electron');

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
  setTimeout(check, 10 * 1000); // 起動直後は描画を優先して少し待つ
  setInterval(check, 4 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdater };
