// タブグループと二段タブバーの検証(再利用可能)。
// 実行: npx electron scripts/test-tab-groups.js [スクショ保存先dir]
//   1) ドメイン判定(純関数)
//   2) TabManager のグループ操作(作成/追加/外す/解除/閉じる/自動仕分け/連続配置)
//   3) タブバーの見た目(1段目=チップ+グループ外のタブ、2段目=選択中グループの中身)
//   4) セッション復元でグループが戻ること
const { app, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-groups-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');
const { registrableDomain, planDomainGroups } = require('../src/main/tab-groups');

const shotDir = process.argv[2] || tmp;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const checkTrue = (name, value, detail) => check(name, value === true ? true : [value, detail], true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

// rect を渡すとその範囲だけを切り出して4倍に拡大する(チップと2段目の継ぎ目のような
// 数pxの見た目は、全体のスクショでは潰れて確かめられないため)
async function shot(wc, name, rect) {
  let image = await wc.capturePage();
  if (rect) {
    image = image.crop(rect);
    const size = image.getSize();
    image = image.resize({ width: size.width * 4, height: size.height * 4, quality: 'best' });
  }
  fs.writeFileSync(path.join(shotDir, name), image.toPNG());
  console.log(`   📸 ${path.join(shotDir, name)}`);
}

// 読み込ませずにURLだけ持つタブを作る(ネットワーク不要。tabUrl は hibernatedUrl を返す)
const addTab = (tm, url) => tm.createTab(url, { background: true, hibernate: true });

app.whenReady().then(async () => {
  try {
    // ---- 1) ドメイン判定 ----
    check('サブドメインはまとめる', registrableDomain('https://docs.google.com/x'), 'google.com');
    check('www も同じ扱い', registrableDomain('https://www.google.com/'), 'google.com');
    check('co.jp は3ラベル', registrableDomain('https://www.asahi.co.jp/news'), 'asahi.co.jp');
    check('通常の2ラベル', registrableDomain('https://example.com/a'), 'example.com');
    check('内部ページは対象外', registrableDomain('roopie://newtab'), null);
    check('file: も対象外', registrableDomain('file:///C:/a.html'), null);
    const plan = planDomainGroups([
      { id: 1, url: 'https://a.example.com/1' },
      { id: 2, url: 'https://example.com/2' },
      { id: 3, url: 'https://solo.test/1' },
      { id: 4, url: 'roopie://newtab' },
    ]);
    check('1件だけのドメインはグループにしない', plan, [{ name: 'example.com', tabIds: [1, 2] }]);

    // ---- 2) TabManager のグループ操作 ----
    registerIpc();
    browser.initData();
    const ctx = browser.createWindow();
    const tm = ctx.tabManager;
    const wc = ctx.window.webContents;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    ctx.window.setBounds({ x: 0, y: 0, width: sw, height: sh });
    ctx.window.show();
    ctx.window.focus();
    await sleep(2500);

    const a1 = addTab(tm, 'https://docs.google.com/a');
    const b1 = addTab(tm, 'https://example.com/1');
    const a2 = addTab(tm, 'https://mail.google.com/b');
    const b2 = addTab(tm, 'https://example.com/2');
    const solo = addTab(tm, 'https://solo.test/1');
    await sleep(600);

    const group = tm.createGroup([a1.id, a2.id], { name: 'テスト' });
    check('グループができる', [tm.groups.length, group.name], [1, 'テスト']);
    check('所属がタブに入る', [tm.getTab(a1.id).groupId, tm.getTab(a2.id).groupId], [group.id, group.id]);
    // 離れて並んでいたメンバーは連続した並びに寄せる(1段目のチップの位置を安定させるため)
    const order = () => tm.tabs.map((t) => t.id);
    check(
      'グループの中身は連続して並ぶ',
      order().indexOf(a2.id) - order().indexOf(a1.id),
      1
    );

    tm.addToGroup(group.id, [b1.id]);
    check('後から追加できる', tm.tabsInGroup(group.id).length, 3);
    tm.removeFromGroup([b1.id]);
    check('グループから外せる', [tm.tabsInGroup(group.id).length, tm.getTab(b1.id).groupId], [2, null]);

    // 中身が全部いなくなったらグループごと消える
    const solo2 = addTab(tm, 'https://tmp.test/1');
    await sleep(300);
    const tmpGroup = tm.createGroup([solo2.id], { name: '一時' });
    tm.closeTab(solo2.id);
    await sleep(300);
    check('空になったグループは消える', tm.getGroup(tmpGroup.id), null);

    // 自動仕分け: 残りのグループ外タブのうち、同じドメインが2つ以上のものだけ
    const madeGroups = tm.groupByDomain();
    check('ドメインごとに1グループできた', madeGroups, 1);
    const domainGroup = tm.groups.find((g) => g.name === 'example.com');
    check('example.com の2タブがまとまる', tm.tabsInGroup(domainGroup?.id).map((t) => t.id).sort(), [b1.id, b2.id].sort());
    check('1件だけのドメインはグループ外のまま', tm.getTab(solo.id).groupId, null);
    check('手で作ったグループは触らない', tm.tabsInGroup(group.id).length, 2);
    // 2回目はグループ外に同じドメインが2つ以上残っていないので何も作らない
    check('もう一度実行してもグループは増えない', [tm.groupByDomain(), tm.groups.length], [0, 2]);

    // ---- 3) タブバーの見た目 ----
    tm.switchTab(solo.id); // グループ外のタブを選ぶ
    await sleep(500);
    const looseView = await js(
      wc,
      `(() => ({
        チップ数: document.querySelectorAll('#tabs .tab-group-chip').length,
        一段目のタブ数: document.querySelectorAll('#tabs .tab').length,
        二段目: !document.getElementById('group-row').classList.contains('hidden'),
      }))()`
    );
    check('1段目はチップ2枚+グループ外のタブ', [looseView.チップ数, looseView.一段目のタブ数], [2, 2]);
    check('グループ外のタブを選んでいる間は2段目を出さない', looseView.二段目, false);

    tm.switchTab(a1.id); // グループの中のタブを選ぶ
    await sleep(500);
    const groupView = await js(
      wc,
      `(() => ({
        二段目: !document.getElementById('group-row').classList.contains('hidden'),
        二段目のタブ数: document.querySelectorAll('#group-tabs .tab').length,
        一段目のタブ数: document.querySelectorAll('#tabs .tab').length,
        選択中のチップ: document.querySelector('#tabs .tab-group-chip.active')?.textContent ?? null,
      }))()`
    );
    check('グループの中のタブを選ぶと2段目が出る', groupView.二段目, true);
    check('2段目にはそのグループの中身だけ', groupView.二段目のタブ数, 2);
    check('1段目にグループの中身は出さない', groupView.一段目のタブ数, 2);
    checkTrue('選択中のグループのチップに印が付く', (groupView.選択中のチップ ?? '').includes('テスト'), groupView);

    // ---- チップと2段目が地続きに見えるか(隙間ゼロ・同じ色) ----
    // チップの下端から2段目の上端までを「橋」(.linked::after)で埋めている。
    // #tabs は overflow-y:hidden だが、切られるのはパディングボックスなので橋は見える
    const bridge = await js(
      wc,
      `(() => {
        const chip = document.querySelector('#tabs .tab-group-chip.linked');
        const row = document.getElementById('group-row');
        if (!chip) return null;
        const c = chip.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        const tabs = document.getElementById('tabs').getBoundingClientRect();
        return {
          橋の高さ: Math.round(r.top - c.bottom),
          橋の下端: Math.round(c.bottom + parseFloat(getComputedStyle(chip, '::after').height)),
          スクロール枠の下端: Math.round(tabs.bottom), // ここまでは切られない(パディングボックス)
          二段目の上端: Math.round(r.top),
          チップの色: getComputedStyle(chip).backgroundColor,
          橋の色: getComputedStyle(chip, '::after').backgroundColor,
          二段目の色: getComputedStyle(row).backgroundColor,
          チップの角丸: getComputedStyle(chip).borderBottomLeftRadius,
          チップの下線: getComputedStyle(chip).boxShadow,
        };
      })()`
    );
    checkTrue('選択中のグループのチップが2段目とつながる印を持つ', bridge !== null, bridge);
    check('橋が隙間をちょうど埋める', [bridge.橋の下端, bridge.二段目の上端], [bridge.二段目の上端, bridge.二段目の上端]);
    checkTrue('橋がスクロール枠に切られない', bridge.橋の下端 <= bridge.スクロール枠の下端, bridge);
    check('チップ・橋・2段目が同じ色', [bridge.チップの色, bridge.橋の色], [bridge.二段目の色, bridge.二段目の色]);
    check('つながっている側の角丸は落とす', bridge.チップの角丸, '0px');
    check('つながっている間は下線を出さない(継ぎ目を切らない)', bridge.チップの下線, 'none');
    console.log(`   チップと2段目: ${JSON.stringify(bridge)}`);
    await shot(wc, 'tab-groups.png');
    // 継ぎ目の目視用(チップの左右に少し余白を取って拡大する)
    const seam = await js(
      wc,
      `(() => { const r = document.querySelector('#tabs .tab-group-chip.linked').getBoundingClientRect();
        return { x: Math.round(r.left) - 30, y: 0, width: Math.round(r.width) + 60, height: 90 }; })()`
    );
    await shot(wc, 'tab-groups-seam.png', seam);

    // ---- チップのインライン改名 ----
    // タブの読み込み・メディア・設定の変更でもタブバーは作り直されるので、
    // 編集中の入力欄がそれで消えたり勝手に確定したりしないこと
    await js(wc, `startGroupRename(${group.id})`);
    await sleep(300);
    check('改名の入力欄が出る', await js(wc, `!!document.querySelector('.group-name-input')`), true);
    await js(
      wc,
      `(() => {
        const input = document.querySelector('.group-name-input');
        input.value = 'しごと';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    tm.sendState(); // 再描画を起こす
    await sleep(400);
    const editing = await js(
      wc,
      `(() => {
        const input = document.querySelector('.group-name-input');
        return { ある: !!input, 値: input?.value ?? null, フォーカス: document.activeElement === input };
      })()`
    );
    check('再描画しても編集中の入力が残る', [editing.ある, editing.値], [true, 'しごと']);
    check('再描画してもフォーカスが戻る', editing.フォーカス, true);
    check('再描画では確定しない(名前はまだ元のまま)', tm.getGroup(group.id).name, 'テスト');
    await js(
      wc,
      `document.querySelector('.group-name-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`
    );
    await sleep(400);
    check('Enterで名前が変わる', tm.getGroup(group.id).name, 'しごと');
    check('確定すると入力欄は消える', await js(wc, `!!document.querySelector('.group-name-input')`), false);

    // チップを押すと、そのグループで最後に見ていたタブへ戻る
    tm.switchTab(a2.id);
    tm.switchTab(solo.id);
    await sleep(300);
    tm.selectGroup(group.id);
    check('チップを押すとそのグループで最後に見ていたタブへ', tm.activeTabId, a2.id);

    // 縦タブではレールの中に折りたたんで出す
    await js(wc, `document.body.classList.add('vertical-tabs')`);
    await js(wc, `renderTabs()`);
    await sleep(300);
    const verticalView = await js(
      wc,
      `(() => ({
        二段目: !document.getElementById('group-row').classList.contains('hidden'),
        字下げ: document.querySelectorAll('#tabs .tab.in-group-list').length,
      }))()`
    );
    check('縦タブでは2段目を使わない', verticalView.二段目, false);
    check('縦タブでは中身をレールの中に出す', verticalView.字下げ, 2);
    await js(wc, `document.body.classList.remove('vertical-tabs'); renderTabs()`);

    // ---- 2段目の✕でも、幅の固定は2段目に掛かる ----
    // (1段目に掛けてしまうと、2段目の✕はカーソルの下から逃げたまま・1段目が別の幅で固定される)
    tm.switchTab(a1.id); // グループの中のタブを選んで2段目を出す
    await sleep(500);
    const groupTabRect = await js(
      wc,
      `(() => { const r = document.querySelector('#group-tabs .tab').getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`
    );
    ctx.window.focus();
    wc.sendInputEvent({ type: 'mouseEnter', x: Math.round(groupTabRect.x + 4), y: Math.round(groupTabRect.y + 4) });
    wc.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(groupTabRect.x + groupTabRect.w / 2),
      y: Math.round(groupTabRect.y + groupTabRect.h / 2),
    });
    await sleep(250);
    const closeRect = await js(
      wc,
      `(() => { const el = document.querySelector('#group-tabs .tab .close-btn'); if (!el) return null;
        const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`
    );
    check('2段目のタブにもホバーで✕が出る', closeRect?.w > 0, true);
    const clickX = Math.round(closeRect.x + closeRect.w / 2);
    const clickY = Math.round(closeRect.y + closeRect.h / 2);
    wc.sendInputEvent({ type: 'mouseDown', x: clickX, y: clickY, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: clickX, y: clickY, button: 'left', clickCount: 1 });
    await sleep(300);
    const locked = await js(
      wc,
      `(() => ({
        二段目: document.getElementById('group-tabs').classList.contains('width-locked'),
        一段目: document.getElementById('tabs').classList.contains('width-locked'),
      }))()`
    );
    check('2段目の✕では2段目だけが固定される', [locked.二段目, locked.一段目], [true, false]);
    await sleep(1200);
    check(
      '1秒後に固定が外れる',
      await js(wc, `document.getElementById('group-tabs').classList.contains('width-locked')`),
      false
    );

    // ---- ドラッグ&ドロップでチップに乗せてグループへ参加 ----
    // 折りたたまれたグループ(2段目を開いていない状態)でも、チップ本体へタブをドロップすれば
    // そのグループに入る(2段目を開いて差し込む手順を踏まなくてよい)
    tm.switchTab(solo.id); // グループ外のタブを選び、対象のグループを閉じた(2段目なし)状態にする
    await sleep(400);
    const dndResult = await js(
      wc,
      `(() => {
        const soloEl = document.querySelector('.tab[data-id="${solo.id}"]');
        const chipEl = document.querySelector('.tab-group-chip[data-group-id="${group.id}"]');
        if (!soloEl || !chipEl) return { エラー: 'チップまたはタブが見つからない' };
        const dt = new DataTransfer();
        const fire = (type, target) => {
          const r = target.getBoundingClientRect();
          target.dispatchEvent(new DragEvent(type, {
            bubbles: true, cancelable: true, dataTransfer: dt,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
        };
        fire('dragstart', soloEl);
        fire('dragover', chipEl);
        const highlighted = chipEl.classList.contains('drag-over-chip');
        fire('drop', chipEl);
        // 実際のdragendは「画面外へ切り離す」判定にOSの実カーソル位置を使うため、
        // テストでは発火させず後始末の関数だけ直接呼ぶ(切り離し判定を避ける)
        cleanupDrag();
        return { ハイライト: highlighted };
      })()`
    );
    await sleep(400);
    checkTrue('チップへドラッグ中はハイライトする', dndResult.ハイライト === true, dndResult);
    check('チップへドロップするとそのグループに入る', tm.getTab(solo.id).groupId, group.id);
    // dragstart時に出したドロップゾーン表示を後始末(実dragendは実カーソル位置での
    // 切り離し判定を伴うため、テストではIPC経由ではなく直接後始末する)
    ctx.draggingTabId = null;
    tm.hideDropZones();
    tm.removeFromGroup([solo.id]); // 以降のセッション復元テストへ影響しないよう元に戻す
    await sleep(200);

    // ---- ドラッグ&ドロップでタブ同士を重ねて新しいグループを作る ----
    // グループ外のタブを2枚重ねると、右クリックメニューの「新しいグループを作成」と同じく
    // その場でグループができ、そのまま改名できる状態になる
    const ng1 = addTab(tm, 'https://newgroup-a.test/1');
    const ng2 = addTab(tm, 'https://newgroup-b.test/1');
    await sleep(600);
    const newGroupResult = await js(
      wc,
      `(() => {
        const fromEl = document.querySelector('.tab[data-id="${ng1.id}"]');
        const toEl = document.querySelector('.tab[data-id="${ng2.id}"]');
        if (!fromEl || !toEl) return { エラー: 'タブが見つからない' };
        const dt = new DataTransfer();
        const fire = (type, target) => {
          const r = target.getBoundingClientRect();
          target.dispatchEvent(new DragEvent(type, {
            bubbles: true, cancelable: true, dataTransfer: dt,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
        };
        fire('dragstart', fromEl);
        fire('dragover', toEl);
        const highlighted = toEl.classList.contains('drag-over-newgroup');
        fire('drop', toEl);
        cleanupDrag(); // 実dragendは避ける(理由は上のチップ参加テストと同じ)
        return { ハイライト: highlighted };
      })()`
    );
    await sleep(400);
    checkTrue('重ねたタブをハイライトする', newGroupResult.ハイライト === true, newGroupResult);
    const ng1After = tm.getTab(ng1.id);
    const ng2After = tm.getTab(ng2.id);
    checkTrue(
      'タブ同士を重ねると同じ新しいグループに入る',
      ng1After?.groupId != null && ng1After.groupId === ng2After?.groupId,
      [ng1After?.groupId, ng2After?.groupId]
    );
    const newGroup = tm.getGroup(ng1After?.groupId);
    checkTrue('作った直後はそのままインライン改名に入れる', await js(wc, `!!document.querySelector('.group-name-input')`), true);
    await js(wc, `document.querySelector('.group-name-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
    ctx.draggingTabId = null;
    tm.hideDropZones();
    tm.closeTab(ng1.id);
    tm.closeTab(ng2.id); // 空になったグループごと消え、以降のテストへ影響しない
    await sleep(200);
    check('後始末で新グループも消える', tm.getGroup(newGroup?.id), null);

    // ---- 4) セッション復元 ----
    const snapshot = tm.snapshotTabs();
    const grouped = snapshot.tabs.filter((t) => t.group);
    checkTrue(
      '記録にグループが載る',
      grouped.length === tm.tabs.filter((t) => t.groupId != null).length,
      snapshot.tabs.map((t) => t.group?.name ?? null)
    );
    const ctx2 = browser.createWindow({ restoreTabs: snapshot.tabs });
    await sleep(2500);
    const tm2 = ctx2.tabManager;
    check('復元後もグループが2つ', tm2.groups.length, 2);
    check(
      '復元後のグループ名と色',
      tm2.groups.map((g) => g.name).sort(),
      tm.groups.map((g) => g.name).sort()
    );
    check(
      '復元後も中身の数が同じ',
      tm2.groups.map((g) => tm2.tabsInGroup(g.id).length).sort(),
      tm.groups.map((g) => tm.tabsInGroup(g.id).length).sort()
    );

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
    browser.flushAll();
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('NG 検証が例外で停止:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {});
