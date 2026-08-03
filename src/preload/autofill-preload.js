// 自動入力(パスワード/住所・個人情報/クレジットカード)用のpreload。
// セッション全体(session.registerPreloadScript)に注入され、通常のWebページの全フレームで動く。
// ページ側にAPIは一切公開しない(ipcRendererはpreloadのスコープに閉じる)。
//
// - フィールド分類: autocomplete属性を最優先し、なければ name/id/placeholder/label のヒューリスティック
// - 候補ドロップダウン: closedなshadow DOMで描画(ページのCSS/JSから隔離)。フォーカスで表示
// - パスワード本体・カード番号は「ユーザーが候補を選択した時」だけメインから取得する
const { ipcRenderer } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  initAutofill();
}

// ---- フィールド分類 ----------------------------------------------------

// autocomplete属性 → 内部フィールド種別
const AC_MAP = {
  username: 'username',
  'current-password': 'current-password',
  'new-password': 'new-password',
  name: 'name-full',
  'family-name': 'family',
  'given-name': 'given',
  organization: 'org',
  'postal-code': 'postal',
  'address-level1': 'region',
  'address-level2': 'city',
  'address-line1': 'street',
  'address-line2': 'building',
  'street-address': 'street-full',
  tel: 'tel',
  'tel-national': 'tel',
  email: 'email',
  'cc-number': 'cc-number',
  'cc-name': 'cc-name',
  'cc-exp': 'cc-exp',
  'cc-exp-month': 'cc-exp-month',
  'cc-exp-year': 'cc-exp-year',
  'cc-csc': 'cc-csc',
};

// ヒューリスティック(上から順に判定するので、より特異的なものを先に置く)
const H_RULES = [
  ['cc-csc', /cvc|cvv|csc|security.?code|セキュリティ\s*コード/i],
  ['cc-exp-month', /(exp|expir|有効期限).{0,12}(month|mm)|card.?month|exp.?m\b/i],
  ['cc-exp-year', /(exp|expir|有効期限).{0,12}(year|yy)|card.?year|exp.?y\b/i],
  ['cc-exp', /exp(iry|iration)?.?date|有効期限|mm\s*\/\s*yy/i],
  ['cc-number', /(card|cc|credit).{0,10}(number|no\b|num)|カード番号|cardnumber|pan\b/i],
  ['cc-name', /(card|cc).{0,10}(holder|name)|カード名義|名義/i],
  ['postal1', /(zip|postal|郵便).{0,6}(1|first|3)/i],
  ['postal2', /(zip|postal|郵便).{0,6}(2|second|4)/i],
  ['postal', /郵便|〒|zip|postal|postcode/i],
  ['region', /都道府県|pref|region|state|province/i],
  ['city', /市区町村|city|municipal/i],
  ['building', /建物|マンション|ビル|部屋|address.?(line)?.?2|addr2|building|apartment|room|suite/i],
  ['street', /番地|丁目|address.?(line)?.?1|addr1|street|町名/i],
  ['kana-family', /セイ|ｾｲ|(姓|last|family).{0,8}(かな|カナ|kana)|(かな|カナ|kana|furigana).{0,8}(姓|last|sei)|sei.?kana|kana.?sei/i],
  ['kana-given', /メイ|ﾒｲ|(名|first|given).{0,8}(かな|カナ|kana)|(かな|カナ|kana|furigana).{0,8}(名|first|mei)|mei.?kana|kana.?mei/i],
  ['kana-full', /フリガナ|ふりがな|カタカナ|kana|furigana/i],
  ['family', /姓|苗字|名字|last.?name|family.?name|surname|\bsei\b/i],
  ['given', /first.?name|given.?name|\bmei\b/i],
  ['name-full', /氏名|名前|お名前|full.?name|your.?name|fullname|contact.?name|^name$/i],
  ['org', /会社|組織|法人|団体|勤務先|company|organization|organisation|corp/i],
  ['tel', /電話|tel|phone|mobile|携帯|fax/i],
  ['email', /メール|e?-?mail/i],
  ['address-full', /住所|address|addr\b/i],
  // 「名」単独はほかの語(名前/氏名/名字)と衝突するため最後に判定
  ['given', /名/],
];

