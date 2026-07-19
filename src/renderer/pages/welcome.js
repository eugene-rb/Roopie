// 初回起動のイントロ。ステップ形式で機能を紹介し、最低限の初期設定(アクセントカラー/
// タブバー位置/検索エンジン/広告ブロック)をその場で決めてもらう。
// 選択は即座に反映する(あとから設定画面でも変更できる)。
const api = window.roopieInternal;

const FEATURES = [
  {
    icon: 'profile',
    title: 'ウィンドウごとのプロファイル',
    body: '仕事用と個人用を同時に開けます。共有する項目(ブックマーク・パスワードなど)は個別に選べます。',
  },
  {
    icon: 'shield',
    title: '広告ブロックとトラッキング分析',
    body: '広告とトラッカーを標準で遮断。どの企業が自分に固有IDを付けているかも一覧できます。',
  },
  {
    icon: 'panel',
    title: 'サイドパネル(F4)',
    body: 'ブックマーク・履歴・メモ・リーディングリストに加え、好きなサイトを常駐させられます。',
  },
  {
    icon: 'grid',
    title: '組み替えられるスタート画面',
    body: '時計・天気・カレンダー・ニュースをドラッグで自由に配置できます。',
  },
  {
    icon: 'gesture',
    title: 'マウスジェスチャー',
    body: '右ドラッグで戻る/進む/タブを閉じる。設定画面から自由に割り当てられます。',
  },
  {
    icon: 'split',
    title: '画面分割',
    body: 'タブを右クリックして「右に並べて表示」で、2つのページを同時に見られます。',
  },
];

const ACCENTS = ['#6c8cff', '#4bbf8a', '#ffb454', '#e5709b', '#a78bfa', '#4dc4d9', '#ff6b6b'];

const TAB_BAR = [
  { value: 'top', name: '上に横並び', desc: '一般的なブラウザと同じ配置' },
  { value: 'left', name: '左に縦並び', desc: 'タブが多くてもタイトルが読める' },
];

const ENGINES = [
  { value: 'google', name: 'Google', desc: '結果の網羅性が高い' },
  { value: 'duckduckgo', name: 'DuckDuckGo', desc: '検索履歴を追跡しない' },
  { value: 'bing', name: 'Bing', desc: 'Microsoftの検索' },
  { value: 'yahoo', name: 'Yahoo!検索', desc: '日本語の情報に強い' },
];

const ADBLOCK = [
  { value: true, name: '有効にする(推奨)', desc: '広告とトラッカーを遮断して表示を速くする' },
  { value: false, name: '無効にする', desc: 'すべてのコンテンツをそのまま表示する' },
];

const steps = [...document.querySelectorAll('.ob-step')];
const dots = document.getElementById('dots');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
let index = 0;

function render() {
  steps.forEach((el, i) => el.classList.toggle('active', i === index));
  [...dots.children].forEach((d, i) => d.classList.toggle('active', i === index));
  backBtn.hidden = index === 0;
  nextBtn.textContent =
    index === 0 ? 'はじめる' : index === steps.length - 1 ? 'Roopieを使いはじめる' : '次へ';
  document.getElementById('skip').hidden = index === steps.length - 1;
}

for (const _ of steps) {
  const dot = document.createElement('div');
  dot.className = 'ob-dot';
  dots.appendChild(dot);
}

backBtn.addEventListener('click', () => {
  index = Math.max(0, index - 1);
  render();
});

nextBtn.addEventListener('click', () => {
  if (index < steps.length - 1) {
    index += 1;
    render();
  } else {
    finish();
  }
});

document.getElementById('skip').addEventListener('click', finish);

function finish() {
  api.introDone();
  api.navigate('roopie://newtab');
}

// 左右キーでも進める
document.addEventListener('keydown', (e) => {
  // ボタンにフォーカスがあるときのEnterは既定のクリックに任せる(二重発火を防ぐ)
  if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) return;
  if (e.key === 'ArrowRight' || e.key === 'Enter') nextBtn.click();
  else if (e.key === 'ArrowLeft' && index > 0) backBtn.click();
});

// ---- 選択肢 ----

// { value, name, desc } の配列からカード型のラジオを作る
function choiceGroup(host, options, current, onPick) {
  host.textContent = '';
  for (const option of options) {
    const btn = document.createElement('button');
    btn.className = 'ob-choice';
    btn.classList.toggle('selected', option.value === current);
    const name = document.createElement('div');
    name.className = 'ob-choice-name';
    name.textContent = option.name;
    const desc = document.createElement('div');
    desc.className = 'ob-choice-desc';
    desc.textContent = option.desc;
    btn.append(name, desc);
    btn.addEventListener('click', () => {
      for (const other of host.children) other.classList.remove('selected');
      btn.classList.add('selected');
      onPick(option.value);
    });
    host.appendChild(btn);
  }
}

function renderAccents(current) {
  const host = document.getElementById('accents');
  host.textContent = '';
  for (const color of ACCENTS) {
    const btn = document.createElement('button');
    btn.className = 'ob-swatch';
    btn.style.background = color;
    btn.title = color;
    btn.classList.toggle('selected', color.toLowerCase() === String(current).toLowerCase());
    btn.addEventListener('click', () => {
      for (const other of host.children) other.classList.remove('selected');
      btn.classList.add('selected');
      // このページのアクセントもすぐ変わる(theme.jsのonThemeStateが拾う)
      api.setTheme({ accent: color });
    });
    host.appendChild(btn);
  }
}

document.getElementById('features').appendChild(window.roopieObCards(FEATURES));

api.getAppInfo().then((info) => {
  document.getElementById('version-badge').textContent = `バージョン ${info.version}`;
});

Promise.all([api.getSettings(), api.getTheme()]).then(([settings, theme]) => {
  renderAccents(theme?.accent ?? ACCENTS[0]);
  choiceGroup(document.getElementById('tabbar'), TAB_BAR, settings.tabBarPosition ?? 'top', (v) =>
    api.setSetting('tabBarPosition', v)
  );
  choiceGroup(document.getElementById('engines'), ENGINES, settings.searchEngine ?? 'google', (v) =>
    api.setSetting('searchEngine', v)
  );
  choiceGroup(document.getElementById('adblock'), ADBLOCK, settings.adblock !== false, (v) =>
    api.setSetting('adblock', v)
  );
});

render();
