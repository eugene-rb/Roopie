// ---- 左側の目次(クリックでスクロール + 現在地をハイライト) ----
const tocLinks = Array.from(document.querySelectorAll('.toc-link'));
const tocSections = tocLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);

for (const link of tocLinks) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector(link.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const tocObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of tocLinks) {
        link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
      }
    }
  },
  { rootMargin: '-10% 0px -70% 0px' }
);
for (const section of tocSections) tocObserver.observe(section);

const profilesEl = document.getElementById('profiles');
const accountsEl = document.getElementById('accounts');
const addBtn = document.getElementById('add-btn');
const accountEmailEl = document.getElementById('account-email');
const accountLabelEl = document.getElementById('account-label');
const accountAddBtn = document.getElementById('account-add-btn');
const bookmarkBarToggle = document.getElementById('show-bookmark-bar');

// 共有する/しないを切り替えられる項目
const SHARABLE = [
  { key: 'bookmarks', name: 'ブックマーク', desc: '全プロファイルで同じブックマークを使う' },
  { key: 'history', name: '閲覧履歴', desc: '全プロファイルで同じ履歴を使う' },
  { key: 'downloads', name: 'ダウンロード履歴', desc: '全プロファイルで同じダウンロード履歴を使う' },
  { key: 'settings', name: 'ブラウザ設定', desc: 'ブックマークバーの表示などの設定を共通にする' },
  { key: 'gestures', name: 'マウスジェスチャー', desc: 'ジェスチャーの割り当てを全プロファイルで共通にする' },
  { key: 'theme', name: 'テーマ', desc: 'アクセントカラーやカスタムCSSを全プロファイルで共通にする' },
  { key: 'passwords', name: '保存パスワード', desc: '保存したパスワードを全プロファイルで共通にする' },
  { key: 'autofill', name: '自動入力(住所・カード)', desc: '住所・お支払い方法を全プロファイルで共通にする' },
];

// 今後のフェーズで対応する項目(UIだけ先に用意)
const PLANNED = [];

let state = { profiles: [], activeId: null, googleAccounts: [] };
// プロファイルID -> 実際にGoogleにログイン中のメールアドレス一覧
let signedIn = {};
// プロファイルID -> そのプロファイルのテーマ({ accent, background, ... })
let themeByProfile = {};
// Torの現在の状態({ status, socksPort, error })
let torStatus = { status: 'disabled' };

async function refreshProfileThemes() {
  const results = await Promise.all(
    state.profiles.map(async (p) => [p.id, await window.roopieInternal.getThemeFor(p.id)])
  );
  themeByProfile = Object.fromEntries(results);
  render();
}
// 追加直後のプロファイルは、そのまま名前を編集できるようにする
let pendingCreate = false;
let renameOnRenderId = null;

// セクション見出しの「プロファイル個別/共有中」バッジ。
// 現在アクティブなプロファイルの共有設定(プロファイルカードのトグルと同じ値)を反映する
function renderScopeBadges() {
  const active = state.profiles.find((p) => p.id === state.activeId);
  for (const el of document.querySelectorAll('.scope-badge[data-scope-key]')) {
    const shared = !!active?.shared?.[el.dataset.scopeKey];
    el.textContent = shared ? '共有中' : 'プロファイル個別';
    el.classList.toggle('is-shared', shared);
    el.title = shared
      ? 'この設定は「共有する」がONの他のプロファイルとも共通です(上のプロファイル一覧で切り替えられます)'
      : 'この設定は現在のプロファイルだけのものです(上のプロファイル一覧の「共有する」で切り替えられます)';
  }
}

function render() {
  profilesEl.textContent = '';
  for (const profile of state.profiles) {
    profilesEl.appendChild(createProfileCard(profile));
  }
  renderAccounts();
  renderScopeBadges();

  if (renameOnRenderId) {
    const id = renameOnRenderId;
    renameOnRenderId = null;
    const profile = state.profiles.find((p) => p.id === id);
    const card = profilesEl.children[state.profiles.indexOf(profile)];
    const nameEl = card?.querySelector('.profile-name');
    if (profile && nameEl) startRename(profile, nameEl);
  }
}

// プロファイルのアイコン(文字/絵文字/画像)を1つの.avatar要素として作る
function buildAvatar(profile) {
  const el = document.createElement('div');
  el.className = 'avatar';
  const icon = profile.icon ?? { type: 'letter' };
  if (icon.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.src = icon.value;
    img.alt = '';
    el.appendChild(img);
  } else if (icon.type === 'emoji' && icon.value) {
    el.classList.add('emoji');
    el.textContent = icon.value;
  } else {
    el.style.background = profile.color;
    el.textContent = (profile.name[0] || '?').toUpperCase();
  }
  return el;
}

// プロファイルを切り替えなくても、そのプロファイルのテーマカラーを選べる小さなスウォッチ列
// このプロファイルでTor経由の接続を使うかのトグル+現在の状態表示
function buildTorRow(profile) {
  const wrap = document.createElement('div');
  wrap.className = 'tor-row';

  const row = createToggleRow({
    name: 'Torで接続',
    desc: 'このプロファイルの通信をTorネットワーク経由にします(接続が遅くなります)',
    checked: !!profile.tor,
    onChange: (checked) => window.roopieInternal.setProfileTor(profile.id, checked),
  });
  wrap.appendChild(row);

  // Torが有効なプロファイルにだけ、現在の接続状態を出す
  if (profile.tor) {
    const status = document.createElement('div');
    status.className = 'tor-status';
    status.textContent = torStatusText(torStatus);
    status.classList.toggle('error', torStatus.status === 'error');
    wrap.appendChild(status);
  }
  return wrap;
}

function torStatusText(state) {
  switch (state?.status) {
    case 'starting':
      return 'Torに接続しています…';
    case 'ready':
      return `Torに接続済み(ポート ${state.socksPort})`;
    case 'error':
      return `Torに接続できません: ${state.error ?? '不明なエラー'}`;
    default:
      return 'Torは停止しています';
  }
}

