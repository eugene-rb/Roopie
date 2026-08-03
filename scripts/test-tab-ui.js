// タブバーまわりのUI検証(再利用可能)。
// 実行: npx electron scripts/test-tab-ui.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、
//   1) アクティブなタブを閉じた/別ウィンドウへ移した後の行き先(設定 activatePreviousTabOnClose)
//   2) ✕の連打中はタブ幅が固定され、1秒後に戻ること
//   3) 音声エフェクト「ニャンキャット」の見た目(縁取り/ボタン配置/ホバー時に猫が消える)
// を確認する。3)はスクショなので目視、1)2)は自己判定。
const { app, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-tabui-'));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

async function shot(wc, name) {
  const image = await wc.capturePage();
  const file = path.join(shotDir, name);
  fs.writeFileSync(file, image.toPNG());
  console.log(`   📸 ${file}`);
}

// 一部だけ切り出して拡大したスクショ(縁取りのような細部の目視用)
async function shotZoom(wc, rect, name, scale = 5) {
  const area = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.w),
    height: Math.round(rect.h),
  };
  const image = await wc.capturePage(area);
  const zoomed = image.resize({ width: area.width * scale, quality: 'best' });
  const file = path.join(shotDir, name);
  fs.writeFileSync(file, zoomed.toPNG());
  console.log(`   🔍 ${file}`);
}

