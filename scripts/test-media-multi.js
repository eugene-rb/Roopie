// メディアプレイヤーが複数タブを独立して扱えることの検証(再利用可能)。
// 実行: npx electron scripts/test-media-multi.js [スクショ保存先dir]
// 一時userDataで本物のウィンドウを開き、2つのタブそれぞれの再生報告をシミュレートして、
// サイドパネルの「再生中」カードとフローティングパネルの行が独立して動くことを確認する。
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
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
const fakeFrame = () => ({ isDestroyed: () => false });

async function shot(wc, name) {
  try {
    const image = await wc.capturePage();
    fs.writeFileSync(path.join(shotDir, name), image.toPNG());
    console.log(`   📸 ${path.join(shotDir, name)}`);
  } catch (err) {
    console.log(`   (スクショ失敗・無視: ${name} => ${err.message})`);
  }
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    for (let i = 0; i < 30 && tm.activeTabId === null; i++) await sleep(200);
    await sleep(300);
    const silentTabId = tm.activeTabId;

    // 2つのバックグラウンドタブを作り、それぞれ独立に「再生中」を報告させる
    const tabA = tm.createTab('data:text/html,<title>mediaA</title>', { background: true });
    const tabB = tm.createTab('data:text/html,<title>mediaB</title>', { background: true });
    await sleep(300);

    tm.onMediaReport(tabA.id, { title: '曲A', artist: 'アーティストA', playing: true, duration: 120, currentTime: 10, canPrev: false, canNext: false, hasVideo: false }, fakeFrame());
    tm.onMediaReport(tabB.id, { title: '曲B', artist: 'アーティストB', playing: false, duration: 200, currentTime: 30, canPrev: false, canNext: false, hasVideo: false }, fakeFrame());
    await sleep(200);

    check('2タブぶんの再生状態が独立して一覧に乗る', ctx.mediaList.length, 2);
    check('Aは再生中', ctx.mediaList.find((m) => m.tabId === tabA.id)?.playing, true);
    check('Bは一時停止中', ctx.mediaList.find((m) => m.tabId === tabB.id)?.playing, false);
    check('どちらも既定ではミュートされていない', ctx.mediaList.every((m) => !m.muted), true);

    // ---- サイドパネルの「再生中」セクションに2枚のカードが独立して出る ----
    ctx.sidePanel.setOpen(true);
    ctx.sidePanel.openSection('now-playing');
    await sleep(400);
    const panelWc = ctx.sidePanel.panelView.webContents;
    const titles = await js(panelWc, `[...document.querySelectorAll('.now-playing-title')].map((el) => el.textContent)`);
    check('サイドパネルに2枚のカードが表示される(タブA/B)', titles.sort(), ['曲A', '曲B'].sort());
    await shot(panelWc, 'now-playing-two-cards.png');

    // Aのカードだけミュートにする → Bには影響しない
    const cardAMuteExists = await js(
      panelWc,
      `(() => {
        const card = [...document.querySelectorAll('.now-playing-card')].find((c) => c.querySelector('.now-playing-title')?.textContent === '曲A');
        return !!card?.querySelector('.now-playing-mute');
      })()`
    );
    check('Aのカードにミュートボタンがある', cardAMuteExists, true);

    // Aのミュートボタン座標を取ってクリックする
    const muteAPos = await js(
      panelWc,
      `(() => {
        const card = [...document.querySelectorAll('.now-playing-card')].find((c) => c.querySelector('.now-playing-title')?.textContent === '曲A');
        const btn = card?.querySelector('.now-playing-mute');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`
    );
    if (muteAPos) clickAt(panelWc, muteAPos.x, muteAPos.y);
    await sleep(300);
    check('Aだけミュートされる', tm.getTab(tabA.id)?.view.webContents.isAudioMuted(), true);
    check('Bはミュートされない', tm.getTab(tabB.id)?.view.webContents.isAudioMuted(), false);
    check('mediaListにもAのmuted:trueが反映される', ctx.mediaList.find((m) => m.tabId === tabA.id)?.muted, true);

    // ---- フローティングパネル: docked=falseの行だけ独立して並ぶ ----
    ctx.sidePanel.setOpen(false);
    await sleep(600);
    check('フローティングパネルが表示される', ctx.mediaPlayer.view?.getVisible(), true);
    const floatWc = ctx.mediaPlayer.view.webContents;
    const floatTitles = await js(floatWc, `[...document.querySelectorAll('.player-row-title')].map((el) => el.textContent)`);
    check('フローティング側にも2行(A/B)が独立して出る', floatTitles.sort(), ['曲A', '曲B'].sort());
    await shot(floatWc, 'mediaplayer-two-rows.png');

    // Aのタブをアクティブにする → ページ上で直接操作できるためAの行だけフローティングから消える
    tm.switchTab(tabA.id);
    await sleep(400);
    const floatTitlesWhileAActive = await js(floatWc, `[...document.querySelectorAll('.player-row-title')].map((el) => el.textContent)`);
    check('再生中のタブがアクティブな間はその行だけ消える(Bのみ表示)', floatTitlesWhileAActive, ['曲B']);
    tm.switchTab(silentTabId); // 元の無音タブへ戻す
    await sleep(400);

    // Bだけ「フローティング表示をやめる」→ フローティングにはAだけ残る(Bはサイドパネルのみ)
    // (activeSectionは既に'now-playing'のまま。openSection()の再呼び出しは折りたたみ動作なので呼ばない)
    ctx.sidePanel.setOpen(true);
    await sleep(400);
    const dockToggleBPos = await js(
      panelWc,
      `(() => {
        const card = [...document.querySelectorAll('.now-playing-card')].find((c) => c.querySelector('.now-playing-title')?.textContent === '曲B');
        const label = card?.querySelector('label.switch'); // 実際のinputはopacity:0のクリック不可要素なのでlabelを狙う
        if (!label) return null;
        const r = label.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`
    );
    if (dockToggleBPos) clickAt(panelWc, dockToggleBPos.x, dockToggleBPos.y);
    await sleep(300);
    check('Bだけdocked=trueになる(Aはfalseのまま)', ctx.mediaList.find((m) => m.tabId === tabB.id)?.docked, true);
    check('Aはdocked=falseのまま(Bの変更に影響されない)', ctx.mediaList.find((m) => m.tabId === tabA.id)?.docked, false);

    ctx.sidePanel.setOpen(false);
    await sleep(600);
    const floatTitlesAfter = await js(floatWc, `[...document.querySelectorAll('.player-row-title')].map((el) => el.textContent)`);
    check('フローティング側はAのみ(Bはサイドパネルのみに)', floatTitlesAfter, ['曲A']);
    await shot(floatWc, 'mediaplayer-one-row-after-dock.png');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
