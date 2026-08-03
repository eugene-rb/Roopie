// Googleアカウントの自動検出の検証(再利用可能)。
// 実行: npx electron scripts/test-google-detect.js
//
// 背景: GoogleのListAccounts APIはページの文脈が無い素のリクエスト
// (Sec-Fetch-Site: none / Origin無し)だとCookieが正しくてもHTTP 400で弾かれる。
// なのでネットワークには出ず、Googleのページ自身がすでに描画している
// 「Google アカウント: 名前 (メール)」ボタンのDOMを読む方式にしている。
// ここではその判定ロジック(isGoogleDomain / parseAccountLabel / detectFromWebContents)を検証する。
const { app } = require('electron');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

app.whenReady().then(async () => {
  const GoogleAccounts = require('../src/main/google-accounts');

  // 1. どのドメインをGoogleログイン共有ドメインとして扱うか
  check('google.comは対象', GoogleAccounts.isGoogleDomain('https://www.google.com/search?q=x'), true);
  check('youtube.comは対象', GoogleAccounts.isGoogleDomain('https://www.youtube.com/watch?v=1'), true);
  check('accounts.google.comは対象', GoogleAccounts.isGoogleDomain('https://accounts.google.com/ListAccounts'), true);
  check('無関係なドメインは対象外', GoogleAccounts.isGoogleDomain('https://evil-google.com.example/'), false);
  check('偽装ドメイン(google.com.evil.com)は対象外', GoogleAccounts.isGoogleDomain('https://google.com.evil.com/'), false);
  check('不正なURLは対象外(例外を投げない)', GoogleAccounts.isGoogleDomain('not a url'), false);

  // 2. aria-label/titleからメール+名前を取り出す(実機で確認した実際の表記そのまま)
  check(
    '日本語表記から取り出せる',
    GoogleAccounts.parseAccountLabel('Google アカウント: 太郎  \n(taro@gmail.com)'),
    { email: 'taro@gmail.com', name: '太郎' }
  );
  check(
    '英語表記から取り出せる',
    GoogleAccounts.parseAccountLabel('Google Account: Jane Doe (jane@example.com)'),
    { email: 'jane@example.com', name: 'Jane Doe' }
  );
  check('メールが無ければnull', GoogleAccounts.parseAccountLabel('通知を見る'), null);
  check('空文字/undefinedはnull', GoogleAccounts.parseAccountLabel(''), null);

  // 3. detectFromWebContents: 実際のwebContentsの代わりにexecuteJavaScriptを差し替えたフェイクで検証
  const fakeWc = (candidates) => ({
    isDestroyed: () => false,
    executeJavaScript: async () => candidates,
  });

  const found = await GoogleAccounts.detectFromWebContents(
    fakeWc([{ aria: null, title: '通知' }, { aria: 'Google アカウント: 花子 (hanako@gmail.com)', title: null }])
  );
  check('候補の中からメール入りのものを見つける', found, [{ email: 'hanako@gmail.com', name: '花子' }]);

  const notFound = await GoogleAccounts.detectFromWebContents(fakeWc([{ aria: '設定', title: null }]));
  check('見つからなければ空配列', notFound, []);

  const destroyed = { isDestroyed: () => true, executeJavaScript: async () => [] };
  check('破棄済みwebContentsなら空配列(呼ばない)', await GoogleAccounts.detectFromWebContents(destroyed), []);
  check('webContentsが無ければ空配列', await GoogleAccounts.detectFromWebContents(null), []);

  const throwing = { isDestroyed: () => false, executeJavaScript: async () => { throw new Error('boom'); } };
  check('executeJavaScriptが失敗しても落ちない', await GoogleAccounts.detectFromWebContents(throwing), []);

  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
