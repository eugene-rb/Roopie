// タブの「閉じるボタンはホバー時だけ」と「音声再生中のエフェクト」のUI検証(再利用可能)。
// 実行: npx electron scripts/test-tab-audio-effect.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、タブに isAudible を立ててエフェクトを確認する。
// 実際に音を鳴らすのは preload のメディアガードと戦うことになるので、状態だけを直接立てる。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-audiofx-'));
app.setPath('userData', tmp);
// 注意: タブ(WebContentsView)側の capturePage はこの環境では
// 「Current display surface not available for capture」で撮れないことがある
// (disableHardwareAcceleration でも直らない)。目視用のスクショは、確実に撮れる
// ウィンドウ本体(chrome UI)側に描いて撮る

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
function checkTrue(name, actual, detail) {
  const ok = !!actual;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(detail ?? actual)}`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

async function shot(wc, name) {
  // 合成が追いつかないと UnknownVizError / display surface not available が出るので粘る
  for (let i = 0; i < 6; i++) {
    try {
      const image = await wc.capturePage();
      const file = path.join(shotDir, name);
      fs.writeFileSync(file, image.toPNG());
      console.log(`   📸 ${file}`);
      return;
    } catch (e) {
      await sleep(600);
      if (i === 5) console.log(`   (スクショ失敗 ${name}: ${e.message})`);
    }
  }
}

// 音を鳴らしている状態を作る(実際の再生の代わりに状態だけ立てて配信する)
function setAudible(ctx, index, audible) {
  ctx.tabManager.tabs[index].isAudible = audible;
  ctx.tabManager.sendState();
}

const EFFECTS = [
  'none',
  'solid',
  'outline',
  'underline',
  'glow',
  'gradient',
  'gradient-underline',
  'gradient-outline',
  'pulse',
  'breathe',
  'flow',
  'sweep',
  'bars',
  'rainbow',
  'nyan',
];
// アニメーションを持つエフェクト(エフェクト要素に animation-name が付くもの)
const ANIMATED = new Set(['pulse', 'breathe', 'flow', 'sweep', 'bars', 'rainbow']);
// エフェクトの描画先。3系統(アクティブ/メディア再生中/タブグループ)ぶんの .tab-fx が重なる
const AUDIO_FX = `document.querySelector('#tabs .tab.audible .tab-fx[data-kind="audio"]')`;

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const wc = ctx.window.webContents;
    const settings = browser.bundleFor(ctx.profileId).settings.data;
    await sleep(2500);

    ctx.tabManager.createTab();
    await sleep(1200);
    check('タブが2枚', ctx.tabManager.tabs.length, 2);

    // ---- 閉じるボタンはホバー時だけ / それ以外はタイトルが伸びる ----
    const titleWidthOf = (i) =>
      js(wc, `Math.round(document.querySelectorAll('#tabs .tab')[${i}].querySelector('.title').getBoundingClientRect().width)`);
    const closeDisplayOf = (i) =>
      js(wc, `getComputedStyle(document.querySelectorAll('#tabs .tab')[${i}].querySelector('.close-btn')).display`);

    check('非ホバーのタブは閉じるボタンが非表示', await closeDisplayOf(0), 'none');
    check('アクティブなタブでも非ホバーなら非表示', await closeDisplayOf(1), 'none');
    const titleWide = await titleWidthOf(0);

    const pos = await js(
      wc,
      `(() => { const r = document.querySelectorAll('#tabs .tab')[0].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
    );
    // Chromiumは移動の連続でホバーを更新するので、少しずつ動かして目的地へ寄せる
    ctx.window.show();
    ctx.window.focus();
    wc.focus();
    for (const step of [0.4, 0.7, 0.9, 1]) {
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(pos.x * step), y: Math.round(pos.y) });
      await sleep(80);
    }
    await sleep(400);
    check('ホバー中のタブに :hover が乗る', await js(wc, `document.querySelectorAll('#tabs .tab:hover').length`), 1);
    check('ホバー中のタブは閉じるボタンが表示', await closeDisplayOf(0), 'flex');
    const titleNarrow = await titleWidthOf(0);
    checkTrue(
      'ホバー解除時はタイトルが閉じるボタンの分まで伸びている',
      titleWide > titleNarrow,
      { 非ホバー: titleWide, ホバー中: titleNarrow }
    );
    await shot(wc, 'close-btn-hover.png');
    // カーソルをタブから外す
    wc.sendInputEvent({ type: 'mouseMove', x: pos.x, y: 400 });
    await sleep(300);

    // ---- 音声再生中のエフェクト ----
    check('鳴っていないタブに .audible は付かない', await js(wc, `document.querySelectorAll('#tabs .tab.audible').length`), 0);
    check(
      '鳴っていないタブには再生中のエフェクト要素も無い',
      await js(wc, `document.querySelectorAll('#tabs .tab .tab-fx[data-kind="audio"]').length`),
      0
    );

    setAudible(ctx, 0, true);
    await sleep(400);
    check('鳴っているタブに .audible が付く', await js(wc, `document.querySelectorAll('#tabs .tab.audible').length`), 1);
    check('既定のエフェクトはbreathe', await js(wc, `${AUDIO_FX}.dataset.effect`), 'breathe');
    checkTrue(
      '位相合わせの --fx-delay が入っている',
      await js(wc, `/^-\\d+(\\.\\d+)?s$/.test(document.querySelector('#tabs .tab.audible').style.getPropertyValue('--fx-delay'))`)
    );

    // ミュートすると鳴っていないのでエフェクトは消える
    ctx.tabManager.tabs[0].view.webContents.setAudioMuted(true);
    ctx.tabManager.sendState();
    await sleep(400);
    check('ミュート中はエフェクトが付かない', await js(wc, `document.querySelectorAll('#tabs .tab.audible').length`), 0);
    ctx.tabManager.tabs[0].view.webContents.setAudioMuted(false);
    ctx.tabManager.sendState();
    await sleep(400);
    check('ミュート解除でエフェクトが戻る', await js(wc, `document.querySelectorAll('#tabs .tab.audible').length`), 1);

    // ---- 再描画してもアニメーションが先頭に戻らない(--fx-delay による位相合わせ) ----
    // タブ要素は状態が届くたびに作り直されるため、これが効かないと毎回0秒目に巻き戻る。
    // 見た目の位置は progress(そのサイクル内の 0..1)で見る
    // (currentTime は負のdelayを含まないので、これだけでは巻き戻りを検出できない)
    const animPhase = () =>
      js(
        wc,
        `(() => {
          const el = document.querySelector('#tabs .tab.audible');
          const a = el.getAnimations({ subtree: true }).find((x) => x.animationName?.startsWith('audio-fx-'));
          if (!a) return null;
          return {
            progress: a.effect.getComputedTiming().progress,
            dur: a.effect.getTiming().duration,
            delay: getComputedStyle(el.querySelector('.tab-fx[data-kind="audio"]')).animationDelay,
            fxDelay: el.style.getPropertyValue('--fx-delay'),
          };
        })()`
      );
    const before = await animPhase();
    checkTrue('エフェクトのアニメーションが動いている', before, before);
    // 計算値は丸められるので数値で比べる
    checkTrue(
      '--fx-delay が animation-delay に届いている',
      before && Math.abs(parseFloat(before.delay) - parseFloat(before.fxDelay)) < 0.01,
      before
    );
    ctx.tabManager.sendState(); // 再描画を起こす
    await sleep(700);
    const after = await animPhase();
    if (before && after) {
      // 経過分(700ms)だけ位相が進んでいるはず。1周をまたぐので剰余で比べる
      const expected = (before.progress + 700 / before.dur) % 1;
      const raw = Math.abs(after.progress - expected);
      const diff = Math.min(raw, 1 - raw) * before.dur;
      checkTrue('再描画してもアニメーションが続きから再生される', diff < 150, { before, after, expected, ズレms: diff });
    }

    // ---- 全エフェクトの適用 ----
    for (const effect of EFFECTS) {
      settings.audioTabEffect = effect;
      browser.sendSettingsFor(ctx.profileId);
      await sleep(350);
      const applied = await js(
        wc,
        `(() => {
          const fx = ${AUDIO_FX};
          if (!fx) return { attr: null };
          const s = getComputedStyle(fx);
          const cat = getComputedStyle(fx, '::after');
          return {
            attr: fx.dataset.effect,
            animation: s.animationName,
            // ニャンキャットは要素自身ではなく ::before/::after に描く
            painted: s.background !== 'none' || s.boxShadow !== 'none' || cat.content !== 'none',
          };
        })()`
      );
      if (effect === 'none') {
        check('「なし」はエフェクト要素を作らない', applied.attr, null);
      } else {
        check(`エフェクト「${effect}」の属性`, applied.attr, effect);
        checkTrue(`エフェクト「${effect}」が描画されている`, applied.painted, applied);
        if (ANIMATED.has(effect)) {
          check(`エフェクト「${effect}」のアニメーション名`, applied.animation, `audio-fx-${effect}`);
        }
      }
    }

    // ---- ニャンキャットは虹(::before)と猫(::after)の2枚重ね ----
    settings.audioTabEffect = 'nyan';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(500);
    const nyan = await js(
      wc,
      `(() => {
        const el = ${AUDIO_FX};
        const before = getComputedStyle(el, '::before');
        const after = getComputedStyle(el, '::after');
        return {
          虹: before.backgroundImage.slice(0, 30),
          虹アニメ: before.animationName,
          猫: after.backgroundImage.slice(0, 30),
          猫アニメ: after.animationName,
          猫幅: after.width,
          猫高さ: after.height,
        };
      })()`
    );
    checkTrue('虹(::before)にドット絵が入っている', nyan.虹.includes('svg+xml'), nyan);
    check('虹のアニメーション', nyan.虹アニメ, 'audio-fx-nyan-rainbow');
    checkTrue('猫(::after)にドット絵が入っている', nyan.猫.includes('svg+xml'), nyan);
    check('猫のアニメーション', nyan.猫アニメ, 'audio-fx-nyan');
    // タブの高さ30pxに猫(21px)が丸ごと収まる
    check('猫の大きさは34x21px', [nyan.猫幅, nyan.猫高さ], ['34px', '21px']);
    checkTrue(
      '猫がタブの高さに収まっている',
      parseFloat(nyan.猫高さ) <= (await js(wc, `document.querySelector('#tabs .tab.audible').getBoundingClientRect().height`)),
      nyan
    );
    // 猫の居場所はパディングで空ける。スピーカーアイコン等が猫に重ならないこと
    const nyanLayout = await js(
      wc,
      `(() => {
        const el = document.querySelector('#tabs .tab.audible');
        const r = el.getBoundingClientRect();
        const btn = el.querySelector('.audio-btn')?.getBoundingClientRect() ?? null;
        const title = el.querySelector('.title').getBoundingClientRect();
        return {
          猫のぶんの余白: getComputedStyle(el.querySelector('.title')).marginRight,
          ボタンの並び順: getComputedStyle(el.querySelector('.audio-btn')).order,
          猫の左端: Math.round(r.right - 4 - 34),
          ボタンの右端: btn ? Math.round(btn.right) : null,
          タイトルの左端: Math.round(title.left),
        };
      })()`
    );
    check('猫のぶんの余白がタイトルに入る', nyanLayout.猫のぶんの余白, '38px');
    check('ボタンはタイトルの左へ寄る', nyanLayout.ボタンの並び順, '-1');
    checkTrue(
      'ボタンがタイトルより左にある',
      nyanLayout.ボタンの右端 === null || nyanLayout.ボタンの右端 <= nyanLayout.タイトルの左端,
      nyanLayout
    );
    checkTrue(
      '猫がタブ内のボタンと重ならない',
      nyanLayout.ボタンの右端 === null || nyanLayout.ボタンの右端 <= nyanLayout.猫の左端,
      nyanLayout
    );

    // 他のエフェクトには虹が出ない(::before を使うのはニャンキャットだけ)
    settings.audioTabEffect = 'glow';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(350);
    check(
      '他のエフェクトでは ::before を出さない',
      await js(wc, `getComputedStyle(${AUDIO_FX}, '::before').content`),
      'none'
    );
    check(
      'ニャンキャット以外では .fx-nyan を付けない',
      await js(wc, `document.querySelectorAll('#tabs .tab.fx-nyan').length`),
      0
    );

    // 見た目の最終確認は代表的な数種類だけスクショする
    for (const effect of ['glow', 'gradient', 'breathe', 'bars', 'nyan']) {
      settings.audioTabEffect = effect;
      browser.sendSettingsFor(ctx.profileId);
      await sleep(500);
      await shot(wc, `effect-${effect}.png`);
    }

    // ---- 色のカスタマイズ ----
    settings.audioTabEffect = 'gradient';
    settings.audioTabEffectColor = '#ff3366';
    settings.audioTabEffectColor2 = '#33ddff';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(400);
    // 色は系統ごとに違えられるので、CSS変数はエフェクト要素そのものに入る
    const colors = await js(
      wc,
      `(() => {
        const s = getComputedStyle(${AUDIO_FX});
        return [s.getPropertyValue('--fx-1').trim(), s.getPropertyValue('--fx-2').trim()];
      })()`
    );
    check('指定した色がCSS変数に入る', colors, ['#ff3366', '#33ddff']);
    await shot(wc, 'effect-custom-color.png');

    settings.audioTabEffectColor = '';
    settings.audioTabEffectColor2 = '';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(400);
    // 空にすると var(--accent) を入れるので、計算後はアクセント色そのものになる
    const accent = await js(wc, `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
    check(
      '色が空ならアクセント色に追従',
      await js(wc, `getComputedStyle(${AUDIO_FX}).getPropertyValue('--fx-1').trim()`),
      accent
    );

    // ---- 3系統(アクティブ / メディア再生中 / タブグループ)を重ねる ----
    settings.activeTabEffect = 'outline';
    settings.audioTabEffect = 'glow';
    settings.groupTabEffect = 'underline';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(400);
    check(
      'アクティブなタブにアクティブ用のエフェクトが付く',
      await js(wc, `document.querySelector('#tabs .tab.active .tab-fx[data-kind="active"]')?.dataset.effect ?? null`),
      'outline'
    );
    check(
      'アクティブでないタブには付かない',
      await js(wc, `document.querySelectorAll('#tabs .tab:not(.active) .tab-fx[data-kind="active"]').length`),
      0
    );

    // 鳴っているタブ(tabs[0])をアクティブにしてグループにも入れる。
    // グループのエフェクトは中身のタブではなく**チップ(グループそのもの)**に出る
    const fxGroup = ctx.tabManager.createGroup([ctx.tabManager.tabs[0].id], { name: 'FX', color: 'red' });
    ctx.tabManager.switchTab(ctx.tabManager.tabs[0].id);
    await sleep(600);
    const stacked = await js(
      wc,
      `(() => {
        const tab = document.querySelector('#group-tabs .tab.active');
        const fx = [...(tab?.querySelectorAll('.tab-fx') ?? [])];
        const chipFx = [...document.querySelectorAll('#tabs .tab-group-chip .tab-fx')];
        return {
          系統: fx.map((el) => el.dataset.kind),
          種類: fx.map((el) => el.dataset.effect),
          チップの系統: chipFx.map((el) => el.dataset.kind),
          チップの種類: chipFx.map((el) => el.dataset.effect),
          グループ色: chipFx.find((el) => el.dataset.kind === 'group')?.style.getPropertyValue('--fx-1') ?? null,
          // 変数が2段(data-color → --group-color → --fx-1)なので計算後の色まで見る
          // (どこかで途切れるとグレーに落ちるが、要素の有無だけの判定では気づけない)
          計算後: getComputedStyle(chipFx[0]).getPropertyValue('--fx-1').trim(),
          グループの赤: getComputedStyle(document.documentElement).getPropertyValue('--group-red').trim(),
        };
      })()`
    );
    check('グループのエフェクトはチップに出る', stacked.チップの系統, ['group']);
    check('チップのエフェクトは設定どおり', stacked.チップの種類, ['underline']);
    check('中身のタブにはグループのエフェクトを出さない(1段目と同じ見た目)', stacked.系統, ['active', 'audio']);
    check('中身のタブは2系統が重なる(下からアクティブ→再生中)', stacked.種類, ['outline', 'glow']);
    check('グループの色が空ならグループ自身の色に従う', stacked.グループ色, 'var(--group-color, var(--group-grey))');
    check('たどった先が本当にそのグループの色になる', stacked.計算後, stacked.グループの赤);
    await shot(wc, 'effect-three-kinds.png');

    // 色を指定するとグループ自身の色より優先される
    settings.groupTabEffectColor = '#00ff88';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(400);
    check(
      'グループの色を指定するとそちらが使われる',
      await js(
        wc,
        `document.querySelector('#tabs .tab-group-chip .tab-fx[data-kind="group"]').style.getPropertyValue('--fx-1')`
      ),
      '#00ff88'
    );
    // チップでもニャンキャットが成立するか(猫のぶんの余白・縁取り・ドット絵)。
    // チップは中身で幅が決まるので、タブと違って細くても猫を出す(猫のぶんだけ広がる)
    settings.groupTabEffectColor = '';
    settings.groupTabEffect = 'nyan';
    browser.sendSettingsFor(ctx.profileId);
    await sleep(500);
    const chipNyan = await js(
      wc,
      `(() => {
        const chip = document.querySelector('#tabs .tab-group-chip');
        const fx = chip.querySelector('.tab-fx');
        return {
          幅: Math.round(chip.getBoundingClientRect().width),
          印: chip.classList.contains('fx-nyan'),
          猫のぶんの余白: getComputedStyle(chip.querySelector('.group-count')).marginRight,
          猫: getComputedStyle(fx, '::after').content,
          虹: getComputedStyle(fx, '::before').backgroundImage.includes('data:image'),
          縁取り: getComputedStyle(chip.querySelector('.group-name')).textShadow !== 'none',
        };
      })()`
    );
    checkTrue('チップが猫のぶんだけ広がる(潰れない)', chipNyan.幅 >= 60, chipNyan);
    check(
      'チップでもニャンキャットが動く',
      { ...chipNyan, 幅: 0 },
      { 幅: 0, 印: true, 猫のぶんの余白: '38px', 猫: '""', 虹: true, 縁取り: true }
    );

    settings.activeTabEffect = 'none';
    settings.groupTabEffect = 'none';
    ctx.tabManager.ungroup(fxGroup.id);
    browser.sendSettingsFor(ctx.profileId);
    await sleep(400);
    check(
      '「なし」にすると要素ごと消える',
      await js(wc, `document.querySelectorAll('.tab-fx[data-kind="active"], .tab-fx[data-kind="group"]').length`),
      0
    );

    // ---- 縦タブでもエフェクトが見切れない ----
    settings.tabBarPosition = 'left';
    settings.audioTabEffect = 'glow';
    browser.applyTabBarPositionFor(ctx.profileId);
    browser.sendSettingsFor(ctx.profileId);
    await sleep(700);
    check('縦タブでも .audible が付く', await js(wc, `document.querySelectorAll('#tabs .tab.audible').length`), 1);
    await shot(wc, 'effect-vertical.png');

    // ---- 設定画面(roopie://settings の「タブ」セクション)----
    // 縦タブのままだとページ領域が composite されず capturePage が撮れないので戻す
    settings.tabBarPosition = 'top';
    settings.audioTabEffect = 'glow';
    settings.groupTabEffect = 'underline'; // 見本の色を見るので「なし」から戻す
    browser.applyTabBarPositionFor(ctx.profileId);
    browser.sendSettingsFor(ctx.profileId);
    await sleep(600);
    const settingsTab = ctx.tabManager.createTab('roopie://settings');
    ctx.tabManager.switchTab(settingsTab.id); // 前面に出さないと capturePage が撮れない
    await sleep(2500);
    const swc = settingsTab.view.webContents;
    const errors = [];
    swc.on('console-message', (e) => {
      if (e.level === 'error') errors.push(e.message);
    });
    // 設定画面は3系統(アクティブ/メディア再生中/タブグループ)ぶんが同じ作りで並ぶ。
    // 2番目がメディア再生中(既存の audioTabEffect)
    const rowsOf = `[...document.querySelectorAll('#tab-effects .setting-row')]`;
    const audioSelect = `document.querySelectorAll('#tab-effects select')[1]`;
    const audioPreview = `document.querySelectorAll('#tab-effects .audio-effect-preview')[1]`;
    // 3番目がタブグループ。エフェクトの出る先がチップなので、見本もチップで組む
    const groupPreview = `document.querySelectorAll('#tab-effects .audio-effect-preview')[2]`;
    const ui = await js(
      swc,
      `(() => {
        const sel = ${audioSelect};
        return {
          系統の数: document.querySelectorAll('#tab-effects select').length,
          選択肢: sel ? sel.querySelectorAll('option').length : 0,
          現在値: sel ? sel.value : null,
          プレビュー: ${audioPreview}?.querySelector('.tab-fx')?.dataset.effect ?? null,
          プレビューのタブ: ${audioPreview}?.querySelectorAll('.tab.audible').length ?? 0,
          グループの見本: !!${groupPreview}?.querySelector('.tab-group-chip .group-name'),
          // 見本の色も変数を2段たどる。設定画面で [data-color] が効かないとグレーに落ちる
          見本の色: getComputedStyle(${groupPreview}.querySelector('.tab-fx')).getPropertyValue('--fx-1').trim(),
          青: getComputedStyle(document.documentElement).getPropertyValue('--group-blue').trim(),
          グレー: getComputedStyle(document.documentElement).getPropertyValue('--group-grey').trim(),
          目次: !!document.querySelector('a[href="#section-tabs"]'),
        };
      })()`
    );
    check('設定画面に3系統ぶん並ぶ', ui.系統の数, 3);
    check('設定画面に15種そろっている', ui.選択肢, 15);
    check('設定画面が今の設定(glow)を映している', ui.現在値, 'glow');
    check('プレビューにも同じエフェクトが載る', ui.プレビュー, 'glow');
    check('プレビューのタブは .audible', ui.プレビューのタブ, 1);
    check('タブグループの見本はチップで出す', ui.グループの見本, true);
    check('見本の色も青のグループの色になる(グレーに落ちない)', [ui.見本の色, ui.見本の色 === ui.グレー], [ui.青, false]);
    checkTrue('目次に「タブ」がある', ui.目次);

    // 選び直すとプレビューとブラウザUIの両方が変わる
    await js(
      swc,
      `(() => {
        const sel = ${audioSelect};
        sel.value = 'nyan';
        sel.dispatchEvent(new Event('change'));
      })()`
    );
    await sleep(600);
    check(
      'プレビューが選び直しに追従',
      await js(swc, `${audioPreview}.querySelector('.tab-fx').dataset.effect`),
      'nyan'
    );
    check('タブバー側にも反映される', await js(wc, `${AUDIO_FX}.dataset.effect`), 'nyan');
    check('保存もされる', settings.audioTabEffect, 'nyan');
    check(
      'ニャンキャットでは色の行を隠す',
      await js(swc, `${rowsOf}.filter((r) => r.querySelector('.color-input'))[1].classList.contains('hidden')`),
      true
    );
    await js(swc, `document.getElementById('section-tabs').scrollIntoView()`);
    ctx.window.focus(); // 非フォーカスだとViewの合成が止まり capturePage が撮れない
    swc.focus();
    await sleep(900);
    await shot(swc, 'settings-tabs-section.png');
    check('設定画面にコンソールエラーが出ない', errors, []);

    // ---- 全エフェクトを1枚に並べて目視する ----
    // クロームUI(index.html)も app.css を読んでいるので、本物と同じ .tab を並べれば実物と同じ見え方になる。
    // 「背景か影が付いている」だけの機械判定では、何も描かれていなくても通ってしまうため目視用に残す
    await js(
      wc,
      `(() => {
        const EFFECTS = ${JSON.stringify(EFFECTS)};
        const box = document.createElement('div');
        box.id = 'fx-grid';
        box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#16181d;padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-content:start;overflow:auto';
        const addFx = (el, effect) => {
          if (effect === 'none') return el;
          const fx = document.createElement('span');
          fx.className = 'tab-fx';
          fx.dataset.effect = effect;
          el.appendChild(fx);
          return el;
        };
        for (const effect of EFFECTS) {
          const cell = document.createElement('div');
          cell.style.cssText = 'display:flex;align-items:center;gap:8px';
          const tab = document.createElement('div');
          tab.className = 'tab active audible' + (effect === 'nyan' ? ' fx-nyan' : '');
          tab.innerHTML = '<span class="favicon-letter">♪</span><span class="title">音声を再生中のタブ</span>';
          // グループの系統はチップ(グループそのもの)に出るので、同じ効果をチップでも並べる
          const chip = document.createElement('div');
          chip.className = 'tab-group-chip active' + (effect === 'nyan' ? ' fx-nyan' : '');
          chip.dataset.color = 'blue';
          chip.innerHTML =
            '<span class="group-dot"></span><span class="group-name">グループ</span><span class="group-count">3</span>';
          const label = document.createElement('span');
          label.textContent = effect;
          label.style.cssText = 'color:#99a0ac;font-size:11px;white-space:nowrap';
          cell.append(addFx(tab, effect), addFx(chip, effect), label);
          box.appendChild(cell);
        }
        document.body.appendChild(box);
      })()`
    );
    await sleep(700);
    await shot(wc, 'all-effects.png');
    await js(wc, `document.getElementById('fx-grid').remove()`);

    // ---- 画面分割中の強調表示(下の2px線)がエフェクトで潰れないか ----
    settings.audioTabEffect = 'solid';
    browser.sendSettingsFor(ctx.profileId);
    ctx.tabManager.switchTab(ctx.tabManager.tabs[0].id);
    await sleep(400);
    const splitLine = await js(
      wc,
      `(() => {
        const el = document.querySelectorAll('#tabs .tab')[0];
        el.classList.add('split'); // 分割中と同じ見た目にする
        const s = getComputedStyle(el);
        const fx = getComputedStyle(el.querySelector('.tab-fx'));
        return { shadow: s.boxShadow, 効果の下端: fx.bottom };
      })()`
    );
    checkTrue('分割中の強調表示(inset box-shadow)は残っている', splitLine.shadow !== 'none', splitLine);
    // ::after は z-index:-1 でも「背景+inset影」の後に描かれるので、全面を塗るエフェクトは線を覆う。
    // 全面系のときだけ下2pxを空けて線を残す
    check('分割中は全面エフェクトの下端を2px空ける', splitLine.効果の下端, '2px');
    await shot(wc, 'effect-split.png');

    // ---- タブが増えて細くなったとき(ニャンキャットのpadding-rightが効きすぎないか)----
    settings.audioTabEffect = 'nyan';
    browser.sendSettingsFor(ctx.profileId);
    for (let i = 0; i < 12; i++) ctx.tabManager.createTab();
    await sleep(2500);
    const narrow = await js(
      wc,
      `(() => {
        const el = document.querySelector('#tabs .tab.audible');
        const r = el.getBoundingClientRect();
        return {
          タブ幅: Math.round(r.width),
          タイトル幅: Math.round(el.querySelector('.title').getBoundingClientRect().width),
          猫のぶんの余白: getComputedStyle(el.querySelector('.title')).marginRight,
          ボタンの並び順: getComputedStyle(el.querySelector('.audio-btn')).order,
          猫: getComputedStyle(el.querySelector('.tab-fx'), '::after').content,
          虹の右: getComputedStyle(el.querySelector('.tab-fx'), '::before').right,
        };
      })()`
    );
    checkTrue('細いタブでもタイトルの場所が残る', narrow.タイトル幅 > 0, narrow);
    check('細いタブでは猫を出さない', narrow.猫, 'none');
    check('細いタブでは猫のぶんの余白も戻す', narrow.猫のぶんの余白, '0px');
    check('細いタブでもボタンは左寄せのまま', narrow.ボタンの並び順, '-1');
    check('細いタブでは虹を右端まで伸ばす', narrow.虹の右, '0px');
    await shot(wc, 'effect-nyan-narrow.png');
    console.log(`   細いタブ: ${JSON.stringify(narrow)}`);

    // ---- タブが増えたときのスクロール(横タブ)----
    // 潰さずに読める幅で止め、あふれた分はスクロールで届くこと
    const hScroll = await js(
      wc,
      `(() => {
        const t = document.getElementById('tabs');
        const tabs = [...t.querySelectorAll('.tab')];
        return {
          タブ数: tabs.length,
          最小のタブ幅: Math.round(Math.min(...tabs.map((el) => el.getBoundingClientRect().width))),
          はみ出し量: Math.round(t.scrollWidth - t.clientWidth),
          スクロール位置: Math.round(t.scrollLeft),
        };
      })()`
    );
    checkTrue('タブは読める幅(140px)より細くならない', hScroll.最小のタブ幅 >= 140, hScroll);
    checkTrue('あふれた分はスクロール領域になる', hScroll.はみ出し量 > 0, hScroll);

    // ホイールを縦に回すと横へ流れる(横タブでは既定では効かないので自前で流している)
    const wheelAt = await js(
      wc,
      `(() => { const r = document.getElementById('tabs').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
    );
    wc.sendInputEvent({ type: 'mouseWheel', x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: -120, canScroll: true });
    await sleep(500);
    const afterWheel = await js(wc, `Math.round(document.getElementById('tabs').scrollLeft)`);
    checkTrue('横タブでホイールを回すと横スクロールする', afterWheel > 0, {
      前: hScroll.スクロール位置,
      後: afterWheel,
    });
    await shot(wc, 'tabs-scrolled.png');

    // 末尾のタブを選ぶと、見える位置まで自動で寄る
    const lastTab = ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1];
    ctx.tabManager.switchTab(lastTab.id);
    await sleep(600);
    const activeVisible = await js(
      wc,
      `(() => {
        const t = document.getElementById('tabs');
        const el = t.querySelector('.tab.active');
        if (!el) return null;
        const a = el.getBoundingClientRect();
        const b = t.getBoundingClientRect();
        return { 見えている: a.left >= b.left - 1 && a.right <= b.right + 1, スクロール位置: Math.round(t.scrollLeft) };
      })()`
    );
    checkTrue('選んだタブは見える位置へ自動で寄る', activeVisible?.見えている, activeVisible);

    // ---- ドラッグ中に端へ寄せるとタブバーが流れる ----
    // 実OSのドラッグは sendInputEvent では起こせないので、dragover を組み立てて投げる
    // (ハンドラが見るのは dataTransfer.types と clientX/Y だけなので、これで経路は通る)。
    // 自動スクロールは requestAnimationFrame で回すため、ウィンドウが他の窓に完全に隠れて
    // 合成が止まっているとrAFが来ず落ちる(スクショの "display surface not available" と同じ状況)。
    // 落ちたときは失敗詳細の「rAFが動く」を見ること
    const edgeDrag = (x, y) =>
      js(
        wc,
        `(() => {
          const dt = new DataTransfer();
          dt.setData('text/plain', 'テスト');
          document.getElementById('tab-bar').dispatchEvent(
            new DragEvent('dragover', { dataTransfer: dt, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true })
          );
        })()`
      );
    // このウィンドウで requestAnimationFrame が回るか(合成が止まっていると来ない)
    await js(wc, `window.__rafOk = false; requestAnimationFrame(() => { window.__rafOk = true; });`);
    await js(wc, `document.getElementById('tabs').scrollLeft = 0`);
    const edgeAt = await js(
      wc,
      `(() => { const r = document.getElementById('tabs').getBoundingClientRect();
        return { 右端: Math.round(r.right - 8), 左端: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) }; })()`
    );
    await edgeDrag(edgeAt.右端, edgeAt.y);
    await sleep(600);
    const dragDiag = await js(
      wc,
      `(() => ({
        スクロール位置: Math.round(document.getElementById('tabs').scrollLeft),
        スロットが出た: !!document.querySelector('.tab-drop-slot'),
        rAFが動く: window.__rafOk === true,
      }))()`
    );
    const draggedRight = dragDiag.スクロール位置;
    checkTrue('ドラッグで右端に寄せると右へ流れる', draggedRight > 0, dragDiag);

    // 端から離す(バーの外)と止まる
    await js(
      wc,
      `document.getElementById('tab-bar').dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`
    );
    await sleep(400);
    const stopped = await js(wc, `Math.round(document.getElementById('tabs').scrollLeft)`);
    await sleep(400);
    check(
      'ドラッグを離すと流れが止まる',
      await js(wc, `Math.round(document.getElementById('tabs').scrollLeft)`),
      stopped
    );

    // 左端に寄せれば逆向きに戻る
    await edgeDrag(edgeAt.左端, edgeAt.y);
    await sleep(600);
    const draggedLeft = await js(wc, `Math.round(document.getElementById('tabs').scrollLeft)`);
    checkTrue('ドラッグで左端に寄せると左へ戻る', draggedLeft < stopped, { 前: stopped, 後: draggedLeft });
    await js(wc, `document.getElementById('tab-bar').dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`);
    await sleep(300);

    // 手でスクロールした位置は、状態が届いても引き戻されない
    await js(wc, `document.getElementById('tabs').scrollLeft = 0`);
    ctx.tabManager.sendState();
    await sleep(500);
    check(
      '再描画で手動スクロール位置を戻さない',
      await js(wc, `Math.round(document.getElementById('tabs').scrollLeft)`),
      0
    );

    // ---- 縦タブでも同じようにスクロールできる ----
    // レールはウィンドウの高さいっぱいなので、あふれさせるためにウィンドウを低くする
    settings.tabBarPosition = 'left';
    browser.applyTabBarPositionFor(ctx.profileId);
    browser.sendSettingsFor(ctx.profileId);
    ctx.window.setSize(1000, 400);
    await sleep(1200);
    const vScroll = await js(
      wc,
      `(() => {
        const t = document.getElementById('tabs');
        return { はみ出し量: Math.round(t.scrollHeight - t.clientHeight), 位置: Math.round(t.scrollTop) };
      })()`
    );
    checkTrue('縦タブでもあふれた分はスクロール領域になる', vScroll.はみ出し量 > 0, vScroll);
    wc.sendInputEvent({ type: 'mouseWheel', x: 110, y: 300, deltaX: 0, deltaY: -120, canScroll: true });
    await sleep(500);
    const afterVWheel = await js(wc, `Math.round(document.getElementById('tabs').scrollTop)`);
    checkTrue('縦タブでホイールを回すと縦スクロールする', afterVWheel > 0, { 前: vScroll.位置, 後: afterVWheel });

    // 縦タブでもドラッグで端に寄せると流れる(こちらは上下方向)
    await js(wc, `document.getElementById('tabs').scrollTop = 0`);
    const vEdge = await js(
      wc,
      `(() => { const r = document.getElementById('tabs').getBoundingClientRect();
        return { 下端: Math.round(r.bottom - 8), x: Math.round(r.left + r.width / 2) }; })()`
    );
    await js(
      wc,
      `(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'テスト');
        document.getElementById('tab-bar').dispatchEvent(
          new DragEvent('dragover', { dataTransfer: dt, clientX: ${vEdge.x}, clientY: ${vEdge.下端}, bubbles: true, cancelable: true })
        );
      })()`
    );
    await sleep(600);
    const vDragged = await js(wc, `Math.round(document.getElementById('tabs').scrollTop)`);
    checkTrue('縦タブでもドラッグで端に寄せると流れる', vDragged > 0, { スクロール位置: vDragged });
    await js(wc, `document.getElementById('tab-bar').dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`);
    await sleep(300);
    await shot(wc, 'tabs-scrolled-vertical.png');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  } catch (e) {
    console.error('例外:', e);
    failed++;
  } finally {
    app.exit(failed ? 1 : 0);
  }
});

app.on('window-all-closed', () => {});
