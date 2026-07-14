// パスワードの検出・自動入力用のpreload。
// セッション全体(session.registerPreloadScript)に注入され、通常のWebページで動く。
// ページ側にAPIは一切公開しない(ipcRendererはpreloadのスコープに閉じる)。
const { ipcRenderer } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  initPasswords();
}

function initPasswords() {
  // ---- ログイン送信の検出 ----
  // submitイベントに加え、SPAで多いボタンクリック送信にも備えて
  // 「パスワード欄に入力があるまま画面遷移した」場合も拾う。
  let lastCredentials = null;

  function findCredentials(root = document) {
    const passwordField = [...root.querySelectorAll('input[type="password"]')].find(
      (el) => el.value && isVisible(el)
    );
    if (!passwordField) return null;

    const form = passwordField.form;
    const scope = form ?? document;
    // ユーザー名は「パスワード欄より前にあるテキスト/メール系の入力」の最後のもの
    const candidates = [...scope.querySelectorAll('input')].filter(
      (el) =>
        ['text', 'email', 'tel', ''].includes(el.type) &&
        el.value &&
        isVisible(el) &&
        el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const username = candidates[candidates.length - 1]?.value ?? '';
    return { username, password: passwordField.value };
  }

  function isVisible(el) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  function capture() {
    const found = findCredentials();
    if (found?.username && found.password) lastCredentials = found;
  }

  // submit(通常のフォーム送信)
  window.addEventListener('submit', capture, true);

  // クリック送信(SPA)や Enter キーでの送信
  window.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('button, input[type="submit"], [role="button"]')) {
        capture();
      }
    },
    true
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') capture();
    },
    true
  );

  // 画面を離れる/隠れるタイミングで、直前に掴んだ資格情報をメインへ渡す。
  // メイン側で「保存済みと同じなら何もしない」を判定する。
  const flush = () => {
    if (!lastCredentials) return;
    ipcRenderer.send('passwords:captured', {
      origin: location.origin,
      ...lastCredentials,
    });
    lastCredentials = null;
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  // ---- 自動入力 ----
  // 保存済みの資格情報を1件だけ入れる(複数ある場合は最初の1件)
  async function autofill() {
    const passwordField = [...document.querySelectorAll('input[type="password"]')].find(isVisible);
    if (!passwordField) return;

    const credentials = await ipcRenderer.invoke('passwords:for-origin', location.origin);
    if (!credentials?.length) return;
    const { username, password } = credentials[0];

    const form = passwordField.form;
    const scope = form ?? document;
    const usernameField = [...scope.querySelectorAll('input')].find(
      (el) =>
        ['text', 'email', 'tel', ''].includes(el.type) &&
        isVisible(el) &&
        el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    if (usernameField && username) setValue(usernameField, username);
    setValue(passwordField, password);
  }

  // Reactなどの制御コンポーネントにも反映されるよう、ネイティブsetter経由で値を入れる
  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      'value'
    )?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autofill);
  } else {
    autofill();
  }
  // 遅れて描画されるログインフォーム(SPA)にも対応
  setTimeout(autofill, 1200);
}