function buildAccentPicker(profile) {
  const wrap = document.createElement('div');
  wrap.className = 'card-accent';

  const label = document.createElement('span');
  label.className = 'card-accent-label';
  label.textContent = 'テーマカラー';
  wrap.appendChild(label);

  const swatches = document.createElement('div');
  swatches.className = 'card-accent-swatches';
  const current = themeByProfile[profile.id]?.accent;
  for (const color of ACCENT_PRESETS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch swatch-sm' + (color === current ? ' active' : '');
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      window.roopieInternal.setThemeFor(profile.id, { accent: color });
      themeByProfile[profile.id] = { ...(themeByProfile[profile.id] ?? {}), accent: color };
      render();
    });
    swatches.appendChild(swatch);
  }
  wrap.appendChild(swatches);
  return wrap;
}

function createProfileCard(profile) {
  const isActive = profile.id === state.activeId;
  const card = document.createElement('div');
  card.className = 'card' + (isActive ? ' active' : '');

  const head = document.createElement('div');
  head.className = 'profile-head';

  const avatarBtn = document.createElement('button');
  avatarBtn.className = 'avatar-btn';
  avatarBtn.title = 'アイコンを変更';
  avatarBtn.appendChild(buildAvatar(profile));
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 共通のアイコンピッカー(icon-picker.js)。nullは「既定に戻す」=頭文字
    window.roopieIconPicker.toggle(avatarBtn, {
      resetLabel: '既定に戻す',
      onPick: (icon) => window.roopieInternal.setProfileIcon(profile.id, icon ?? { type: 'letter' }),
    });
  });
  head.appendChild(avatarBtn);

  const name = document.createElement('div');
  name.className = 'profile-name';
  name.textContent = profile.name;
  head.appendChild(name);

  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '使用中';
    head.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  if (!isActive) {
    actions.appendChild(
      button('切り替え', () => window.roopieInternal.switchProfile(profile.id))
    );
  }
  actions.appendChild(button('名前を変更', () => startRename(profile, name)));

  if (state.profiles.length > 1) {
    const removeBtn = button('削除', () => {
      if (confirm(`プロファイル「${profile.name}」と、その中のCookie・履歴・ブックマークを削除します。よろしいですか?`)) {
        window.roopieInternal.removeProfile(profile.id);
      }
    });
    removeBtn.classList.add('danger');
    actions.appendChild(removeBtn);
  }

  head.appendChild(actions);
  card.appendChild(head);
  card.appendChild(buildAccentPicker(profile));
  card.appendChild(buildTorRow(profile));

  // 共有トグル
  const list = document.createElement('div');
  list.className = 'shared-list';

  for (const item of SHARABLE) {
    list.appendChild(
      createToggleRow({
        name: item.name,
        desc: item.desc,
        checked: !!profile.shared[item.key],
        onChange: (checked) =>
          window.roopieInternal.setProfileShared(profile.id, item.key, checked),
      })
    );
  }

  for (const item of PLANNED) {
    list.appendChild(
      createToggleRow({ name: item.name, desc: item.desc, checked: false, disabled: true })
    );
  }

  card.appendChild(createGoogleSection(profile));
  card.appendChild(list);
  return card;
}

// プロファイルごとに、どのGoogleアカウントを使うか/プライマリはどれかを選ぶ
function createGoogleSection(profile) {
  const section = document.createElement('div');
  section.className = 'google-section';

  const title = document.createElement('div');
  title.className = 'google-title';
  const titleText = document.createElement('span');
  titleText.textContent = 'Googleアカウント(使う / プライマリ)';
  title.appendChild(titleText);

  const actions = document.createElement('div');
  actions.className = 'profile-actions';
  actions.appendChild(
    button('ログイン', () => window.roopieInternal.googleLogin(profile.id))
  );
  actions.appendChild(
    button('ログアウト', () => window.roopieInternal.googleSignOut(profile.id))
  );
  title.appendChild(actions);
  section.appendChild(title);

  if (state.googleAccounts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = '下の「Googleアカウント」から先にアカウントを登録してください';
    section.appendChild(empty);
    return section;
  }

  const active = signedIn[profile.id] ?? [];
  for (const account of state.googleAccounts) {
    section.appendChild(createGoogleRow(profile, account, active));
  }
  return section;
}

function createGoogleRow(profile, account, activeEmails) {
  const enabled = profile.google.enabled.includes(account.id);
  const isPrimary = profile.google.primaryId === account.id;

  const row = document.createElement('div');
  row.className = 'google-row';

  const use = document.createElement('input');
  use.type = 'checkbox';
  use.checked = enabled;
  use.title = 'このプロファイルでこのアカウントを使う';
  use.addEventListener('change', () =>
    window.roopieInternal.setGoogleEnabled(profile.id, account.id, use.checked)
  );
  row.appendChild(use);

  const email = document.createElement('div');
  email.className = 'google-email';
  email.textContent = account.email;
  if (account.label) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = account.label;
    email.appendChild(label);
  }
  row.appendChild(email);

  if (activeEmails.some((e) => e.toLowerCase() === account.email.toLowerCase())) {
    const tag = document.createElement('span');
    tag.className = 'tag signed-in';
    tag.textContent = 'ログイン中';
    row.appendChild(tag);
  }

  // プライマリは有効なアカウントの中からのみ選べる
  const primaryLabel = document.createElement('label');
  primaryLabel.className = 'radio-label';
  const primary = document.createElement('input');
  primary.type = 'radio';
  primary.name = `primary-${profile.id}`;
  primary.checked = isPrimary;
  primary.disabled = !enabled;
  primary.addEventListener('change', () =>
    window.roopieInternal.setGooglePrimary(profile.id, account.id)
  );
  primaryLabel.appendChild(primary);
  primaryLabel.append('プライマリ');
  row.appendChild(primaryLabel);

  if (enabled) {
    row.appendChild(
      button('このアカウントでログイン', () =>
        window.roopieInternal.googleLogin(profile.id, account.id)
      )
    );
  }

  return row;
}

