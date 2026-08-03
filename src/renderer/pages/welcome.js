// 初回起動のイントロ。ステップ形式で機能を紹介し、最低限の初期設定(アクセントカラー/
// タブバー位置/検索エンジン/広告ブロック)をその場で決めてもらう。
// 選択は即座に反映する(あとから設定画面でも変更できる)。
const api = window.roopieInternal;

const FEATURES = [
  // 本文は2行に収まる長さにしておく(8枚が縦にあふれてボタンに重なるのを避けるため)
  {
    icon: 'profile',
    title: 'ウィンドウごとのプロファイル',
    body: '仕事用と個人用を同時に開けます。共有する項目は個別に選べます。',
  },
  {
    icon: 'shield',
    title: '広告ブロックとトラッキング分析',
    body: '広告とトラッカーを標準で遮断。固有IDを付ける企業も一覧できます。',
  },
  {
    icon: 'translate',
    title: 'ページの翻訳',
    body: '読めない言語のページを丸ごと翻訳。選んだ文だけでも訳せます。',
  },
  {
    icon: 'panel',
    title: 'サイドパネル(F4)',
    body: 'ブックマーク・履歴・メモ・タイマー。好きなサイトも常駐できます。',
  },
  {
    icon: 'grid',
    title: '組み替えられるスタート画面',
    body: '時計・天気・カレンダー・ニュースをドラッグで自由に配置。',
  },
  {
    icon: 'palette',
    title: '自分好みの見た目',
    body: '明るさ・色・半透明やグラデーション、タブのエフェクトまで。',
  },
];
// マウスジェスチャーと画面分割は最後のステップで触れる(カードを増やすと縦にあふれる)

const ACCENTS = ['#6c8cff', '#4bbf8a', '#ffb454', '#e5709b', '#a78bfa', '#4dc4d9', '#ff6b6b'];

const WINDOW_MODES = [
  { value: 'system', name: 'システムに合わせる', desc: 'Windowsの設定に追従する' },
  { value: 'dark', name: 'ダーク', desc: '暗い配色で統一する' },
  { value: 'light', name: 'ライト', desc: '明るい配色で統一する' },
];

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

const TRANSLATE = [
  { value: true, name: '提案する(推奨)', desc: '読めない言語のページで確認を出す' },
  { value: false, name: '提案しない', desc: '翻訳アイコンから自分で実行する' },
];

const steps = [...document.querySelectorAll('.ob-step')];
const dots = document.getElementById('dots');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
const stage = document.querySelector('.ob-stage');
const actions = document.querySelector('.ob-actions');
let index = 0;

function render() {
  steps.forEach((el, i) => el.classList.toggle('active', i === index));
  [...dots.children].forEach((d, i) => d.classList.toggle('active', i === index));
  backBtn.hidden = index === 0;
  nextBtn.textContent =
    index === 0 ? 'はじめる' : index === steps.length - 1 ? 'Roopieを使いはじめる' : '次へ';
  document.getElementById('skip').hidden = index === steps.length - 1;
  updateStickyActions();
}

// 中身がウィンドウに収まらないステップだけ、ボタンを下端に貼り付ける。
// 収まっているステップに付けると、ぼかしの帯だけが宙に浮いて見えてしまう
function updateStickyActions() {
  actions.classList.remove('sticky'); // 付いたままだと高さが変わって判定がぶれる
  if (stage.scrollHeight > stage.clientHeight + 1) actions.classList.add('sticky');
}

window.addEventListener('resize', updateStickyActions);

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
  // 入力欄では矢印もEnterも入力側の操作(ステップ送りに使わない)
  if (e.target instanceof HTMLInputElement) return;
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

// ---- 天気の場所(スタート画面の天気ウィジェットが既定で使う) ----

const cityInput = document.getElementById('city-input');
const cityResults = document.getElementById('city-results');

async function searchCity() {
  const query = cityInput.value.trim();
  if (!query) return;
  cityResults.textContent = '';
  const hint = document.createElement('div');
  hint.className = 'ob-hint';
  hint.textContent = '検索中…';
  cityResults.appendChild(hint);

  const places = await api.geocodeCity(query);
  cityResults.textContent = '';
  if (!places.length) {
    // 検索API(Open-Meteo)は日本語の地名でも当たり外れがある(ローマ字なら確実)
    hint.textContent = /[^\x00-\x7F]/.test(query)
      ? '見つかりませんでした。ローマ字でも試してみてください(例: Tokyo)'
      : '見つかりませんでした。別の書き方で試してください';
    cityResults.appendChild(hint);
    return;
  }
  for (const place of places) {
    const btn = document.createElement('button');
    btn.className = 'ob-result';
    btn.textContent = [place.name, place.admin, place.country].filter(Boolean).join(' / ');
    btn.addEventListener('click', () => {
      for (const other of cityResults.children) other.classList.remove('selected');
      btn.classList.add('selected');
      api.setSetting('weatherLocation', { name: place.name, lat: place.lat, lon: place.lon });
    });
    cityResults.appendChild(btn);
  }
}

document.getElementById('city-search').addEventListener('click', searchCity);
cityInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.stopPropagation(); // ステップ送りのEnterと二重に反応させない
  searchCity();
});

document.getElementById('features').appendChild(window.roopieObCards(FEATURES));

api.getAppInfo().then((info) => {
  document.getElementById('version-badge').textContent = `バージョン ${info.version}`;
});

Promise.all([api.getSettings(), api.getTheme()]).then(([settings, theme]) => {
  renderAccents(theme?.accent ?? ACCENTS[0]);
  // 明るさはテーマ側(プロファイル単位)。選んだ瞬間にブラウザのUIが切り替わる
  choiceGroup(document.getElementById('window-mode'), WINDOW_MODES, theme?.windowMode ?? 'system', (v) =>
    api.setTheme({ windowMode: v })
  );
  choiceGroup(document.getElementById('tabbar'), TAB_BAR, settings.tabBarPosition ?? 'top', (v) =>
    api.setSetting('tabBarPosition', v)
  );
  choiceGroup(document.getElementById('engines'), ENGINES, settings.searchEngine ?? 'google', (v) =>
    api.setSetting('searchEngine', v)
  );
  choiceGroup(document.getElementById('adblock'), ADBLOCK, settings.adblock !== false, (v) =>
    api.setSetting('adblock', v)
  );
  choiceGroup(document.getElementById('translate'), TRANSLATE, settings.translateAutoOffer !== false, (v) =>
    api.setSetting('translateAutoOffer', v)
  );
  // 設定済みならそれを見せる(イントロを見直したときのため)
  if (settings.weatherLocation?.name) {
    cityInput.value = settings.weatherLocation.name;
    const hint = document.createElement('div');
    hint.className = 'ob-hint';
    hint.textContent = `現在の設定: ${settings.weatherLocation.name}`;
    cityResults.appendChild(hint);
  }
});

render();
