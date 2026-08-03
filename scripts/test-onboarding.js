// 初回起動のイントロ(roopie://welcome)とアップデート後の変更点(roopie://whatsnew)の検証(再利用可能)。
// 実行: npx electron scripts/test-onboarding.js [スクショ保存先dir]
// 一時userDataで本物のメインプロセスを動かし、
//   1) 出し分けロジック(decideStartup)
//   2) イントロを最後まで進めたときに設定が反映され、状態が保存され、新しいタブへ抜けること
//   3) 変更点ページが release-notes.json の内容を描画し、「見た」と記録されること
// を確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-onboarding-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const appState = require('../src/main/app-state');
const { setupAutoUpdater } = require('../src/main/updater');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// スクショは補助情報。描画直後は capturePage が失敗することがあるので1度だけ待って再試行し、
// それでも撮れなければ検証自体は止めずに警告にとどめる
async function shot(wc, name) {
  for (let i = 0; i < 2; i++) {
    try {
      const image = await wc.capturePage();
      const file = path.join(shotDir, name);
      fs.writeFileSync(file, image.toPNG());
      console.log(`   📸 ${file}`);
      return;
    } catch (err) {
      if (i === 1) console.log(`   ⚠ スクショを撮れませんでした(${name}): ${err.message}`);
      else await sleep(600);
    }
  }
}

// 内部ページのタブのwebContents(chrome UIではなくページ側)
const pageWc = (ctx) => ctx.tabManager.tabs[0].view.webContents;

async function waitFor(wc, expr, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if (await js(wc, expr)) return true;
    } catch {
      // 読み込み中は評価できないことがある
    }
    await sleep(150);
  }
  return false;
}

