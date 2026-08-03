// マルチプロファイル(Edge挙動)の検証(再利用可能)。
// 実行: npx electron scripts/test-multi-profile.js
// 一時userDataで本物の browser.js を動かし、切り替え=新ウィンドウ/既存ウィンドウ維持/
// プロファイル間のデータ分離/共有トグル/削除時のウィンドウクローズを確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// browser.js を読む前にuserDataを一時フォルダへ(実プロファイルを汚さない)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-mp-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const windows = require('../src/main/windows');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  browser.initData();

  const p1 = browser.profiles.active();
  const p2 = browser.profiles.create('仕事');

  // ウィンドウ1(既定=アクティブプロファイル)
  const ctx1 = browser.createWindow();
  check('ウィンドウ1のプロファイル', ctx1.profileId, p1.id);

  // 切り替え → 新しいウィンドウが開き、既存ウィンドウはそのまま(Edge挙動)
  const ctx2 = browser.switchProfile(p2.id);
  await sleep(300);
  check('切り替えで新ウィンドウ', !!ctx2 && ctx2 !== ctx1, true);
  check('新ウィンドウのプロファイル', ctx2.profileId, p2.id);
  check('ウィンドウは2枚', windows.normal().length, 2);
  check('既存ウィンドウは元のプロファイルのまま', ctx1.profileId, p1.id);
  check('既存ウィンドウは開いたまま', ctx1.window.isDestroyed(), false);
  check('アクティブ(新規ウィンドウの既定)はp2', browser.profiles.activeId, p2.id);

  // データ分離: p1に保存したパスワードはp2から見えない
  const b1 = browser.bundleFor(p1.id);
  const b2 = browser.bundleFor(p2.id);
  check('束は別インスタンス', b1 !== b2, true);
  b1.passwords.save('https://a.example', 'user1', 'pass1');
  check('p1に1件', b1.passwords.list().length, 1);
  check('p2は0件', b2.passwords.list().length, 0);

  // 設定も分離
  b1.settings.data.searchEngine = 'bing';
  check('設定の分離', b2.settings.data.searchEngine !== 'bing', true);

  // ブックマークも分離
  b1.bookmarks.addStartPage('p1のページ');
  check('ブックマークの分離', b2.bookmarks.startPages().length !== b1.bookmarks.startPages().length, true);

  // 共有トグル: 両プロファイルで passwords を共有 → 同じStoreインスタンスを指す
  browser.setShared(p1.id, 'passwords', true);
  browser.setShared(p2.id, 'passwords', true);
  check('共有トグルで同じストアを共有', b1.passwords.store === b2.passwords.store, true);
  browser.setShared(p1.id, 'passwords', false);
  browser.setShared(p2.id, 'passwords', false);
  check('共有解除で別ストアに戻る', b1.passwords.store !== b2.passwords.store, true);
  check('解除後もp1のデータは残る', b1.passwords.list().length, 1);

  // 新しいウィンドウ(Ctrl+N相当)は呼び出し元と同じプロファイル
  const ctx3 = browser.createWindow({ profileId: p2.id });
  check('同プロファイルの追加ウィンドウ', ctx3.profileId, p2.id);
  check('ウィンドウは3枚', windows.normal().length, 3);

  // プロファイル削除 → そのプロファイルのウィンドウ(2枚)が閉じる
  browser.removeProfile(p2.id);
  await sleep(500);
  check('削除後のウィンドウ数', windows.normal().length, 1);
  check('残りはp1のウィンドウ', windows.normal()[0]?.profileId, p1.id);
  check('アクティブはp1に戻る', browser.profiles.activeId, p1.id);
  check('削除プロファイルの束は破棄', browser.bundleFor(p2.id), null);

  // 最後のウィンドウを閉じるとタブ構成が保存され、switchProfileで復元される
  const snapshotFile = path.join(tmp, 'profiles', p1.id, 'session-tabs.json');
  windows.normal()[0].window.close();
  await sleep(500);
  check('閉じたときにタブ構成を保存', fs.existsSync(snapshotFile), true);

  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  browser.flushAll();
  app.exit(failed ? 1 : 0);
});

// テスト中に全ウィンドウが閉じても終了しない(自前でapp.exitする)
app.on('window-all-closed', () => {});