// ブラウザ全体のGoogleアカウント一覧
function renderAccounts() {
  accountsEl.textContent = '';

  if (state.googleAccounts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'まだ登録されていません';
    accountsEl.appendChild(empty);
    return;
  }

  for (const account of state.googleAccounts) {
    const usedBy = state.profiles
      .filter((p) => p.google.enabled.includes(account.id))
      .map((p) => (p.google.primaryId === account.id ? `${p.name}(プライマリ)` : p.name));

    const row = document.createElement('div');
    row.className = 'row';

    const main = document.createElement('div');
    main.className = 'main';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = account.label ? `${account.email}(${account.label})` : account.email;
    main.appendChild(title);

    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = usedBy.length ? `使用中: ${usedBy.join(' / ')}` : 'どのプロファイルでも未使用';
    main.appendChild(sub);
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () =>
      window.roopieInternal.removeGoogleAccount(account.id)
    );
    actions.appendChild(removeBtn);
    row.appendChild(actions);

    accountsEl.appendChild(row);
  }
}

// 各プロファイルで実際にログイン中のアカウントを取得して表示を更新する
async function refreshSignedIn() {
  const results = await Promise.all(
    state.profiles.map(async (p) => [p.id, await window.roopieInternal.signedInGoogleAccounts(p.id)])
  );
  signedIn = Object.fromEntries(results);
  render();
}

function createToggleRow({ name, desc, checked, disabled, onChange }) {
  const row = document.createElement('div');
  row.className = 'setting-row';

  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'setting-name';
  title.textContent = name;
  text.appendChild(title);

  const description = document.createElement('div');
  description.className = 'setting-desc';
  description.textContent = desc;
  text.appendChild(description);
  row.appendChild(text);

  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = !!disabled;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);

  const slider = document.createElement('span');
  slider.className = 'slider';
  label.appendChild(slider);
  row.appendChild(label);

  return row;
}

function button(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// 名前を入力欄に差し替えて編集する
function startRename(profile, nameEl) {
  const input = document.createElement('input');
  input.className = 'search';
  input.value = profile.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const name = input.value.trim();
    if (name && name !== profile.name) window.roopieInternal.renameProfile(profile.id, name);
    else render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') render();
  });
  input.addEventListener('blur', commit);
}

addBtn.addEventListener('click', () => {
  pendingCreate = true;
  window.roopieInternal.createProfile('新しいプロファイル');
});

function addAccount() {
  const email = accountEmailEl.value.trim();
  if (!email.includes('@')) {
    accountEmailEl.focus();
    return;
  }
  window.roopieInternal.addGoogleAccount(email, accountLabelEl.value);
  accountEmailEl.value = '';
  accountLabelEl.value = '';
}

accountAddBtn.addEventListener('click', addAccount);
for (const el of [accountEmailEl, accountLabelEl]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addAccount();
  });
}

const searchEngineSelect = document.getElementById('search-engine');
searchEngineSelect.addEventListener('change', () =>
  window.roopieInternal.setSetting('searchEngine', searchEngineSelect.value)
);

bookmarkBarToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('showBookmarkBar', bookmarkBarToggle.checked)
);

const adblockToggle = document.getElementById('adblock-toggle');
adblockToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('adblock', adblockToggle.checked)
);

// ---- スタート画面のアイコン最大サイズ ----
const startIconSizeInput = document.getElementById('start-icon-size');
startIconSizeInput.addEventListener('change', () =>
  window.roopieInternal.setSetting('startIconSize', Number(startIconSizeInput.value))
);

// ---- ダウンロード先 ----
const downloadPathDesc = document.getElementById('download-path-desc');
const downloadPathChangeBtn = document.getElementById('download-path-change');
const downloadPathResetBtn = document.getElementById('download-path-reset');

function renderDownloadPath(path) {
  downloadPathDesc.textContent = path || 'OSの既定のダウンロードフォルダ';
}

downloadPathChangeBtn.addEventListener('click', async () => {
  const picked = await window.roopieInternal.pickDownloadFolder();
  if (picked) {
    window.roopieInternal.setSetting('downloadPath', picked);
    renderDownloadPath(picked);
  }
});

downloadPathResetBtn.addEventListener('click', () => {
  window.roopieInternal.setSetting('downloadPath', '');
  renderDownloadPath('');
});

// ---- ツールバーのカスタマイズ(表示/非表示 + 並べ替え) ----
const TOOLBAR_ITEM_LABELS = {
  downloads: 'ダウンロード',
  history: '履歴',
  qr: 'QRコード',
  zoom: 'ズーム',
};
const toolbarItemsList = document.getElementById('toolbar-items-list');
let toolbarItemsState = [];
let toolbarDragIndex = null;

function saveToolbarItems(next) {
  toolbarItemsState = next;
  window.roopieInternal.setSetting('toolbarItems', next);
  renderToolbarItems(next);
}