app.whenReady().then(async () => {
  try {
    // ---- 1. 出し分けロジック ----
    const latest = appState.latestNotesVersion();
    check('変更履歴の最新versionが読める', typeof latest === 'string' && latest.length > 0, true);
    check('初回起動 → イントロ', appState.decideStartup({ introDone: false, seenNotes: null }, latest), 'welcome');
    check('2回目以降 → 何も開かない', appState.decideStartup({ introDone: true, seenNotes: latest }, latest), null);
    check('変更点が増えた → 変更点', appState.decideStartup({ introDone: true, seenNotes: latest }, '9.9'), 'whatsnew');
    check('ビルド番号だけ上がっても出さない', appState.decideStartup({ introDone: true, seenNotes: latest }, latest), null);
    check('変更履歴が空 → 何も開かない', appState.decideStartup({ introDone: true, seenNotes: null }, null), null);

    // ---- 2. イントロ ----
    registerIpc();
    browser.initData();
    appState.init();
    setupAutoUpdater(); // 未パッケージなので「開発中」状態になるだけ(通信はしない)
    const startupUrl = appState.takeStartupUrl();
    check('初回起動の初期タブはイントロ', startupUrl, 'roopie://welcome');
    check('起動URLは1回だけ消費される', appState.takeStartupUrl(), undefined);

    const ctx = browser.createWindow({ url: startupUrl });
    await sleep(1500);
    const wc = pageWc(ctx);
    check('イントロが開いた', await waitFor(wc, `!!document.querySelector('.ob-step.active')`), true);
    check('機能カードが並ぶ', await js(wc, `document.querySelectorAll('#features .ob-card').length`), 6);
    check(
      '追加した機能(翻訳・見た目)もカードにある',
      await js(
        wc,
        `['ページの翻訳', '自分好みの見た目'].every((t) =>
           [...document.querySelectorAll('#features .ob-card-title')].some((el) => el.textContent === t))`
      ),
      true
    );
    check(
      'カードのアイコンが描かれている(未知のキーで代替されていない)',
      await js(wc, `[...document.querySelectorAll('#features .ob-card-icon svg')].every((s) => s.innerHTML.length > 20)`),
      true
    );
    check('進捗ドットはステップ数と同じ', await js(wc, `document.querySelectorAll('.ob-dot').length`), 6);
    check(
      'バージョンが表示される',
      await js(wc, `/^バージョン \\d/.test(document.getElementById('version-badge').textContent)`),
      true
    );
    await shot(wc, 'onboarding-1-welcome.png');

    // 「はじめる」で機能紹介、もう1回「次へ」で見た目のステップへ
    await js(wc, `document.getElementById('next').click()`);
    await sleep(400);
    check('2ステップ目(できること)', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '1');
    // カードを増やしたときに操作ボタンへ重ならないか(通常のウィンドウの大きさで収まること)
    check(
      '機能カードは通常の大きさのウィンドウに収まる',
      await js(wc, `(() => { const s = document.querySelector('.ob-stage'); return s.scrollHeight <= s.clientHeight + 1; })()`),
      true
    );
    await shot(wc, 'onboarding-2-features.png');
    await js(wc, `document.getElementById('next').click()`);
    await sleep(300);
    check('3ステップ目(見た目)', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '2');
    await shot(wc, 'onboarding-2-look.png');

    // 明るさ・アクセントカラー・タブバー位置を選ぶ
    await js(
      wc,
      `[...document.querySelectorAll('#window-mode .ob-choice')].find((b) => b.textContent.includes('ライト')).click()`
    );
    await js(wc, `document.querySelectorAll('#accents .ob-swatch')[1].click()`);
    await js(
      wc,
      `[...document.querySelectorAll('#tabbar .ob-choice')].find((b) => b.textContent.includes('左に縦並び')).click()`
    );
    await sleep(400);
    check('ウィンドウの明るさが即反映される', browser.theme.data.windowMode, 'light');
    check('アクセントカラーが即反映される', browser.theme.data.accent, '#4bbf8a');
    check('タブバー位置が即反映される', browser.settings.data.tabBarPosition, 'left');

    // 検索とプライバシー
    await js(wc, `document.getElementById('next').click()`);
    await sleep(300);
    check('4ステップ目(検索とプライバシー)', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '3');
    await js(
      wc,
      `[...document.querySelectorAll('#engines .ob-choice')].find((b) => b.textContent.includes('DuckDuckGo')).click()`
    );
    await js(
      wc,
      `[...document.querySelectorAll('#adblock .ob-choice')].find((b) => b.textContent.includes('無効')).click()`
    );
    await js(
      wc,
      `[...document.querySelectorAll('#translate .ob-choice')].find((b) => b.textContent.includes('提案しない')).click()`
    );
    await sleep(400);
    check('検索エンジンが即反映される', browser.settings.data.searchEngine, 'duckduckgo');
    check('広告ブロックのOFFが即反映される', browser.settings.data.adblock, false);
    check('翻訳の提案のOFFが即反映される', browser.settings.data.translateAutoOffer, false);
    await shot(wc, 'onboarding-3-search.png');

    // 天気の場所(既定値は持たず、ここで設定を促す)
    await js(wc, `document.getElementById('next').click()`);
    await sleep(300);
    check('5ステップ目(天気の場所)', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '4');
    check('都市検索のUIがある', await js(wc, `!!document.getElementById('city-input') && !!document.getElementById('city-search')`), true);
    check('天気の場所は初期状態では未設定', browser.settings.data.weatherLocation, null);

    // 実際に検索して選ぶ(Open-Meteoの検索APIを使うのでネットワークが必要)。
    // このAPIは日本語の地名にヒットしないため、ローマ字で引けることを確認する
    await js(wc, `(() => { document.getElementById('city-input').value = 'Tokyo'; document.getElementById('city-search').click(); })()`);
    await sleep(2500);
    const hits = await js(wc, `document.querySelectorAll('#city-results .ob-result').length`);
    check('ローマ字の都市名で候補が出る', hits > 0, true);
    if (hits > 0) {
      await js(wc, `document.querySelector('#city-results .ob-result').click()`);
      await sleep(400);
      const saved = browser.settings.data.weatherLocation;
      check('候補を選ぶと場所が保存される', Number.isFinite(saved?.lat) && Number.isFinite(saved?.lon), true);
      console.log(`   選ばれた場所: ${saved?.name} (${saved?.lat}, ${saved?.lon})`);
    }

    // 検索結果のクリックと同じ経路(通信せずにIPCの正規化だけを見る)
    await js(wc, `window.roopieInternal.setSetting('weatherLocation', { name: '検証市', lat: 35.6, lon: 139.7 })`);
    await sleep(300);
    check('選んだ場所が保存される', browser.settings.data.weatherLocation, { name: '検証市', lat: 35.6, lon: 139.7 });
    await js(wc, `window.roopieInternal.setSetting('weatherLocation', { name: 'x', lat: 999, lon: 0 })`);
    await sleep(300);
    check('おかしな座標は弾く', browser.settings.data.weatherLocation, null);
    await js(wc, `window.roopieInternal.setSetting('weatherLocation', { name: '検証市', lat: 35.6, lon: 139.7 })`);
    await sleep(200);
    await shot(wc, 'onboarding-4-weather.png');

    // 完了 → 新しいタブへ
    await js(wc, `document.getElementById('next').click()`);
    await sleep(300);
    check('最終ステップ', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '5');
    const buttonVisible = () =>
      js(
        wc,
        `(() => {
           const r = document.getElementById('next').getBoundingClientRect();
           return r.bottom <= window.innerHeight + 1 && r.top >= 0;
         })()`
      );
    const actionsPosition = () => js(wc, `getComputedStyle(document.querySelector('.ob-actions')).position`);
    check('ボタンがウィンドウの中に収まっている', await buttonVisible(), true);
    // 収まっているステップでは貼り付けない(ぼかしの帯だけが宙に浮いて見えるため)
    check('収まっているステップでは下端に貼り付けない', await actionsPosition(), 'static');
    await shot(wc, 'onboarding-5-done.png');
    // 小さいウィンドウでは項目が収まらない。そのときはボタンを下端に貼り付けて押せるままにする
    ctx.window.setBounds({ ...ctx.window.getBounds(), width: 820, height: 420 });
    await sleep(900);
    await js(wc, `(() => { document.getElementById('back').click(); document.getElementById('back').click(); })()`);
    await sleep(500);
    check('(前提)項目の多いステップに戻った', await js(wc, `document.querySelector('.ob-step.active').dataset.step`), '3');
    check('収まらないステップでは下端に貼り付ける', await actionsPosition(), 'sticky');
    check('小さいウィンドウでもボタンが見える', await buttonVisible(), true);
    await shot(wc, 'onboarding-6-small.png');
    ctx.window.setBounds({ ...ctx.window.getBounds(), width: 1280, height: 800 });
    await sleep(700);
    await js(wc, `(() => { document.getElementById('next').click(); document.getElementById('next').click(); })()`);
    await sleep(500);

    await js(wc, `document.getElementById('next').click()`);
    await sleep(1200);
    check('イントロを抜けると新しいタブ', pageWc(ctx).getURL().startsWith('roopie://newtab'), true);

    appState.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'app-state.json'), 'utf8'));
    check('イントロ完了が保存される', saved.introDone, true);
    check('変更点も既読になる(直後に出さない)', saved.seenNotes, latest);
    check('完了後は何も開かない', appState.decideStartup(saved, latest), null);

    // ---- 3. 変更点ページ ----
    ctx.tabManager.createTab('roopie://whatsnew');
    await sleep(1500);
    const newsWc = ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].view.webContents;
    check('変更点が開いた', await waitFor(newsWc, `!!document.querySelector('#notes .ob-card')`), true);
    check(
      '変更点のカードが描画される',
      await js(newsWc, `document.querySelectorAll('#notes .ob-card').length > 0`),
      true
    );
    check(
      '見出しに変更履歴のタイトルが入る',
      await js(newsWc, `document.getElementById('title').textContent.length > 0`),
      true
    );
    check(
      '見出しが中央寄せ',
      await js(newsWc, `getComputedStyle(document.getElementById('title')).textAlign`),
      'center'
    );
    check(
      '「続ける」ボタンが常に見える(下端に固定)',
      await js(newsWc, `getComputedStyle(document.querySelector('.ob-actions')).position`),
      'sticky'
    );
    await shot(newsWc, 'onboarding-5-whatsnew.png');

    // ---- 4. 設定画面の「Roopieについて」 ----
    ctx.tabManager.createTab('roopie://settings');
    await sleep(2000);
    const setWc = ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].view.webContents;
    check(
      'バージョンが表示される',
      await waitFor(setWc, `/バージョン/.test(document.getElementById('about-version').textContent)`),
      true
    );
    check(
      '開発中は自動アップデートが動かない旨を出す',
      await js(setWc, `document.getElementById('about-version').textContent.includes('開発中')`),
      true
    );
    check('目次に「Roopieについて」', await js(setWc, `[...document.querySelectorAll('.toc-link')].some((a) => a.textContent === 'Roopieについて')`), true);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
