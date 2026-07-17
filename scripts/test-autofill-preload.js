// autofill-preload.js のE2E検証(再利用可能)。
// 実行: npx electron scripts/test-autofill-preload.js
// テストページを一時HTTPサーバーで配信し、非表示のBrowserWindowに本物のpreloadを注入。
// sendInputEvent(信頼済みイベント)でクリック/キー操作し、ドロップダウン選択→自動入力を検証する。
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8932;
const PAGE = fs.readFileSync(path.join(__dirname, 'test-autofill-page.html'));

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- メイン側のIPCをフェイクで用意 ----
const FAKE_ADDRESS = {
  id: 'a1',
  familyName: '山田',
  givenName: '太郎',
  familyKana: 'ヤマダ',
  givenKana: 'タロウ',
  org: 'テスト株式会社',
  postal: '100-0001',
  region: '東京都',
  city: '千代田区',
  street: '千代田1-1',
  building: 'テストビル301',
  tel: '03-1234-5678',
  email: 'taro@example.com',
};
const FAKE_CARD = { id: 'c1', holder: 'TARO YAMADA', last4: '1111', brand: 'Visa', expMonth: 7, expYear: 2028 };

let capturedPayload = null;

function setupIpc() {
  ipcMain.handle('autofill:page-data', () => ({
    usernames: ['alice@example.com', 'bob@example.com'],
    addresses: [FAKE_ADDRESS],
    cards: [FAKE_CARD],
  }));
  ipcMain.handle('passwords:credential', (_e, username) => ({ username, password: `pw-of-${username}` }));
  ipcMain.handle('passwords:for-origin', () => []); // 自動入力(1件時)は今回は対象外
  ipcMain.handle('autofill:card-fill', () => ({ number: '4111111111111111', holder: 'TARO YAMADA', expMonth: 7, expYear: 2028 }));
  ipcMain.on('passwords:captured', (_e, payload) => (capturedPayload = payload));
}

// ---- ブラウザ操作ヘルパー ----
async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function clickSelector(win, selector) {
  const rect = await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await sleep(80);
  const pos = await js(win, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(250); // ドロップダウンのIPC往復待ち
}

function key(win, keyCode) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

async function pickItem(win, downCount) {
  for (let i = 0; i < downCount; i++) key(win, 'Down');
  await sleep(60);
  key(win, 'Return');
  await sleep(250); // credential/card取得のIPC往復待ち
}

const dropdownVisible = (win) =>
  js(
    win,
    `[...document.documentElement.children].some((el) => el.tagName === 'DIV' && el.style.position === 'fixed' && el.style.display === 'block')`
  );

const value = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).value`);

// ---- テスト本体 ----
app.whenReady().then(async () => {
  setupIpc();
  const server = http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    })
    .listen(PORT);

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'autofill-preload.js') },
  });
  await win.loadURL(`http://localhost:${PORT}`);
  await sleep(300);

  // 1. ログイン: パスワード欄フォーカスで資格情報ドロップダウン → 2件目(bob)を選択
  await clickSelector(win, '#login input[type="password"]');
  check('ログイン欄でドロップダウン表示', await dropdownVisible(win), true);
  await pickItem(win, 2);
  check('ユーザー名が入る', await value(win, '#login input[name="email"]'), 'bob@example.com');
  check('パスワードが入る', await value(win, '#login input[name="password"]'), 'pw-of-bob@example.com');
  check('選択後は閉じる', await dropdownVisible(win), false);

  // 2. 住所: 姓フォーカスで住所ドロップダウン → 1件目を選択
  await clickSelector(win, '#address input[name="sei"]');
  check('住所欄でドロップダウン表示', await dropdownVisible(win), true);
  await pickItem(win, 1);
  check('姓', await value(win, '#address input[name="sei"]'), '山田');
  check('名', await value(win, '#address input[name="mei"]'), '太郎');
  check('セイ', await value(win, '#address input[name="kana_sei"]'), 'ヤマダ');
  check('メイ', await value(win, '#address input[name="kana_mei"]'), 'タロウ');
  check('郵便番号1(分割)', await value(win, '#address input[name="zip1"]'), '100');
  check('郵便番号2(分割)', await value(win, '#address input[name="zip2"]'), '0001');
  check('都道府県(select)', await value(win, '#address select[name="pref"]'), '東京都');
  check('市区町村', await value(win, '#address input[name="city"]'), '千代田区');
  check('番地', await value(win, '#address input[name="address1"]'), '千代田1-1');
  check('建物', await value(win, '#address input[name="address2"]'), 'テストビル301');
  check('電話(数字のみ)', await value(win, '#address input[name="tel"]'), '0312345678');
  check('メール(placeholder判定)', await value(win, '#address input[name="contact_mail"]'), 'taro@example.com');

  // 3. カード: 番号フォーカスでカードドロップダウン → 選択
  await clickSelector(win, '#payment input[name="cardnumber"]');
  check('カード欄でドロップダウン表示', await dropdownVisible(win), true);
  await pickItem(win, 1);
  check('カード番号', await value(win, '#payment input[name="cardnumber"]'), '4111111111111111');
  check('カード名義', await value(win, '#payment input[name="cardholder"]'), 'TARO YAMADA');
  check('有効期限月(select)', await value(win, '#payment select[name="exp_month"]'), '07');
  check('有効期限年(select)', await value(win, '#payment select[name="exp_year"]'), '2028');
  check('CVCは入れない', await value(win, '#payment input[name="cvc"]'), '');

  // 4. 新規登録: 資格情報2件+生成の3項目 → 生成を選択
  await clickSelector(win, '#signup input[name="new-pass"]');
  check('新規登録欄でドロップダウン表示', await dropdownVisible(win), true);
  await pickItem(win, 3);
  const p1 = await value(win, '#signup input[name="new-pass"]');
  const p2 = await value(win, '#signup input[name="new-pass2"]');
  check('生成パスワードの長さ', p1.length, 16);
  check('確認欄にも同じ値', p1 === p2, true);

  // 5. 送信検出 → ページ離脱で passwords:captured が届く
  await js(win, `(() => {
    const u = document.querySelector('#login input[name="email"]');
    const p = document.querySelector('#login input[type="password"]');
    u.value = 'carol@example.com'; p.value = 'pw-carol';
  })()`);
  await clickSelector(win, '#login button');
  await win.loadURL('about:blank');
  await sleep(300);
  check('送信検出でキャプチャ', capturedPayload, { username: 'carol@example.com', password: 'pw-carol' });

  server.close();
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
