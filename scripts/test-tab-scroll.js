// タブがあふれたときの見せ方の検証(再利用可能)。
// 実行: npx electron scripts/test-tab-scroll.js [スクショ保存先dir]
//
// 一時userDataで本物のウィンドウを開き、タブを増やして
//   1) 設定「タブの最小幅」(tabMinWidth)が実際のタブ幅と挿入スロットに効くこと
//   2) あふれている側の端がフェードすること(#tabs の fade-start / fade-end)
//   3) アクティブなタブはスクロールしても隠れないこと(sticky + .pinned)
//   4) 新しいタブを開くと、そのタブが見える位置までスクロールすること
// を確認する。見た目はスクショではなく getBoundingClientRect() の実測で判定する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-tabscroll-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
function checkThat(name, ok, detail) {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// タブバー(1段目)の状態。位置はスクロール座標系(張り付きの影響を除いた本来の位置)で測る
const barState = (wc) =>
  js(
    wc,
    `(() => {
       const bar = document.getElementById('tabs');
       const barRect = bar.getBoundingClientRect();
       const raw = (el) => {
         bar.classList.add('measure-raw');
         const r = el.getBoundingClientRect();
         bar.classList.remove('measure-raw');
         return { left: r.left - barRect.left + bar.scrollLeft, width: r.width };
       };
       const tabs = [...bar.querySelectorAll(':scope > .tab')].map((el) => ({
         id: el.dataset.id,
         active: el.classList.contains('active'),
         pinned: el.classList.contains('pinned'),
         sticky: getComputedStyle(el).position === 'sticky',
         ...raw(el),
         // 見た目の位置(張り付いていれば本来の位置とずれる)
         viewLeft: Math.round(el.getBoundingClientRect().left - barRect.left),
       }));
       // 押せる状態の送りボタンか(hidden=場所ごと消えている / off=場所は空いているが押せない)
       const arrow = (id) => {
         const el = document.getElementById(id);
         return !el.classList.contains('hidden') && !el.classList.contains('off');
       };
       return {
         arrows: { left: arrow('tabs-scroll-left'), right: arrow('tabs-scroll-right') },
         scrollLeft: Math.round(bar.scrollLeft),
         clientWidth: Math.round(bar.clientWidth),
         scrollWidth: Math.round(bar.scrollWidth),
         fadeStart: bar.classList.contains('fade-start'),
         fadeEnd: bar.classList.contains('fade-end'),
         mask: getComputedStyle(bar).webkitMaskImage,
         minWidth: getComputedStyle(bar.querySelector(':scope > .tab')).minWidth,
         tabs,
       };
     })()`
  );

const setSetting = (ctx, key, value) => {
  const bundle = browser.bundleFor(ctx.profileId);
  bundle.settings.data[key] = value;
  bundle.settings.save();
  browser.sendSettingsFor(ctx.profileId);
};

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const uiWc = ctx.window.webContents;
    ctx.window.setBounds({ x: 40, y: 40, width: 1000, height: 700 });
    await sleep(2200);

    // ---- 1) 最小幅の設定 ----
    check('既定の最小幅は140px', (await barState(uiWc)).minWidth, '140px');
    setSetting(ctx, 'tabMinWidth', 72);
    await sleep(600);
    check('設定した最小幅がタブに効く', (await barState(uiWc)).minWidth, '72px');
    check(
      '挿入スロットの最小幅も揃う(ドロップ位置がずれないため)',
      await js(
        uiWc,
        `(() => {
           const slot = document.createElement('div');
           slot.className = 'tab-drop-slot open';
           document.getElementById('tabs').appendChild(slot);
           const v = getComputedStyle(slot).minWidth;
           slot.remove();
           return v;
         })()`
      ),
      '72px'
    );

    // 最小幅を小さくすると、同じ幅のバーに入るタブが増える(=あふれ始めるのが遅くなる)
    for (let i = 0; i < 8; i++) ctx.tabManager.createTab('roopie://newtab', { background: true });
    await sleep(1200);
    const narrow = await barState(uiWc);
    checkThat('72pxならまだあふれない(9枚)', narrow.scrollWidth - narrow.clientWidth <= 1, narrow);
    check('フェードも出ない', [narrow.fadeStart, narrow.fadeEnd], [false, false]);

    setSetting(ctx, 'tabMinWidth', 180);
    await sleep(700);
    const wide = await barState(uiWc);
    checkThat('180pxにすると同じ枚数であふれる', wide.scrollWidth - wide.clientWidth > 1, wide);
    checkThat('タブは最小幅まで縮んでいる', Math.round(wide.tabs[0].width) >= 180, wide.tabs[0]);

    // ---- 2) あふれている側だけフェードする ----
    // 先頭にいる = 右にだけ続きがある
    await js(uiWc, `document.getElementById('tabs').scrollLeft = 0`);
    await sleep(400);
    const atStart = await barState(uiWc);
    check('左端では右だけフェードする', [atStart.fadeStart, atStart.fadeEnd], [false, true]);
    checkThat('マスクが当たっている', atStart.mask.includes('linear-gradient'), atStart.mask);
    check('続きがある側にだけ送りボタンを出す', atStart.arrows, { left: false, right: true });

    // 送りボタンで実際に送れる
    await js(uiWc, `document.getElementById('tabs-scroll-right').click()`);
    await sleep(900);
    const scrolled = await barState(uiWc);
    checkThat('送りボタンで右へ進む', scrolled.scrollLeft > atStart.scrollLeft, {
      before: atStart.scrollLeft,
      after: scrolled.scrollLeft,
    });
    check('進んだら戻る側のボタンも出る', scrolled.arrows.left, true);

    // 真ん中まで送る = 両側に続きがある(アクティブなタブは端から離れた位置にしておく)
    ctx.tabManager.switchTab(ctx.tabManager.tabs[4].id);
    await sleep(600);
    const middle = await js(
      uiWc,
      `(() => {
         const bar = document.getElementById('tabs');
         bar.scrollLeft = Math.round((bar.scrollWidth - bar.clientWidth) / 2);
         return bar.scrollLeft;
       })()`
    );
    await sleep(400);
    const mid = await barState(uiWc);
    checkThat('途中では両側フェードする', mid.fadeStart && mid.fadeEnd, { mid, middle });

    // 右端まで送る = 左にだけ続きがある(アクティブなタブが右端側にいて張り付かない状態で見る)
    ctx.tabManager.switchTab(ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].id);
    await sleep(700);
    await js(uiWc, `(() => { const b = document.getElementById('tabs'); b.scrollLeft = b.scrollWidth; return b.scrollLeft; })()`);
    await sleep(400);
    const atEnd = await barState(uiWc);
    console.log('   右端の状態:', JSON.stringify({ ...atEnd, tabs: atEnd.tabs.filter((t) => t.active) }));
    check('右端では左だけフェードする', [atEnd.fadeStart, atEnd.fadeEnd], [true, false]);
    check('端にいるアクティブなタブは張り付き扱いにしない', atEnd.tabs.find((t) => t.active)?.pinned, false);

    // アクティブなタブが端に張り付いている側は、フェードの代わりにそのタブを見せる
    // (フェードを掛けると張り付いたタブ自身が薄くなってしまう)
    ctx.tabManager.switchTab(ctx.tabManager.tabs[4].id);
    await sleep(700);
    await js(uiWc, `(() => { const b = document.getElementById('tabs'); b.scrollLeft = b.scrollWidth; return b.scrollLeft; })()`);
    await sleep(400);
    const pinnedSide = await barState(uiWc);
    check('張り付いている側はフェードしない', [pinnedSide.fadeStart, pinnedSide.fadeEnd], [false, false]);
    check('代わりにそのタブが張り付いて見えている', pinnedSide.tabs.find((t) => t.active)?.pinned, true);

    // ---- 3) アクティブなタブは隠れない ----
    // 先頭のタブを選び、右端までスクロールしても見えていること
    ctx.tabManager.switchTab(ctx.tabManager.tabs[0].id);
    await sleep(700);
    await js(uiWc, `(() => { const b = document.getElementById('tabs'); b.scrollLeft = b.scrollWidth; return b.scrollLeft; })()`);
    await sleep(500);
    const pinnedState = await barState(uiWc);
    const activeTab = pinnedState.tabs.find((t) => t.active);
    checkThat('アクティブなタブはstickyで配置されている', activeTab.sticky, activeTab);
    checkThat(
      '本来の位置は見える範囲の外(=隠れるはずだった)',
      activeTab.left < pinnedState.scrollLeft,
      { left: activeTab.left, scrollLeft: pinnedState.scrollLeft }
    );
    checkThat(
      'それでも左端に張り付いて見えている',
      activeTab.viewLeft >= 0 && activeTab.viewLeft <= 2,
      activeTab
    );
    check('張り付いている間は .pinned が付く', activeTab.pinned, true);
    checkThat(
      '張り付いた側はフェードしない(薄くならない)',
      pinnedState.fadeStart === false,
      pinnedState
    );
    checkThat(
      '張り付いたタブは不透明で描かれる(下のタブが透けない)',
      await js(
        uiWc,
        `(() => {
           const el = document.querySelector('#tabs > .tab.pinned');
           return el ? getComputedStyle(el).backgroundImage.includes('linear-gradient') : '張り付いたタブが無い';
         })()`
      ),
      true
    );
    await shot(uiWc, 'tab-scroll-pinned.png');

    // 逆向き: 最後のタブを選んで左端まで戻しても見えている
    ctx.tabManager.switchTab(ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].id);
    await sleep(700);
    await js(uiWc, `document.getElementById('tabs').scrollLeft = 0`);
    await sleep(500);
    const pinnedRight = await barState(uiWc);
    const lastActive = pinnedRight.tabs.find((t) => t.active);
    checkThat(
      '右端側でも張り付いて見えている',
      lastActive.pinned && lastActive.viewLeft + lastActive.width <= pinnedRight.clientWidth + 2,
      { lastActive, clientWidth: pinnedRight.clientWidth }
    );

    // ---- 4) 新しいタブは見える位置まで送る ----
    // 左端まで戻したうえで、末尾に裏タブを1枚足す(アクティブは変わらない)
    ctx.tabManager.switchTab(ctx.tabManager.tabs[0].id);
    await sleep(600);
    await js(uiWc, `document.getElementById('tabs').scrollLeft = 0`);
    await sleep(400);
    const before = await barState(uiWc);
    const newTab = ctx.tabManager.createTab('roopie://newtab', { background: true });
    await sleep(1500); // スムーススクロールの分だけ待つ
    const after = await barState(uiWc);
    const added = after.tabs.find((t) => t.id === String(newTab.id));
    console.log(
      '   新しいタブ追加の前後:',
      JSON.stringify({
        before: { scrollLeft: before.scrollLeft, clientWidth: before.clientWidth, scrollWidth: before.scrollWidth, arrows: before.arrows },
        after: { scrollLeft: after.scrollLeft, clientWidth: after.clientWidth, scrollWidth: after.scrollWidth, arrows: after.arrows },
        max: after.scrollWidth - after.clientWidth,
      })
    );
    checkThat('新しいタブが末尾に増えている', !!added, after.tabs.map((t) => t.id));
    checkThat('その1枚が見える位置までスクロールする', after.scrollLeft > before.scrollLeft, {
      before: before.scrollLeft,
      after: after.scrollLeft,
    });
    checkThat(
      '新しいタブは見える範囲に収まっている',
      added.left >= after.scrollLeft - 2 &&
        added.left + added.width <= after.scrollLeft + after.clientWidth + 2,
      { added, after: { scrollLeft: after.scrollLeft, clientWidth: after.clientWidth } }
    );
    checkThat(
      '裏で開いてもアクティブなタブは張り付いて見えたまま',
      after.tabs.find((t) => t.active)?.pinned === true,
      after.tabs.find((t) => t.active)
    );
    await shot(uiWc, 'tab-scroll-newtab.png');

    // ---- 5) 縦タブでも同じように効く(フェードは上下方向) ----
    setSetting(ctx, 'tabBarPosition', 'left');
    browser.applyTabBarPositionFor(ctx.profileId);
    await sleep(1200);
    // レールに入りきらない枚数まで増やす
    while (ctx.tabManager.tabs.length < 24) ctx.tabManager.createTab('roopie://newtab', { background: true });
    await sleep(2500);
    // ① 末尾のタブを選んで下端へ = 上にだけ続きがある(張り付きは起きない状態)
    ctx.tabManager.switchTab(ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].id);
    await sleep(900);
    await js(uiWc, `(() => { const b = document.getElementById('tabs'); b.scrollTop = b.scrollHeight; return b.scrollTop; })()`);
    await sleep(500);
    const verticalFade = await js(
      uiWc,
      `(() => {
         const bar = document.getElementById('tabs');
         return {
           fadeStart: bar.classList.contains('fade-start'),
           fadeEnd: bar.classList.contains('fade-end'),
           mask: getComputedStyle(bar).webkitMaskImage,
         };
       })()`
    );
    console.log('   縦タブ(下端)の状態:', JSON.stringify(verticalFade));
    check('縦タブでも下端では上だけフェードする', [verticalFade.fadeStart, verticalFade.fadeEnd], [true, false]);
    // 上下方向のグラデーションは既定の向きなので、計算値に "to bottom" は現れない
    checkThat(
      '縦タブでは上下方向にフェードする(横方向ではない)',
      verticalFade.mask.includes('linear-gradient') && !verticalFade.mask.includes('to right'),
      verticalFade.mask
    );

    // ② 先頭のタブを選んで下端へ = 上に張り付いて見えたまま
    ctx.tabManager.switchTab(ctx.tabManager.tabs[0].id);
    await sleep(800);
    await js(uiWc, `(() => { const b = document.getElementById('tabs'); b.scrollTop = b.scrollHeight; return b.scrollTop; })()`);
    await sleep(500);
    const verticalState = await js(
      uiWc,
      `(() => {
         const bar = document.getElementById('tabs');
         const barRect = bar.getBoundingClientRect();
         const active = bar.querySelector(':scope > .tab.active');
         const rect = active.getBoundingClientRect();
         return {
           fadeStart: bar.classList.contains('fade-start'),
           fadeEnd: bar.classList.contains('fade-end'),
           mask: getComputedStyle(bar).webkitMaskImage,
           position: getComputedStyle(active).position,
           pinned: active.classList.contains('pinned'),
           viewTop: Math.round(rect.top - barRect.top),
           barHeight: Math.round(barRect.height),
         };
       })()`
    );
    console.log('   縦タブ(張り付き)の状態:', JSON.stringify(verticalState));
    check('張り付いている側はフェードしない(縦も同じ)', [verticalState.fadeStart, verticalState.fadeEnd], [false, false]);
    check('縦でもアクティブなタブは張り付く', [verticalState.position, verticalState.pinned], ['sticky', true]);
    checkThat(
      '縦でも張り付いて見えている(レールの中に収まる)',
      verticalState.viewTop >= 0 && verticalState.viewTop <= verticalState.barHeight,
      verticalState
    );
    await shot(uiWc, 'tab-scroll-vertical.png');
    setSetting(ctx, 'tabBarPosition', 'top');
    browser.applyTabBarPositionFor(ctx.profileId);
    await sleep(1000);

    // ---- 6) あふれていない状態に戻ればフェードも張り付きも消える ----
    setSetting(ctx, 'tabMinWidth', 56);
    await sleep(800);
    while (ctx.tabManager.tabs.length > 2) ctx.tabManager.closeTab(ctx.tabManager.tabs[ctx.tabManager.tabs.length - 1].id);
    await sleep(1500);
    const calm = await barState(uiWc);
    check('あふれなければフェードしない', [calm.fadeStart, calm.fadeEnd], [false, false]);
    check('あふれなければ張り付きの印も付かない', calm.tabs.some((t) => t.pinned), false);
    check('あふれなければ送りボタンも出ない', calm.arrows, { left: false, right: false });

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

// 初回は UnknownVizError になることがあるので数回試す(検証本体には影響しない)
async function shot(wc, name) {
  for (let i = 0; i < 4; i++) {
    try {
      const image = await wc.capturePage();
      fs.writeFileSync(path.join(shotDir, name), image.toPNG());
      console.log(`   📸 ${path.join(shotDir, name)}`);
      return;
    } catch (err) {
      if (i === 3) console.log(`   (スクショ失敗: ${name} ${err.message})`);
      await sleep(400);
    }
  }
}

app.on('window-all-closed', () => {});