// :hover を効かせるには mouseEnter → mouseMove の順で送る(mouseMoveだけだと入らない)
function moveTo(wc, x, y) {
  const at = { x: Math.round(x), y: Math.round(y) };
  wc.sendInputEvent({ type: 'mouseEnter', ...at });
  wc.sendInputEvent({ type: 'mouseMove', ...at });
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

// n番目のタブの矩形(タブバーのwebContentsローカル座標)
const rectOf = (wc, selector) =>
  js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`
  );

const tabWidth = async (wc) => Math.round((await rectOf(wc, '#tabs .tab'))?.w ?? 0);

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    const wc = ctx.window.webContents;
    // タブを並べる場所を広く取る(狭いと min-width(140px)に当たり、
    // 閉じても広がらないので幅固定の検証ができない)
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    ctx.window.setBounds({ x: 0, y: 0, width: sw, height: sh });
    ctx.window.show();
    ctx.window.focus();
    await sleep(2500);

    // 位置指定の検証用に12枚まで増やす(このあと数枚閉じる)
    while (tm.tabs.length < 12) {
      tm.createTab();
      await sleep(200);
    }
    await shot(wc, 'tabs-start.png');

    // ---- 1) 閉じた後の行き先 ----
    const ids = () => tm.tabs.map((t) => t.id);
    let list = ids();
    tm.switchTab(list[1]);
    tm.switchTab(list[5]);
    tm.closeTab(list[5]);
    check('既定(OFF): 閉じたら同じ位置のタブへ', tm.activeTabId, list[6]);

    tm.setActivatePreviousTab(true);
    list = ids();
    tm.switchTab(list[2]);
    tm.switchTab(list[7]);
    tm.closeTab(list[7]);
    check('ON: 閉じたら直前にアクティブだったタブへ', tm.activeTabId, list[2]);

    // 直前のタブが既に無い場合は、さらに前へさかのぼる
    list = ids();
    tm.switchTab(list[0]);
    tm.switchTab(list[3]);
    tm.switchTab(list[4]);
    tm.closeTab(list[3]); // 履歴の先頭(=直前)を裏で閉じる
    tm.closeTab(list[4]); // アクティブを閉じる → list[3]はもう無いのでlist[0]へ
    check('ON: 直前のタブが既に閉じていたらその前へ', tm.activeTabId, list[0]);

    // D&Dで別ウィンドウへ移す経路(releaseTab)でも同じ行き先になる
    list = ids();
    tm.switchTab(list[1]);
    tm.switchTab(list[5]);
    const released = tm.releaseTab(list[5]);
    check('ON: 別ウィンドウへ移した後も直前のタブへ', tm.activeTabId, list[1]);
    if (released) tm.adoptTab(released); // 後始末(このウィンドウへ戻す)
    await sleep(300);

    tm.setActivatePreviousTab(false);

    // ---- 2) ✕の連打中はタブ幅を固定する ----
    // 「縮んでいるが min-width(140px)には当たっていない」状態を作る
    while (tm.tabs.length > 3 && (await tabWidth(wc)) < 145) {
      tm.closeTab(tm.tabs[tm.tabs.length - 1].id);
      await sleep(200);
    }
    while (tm.tabs.length < 20 && (await tabWidth(wc)) > 195) {
      tm.createTab();
      await sleep(200);
    }
    const shrunk = await tabWidth(wc);
    check('タブが縮んでいる(検証の前提)', shrunk < 200 && shrunk > 140, true);

    const before = await tabWidth(wc);
    const tabRect = await rectOf(wc, '#tabs .tab');
    // ホバーで✕を出す。1回だけだと座標が変わらず無視されることがあるので2回送る
    moveTo(wc, tabRect.x + 4, tabRect.y + 4);
    moveTo(wc, tabRect.x + tabRect.w / 2, tabRect.y + tabRect.h / 2);
    await sleep(200);
    const hovered = await js(wc, `!!document.querySelector('#tabs .tab:hover')`);
    console.log(`   (デバッグ)タブが:hover状態か: ${hovered}`);
    const closeRect = await rectOf(wc, '#tabs .tab .close-btn');
    check('ホバーで✕が出る', closeRect?.w > 0, true);
    clickAt(wc, closeRect.x + closeRect.w / 2, closeRect.y + closeRect.h / 2);
    await sleep(300);
    const locked = await tabWidth(wc);
    check('✕の直後はタブ幅が変わらない', locked, before);
    check('固定中はwidth-lockedが付く', await js(wc, `document.getElementById('tabs').classList.contains('width-locked')`), true);

    await sleep(1200);
    const released2 = await tabWidth(wc);
    check('1秒後に固定が外れる', await js(wc, `document.getElementById('tabs').classList.contains('width-locked')`), false);
    check('1秒後はタブ幅が広がる', released2 > locked, true);

    // ---- 3) ニャンキャットの見た目 ----
    // 実際に音を鳴らすタブは用意できないので、タブバー側の状態だけ音声再生中に見せる
    const faked = await js(
      wc,
      `(() => {
        try {
          document.body.dataset.audioEffect = 'nyan';
          tabState.tabs.forEach((t) => { t.isAudible = true; t.isMuted = false; });
          mediaList = tabState.tabs.map((t) => ({ tabId: t.id, playing: true }));
          renderTabs();
          return document.querySelectorAll('#tabs .tab.audible').length;
        } catch (e) { return String(e); }
      })()`
    );
    check('音声再生中の見た目に差し替えた', typeof faked === 'number' && faked > 0, true);
    if (typeof faked !== 'number') console.log(`   差し替え失敗: ${faked}`);
    await sleep(600);
    await shot(wc, 'nyan-tabs.png');
    const nyanRect = await rectOf(wc, '#tabs .tab');
    await shotZoom(wc, nyanRect, 'nyan-tab-zoom.png');

    // ホバー中は猫が消えて✕が本来の位置に出る
    moveTo(wc, nyanRect.x + nyanRect.w / 2, nyanRect.y + nyanRect.h / 2);
    await sleep(400);
    check('ホバー中は猫を消す', await js(wc, `!!document.querySelector('#tabs .tab.audible:hover')`), true);
    await shotZoom(wc, nyanRect, 'nyan-tab-hover-zoom.png');

    // 設定画面のプレビューは同じ .tab を使うが✕が無いので、ホバーしても猫は消さない
    // (猫を見に来た画面で猫が消えないこと。ここでは同じ作りの箱を仮に置いて確かめる)
    const previewRect = await js(
      wc,
      `(() => {
        const box = document.createElement('div');
        box.id = 'fx-preview-probe';
        box.style.cssText = 'position:fixed;left:8px;top:200px;width:220px;background:#16181d;z-index:9999';
        box.innerHTML =
          '<div class="tab active audible fx-nyan"><span class="favicon-letter">♪</span>' +
          '<span class="title">プレビュー</span><span class="tab-fx" data-effect="nyan"></span></div>';
        document.body.appendChild(box);
        const r = box.querySelector('.tab').getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      })()`
    );
    // ホバーは座標が変わらないと乗らないことがあるので、少し動かしてから中心へ寄せる
    moveTo(wc, previewRect.x + 4, previewRect.y + 4);
    await sleep(120);
    moveTo(wc, previewRect.x + previewRect.w / 2, previewRect.y + previewRect.h / 2);
    await sleep(400);
    const previewCat = await js(
      wc,
      `(() => {
        const fx = document.querySelector('#fx-preview-probe .tab .tab-fx');
        return { hover: !!document.querySelector('#fx-preview-probe .tab:hover'), 猫: getComputedStyle(fx, '::after').content };
      })()`
    );
    check('タブバー以外(プレビュー)はホバーしても猫が消えない', [previewCat.hover, previewCat.猫 !== 'none'], [true, true]);
    await js(wc, `document.getElementById('fx-preview-probe').remove()`);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