function clearToolbarMarkers() {
  for (const el of toolbarItemsList.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

function renderToolbarItems(items) {
  if (Array.isArray(items) && items.length) toolbarItemsState = items;
  toolbarItemsList.textContent = '';
  toolbarItemsState.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'toolbar-item-row';
    row.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグで並べ替え';
    row.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'toolbar-item-label';
    label.textContent = TOOLBAR_ITEM_LABELS[item.id] || item.id;
    row.appendChild(label);

    const sw = document.createElement('label');
    sw.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.visible !== false;
    cb.addEventListener('change', () => {
      saveToolbarItems(
        toolbarItemsState.map((it) => (it.id === item.id ? { ...it, visible: cb.checked } : it))
      );
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    sw.append(cb, slider);
    row.appendChild(sw);

    // ドラッグ並べ替え(タブバーの並べ替えと同じ手法)
    row.addEventListener('dragstart', () => {
      toolbarDragIndex = index;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      toolbarDragIndex = null;
      row.classList.remove('dragging');
      clearToolbarMarkers();
    });
    row.addEventListener('dragover', (e) => {
      if (toolbarDragIndex === null || toolbarDragIndex === index) return;
      e.preventDefault();
      clearToolbarMarkers();
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
    });
    row.addEventListener('drop', (e) => {
      if (toolbarDragIndex === null || toolbarDragIndex === index) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      let to = index + (after ? 1 : 0);
      const from = toolbarDragIndex;
      if (from < to) to -= 1;
      const next = toolbarItemsState.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      toolbarDragIndex = null;
      clearToolbarMarkers();
      saveToolbarItems(next);
    });

    toolbarItemsList.appendChild(row);
  });
}

// ---- ショートカット割り当て ----
const shortcutsList = document.getElementById('shortcuts-list');
const shortcutsResetAllBtn = document.getElementById('shortcuts-reset-all');
let keybindingsState = [];
let capturingId = null; // キー入力待ちのコマンドID
let captureError = '';

// keydownのe.code → Electronアクセラレータのキートークン(JP配列/IMEに影響されないようcodeを使う)
const CODE_TO_KEY = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Space: 'Space', Tab: 'Tab', Enter: 'Return', NumpadEnter: 'Return',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Backquote: '`', NumpadAdd: 'Plus', NumpadSubtract: '-',
};
function codeToAccelKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_TO_KEY[code] || null;
}

// 保存形式(CmdOrCtrl+Plus など)を見やすい表記に
function displayAccel(accel) {
  if (!accel) return 'なし';
  return accel
    .replace(/CmdOrCtrl|CommandOrControl|Command|Cmd/gi, 'Ctrl')
    .replace(/\bPlus\b/g, '+')
    .replace(/\bReturn\b/g, 'Enter')
    .replace(/\bLeft\b/g, '←').replace(/\bRight\b/g, '→')
    .replace(/\bUp\b/g, '↑').replace(/\bDown\b/g, '↓');
}

function renderKeybindings(config) {
  if (Array.isArray(config)) keybindingsState = config;
  shortcutsList.textContent = '';
  const byCat = new Map();
  for (const cmd of keybindingsState) {
    if (!byCat.has(cmd.category)) byCat.set(cmd.category, []);
    byCat.get(cmd.category).push(cmd);
  }
  for (const [cat, cmds] of byCat) {
    const head = document.createElement('div');
    head.className = 'shortcuts-cat';
    head.textContent = cat;
    shortcutsList.appendChild(head);
    for (const cmd of cmds) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const label = document.createElement('span');
      label.className = 'shortcut-label';
      label.textContent = cmd.label;
      row.appendChild(label);

      if (capturingId === cmd.id && captureError) {
        const err = document.createElement('span');
        err.className = 'shortcut-error';
        err.textContent = captureError;
        row.appendChild(err);
      }

      const keyBtn = document.createElement('button');
      keyBtn.className = 'shortcut-key' + (cmd.isDefault ? '' : ' custom');
      if (capturingId === cmd.id) {
        keyBtn.classList.add('capturing');
        keyBtn.textContent = 'キーを押す…';
      } else {
        keyBtn.textContent = displayAccel(cmd.accelerator);
      }
      keyBtn.addEventListener('click', () => startCapture(cmd.id));
      row.appendChild(keyBtn);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'shortcut-reset';
      resetBtn.title = '既定に戻す';
      resetBtn.textContent = '↺';
      resetBtn.disabled = cmd.isDefault;
      resetBtn.addEventListener('click', async () => {
        if (capturingId) stopCapture();
        renderKeybindings(await window.roopieInternal.resetKeybinding(cmd.id));
      });
      row.appendChild(resetBtn);

      shortcutsList.appendChild(row);
    }
  }
}

function startCapture(id) {
  if (capturingId === id) return;
  capturingId = id;
  captureError = '';
  renderKeybindings();
  window.addEventListener('keydown', captureKeydown, true);
}
function stopCapture() {
  capturingId = null;
  captureError = '';
  window.removeEventListener('keydown', captureKeydown, true);
}

async function captureKeydown(e) {
  e.preventDefault();
  e.stopPropagation();
  const id = capturingId;
  if (!id) return;
  // Escで取り消し
  if (e.code === 'Escape') {
    stopCapture();
    renderKeybindings();
    return;
  }
  // 修飾なしBackspaceで無効化(ショートカットなし)
  if (e.code === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    keybindingsState = keybindingsState.map((c) => (c.id === id ? { ...c, accelerator: '', isDefault: false } : c));
    stopCapture();
    await window.roopieInternal.setKeybinding(id, '');
    renderKeybindings();
    return;
  }
  const key = codeToAccelKey(e.code);
  if (!key) return; // 修飾キーのみ → まだ待つ
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('CmdOrCtrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const isFn = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!mods.length && !isFn) {
    captureError = '修飾キー(Ctrl / Alt / Shift)と組み合わせてください';
    renderKeybindings();
    return;
  }
  const accelerator = [...mods, key].join('+');
  const r = await window.roopieInternal.setKeybinding(id, accelerator);
  if (!r.ok) {
    captureError =
      r.reason === 'conflict'
        ? `「${r.conflict.label}」と重複しています`
        : r.reason === 'reserved'
          ? 'この組み合わせは使用できません'
          : '使用できないキーです';
    renderKeybindings();
    return;
  }
  keybindingsState = keybindingsState.map((c) => (c.id === id ? { ...c, accelerator, isDefault: false } : c));
  stopCapture();
  renderKeybindings();
}

shortcutsResetAllBtn.addEventListener('click', async () => {
  if (capturingId) stopCapture();
  renderKeybindings(await window.roopieInternal.resetAllKeybindings());
});

// メインからの配信(他ウィンドウでの変更・メニュー再構築後の同期)
window.roopieInternal.onKeybindings((config) => {
  if (capturingId) return; // 入力待ち中は上書きしない
  renderKeybindings(config);
});

// ---- 拡張機能 ----
const extensionIdEl = document.getElementById('extension-id');
const extensionInstallBtn = document.getElementById('extension-install-btn');
const extensionsListEl = document.getElementById('extensions-list');

