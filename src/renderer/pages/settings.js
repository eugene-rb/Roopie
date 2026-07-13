const profilesEl = document.getElementById('profiles');
const addBtn = document.getElementById('add-btn');
const bookmarkBarToggle = document.getElementById('show-bookmark-bar');

// 共有する/しないを切り替えられる項目
const SHARABLE = [
  { key: 'bookmarks', name: 'ブックマーク', desc: '全プロファイルで同じブックマークを使う' },
  { key: 'history', name: '閲覧履歴', desc: '全プロファイルで同じ履歴を使う' },
  { key: 'downloads', name: 'ダウンロード履歴', desc: '全プロファイルで同じダウンロード履歴を使う' },
  { key: 'settings', name: 'ブラウザ設定', desc: 'ブックマークバーの表示などの設定を共通にする' },
];

// 今後のフェーズで対応する項目(UIだけ先に用意)
const PLANNED = [
  { name: '保存パスワード', desc: 'Phase 6 で対応予定' },
  { name: 'マウスジェスチャー', desc: 'Phase 4 で対応予定' },
  { name: 'テーマ・カスタムCSS', desc: 'Phase 5 で対応予定' },
  { name: '拡張機能', desc: '拡張機能対応後に実装' },
];

let state = { profiles: [], activeId: null };
// 追加直後のプロファイルは、そのまま名前を編集できるようにする
let pendingCreate = false;
let renameOnRenderId = null;

function render() {
  profilesEl.textContent = '';
  for (const profile of state.profiles) {
    profilesEl.appendChild(createProfileCard(profile));
  }

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

  card.appendChild(list);
  return card;
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

bookmarkBarToggle.addEventListener('change', () =>
  window.roopieInternal.setSetting('showBookmarkBar', bookmarkBarToggle.checked)
);

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
});

(async () => {
  state = await window.roopieInternal.listProfiles();
  render();
  const settings = await window.roopieInternal.getSettings();
  bookmarkBarToggle.checked = !!settings.showBookmarkBar;
})();
