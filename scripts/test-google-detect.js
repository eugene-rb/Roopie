// Googleアカウントの自動検出の検証(再利用可能)。
// 実行: npx electron scripts/test-google-detect.js
//
// 肝は「どのセッションのCookieでリクエストするか」。
// net.fetch(url, { session }) はセッション指定を無視して defaultSession で送るため、
// プロファイル(persist:profile-<id>)のログイン情報が一切乗らず、検出は必ず失敗する。
// ここではローカルのHTTPサーバを ListAccounts の代わりに使い、
// 実際に届いたCookieを見て「そのプロファイルのセッションで送られているか」を確かめる。
const { app, session, net } = require('electron');
const http = require('http');

const PORT = 8943;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

app.whenReady().then(async () => {
  // 届いたCookieをそのまま返すサーバ(ListAccountsの代役)
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' }));
    })
    .listen(PORT);
  const url = `http://localhost:${PORT}/ListAccounts`;

  // プロファイル用のパーティション(実アプリと同じ形)にだけログイン相当のCookieを置く
  const profileSession = session.fromPartition('persist:test-google-detect');
  await profileSession.cookies.set({ url, name: 'PROFILE_SID', value: 'profile-value' });
  await session.defaultSession.cookies.set({ url, name: 'DEFAULT_SID', value: 'default-value' });

  const cookieOf = async (promise) => JSON.parse(await (await promise).text()).cookie;

  // 1. net.fetch にセッションを渡しても効かない(これが今回の不具合の原因)
  const viaNet = await cookieOf(net.fetch(url, { session: profileSession }));
  check('net.fetch({session}) はプロファイルのCookieを送らない', viaNet.includes('PROFILE_SID'), false);
  check('net.fetch({session}) は defaultSession のCookieを送ってしまう', viaNet.includes('DEFAULT_SID'), true);

  // 2. session.fetch なら、そのプロファイルのCookieで送られる
  const viaSession = await cookieOf(profileSession.fetch(url));
  check('session.fetch はプロファイルのCookieを送る', viaSession.includes('PROFILE_SID'), true);
  check('session.fetch は defaultSession のCookieを混ぜない', viaSession.includes('DEFAULT_SID'), false);

  // 3. 実装(google-accounts.js)が session.fetch を使っているか。
  //    ListAccounts の代わりにこのサーバを向かせ、届いたCookieで判定する
  const GoogleAccounts = require('../src/main/google-accounts');
  const captured = [];
  const fakeSession = {
    fetch: (u) => {
      captured.push(u);
      return profileSession.fetch(url); // 実際の送信はプロファイルのセッションで行う
    },
  };
  const result = await GoogleAccounts.fetchSignedIn(fakeSession);
  check('fetchSignedIn は渡されたセッションの fetch を使う', captured.length, 1);
  check('ListAccountsのエンドポイントを叩いている', captured[0]?.includes('accounts.google.com/ListAccounts'), true);
  check('想定外の応答なら空配列を返す(落ちない)', Array.isArray(result), true);

  // 4. セッションが無い/壊れている場合も落ちない
  check('セッションが無ければ空配列', await GoogleAccounts.fetchSignedIn(null), []);
  check('fetchを持たないオブジェクトでも空配列', await GoogleAccounts.fetchSignedIn({}), []);

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
