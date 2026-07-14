const backdrop = document.getElementById('backdrop');
const menu = document.getElementById('menu');
const itemsEl = document.getElementById('items');
const manageBtn = document.getElementById('manage');

const MENU_WIDTH = 260;
const MARGIN = 8;

// メインプロセスから「このアンカー位置に、このプロファイル一覧で開いて」と指示が来る
window.roopieInternal.onMenuShow(({ profiles, activeId, anchor }) => {
  renderItems(profiles, activeId);
  menu.classList.remove('hidden');
  position(anchor);
});

// プロファイルのアイコン(文字/絵文字/画像)を1つの.avatar要素として作る
function buildAvatar(profile) {
  const el = document.createElement('span');
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

function renderItems(profiles, activeId) {
  itemsEl.textContent = '';
  for (const profile of profiles) {
    const item = document.createElement('button');
    item.className = 'menu-item';

    item.appendChild(buildAvatar(profile));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = profile.name;
    item.appendChild(name);

    if (profile.id === activeId) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      item.appendChild(check);
    }

    item.addEventListener('click', () => {
      if (profile.id !== activeId) window.roopieInternal.switchProfile(profile.id);
      close();
    });
    itemsEl.appendChild(item);
  }
}

// アンカー(ツールバーのボタン)の右端に合わせて表示する
function position(anchor) {
  const maxLeft = window.innerWidth - MENU_WIDTH - MARGIN;
  const left = Math.max(MARGIN, Math.min(anchor.right - MENU_WIDTH, maxLeft));
  menu.style.left = `${left}px`;
  menu.style.top = `${MARGIN}px`;
}

function close() {
  menu.classList.add('hidden');
  window.roopieInternal.closeMenu();
}

// メニューの外側をクリックしたら閉じる
backdrop.addEventListener('mousedown', (e) => {
  if (!menu.contains(e.target)) close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});

manageBtn.addEventListener('click', () => {
  window.roopieInternal.openTab('roopie://settings');
  close();
});

document.getElementById('new-window').addEventListener('click', () => {
  window.roopieInternal.newWindow();
  close();
});

document.getElementById('new-incognito').addEventListener('click', () => {
  window.roopieInternal.newIncognitoWindow();
  close();
});
