// パスワード/自動入力のメインプロセスロジック検証(再利用可能)。
// 実行: npx electron scripts/test-autofill-main.js
// アプリ本体とは別プロセス・別データ(一時フォルダ)で動くので、起動中でも実行できる。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Store = require('../src/main/store');
const Passwords = require('../src/main/passwords');
const Autofill = require('../src/main/autofill');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-test-'));

  // ---- Passwords ----
  const pw = new Passwords(new Store(path.join(dir, 'passwords.json'), []));
  check('旧形式(配列)からの移行', Array.isArray(pw.items) && Array.isArray(pw.neverSave), true);

  if (!Passwords.available()) {
    console.log('SKIP safeStorageが使えない環境のため暗号化系テストをスキップ');
  } else {
    pw.save('https://example.com', 'alice', 'pw-a');
    pw.save('https://example.com', 'bob', 'pw-b');
    pw.save('https://other.com', 'carol', 'pw-c');
    check('保存件数', pw.list().length, 3);
    check('usernamesForOrigin', pw.usernamesForOrigin('https://example.com').sort(), ['alice', 'bob']);
    check('credentialで復号', pw.credential('https://example.com', 'alice')?.password, 'pw-a');
    check('credentialが最終使用順に影響', pw.usernamesForOrigin('https://example.com')[0], 'alice');
    check('matches', pw.matches('https://example.com', 'alice', 'pw-a'), true);
    check('update(パスワード変更)', pw.update(pw.list()[0].id, { password: 'pw-a2' }), true);
    check('update後のreveal', pw.reveal(pw.list()[0].id), 'pw-a2');
    const bobId = pw.list().find((p) => p.username === 'bob').id;
    check('update(重複ユーザー名は失敗)', pw.update(bobId, { username: 'alice' }), false);
    check('exportAll', pw.exportAll().length, 3);

    pw.addNeverSave('https://never.com');
    check('neverSave追加', pw.isExcluded('https://never.com'), true);
    pw.removeNeverSave('https://never.com');
    check('neverSave解除', pw.isExcluded('https://never.com'), false);
  }

  // ---- Autofill ----
  const af = new Autofill(new Store(path.join(dir, 'autofill.json'), {}));
  const addr = af.saveAddress({
    familyName: '山田',
    givenName: '太郎',
    familyKana: 'ヤマダ',
    givenKana: 'タロウ',
    postal: '100-0001',
    region: '東京都',
    city: '千代田区',
    street: '千代田1-1',
    tel: '03-1234-5678',
    email: 'taro@example.com',
  });
  check('住所の保存', !!addr?.id, true);
  check('住所の一覧', af.listAddresses().length, 1);
  af.saveAddress({ id: addr.id, familyName: '山田', givenName: '花子' });
  check('住所の更新', af.listAddresses()[0].givenName, '花子');
  check('空の住所は保存しない', af.saveAddress({}), null);

  if (Autofill.available()) {
    const cardId = af.saveCard({ holder: 'TARO YAMADA', number: '4111 1111 1111 1111', expMonth: 7, expYear: 2028 });
    check('カードの保存', typeof cardId, 'string');
    const listed = af.listCards()[0];
    check('カード一覧はマスク済み', 'encrypted' in listed || 'number' in listed, false);
    check('ブランド判定(Visa)', listed.brand, 'Visa');
    check('下4桁', listed.last4, '1111');
    check('Luhn判定', listed.luhnOk, true);
    check('復号(cardFill)', af.cardFill(cardId)?.number, '4111111111111111');
    check('番号なし編集で番号維持', (af.saveCard({ id: cardId, holder: 'T YAMADA', expMonth: 8, expYear: 2029 }), af.cardFill(cardId)?.number), '4111111111111111');
    check('不正番号は保存しない', af.saveCard({ number: 'abc' }), null);
    check('Mastercard判定', (af.saveCard({ number: '5555555555554444', expMonth: 1, expYear: 2027 }), af.listCards().at(-1).brand), 'Mastercard');
    check('JCB判定', (af.saveCard({ number: '3530111333300000', expMonth: 1, expYear: 2027 }), af.listCards().at(-1).brand), 'JCB');
    af.removeCard(cardId);
    check('カード削除', af.listCards().length, 2);
  } else {
    console.log('SKIP safeStorageが使えないためカード系テストをスキップ');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  app.exit(failed ? 1 : 0);
});
