// Windowsの「既定のアプリ」にRoopieを"ブラウザ"として載せるためのレジストリ登録。
//
// Electronの app.setAsDefaultProtocolClient は HKCU\Software\Classes\http しか書かないため、
// それだけでは設定アプリの一覧にRoopieが**そもそも出てこない**(=ユーザーは既定にしようがない)。
// Chrome/Edgeと同じ形の StartMenuInternet + InstallInfo + Capabilities + RegisteredApplications を書いて初めて
// 「既定のアプリ」でRoopieを選べるようになり、Windows 11では「既定に設定する」の1クリックで
// http/https/.htm/.html がまとめて切り替わる。
//
// 書き込み先はすべて HKCU(インストールは perMachine:false = ユーザー単位のため)。
// アンインストール時の削除は build/installer.nsh で行う。
const { app } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

// RegisteredApplications に載せる名前。ms-settings:defaultapps?registeredAppUser= に渡す値でもある
const APP_NAME = 'Roopie';
const PROG_ID = 'RoopieHTML';
const DESCRIPTION = 'Roopie - Chromiumベースのブラウザ';
const APP_USER_MODEL_ID = 'com.eugene-rb.roopie';
const CLIENT_KEY = `Software\\Clients\\StartMenuInternet\\${APP_NAME}`;
const CAPABILITIES_KEY = `${CLIENT_KEY}\\Capabilities`;

function regAdd(key, name, data, type = 'REG_SZ') {
  const args = ['add', `HKCU\\${key}`, ...(name ? ['/v', name] : ['/ve']), '/t', type, '/d', String(data), '/f'];
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err) => {
      if (err) console.error('既定のブラウザ登録に失敗:', key, name || '(既定)', err.message);
      resolve(!err);
    });
  });
}

// このパソコンのユーザーにRoopieを「ブラウザ」として知らせる。
// 開発中(electron.exe)に書くと electron.exe がブラウザとして居座るため、パッケージ版だけで行う
async function register() {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const exe = process.execPath;
  const icon = `${exe},0`;
  const entries = [
    // 開くための定義(ProgId)。%1 に開きたいURL・ファイルパスが入る
    [`Software\\Classes\\${PROG_ID}`, null, 'Roopie HTML Document'],
    [`Software\\Classes\\${PROG_ID}\\DefaultIcon`, null, icon],
    [`Software\\Classes\\${PROG_ID}\\shell\\open\\command`, null, `"${exe}" "%1"`],
    [`Software\\Classes\\${PROG_ID}\\Application`, 'ApplicationName', APP_NAME],
    [`Software\\Classes\\${PROG_ID}\\Application`, 'ApplicationIcon', icon],
    [`Software\\Classes\\${PROG_ID}\\Application`, 'ApplicationDescription', DESCRIPTION],
    // パッケージ版のAppUserModelIdは electron-builder の appId(package.json の build.appId)
    [`Software\\Classes\\${PROG_ID}\\Application`, 'AppUserModelId', APP_USER_MODEL_ID],
    // 「ブラウザ」の一覧(StartMenuInternet)に載せる
    [CLIENT_KEY, null, APP_NAME],
    [`${CLIENT_KEY}\\DefaultIcon`, null, icon],
    [`${CLIENT_KEY}\\shell\\open\\command`, null, `"${exe}"`],
    // これが無いとWindowsはこのクライアントを「ブラウザ」として数えず、
    // Capabilitiesまで書いても設定アプリの一覧にRoopieが**出てこない**(実測で確認)。
    // 中身はSPAD(Set Program Access and Defaults)時代の名残でRoopie自身は解釈しないが、
    // Chrome/Edge/Vivaldiも同じ4つを書いている。IconsVisibleだけREG_DWORD
    [`${CLIENT_KEY}\\InstallInfo`, 'ReinstallCommand', `"${exe}" --make-default-browser`],
    [`${CLIENT_KEY}\\InstallInfo`, 'HideIconsCommand', `"${exe}" --hide-icons`],
    [`${CLIENT_KEY}\\InstallInfo`, 'ShowIconsCommand', `"${exe}" --show-icons`],
    [`${CLIENT_KEY}\\InstallInfo`, 'IconsVisible', 1, 'REG_DWORD'],
    // 何を開けるアプリなのか(これが無いと設定アプリで選べない)
    [CAPABILITIES_KEY, 'ApplicationName', APP_NAME],
    [CAPABILITIES_KEY, 'ApplicationIcon', icon],
    [CAPABILITIES_KEY, 'ApplicationDescription', DESCRIPTION],
    [`${CAPABILITIES_KEY}\\StartMenu`, 'StartMenuInternet', APP_NAME],
    [`${CAPABILITIES_KEY}\\URLAssociations`, 'http', PROG_ID],
    [`${CAPABILITIES_KEY}\\URLAssociations`, 'https', PROG_ID],
    [`${CAPABILITIES_KEY}\\FileAssociations`, '.htm', PROG_ID],
    [`${CAPABILITIES_KEY}\\FileAssociations`, '.html', PROG_ID],
    // 上記をWindowsに見つけてもらう入口
    ['Software\\RegisteredApplications', APP_NAME, CAPABILITIES_KEY],
  ];
  for (const [key, name, data, type] of entries) {
    if (!(await regAdd(key, name, data, type))) return false;
  }
  return true;
}

// 登録内容が実行ファイルの場所に依存するので、変わったときだけ書き直せるよう目印を作る
function stamp() {
  return `${path.normalize(process.execPath).toLowerCase()}|${app.getVersion()}`;
}

module.exports = { register, stamp, APP_NAME, PROG_ID };