function renderExtensions(items) {
  extensionsListEl.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'インストール済みの拡張機能はありません';
    extensionsListEl.appendChild(empty);
    return;
  }

  for (const ext of items) {
    const card = document.createElement('div');
    card.className = 'ext-card';

    if (ext.icon) {
      const icon = document.createElement('img');
      icon.className = 'ext-icon';
      icon.src = ext.icon;
      card.appendChild(icon);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'ext-icon ext-icon-fallback';
      fallback.textContent = (ext.name[0] || '?').toUpperCase();
      card.appendChild(fallback);
    }

    const main = document.createElement('div');
    main.className = 'ext-main';
    const titleRow = document.createElement('div');
    titleRow.className = 'ext-title-row';
    const name = document.createElement('span');
    name.className = 'ext-name';
    name.textContent = ext.name;
    titleRow.appendChild(name);
    const version = document.createElement('span');
    version.className = 'ext-version';
    version.textContent = `v${ext.version}`;
    titleRow.appendChild(version);
    main.appendChild(titleRow);
    if (ext.description) {
      const desc = document.createElement('p');
      desc.className = 'ext-desc';
      desc.textContent = ext.description;
      main.appendChild(desc);
    }
    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'ext-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn danger';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => {
      if (confirm(`「${ext.name}」を削除します。よろしいですか?`)) {
        window.roopieInternal.removeExtension(ext.id);
      }
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    extensionsListEl.appendChild(card);
  }
}

async function installExtensionFromInput() {
  const id = extensionIdEl.value.trim();
  if (!/^[a-p]{32}$/.test(id)) {
    alert('拡張機能IDの形式が正しくありません(a〜pの32文字)');
    return;
  }
  extensionInstallBtn.disabled = true;
  try {
    await window.roopieInternal.installExtension(id);
    extensionIdEl.value = '';
  } catch (err) {
    alert(`インストールに失敗しました: ${err.message ?? err}`);
  } finally {
    extensionInstallBtn.disabled = false;
  }
}

extensionInstallBtn.addEventListener('click', installExtensionFromInput);
extensionIdEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') installExtensionFromInput();
});

window.roopieInternal.onExtensionsState((items) => renderExtensions(items));

// ---- 保存したパスワード ----
const savePasswordsToggle = document.getElementById('save-passwords');
const passwordsListEl = document.getElementById('passwords-list');
const passwordsDescEl = document.getElementById('passwords-desc');

// パスワードは既定で伏せ字。「表示」を押したものだけ復号して見せる
const revealed = new Map();
const passwordsSearchEl = document.getElementById('passwords-search');
let allPasswords = [];

function renderPasswords() {
  const query = passwordsSearchEl.value.trim().toLowerCase();
  const items = query
    ? allPasswords.filter(
        (p) => p.origin.toLowerCase().includes(query) || p.username.toLowerCase().includes(query)
      )
    : allPasswords;

  passwordsListEl.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = query ? '一致するパスワードはありません' : '保存されたパスワードはありません';
    passwordsListEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'row';

    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.origin.replace(/^https?:\/\//, '');
    main.appendChild(title);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = item.username;
    main.appendChild(sub);
    row.appendChild(main);

    const secret = document.createElement('span');
    secret.className = 'password-value';
    secret.textContent = revealed.get(item.id) ?? '••••••••';
    row.appendChild(secret);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const revealBtn = document.createElement('button');
    revealBtn.className = 'row-btn';
    revealBtn.textContent = revealed.has(item.id) ? '隠す' : '表示';
    revealBtn.addEventListener('click', async () => {
      if (revealed.has(item.id)) {
        revealed.delete(item.id);
      } else {
        const value = await window.roopieInternal.revealPassword(item.id);
        revealed.set(item.id, value ?? '(復号できません)');
      }
      renderPasswords();
    });
    actions.appendChild(revealBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openPasswordEditModal(item));
    actions.appendChild(editBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => window.roopieInternal.removePassword(item.id));
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    passwordsListEl.appendChild(row);
  }
}

async function refreshPasswords() {
  allPasswords = await window.roopieInternal.listPasswords();
  renderPasswords();
  refreshExcluded();
}

passwordsSearchEl.addEventListener('input', renderPasswords);

savePasswordsToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('savePasswords', savePasswordsToggle.checked)
);

document.getElementById('passwords-clear').addEventListener('click', () => {
  if (confirm('保存したパスワードをすべて削除します。よろしいですか?')) {
    revealed.clear();
    window.roopieInternal.clearPasswords();
  }
});

window.roopieInternal.onPasswordsState((items) => {
  allPasswords = items;
  renderPasswords();
  refreshExcluded();
});

