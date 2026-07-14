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
];

// 今後のフェーズで対応する項目(UIだけ先に用意)
const PLANNED = [
  { name: '保存パスワード', desc: 'Phase 6 で対応予定' },
  { name: '拡張機能', desc: '拡張機能対応後に実装' },
];

let state = { profiles: [], activeId: null, googleAccounts: [] };
// プロファイルID -> 実際にGoogleにログイン中のメールアドレス一覧
let signedIn = {};
// 追加直後のプロファイルは、そのまま名前を編集できるようにする
let pendingCreate = false;
let renameOnRenderId = null;

function render() {
  profilesEl.textContent = '';
  for (const profile of state.profiles) {
    profilesEl.appendChild(createProfileCard(profile));
  }
  renderAccounts();

  if (renameOnRenderId) {
    const id = renameOnRenderId;
    renameOnRenderId = null;
    const profile = state.profiles.find((p) => p.id === id);
    const card = profilesEl.children[state.profiles.indexOf(profile)];
    const nameEl = card?.querySelector('.profile-name');
    if (profile && nameEl) startRename(profile, nameEl);
  }
}

function createProfileCard(profile) {
  const isActive = profile.id === state.activeId;
  const card = document.createElement('div');
  card.className = 'card' + (isActive ? ' active' : '');

  const head = document.createElement('div');
  head.className = 'profile-head';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = profile.color;
  avatar.textContent = (profile.name[0] || '?').toUpperCase();
  head.appendChild(avatar);

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

bookmarkBarToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('showBookmarkBar', bookmarkBarToggle.checked)
);

const adblockToggle = document.getElementById('adblock-toggle');
adblockToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('adblock', adblockToggle.checked)
);

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
  render();
});
window.roopieInternal.onSettings((settings) => {
  bookmarkBarToggle.checked = !!settings.showBookmarkBar;
  adblockToggle.checked = settings.adblock !== false;
});

// 別タブでログインして戻ってきたときに「ログイン中」表示を更新する
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSignedIn();
});

(async () => {
  const [profileState, accounts, settings, gestureConfig, themeConfig] = await Promise.all([
    window.roopieInternal.listProfiles(),
    window.roopieInternal.listGoogleAccounts(),
    window.roopieInternal.getSettings(),
    window.roopieInternal.getGestures(),
    window.roopieInternal.getTheme(),
  ]);
  state = { ...profileState, googleAccounts: accounts };
  bookmarkBarToggle.checked = !!settings.showBookmarkBar;
  adblockToggle.checked = settings.adblock !== false;
  if (gestureConfig) gestureState = gestureConfig;
  if (themeConfig) themeState = themeConfig;
  render();
  renderGestures();
  renderTheme();
  refreshSignedIn();
})();