const ADDRESS_TYPES = new Set([
  'name-full',
  'family',
  'given',
  'kana-family',
  'kana-given',
  'kana-full',
  'org',
  'postal',
  'postal1',
  'postal2',
  'region',
  'city',
  'street',
  'street-full',
  'building',
  'address-full',
  'tel',
  'email',
]);
const CARD_TYPES = new Set(['cc-number', 'cc-name', 'cc-exp', 'cc-exp-month', 'cc-exp-year']);

function labelTextFor(el) {
  let text = '';
  if (el.labels) for (const label of el.labels) text += ' ' + label.textContent;
  const wrapping = el.closest('label');
  if (wrapping) text += ' ' + wrapping.textContent;
  // <td>ラベル</td><td><input></td> のような表組みフォームにもある程度対応
  const cell = el.closest('td');
  const prev = cell?.previousElementSibling;
  if (prev && prev.textContent.length < 30) text += ' ' + prev.textContent;
  return text;
}

function haystackFor(el) {
  return [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute('aria-label'),
    el.autocomplete,
    labelTextFor(el).slice(0, 200),
  ]
    .filter(Boolean)
    .join(' ');
}

// input/select を内部フィールド種別に分類する(分類できなければ null)
function classify(el) {
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'SELECT') return null;
  if (el.disabled || el.readOnly) return null;
  if (tag === 'INPUT' && ['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'range', 'color'].includes(el.type)) {
    return null;
  }

  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).pop();
  if (ac && AC_MAP[ac]) return AC_MAP[ac];

  if (tag === 'INPUT' && el.type === 'password') {
    return isNewPasswordField(el) ? 'new-password' : 'current-password';
  }

  const hay = haystackFor(el);
  if (el.type === 'email') return 'email';
  if (el.type === 'tel') return 'tel';
  for (const [type, re] of H_RULES) {
    if (re.test(hay)) return type;
  }
  // パスワード欄のあるフォームのテキスト欄はユーザー名の可能性が高い
  if (tag === 'INPUT' && ['text', 'email', ''].includes(el.type) && formHasPassword(el)) {
    if (/user|login|account|mail|id|ユーザー|アカウント|ログイン/i.test(hay)) return 'username';
  }
  return null;
}

function scopeFor(el) {
  return el.form ?? el.getRootNode();
}

function formHasPassword(el) {
  const scope = el.form ?? document;
  return !!scope.querySelector('input[type="password"]');
}

// 新規登録フォーム(パスワード欄が2つ以上 or autocomplete="new-password")の判定
function isNewPasswordField(el) {
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (ac.includes('new-password')) return true;
  const scope = el.form ?? document;
  return [...scope.querySelectorAll('input[type="password"]')].filter(isVisible).length >= 2;
}