// ---- パスワードの編集モーダル ----
function openPasswordEditModal(item) {
  openFormModal({
    title: 'パスワードを編集',
    note: item.origin.replace(/^https?:\/\//, ''),
    fields: [
      { key: 'username', label: 'ユーザー名', value: item.username },
      { key: 'password', label: 'パスワード(空欄なら変更しない)', value: '', type: 'password' },
    ],
    onSave: async (values) => {
      const ok = await window.roopieInternal.updatePassword(item.id, {
        username: values.username,
        password: values.password,
      });
      if (!ok) alert('更新できませんでした(同じサイトに同名のユーザー名が既にあります)');
      revealed.delete(item.id);
      return ok;
    },
  });
}

// ---- エクスポート / インポート ----
document.getElementById('passwords-export').addEventListener('click', async () => {
  const result = await window.roopieInternal.exportPasswords();
  if (result === null) return; // キャンセル
  alert(result.count ? `${result.count}件をエクスポートしました` : 'エクスポートできるパスワードがありません');
});

document.getElementById('passwords-import').addEventListener('click', async () => {
  const result = await window.roopieInternal.importPasswords();
  if (result === null) return; // キャンセル
  alert(`${result.imported}件をインポートしました${result.skipped ? `(${result.skipped}件はスキップ)` : ''}`);
});

// ---- 保存しないサイト(除外リスト) ----
const excludedWrapEl = document.getElementById('passwords-excluded-wrap');
const excludedListEl = document.getElementById('passwords-excluded');

async function refreshExcluded() {
  const origins = await window.roopieInternal.listExcludedPasswordSites();
  excludedWrapEl.classList.toggle('hidden', !origins.length);
  excludedListEl.textContent = '';
  for (const origin of origins) {
    const row = document.createElement('div');
    row.className = 'row';
    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = origin.replace(/^https?:\/\//, '');
    main.appendChild(title);
    row.appendChild(main);
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '解除';
    removeBtn.addEventListener('click', () => window.roopieInternal.removeExcludedPasswordSite(origin));
    actions.appendChild(removeBtn);
    row.appendChild(actions);
    excludedListEl.appendChild(row);
  }
}

// =========================================================
// 自動入力(住所・個人情報 / お支払い方法)
// =========================================================
const addressesListEl = document.getElementById('addresses-list');
const cardsListEl = document.getElementById('cards-list');
const autofillAddressesToggle = document.getElementById('autofill-addresses');
const autofillCardsToggle = document.getElementById('autofill-cards');

autofillAddressesToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('autofillAddresses', autofillAddressesToggle.checked)
);
autofillCardsToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('autofillCards', autofillCardsToggle.checked)
);

// 共通のフォームモーダル。fields: [{key, label, value, type?, placeholder?, half?}]
function openFormModal({ title, note, fields, onSave }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'af-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'af-modal';

  const heading = document.createElement('h3');
  heading.textContent = title;
  modal.appendChild(heading);
  if (note) {
    const noteEl = document.createElement('p');
    noteEl.className = 'note af-modal-note';
    noteEl.textContent = note;
    modal.appendChild(noteEl);
  }

  const grid = document.createElement('div');
  grid.className = 'af-modal-grid';
  const inputs = {};
  for (const field of fields) {
    const wrap = document.createElement('label');
    wrap.className = 'af-field' + (field.half ? ' half' : '');
    const label = document.createElement('span');
    label.className = 'af-field-label';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.className = 'search af-field-input';
    input.type = field.type ?? 'text';
    input.value = field.value ?? '';
    input.placeholder = field.placeholder ?? '';
    input.autocomplete = 'off';
    wrap.append(label, input);
    grid.appendChild(wrap);
    inputs[field.key] = input;
  }
  modal.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'af-modal-actions';
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'キャンセル';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '保存';
  actions.append(spacer, cancelBtn, saveBtn);
  modal.appendChild(actions);

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  cancelBtn.addEventListener('click', close);
  saveBtn.addEventListener('click', async () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
    saveBtn.disabled = true;
    const ok = await onSave(values);
    saveBtn.disabled = false;
    if (ok !== false) close();
  });
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  Object.values(inputs)[0]?.focus();
}

// ---- 住所・個人情報 ----
function addressLabel(a) {
  const name = [a.familyName, a.givenName].filter(Boolean).join(' ');
  const addr = [a.region, a.city, a.street, a.building].filter(Boolean).join('');
  return { title: name || a.org || a.email || '(名称なし)', sub: [addr, a.tel].filter(Boolean).join('  ') };
}

function renderAddresses(items) {
  addressesListEl.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = '保存された住所はありません';
    addressesListEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'row';
    const main = document.createElement('div');
    main.className = 'main';
    const { title, sub } = addressLabel(item);
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = title;
    main.appendChild(titleEl);
    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'sub';
      subEl.textContent = sub;
      main.appendChild(subEl);
    }
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openAddressModal(item));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => window.roopieInternal.removeAddress(item.id));
    actions.append(editBtn, removeBtn);
    row.appendChild(actions);
    addressesListEl.appendChild(row);
  }
}

function openAddressModal(existing) {
  openFormModal({
    title: existing ? '住所を編集' : '住所を追加',
    fields: [
      { key: 'familyName', label: '姓', value: existing?.familyName, half: true },
      { key: 'givenName', label: '名', value: existing?.givenName, half: true },
      { key: 'familyKana', label: 'セイ(フリガナ)', value: existing?.familyKana, half: true },
      { key: 'givenKana', label: 'メイ(フリガナ)', value: existing?.givenKana, half: true },
      { key: 'org', label: '組織・会社(任意)', value: existing?.org },
      { key: 'postal', label: '郵便番号', value: existing?.postal, half: true, placeholder: '100-0001' },
      { key: 'region', label: '都道府県', value: existing?.region, half: true },
      { key: 'city', label: '市区町村', value: existing?.city },
      { key: 'street', label: '番地など', value: existing?.street },
      { key: 'building', label: '建物名・部屋番号(任意)', value: existing?.building },
      { key: 'tel', label: '電話番号', value: existing?.tel, half: true },
      { key: 'email', label: 'メールアドレス', value: existing?.email, half: true },
    ],
    onSave: async (values) => {
      await window.roopieInternal.saveAddress({ ...values, id: existing?.id });
    },
  });
}

document.getElementById('address-add').addEventListener('click', () => openAddressModal(null));

