// ウィンドウとタブの関係まわりの検証(再利用可能)。
// 実行: npx electron scripts/test-window-tabs.js
//
// 1. ショートカット/マウスジェスチャーで開いたタブがアクティブタブのすぐ右に入る
//    (「+」ボタンやリンクからのタブは今まで通り末尾)
// 2. 別ウィンドウで閉じたタブも「閉じたタブを再度開く」で戻せる(プロファイル単位で共有。
//    シークレットのタブは通常ウィンドウへ持ち出さない)
// 3. 2枚目以降のウィンドウを閉じたら、タブ・Webパネル・フローティング表示の
//    webContentsがすべて破棄されて音が止まる
const { app, ipcMain, screen } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 8945;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-ui-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// 初期タブは index.html の did-finish-load 後に非同期で作られる
async function waitForActive(tm, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs && tm.activeTabId === null) await sleep(200);
}

async function waitFor(fn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(200);
  }
  return false;
}

const indexOf = (tm, id) => tm.tabs.findIndex((t) => t.id === id);

// AudioContextのautoplay制限を避けるため、先に信頼済みクリックでユーザー操作扱いにしてから鳴らす
async function startTone(wc) {
  wc.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 });
  await sleep(100);
  await js(
    wc,
    `(() => {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      const osc = c.createOscillator();
      osc.frequency.value = 440;
      osc.connect(c.destination);
      osc.start();
      return c.state;
    })()`
  );
  return waitFor(() => wc.isCurrentlyAudible());
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    // ホイールクリックのリンク先が data: URL だと、Chromiumが新しいウィンドウを作る前に
    // 弾いてしまう(トップフレームのdata:遷移は禁止)。実ページをローカルで配信する。
    // 後半のWebパネルのテストでも同じサーバーを使う
    const server = http
      .createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        if (req.url === '/links') {
          res.end(
            '<!doctype html><meta charset="utf-8"><title>リンク元</title>' +
              '<a id="l1" href="/other1" target="_blank" style="position:absolute;left:20px;top:20px">link1</a>' +
              '<a id="l2" href="/other2" target="_blank" style="position:absolute;left:20px;top:90px">link2</a>'
          );
          return;
        }
        res.end('<!doctype html><meta charset="utf-8"><title>リンク先</title>本文');
      })
      .listen(PORT);

    // ---- 1. 新しいタブの位置 ----
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    await waitForActive(tm);

    const first = tm.activeTabId;
    const a = tm.createTab('data:text/html,<title>a</title>');
    const b = tm.createTab('data:text/html,<title>b</title>');
    await sleep(200);
    check('通常のcreateTabは末尾に足す', indexOf(tm, b.id), tm.tabs.length - 1);

    tm.switchTab(a.id); // 真ん中(先頭タブ, a, b の a)を選ぶ
    await sleep(200);
    const near = tm.createTab('data:text/html,<title>near</title>', { nearActive: true });
    check('nearActiveはアクティブタブのすぐ右に入る', indexOf(tm, near.id), indexOf(tm, a.id) + 1);
    check('bはその後ろへ押し出される', indexOf(tm, b.id), indexOf(tm, near.id) + 1);

    // ジェスチャー(gestures:perform)の配線ごと確認する。送信元はタブのwebContents
    tm.switchTab(a.id);
    await sleep(200);
    const aIndex = indexOf(tm, a.id);
    const before = tm.tabs.length;
    ipcMain.emit('gestures:perform', { sender: a.view.webContents }, 'newTab');
    await sleep(300);
    check('ジェスチャーでタブが1枚増える', tm.tabs.length, before + 1);
    check('ジェスチャーの新しいタブもアクティブタブの右', indexOf(tm, tm.activeTabId), aIndex + 1);

    // リンクから開いたタブ(ホイールクリック/Ctrl+クリック/target=_blank)はリンク元タブの
    // すぐ右へ。どれも同じ setWindowOpenHandler を通るので、ここでは target=_blank の
    // クリックで並び順を確認する(このハーネスはchrome UI付きのウィンドウで
    // sendInputEventが届かないため。実際のホイールクリックでの位置は test-background-tab.js)
    tm.switchTab(a.id);
    await sleep(200);
    const linkTab = tm.createTab(`http://localhost:${PORT}/links`);
    await Promise.race([new Promise((r) => linkTab.view.webContents.once('did-finish-load', r)), sleep(8000)]);
    await sleep(300);
    const linkIndex = indexOf(tm, linkTab.id);
    const clickLink = (id) => js(linkTab.view.webContents, `document.getElementById('${id}').click()`);

    await clickLink('l1');
    await sleep(400);
    const child1 = tm.tabs[linkIndex + 1];
    check('リンクから開いたタブはリンク元のすぐ右', child1?.openerTabId, linkTab.id);

    // 続けて開いた2枚目は1枚目の後ろ(開いた順に並ぶ)
    await clickLink('l2');
    await sleep(400);
    check('続けて開いた2枚目は1枚目を押し戻さない', indexOf(tm, child1.id), linkIndex + 1);
    check('2枚目はその後ろに入る', tm.tabs[linkIndex + 2]?.openerTabId, linkTab.id);

    // リンク元が非アクティブでも、位置はリンク元基準(アクティブなタブ基準にしない)
    tm.switchTab(first);
    await sleep(200);
    await clickLink('l1');
    await sleep(400);
    check('リンク元が非アクティブでもリンク元の右に入る', tm.tabs[linkIndex + 3]?.openerTabId, linkTab.id);
    check('アクティブなタブの隣には入らない', indexOf(tm, first), 0);

    // 「+」ボタン(tabs:new)は末尾のまま(Vivaldi挙動)
    tm.switchTab(a.id);
    await sleep(200);
    ipcMain.emit('tabs:new', { sender: ctx.window.webContents }, undefined, false);
    await sleep(300);
    check('「+」ボタンのタブは末尾に足す', indexOf(tm, tm.activeTabId), tm.tabs.length - 1);
    check('先頭タブは動いていない', indexOf(tm, first), 0);

    // ---- 2. 閉じたタブの復元をウィンドウ間で共有 ----
    const ctx2 = browser.createWindow();
    const tm2 = ctx2.tabManager;
    await waitForActive(tm2);

    const victim = tm2.createTab('data:text/html,<title>victim</title>');
    await sleep(300);
    const victimUrl = victim.view.webContents.getURL();
    tm2.closeTab(victim.id);
    await sleep(200);
    check('閉じたタブは同じプロファイルの共有リストに載る', tm.closedTabs.at(-1)?.url, victimUrl);

    const restored = tm.reopenClosedTab(); // 別ウィンドウ(1枚目)から戻す
    await sleep(300);
    check('別ウィンドウで閉じたタブを復元できる', restored?.view.webContents.getURL(), victimUrl);
    check('復元したタブは復元した側のウィンドウに入る', indexOf(tm, restored.id) >= 0, true);
    check('復元後は履歴から消える', tm.closedTabs.some((e) => e.url === victimUrl), false);

    // 別プロファイルとも共有しない(履歴はプロファイル単位)
    const p2 = browser.profiles.create('検証用');
    const other = browser.createWindow({ profileId: p2.id });
    await waitForActive(other.tabManager);
    const otherTab = other.tabManager.createTab('data:text/html,<title>別プロファイル</title>');
    await sleep(300);
    const otherUrl = otherTab.view.webContents.getURL();
    other.tabManager.closeTab(otherTab.id);
    await sleep(200);
    check('別プロファイルで閉じたタブは混ざらない', tm.closedTabs.some((e) => e.url === otherUrl), false);
    check('別プロファイル側では戻せる', other.tabManager.closedTabs.at(-1)?.url, otherUrl);
    other.window.close();
    await waitFor(() => other.window.isDestroyed());
    await sleep(300);
    check('別プロファイルのウィンドウの記録も混ざらない', tm.closedTabs.some((e) => e.type === 'window'), false);

    // シークレットは共有しない
    const inc = browser.createWindow({ incognito: true });
    await waitForActive(inc.tabManager);
    const secret = inc.tabManager.createTab('data:text/html,<title>secret</title>');
    await sleep(300);
    const secretUrl = secret.view.webContents.getURL();
    inc.tabManager.closeTab(secret.id);
    await sleep(200);
    check('シークレットで閉じたタブは通常ウィンドウに漏れない', tm.closedTabs.some((e) => e.url === secretUrl), false);
    check('シークレットのウィンドウ内では戻せる', inc.tabManager.closedTabs.at(-1)?.url, secretUrl);
    inc.window.close();
    await sleep(300);

    // ---- 3. ウィンドウを閉じたら音が止まる ----
    const noisy = tm2.createTab('data:text/html,<title>noisy</title>');
    await sleep(400);
    const noisyWc = noisy.view.webContents;
    check('2枚目のウィンドウのタブが実際に鳴っている', await startTone(noisyWc), true);

    // Webパネル(ピン留めしたYouTube等)も音源になる。サイドパネル本体・フローティング表示も
    // ウィンドウ破棄後に残らないことを見る(Viewは表示されて初めて作られる設計)
    ctx2.sidePanel.setOpen(true);
    ctx2.sidePanel.openSection('bookmarks'); // panelView を作る
    ctx2.sidePanel.addWeb(`http://localhost:${PORT}/`); // webView を作って読み込む
    ctx2.mediaPlayer.ensureView();
    ctx2.timerPanel.ensureView();
    await sleep(1200);
    const panelWc = ctx2.sidePanel.panelView?.webContents;
    const webPanelWc = ctx2.sidePanel.webView?.webContents;
    const floatWcs = [ctx2.mediaPlayer.view?.webContents, ctx2.timerPanel.view?.webContents];
    check('サイドパネル本体のViewができている', !!panelWc, true);
    check('WebパネルのViewができている', !!webPanelWc, true);
    check('フローティング表示のViewができている', floatWcs.every(Boolean), true);
    check('Webパネルが実際に鳴っている', await startTone(webPanelWc), true);

    const tabCount = tm2.tabs.length;
    check('閉じる前はタブが残っている', tabCount > 0, true);
    // 新しいタブページは記録の対象外なので、戻ってくるのはそれ以外のタブ
    const restorable = tm2.tabs.filter((t) => {
      const u = tm2.tabUrl(t) || '';
      return u && !u.startsWith('roopie://newtab');
    }).length;
    const tabEntriesBefore = tm.closedTabs.filter((e) => e.type === 'tab').length;
    ctx2.window.close();
    await waitFor(() => ctx2.window.isDestroyed());
    await sleep(500);

    check('ウィンドウを閉じたらタブのwebContentsが破棄される', noisyWc.isDestroyed(), true);
    check('鳴っていたタブが無音になる', noisyWc.isDestroyed() || !noisyWc.isCurrentlyAudible(), true);
    check('TabManagerのタブも空になる', tm2.tabs.length, 0);
    check('WebパネルのwebContentsも破棄される', webPanelWc.isDestroyed(), true);
    check('鳴っていたWebパネルが無音になる', webPanelWc.isDestroyed() || !webPanelWc.isCurrentlyAudible(), true);
    check('サイドパネル本体のwebContentsも破棄される', panelWc.isDestroyed(), true);
    check('フローティング表示のwebContentsも破棄される', floatWcs.every((wc) => wc.isDestroyed()), true);
    server.close();
    check('1枚目のウィンドウは無事', ctx.window.isDestroyed(), false);
    check('1枚目のタブは生きている', tm.tabs.every((t) => !t.view.webContents.isDestroyed()), true);

    // 閉じたウィンドウのタブで「閉じたタブを再度開く」の履歴を埋め尽くさない
    check('ウィンドウごと閉じてもタブ単位の履歴は増えない', tm.closedTabs.filter((e) => e.type === 'tab').length, tabEntriesBefore);

    // ---- 4. ウィンドウ単位の復元 ----
    const last = tm.closedTabs.at(-1);
    check('閉じたウィンドウが1件だけ積まれる', last?.type, 'window');
    check('閉じたウィンドウのタブ構成を覚えている', last?.tabs.length, restorable);
    check('新しいタブページはウィンドウの記録から省く', last?.tabs.every((t) => !!t.url), true);
    check('位置と大きさも覚えている', Number.isFinite(last?.bounds?.width), true);

    const beforeWindows = require('../src/main/windows').all().length;
    const reopened = tm.reopenClosedTab(); // 別ウィンドウ(1枚目)のショートカットから戻す
    check('ウィンドウが1枚増える', require('../src/main/windows').all().length, beforeWindows + 1);
    check('新しいウィンドウとして開く', reopened?.window?.isDestroyed(), false);
    check('閉じたときと同じ大きさ', reopened.window.getBounds().width, last.bounds.width);
    await waitFor(() => reopened.tabManager.tabs.length >= restorable);
    check('タブ構成が戻る', reopened.tabManager.tabs.length, restorable);
    // 記録から新しいタブページを省いた結果、アクティブだったタブが消えることがある
    check('復元したウィンドウでも必ず1枚選ばれている', reopened.tabManager.activeTabId !== null, true);
    check('復元後は履歴から消える', tm.closedTabs.some((e) => e.type === 'window'), false);
    check('復元したウィンドウのタブは元のURL', reopened.tabManager.tabs.map((t) => reopened.tabManager.tabUrl(t)), last.tabs.map((t) => t.url));

    // 復元したウィンドウをもう一度閉じても、同じように戻せる(記録は使い捨てではない)
    reopened.window.close();
    await waitFor(() => reopened.window.isDestroyed());
    await sleep(300);
    check('閉じ直すとまた「閉じたウィンドウ」として積まれる', tm.closedTabs.at(-1)?.type, 'window');

    // 当時のモニタが無くなっていても画面外に開かない(bounds はいちばん近いモニタへ収める)
    const offscreen = browser.createWindow({ bounds: { x: 99999, y: 99999, width: 900, height: 600 } });
    const offBounds = offscreen.window.getBounds();
    // どのモニタでもよいので、実在する作業領域の中に収まっていること
    const inside = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        offBounds.x >= a.x &&
        offBounds.y >= a.y &&
        offBounds.x + offBounds.width <= a.x + a.width &&
        offBounds.y + offBounds.height <= a.y + a.height
      );
    });
    check('画面外のboundsはモニタの作業領域に収める', inside, true);
    offscreen.window.close();
    await waitFor(() => offscreen.window.isDestroyed());
    await sleep(200);

    // タブだけを閉じた履歴と混ざっても、閉じた順の逆(新しい方から)に戻る
    const solo = tm.createTab('data:text/html,<title>solo</title>');
    await sleep(300);
    const soloUrl = solo.view.webContents.getURL();
    tm.closeTab(solo.id);
    await sleep(200);
    check('タブを閉じた分が最後に積まれる', tm.closedTabs.at(-1)?.type, 'tab');
    const soloBack = tm.reopenClosedTab();
    await sleep(300);
    check('先に戻るのは後から閉じたタブの方', soloBack?.view?.webContents.getURL(), soloUrl);
    check('ウィンドウの記録は残っている', tm.closedTabs.at(-1)?.type, 'window');

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