function isVisible(el) {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

// ---- 値の設定(React等の制御コンポーネント対応) --------------------------

function setValue(el, value) {
  if (el.tagName === 'SELECT') {
    setSelectValue(el, value);
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// selectは「値が一致」→「表示テキストが値を含む」の順で探す(都道府県・月・年など)
function setSelectValue(el, value) {
  const target = String(value);
  let matched = [...el.options].find((o) => o.value === target);
  if (!matched) matched = [...el.options].find((o) => o.textContent.trim() === target);
  if (!matched) matched = [...el.options].find((o) => o.textContent.includes(target) || target.includes(o.textContent.trim()));
  // 月・年は '07' と '7'、'2026' と '26' の揺れを吸収する
  if (!matched && /^\d+$/.test(target)) {
    const n = Number(target);
    matched = [...el.options].find((o) => Number(o.value) === n || Number(o.textContent) === n || Number(o.value) === n % 100);
  }
  if (!matched) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter ? setter.call(el, matched.value) : (el.value = matched.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---- 住所レコード → フィールド値 ----------------------------------------

function addressValueFor(type, a) {
  const fullName = [a.familyName, a.givenName].filter(Boolean).join(' ');
  const fullKana = [a.familyKana, a.givenKana].filter(Boolean).join(' ');
  const digitsTel = (a.tel ?? '').replace(/[^\d+]/g, '');
  const postal = (a.postal ?? '').replace(/[^\d]/g, '');
  switch (type) {
    case 'name-full': return fullName;
    case 'family': return a.familyName;
    case 'given': return a.givenName;
    case 'kana-family': return a.familyKana;
    case 'kana-given': return a.givenKana;
    case 'kana-full': return fullKana;
    case 'org': return a.org;
    case 'postal': return a.postal;
    case 'postal1': return postal.slice(0, 3);
    case 'postal2': return postal.slice(3, 7);
    case 'region': return a.region;
    case 'city': return a.city;
    case 'street': return a.street;
    case 'street-full': return [a.street, a.building].filter(Boolean).join(' ');
    case 'building': return a.building;
    case 'address-full': return [a.region, a.city, a.street, a.building].filter(Boolean).join('');
    case 'tel': return digitsTel || a.tel;
    case 'email': return a.email;
    default: return '';
  }
}

function addressSummary(a) {
  const name = [a.familyName, a.givenName].filter(Boolean).join(' ');
  const addr = [a.region, a.city, a.street].filter(Boolean).join('');
  return { title: name || a.org || a.email || addr || '(名称なし)', sub: addr || a.tel || a.email || '' };
}

// ---- パスワード生成 ------------------------------------------------------

function generatePassword() {
  // 紛らわしい文字(l/I/O/0/1)を除いた16文字。各種別を最低1文字含める
  const sets = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    '23456789',
    '!@#$%^&*',
  ];
  const all = sets.join('');
  const rand = (n) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const chars = sets.map((set) => set[rand(set.length)]);
  while (chars.length < 16) chars.push(all[rand(all.length)]);
  // シャッフル(Fisher–Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ==========================================================================

function initAutofill() {
  // ---- 候補ドロップダウン(closed shadow DOM) ----
  let host = null;
  let shadow = null;
  let listEl = null;
  let anchor = null; // 現在ドロップダウンを出している入力欄
  let activeIndex = -1;
  // 候補選択直後に同じ欄で再表示しない(別の欄への移動はすぐ表示してよい)
  let suppressEl = null;
  let suppressUntil = 0;

  function ensureUi() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: none;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .box {
        min-width: 220px; max-width: 340px; max-height: 240px; overflow-y: auto;
        background: #23262e; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.45);
        font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 4px;
      }
      .item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 7px; cursor: default; }
      .item.active { background: rgba(108,140,255,0.22); }
      .icon { flex-shrink: 0; width: 18px; text-align: center; }
      .text { min-width: 0; }
      .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: 11px; color: #99a0ac; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .foot { font-size: 10px; color: #99a0ac; padding: 4px 10px 2px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 3px; }
      @media (prefers-color-scheme: light) {
        .box { background: #ffffff; color: #1f2328; border-color: rgba(0,0,0,0.15); }
        .sub, .foot { color: #6b7280; }
        .item.active { background: rgba(108,140,255,0.15); }
      }
    `;
    shadow.appendChild(style);
    listEl = document.createElement('div');
    listEl.className = 'box';
    shadow.appendChild(listEl);
    document.documentElement.appendChild(host);
  }

  let currentItems = [];

  function showDropdown(el, items, footNote) {
    if (!items.length) return;
    ensureUi();
    currentItems = items;
    activeIndex = -1;
    listEl.textContent = '';
    for (const [index, item] of items.entries()) {
      const row = document.createElement('div');
      row.className = 'item';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = item.icon;
      const text = document.createElement('span');
      text.className = 'text';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.title;
      text.appendChild(title);
      if (item.sub) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = item.sub;
        text.appendChild(sub);
      }
      row.append(icon, text);
      row.addEventListener('mouseenter', () => setActive(index));
      // mousedownで実行(clickだと先にblurが走ってドロップダウンが閉じる)
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.isTrusted) pick(index);
      });
      listEl.appendChild(row);
    }
    if (footNote) {
      const foot = document.createElement('div');
      foot.className = 'foot';
      foot.textContent = footNote;
      listEl.appendChild(foot);
    }
    anchor = el;
    positionDropdown();
    host.style.display = 'block';
  }

  function positionDropdown() {
    if (!anchor || !host) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    host.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - width - 8))}px`;
    const below = rect.bottom + 246 < innerHeight;
    host.style.top = below ? `${rect.bottom + 4}px` : '';
    host.style.bottom = below ? '' : `${innerHeight - rect.top + 4}px`;
  }

  function hideDropdown() {
    if (host) host.style.display = 'none';
    anchor = null;
    currentItems = [];
    activeIndex = -1;
  }

  function setActive(index) {
    activeIndex = index;
    [...listEl.querySelectorAll('.item')].forEach((row, i) => row.classList.toggle('active', i === index));
  }

  function pick(index) {
    const item = currentItems[index];
    const el = anchor;
    hideDropdown();
    suppressEl = el;
    suppressUntil = Date.now() + 400;
    if (item && el) item.action(el);
  }

  const isOpen = () => !!anchor;

  // ---- 候補の組み立て ----

  async function openFor(el) {
    if (el === suppressEl && Date.now() < suppressUntil) return;
    const type = classify(el);
    if (!type || type === 'cc-csc') return;
    if (el.tagName === 'SELECT') return; // selectは自動入力の対象(出力先)だが候補は出さない

    const data = await ipcRenderer.invoke('autofill:page-data').catch(() => null);
    if (!data || document.activeElement !== el) return;

    const items = [];

    if (type === 'current-password' || type === 'username' || type === 'new-password') {
      for (const username of data.usernames) {
        items.push({
          icon: '🔑',
          title: username,
          sub: 'パスワードを入力',
          action: (target) => fillCredential(target, username),
        });
      }
      if (type === 'new-password') {
        items.push({
          icon: '✨',
          title: '強力なパスワードを生成',
          sub: '保存確認は送信時に表示されます',
          action: (target) => fillGeneratedPassword(target),
        });
      }
      showDropdown(el, items, items.length ? 'Roopie パスワードマネージャー' : '');
      return;
    }

    if (ADDRESS_TYPES.has(type)) {
      // メール/電話はログインフォームでも出てくるので、パスワード欄があるフォームでは資格情報を優先
      if ((type === 'email' || type === 'username') && formHasPassword(el) && data.usernames.length) {
        for (const username of data.usernames) {
          items.push({
            icon: '🔑',
            title: username,
            sub: 'パスワードを入力',
            action: (target) => fillCredential(target, username),
          });
        }
      } else {
        for (const address of data.addresses) {
          const { title, sub } = addressSummary(address);
          items.push({ icon: '🏠', title, sub, action: (target) => fillAddress(target, address) });
        }
      }
      showDropdown(el, items, items.length ? 'Roopie 自動入力' : '');
      return;
    }

    if (CARD_TYPES.has(type)) {
      for (const card of data.cards) {
        items.push({
          icon: '💳',
          title: `${card.brand} •••• ${card.last4}`,
          sub: [card.holder, card.expMonth && card.expYear ? `${card.expMonth}/${card.expYear}` : '']
            .filter(Boolean)
            .join('  '),
          action: (target) => fillCard(target, card.id),
        });
      }
      showDropdown(el, items, items.length ? 'セキュリティコードは保存されません' : '');
    }
  }

  // ---- 各種フィル ----

  async function fillCredential(el, username) {
    const credential = await ipcRenderer.invoke('passwords:credential', username).catch(() => null);
    if (!credential) return;
    const scope = el.form ?? document;
    const passwordField = [...scope.querySelectorAll('input[type="password"]')].find(isVisible);
    const usernameField =
      el.type === 'password'
        ? [...scope.querySelectorAll('input')].find(
            (i) =>
              ['text', 'email', 'tel', ''].includes(i.type) &&
              isVisible(i) &&
              passwordField &&
              i.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING
          )
        : el;
    if (usernameField && credential.username) setValue(usernameField, credential.username);
    if (passwordField) setValue(passwordField, credential.password);
  }

  function fillGeneratedPassword(el) {
    const password = generatePassword();
    const scope = el.form ?? document;
    for (const field of scope.querySelectorAll('input[type="password"]')) {
      if (isVisible(field)) setValue(field, password);
    }
  }

  function fillAddress(el, address) {
    const scope = el.form ?? document;
    const fields = scope === document ? document.querySelectorAll('input, select') : scope.querySelectorAll('input, select');
    const filledTypes = new Set();
    for (const field of fields) {
      if (!isVisible(field)) continue;
      const type = classify(field);
      if (!type || !ADDRESS_TYPES.has(type)) continue;
      // 同じ種別が複数あるとき(確認用など)は最初の1つだけ…ではなく全部に入れる方が実用的
      const value = addressValueFor(type, address);
      if (value) {
        setValue(field, value);
        filledTypes.add(type);
      }
    }
    // フォーカス中の欄が未分類種別だった場合の保険(単独入力)
    if (!filledTypes.size) {
      const type = classify(el);
      const value = type ? addressValueFor(type, address) : '';
      if (value) setValue(el, value);
    }
  }

  async function fillCard(el, cardId) {
    const card = await ipcRenderer.invoke('autofill:card-fill', cardId).catch(() => null);
    if (!card) return;
    const scope = el.form ?? document;
    for (const field of scope.querySelectorAll('input, select')) {
      if (!isVisible(field)) continue;
      const type = classify(field);
      switch (type) {
        case 'cc-number': setValue(field, card.number); break;
        case 'cc-name': setValue(field, card.holder); break;
        case 'cc-exp-month': setValue(field, String(card.expMonth)); break;
        case 'cc-exp-year': setValue(field, String(card.expYear)); break;
        case 'cc-exp':
          if (card.expMonth && card.expYear) {
            setValue(field, `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`);
          }
          break;
      }
    }
  }

  // ---- イベント配線 ----

  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLInputElement) openFor(e.target);
  });
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target === document.activeElement && !isOpen()) {
        openFor(e.target);
      }
    },
    true
  );
  document.addEventListener('focusout', () => {
    // ドロップダウン内のmousedownはpreventDefaultでフォーカスを奪わないので、blurは「外に出た」とみなせる
    setTimeout(() => {
      if (anchor && document.activeElement !== anchor) hideDropdown();
    }, 0);
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isOpen() || e.target !== anchor) {
        if (e.key === 'Escape') hideDropdown();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + delta + currentItems.length) % currentItems.length);
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        pick(activeIndex);
      } else if (e.key === 'Escape') {
        hideDropdown();
      } else if (e.key === 'Tab') {
        hideDropdown();
      }
    },
    true
  );
  // 入力し始めたら閉じる(候補で邪魔しない)
  document.addEventListener('input', (e) => {
    if (isOpen() && e.target === anchor) hideDropdown();
  });
  addEventListener('scroll', () => (isOpen() ? positionDropdown() : null), true);
  addEventListener('resize', () => (isOpen() ? positionDropdown() : null));
  addEventListener('pagehide', hideDropdown);

  // ---- ログイン送信の検出(保存確認バー用) ----
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
  // メイン側で「保存済みと同じなら何もしない」「除外サイト」を判定する。
  const flush = () => {
    if (!lastCredentials) return;
    ipcRenderer.send('passwords:captured', lastCredentials);
    lastCredentials = null;
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  // ---- 読み込み時の自動入力(保存が1件だけの時。従来挙動) ----
  async function autofillOnLoad() {
    const passwordField = [...document.querySelectorAll('input[type="password"]')].find(isVisible);
    if (!passwordField || isNewPasswordField(passwordField)) return;

    const credentials = await ipcRenderer.invoke('passwords:for-origin').catch(() => []);
    if (credentials?.length !== 1) return; // 複数あるときはドロップダウンで選ぶ
    const { username, password } = credentials[0];

    const scope = passwordField.form ?? document;
    const usernameField = [...scope.querySelectorAll('input')].find(
      (el) =>
        ['text', 'email', 'tel', ''].includes(el.type) &&
        isVisible(el) &&
        el.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    if (usernameField && username) setValue(usernameField, username);
    setValue(passwordField, password);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autofillOnLoad);
  } else {
    autofillOnLoad();
  }
  // 遅れて描画されるログインフォーム(SPA)にも対応
  setTimeout(autofillOnLoad, 1200);
}