// ---- お支払い方法(カード) ----
function renderCards(items) {
  cardsListEl.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = '保存されたお支払い方法はありません';
    cardsListEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'row';
    const main = document.createElement('div');
    main.className = 'main';
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = `${item.brand} •••• ${item.last4}`;
    main.appendChild(titleEl);
    const subEl = document.createElement('span');
    subEl.className = 'sub';
    subEl.textContent = [
      item.holder,
      item.expMonth && item.expYear ? `有効期限 ${item.expMonth}/${item.expYear}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    main.appendChild(subEl);
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openCardModal(item));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => window.roopieInternal.removeCard(item.id));
    actions.append(editBtn, removeBtn);
    row.appendChild(actions);
    cardsListEl.appendChild(row);
  }
}

function openCardModal(existing) {
  openFormModal({
    title: existing ? 'カードを編集' : 'カードを追加',
    note: existing ? `${existing.brand} •••• ${existing.last4}(番号を変える場合のみ再入力)` : undefined,
    fields: [
      {
        key: 'number',
        label: existing ? 'カード番号(空欄なら変更しない)' : 'カード番号',
        value: '',
        placeholder: '4111 1111 1111 1111',
      },
      { key: 'holder', label: 'カード名義', value: existing?.holder, placeholder: 'TARO YAMADA' },
      { key: 'expMonth', label: '有効期限(月)', value: existing?.expMonth || '', half: true, placeholder: 'MM' },
      { key: 'expYear', label: '有効期限(年)', value: existing?.expYear || '', half: true, placeholder: 'YYYY' },
    ],
    onSave: async (values) => {
      const id = await window.roopieInternal.saveCard({ ...values, id: existing?.id });
      if (!id) {
        alert('カード番号を確認してください(12〜19桁の数字)');
        return false;
      }
    },
  });
}

document.getElementById('card-add').addEventListener('click', () => openCardModal(null));

async function refreshAutofill() {
  renderAddresses(await window.roopieInternal.listAddresses());
  renderCards(await window.roopieInternal.listCards());
}

window.roopieInternal.onAutofillState(({ addresses, cards }) => {
  renderAddresses(addresses);
  renderCards(cards);
});

// ---- テーマ ----
const ACCENT_PRESETS = ['#6c8cff', '#4bbf8a', '#ffb454', '#e5709b', '#a78bfa', '#4dc4d9', '#ff6b6b'];
const accentSwatchesEl = document.getElementById('accent-swatches');
const accentCustomEl = document.getElementById('accent-custom');
const themeBgEl = document.getElementById('theme-bg');
const customCssEl = document.getElementById('custom-css');

let themeState = { accent: '#6c8cff', background: 'auto', customCss: '' };

function renderTheme() {
  accentSwatchesEl.textContent = '';
  for (const color of ACCENT_PRESETS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch' + (color === themeState.accent ? ' active' : '');
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', () => window.roopieInternal.setTheme({ accent: color }));
    accentSwatchesEl.appendChild(swatch);
  }
  accentCustomEl.value = themeState.accent;
  themeBgEl.value = themeState.background;
  // 編集中のカスタムCSSは上書きしない
  if (document.activeElement !== customCssEl) customCssEl.value = themeState.customCss;
  bgImageRowEl.classList.toggle('hidden', themeState.background !== 'image');
}

accentCustomEl.addEventListener('change', () =>
  window.roopieInternal.setTheme({ accent: accentCustomEl.value })
);
themeBgEl.addEventListener('change', () =>
  window.roopieInternal.setTheme({ background: themeBgEl.value })
);
document.getElementById('custom-css-apply').addEventListener('click', () =>
  window.roopieInternal.setTheme({ customCss: customCssEl.value })
);

// ---- 新しいタブの背景画像 ----
const bgImageRowEl = document.getElementById('bg-image-row');
const bgImageInput = document.createElement('input');
bgImageInput.type = 'file';
bgImageInput.accept = 'image/*';
bgImageInput.id = 'bg-image-file-input';
bgImageInput.className = 'hidden';
document.body.appendChild(bgImageInput);

// 大きな画像でもdata URIが肥大化しないよう、長辺1920pxまでに縮小してJPEGへ変換する
async function resizeImageForBackground(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const MAX_DIM = 1920;
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

bgImageInput.addEventListener('change', async () => {
  const file = bgImageInput.files?.[0];
  bgImageInput.value = '';
  if (!file) return;
  const dataUrl = await resizeImageForBackground(file);
  window.roopieInternal.setTheme({ background: 'image', backgroundImage: dataUrl });
});

document.getElementById('bg-image-upload').addEventListener('click', () => bgImageInput.click());
document.getElementById('bg-image-clear').addEventListener('click', () => {
  window.roopieInternal.setTheme({ background: 'auto', backgroundImage: '' });
});

window.roopieInternal.onThemeState((next) => {
  themeState = next;
  renderTheme();
});

// ---- マウスジェスチャー ----
const gestureEnabledEl = document.getElementById('gesture-enabled');
const gestureListEl = document.getElementById('gesture-list');
const gestureNewPatternEl = document.getElementById('gesture-new-pattern');
const gestureActionEl = document.getElementById('gesture-action');
const gestureAddBtn = document.getElementById('gesture-add-btn');

const ARROWS = { U: '↑', D: '↓', L: '←', R: '→' };
const MAX_PATTERN = 8;

let gestureState = { enabled: false, mappings: {}, actions: [] };
let newPattern = '';

function toArrows(pattern) {
  return [...pattern].map((d) => ARROWS[d]).join(' ');
}

function saveGestures(mappings = gestureState.mappings) {
  window.roopieInternal.setGestures({ enabled: gestureEnabledEl.checked, mappings });
}

function renderGestures() {
  gestureEnabledEl.checked = !!gestureState.enabled;

  // アクションの選択肢(追加フォーム用)
  const selected = gestureActionEl.value;
  gestureActionEl.textContent = '';
  for (const action of gestureState.actions) {
    const option = document.createElement('option');
    option.value = action.id;
    option.textContent = action.label;
    gestureActionEl.appendChild(option);
  }
  if (gestureState.actions.some((a) => a.id === selected)) gestureActionEl.value = selected;

  // 割り当て一覧
  gestureListEl.textContent = '';
  const patterns = Object.keys(gestureState.mappings);
  if (patterns.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'ジェスチャーが登録されていません。下のボタンから追加できます';
    gestureListEl.appendChild(empty);
  }

  for (const pattern of patterns) {
    const row = document.createElement('div');
    row.className = 'row';

    const arrows = document.createElement('div');
    arrows.className = 'gesture-row-pattern';
    arrows.textContent = toArrows(pattern);
    row.appendChild(arrows);

    // アクションはその場でプルダウン変更できる
    const select = document.createElement('select');
    select.className = 'gesture-select';
    for (const action of gestureState.actions) {
      const option = document.createElement('option');
      option.value = action.id;
      option.textContent = action.label;
      select.appendChild(option);
    }
    select.value = gestureState.mappings[pattern];
    select.addEventListener('change', () => {
      saveGestures({ ...gestureState.mappings, [pattern]: select.value });
    });
    row.appendChild(select);

    const spacer = document.createElement('div');
    spacer.className = 'main';
    row.appendChild(spacer);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-btn';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', () => {
      const mappings = { ...gestureState.mappings };
      delete mappings[pattern];
      saveGestures(mappings);
    });
    actions.appendChild(removeBtn);
    row.appendChild(actions);

    gestureListEl.appendChild(row);
  }

  renderNewPattern();
}

function renderNewPattern() {
  if (!newPattern) {
    gestureNewPatternEl.className = 'gesture-pattern empty';
    gestureNewPatternEl.textContent = '方向ボタンでジェスチャーを作成';
    gestureAddBtn.disabled = true;
    return;
  }
  gestureNewPatternEl.className = 'gesture-pattern';
  gestureNewPatternEl.textContent = toArrows(newPattern);
  gestureAddBtn.disabled = false;

  // 既存のジェスチャーと重複している場合は注意書きを出す(追加すると上書き)
  if (gestureState.mappings[newPattern]) {
    const note = document.createElement('span');
    note.className = 'gesture-conflict';
    note.textContent = ' (登録済み: 追加で上書き)';
    gestureNewPatternEl.appendChild(note);
  }
}

for (const btn of document.querySelectorAll('.gesture-dir')) {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    // 同じ方向は連続できない(ドラッグでは検出されないため)
    if (newPattern.length >= MAX_PATTERN || newPattern[newPattern.length - 1] === dir) return;
    newPattern += dir;
    renderNewPattern();
  });
}

document.getElementById('gesture-backspace').addEventListener('click', () => {
  newPattern = newPattern.slice(0, -1);
  renderNewPattern();
});

gestureAddBtn.addEventListener('click', () => {
  if (!newPattern) return;
  saveGestures({ ...gestureState.mappings, [newPattern]: gestureActionEl.value });
  newPattern = '';
  renderNewPattern();
});

document.getElementById('gesture-reset').addEventListener('click', () => {
  if (confirm('マウスジェスチャーの割り当てを既定に戻します。よろしいですか?')) {
    window.roopieInternal.resetGestures();
  }
});

gestureEnabledEl.addEventListener('change', () => saveGestures());

window.roopieInternal.onGesturesState((next) => {
  gestureState = next;
  renderGestures();
});

window.roopieInternal.onTorStatus((next) => {
  torStatus = next;
  render();
});

window.roopieInternal.onProfilesState((next) => {
  const known = new Set(state.profiles.map((p) => p.id));
  state = next;
  if (pendingCreate) {
    const added = state.profiles.find((p) => !known.has(p.id));
    if (added) {
      renameOnRenderId = added.id;
      pendingCreate = false;
    }
  }
  // プロファイルの増減があれば、テーマカラーも読み直す
  if (state.profiles.some((p) => !known.has(p.id)) || known.size !== state.profiles.length) {
    refreshProfileThemes();
  } else {
    render();
  }
});
window.roopieInternal.onSettings((settings) => {
  searchEngineSelect.value = settings.searchEngine || 'google';
  bookmarkBarToggle.checked = !!settings.showBookmarkBar;
  adblockToggle.checked = settings.adblock !== false;
  savePasswordsToggle.checked = settings.savePasswords !== false;
  autofillAddressesToggle.checked = settings.autofillAddresses !== false;
  autofillCardsToggle.checked = settings.autofillCards !== false;
  renderDownloadPath(settings.downloadPath);
  renderToolbarItems(settings.toolbarItems);
  startIconSizeInput.value = settings.startIconSize || 96;
});

// 別タブでログインして戻ってきたときに「ログイン中」表示を更新する
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSignedIn();
});

(async () => {
  const [profileState, accounts, settings, gestureConfig, themeConfig, extensions, tor, keybindings] =
    await Promise.all([
      window.roopieInternal.listProfiles(),
      window.roopieInternal.listGoogleAccounts(),
      window.roopieInternal.getSettings(),
      window.roopieInternal.getGestures(),
      window.roopieInternal.getTheme(),
      window.roopieInternal.listExtensions(),
      window.roopieInternal.getTorStatus(),
      window.roopieInternal.getKeybindings(),
    ]);
  if (tor) torStatus = tor;
  renderExtensions(extensions);
  state = { ...profileState, googleAccounts: accounts };
  searchEngineSelect.value = settings.searchEngine || 'google';
  bookmarkBarToggle.checked = !!settings.showBookmarkBar;
  adblockToggle.checked = settings.adblock !== false;
  savePasswordsToggle.checked = settings.savePasswords !== false;
  autofillAddressesToggle.checked = settings.autofillAddresses !== false;
  autofillCardsToggle.checked = settings.autofillCards !== false;
  renderDownloadPath(settings.downloadPath);
  renderToolbarItems(settings.toolbarItems);
  startIconSizeInput.value = settings.startIconSize || 96;
  if (gestureConfig) gestureState = gestureConfig;
  if (themeConfig) themeState = themeConfig;
  render();
  renderGestures();
  renderTheme();
  renderKeybindings(keybindings);
  refreshSignedIn();
  refreshProfileThemes();

  // OSの暗号化が使えない環境では保存機能自体を無効にする
  if (!(await window.roopieInternal.passwordsAvailable())) {
    savePasswordsToggle.disabled = true;
    passwordsDescEl.textContent =
      'この環境ではOSの暗号化が利用できないため、パスワードを保存できません';
  }
  if (!(await window.roopieInternal.autofillAvailable())) {
    autofillCardsToggle.disabled = true;
    document.getElementById('card-add').disabled = true;
    document.getElementById('cards-desc').textContent =
      'この環境ではOSの暗号化が利用できないため、カードを保存できません';
  }
  refreshPasswords();
  refreshAutofill();
})();
