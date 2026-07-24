// 拡張機能メニュー(Edgeのパズルボタン風)のUIレベル検証(再利用可能)。
// 実行: npx electron scripts/test-extensions-menu.js [スクショ保存先dir]
//
// 一時userDataで本物のウィンドウを開き、テスト用の拡張を2つ読み込んでから
// ツールバーのパズルボタンを信頼済みクリックで押し、オーバーレイに出る #ext-menu を
// getBoundingClientRect()/getComputedStyle() の実測で確認する(見た目はCSS任せなので
// スクショではなく実測。スクショは最後の目視用)。
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-extmenu-'));
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

async function shot(wc, name) {
  // capturePage は初回に UnknownVizError を返すことがあるので数回試す(検証本体には影響しない)
  let image = null;
  for (let i = 0; i < 4 && !image; i++) {
    try {
      image = await wc.capturePage();
    } catch (err) {
      if (i === 3) {
        console.log(`   (スクショ失敗: ${name} ${err.message})`);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const file = path.join(shotDir, name);
  fs.writeFileSync(file, image.toPNG());
  console.log(`   📸 ${file}`);
}

function clickAt(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

async function clickSelector(wc, selector) {
  const pos = await js(
    wc,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!pos) throw new Error(`要素が見つかりません: ${selector}`);
  clickAt(wc, pos.x, pos.y);
}

// アイコン付き/無しのテスト拡張を作る(アイコン無し=頭文字フォールバックの確認用)
function makeExtension(name, withIcon) {
  const dir = path.join(tmp, 'test-exts', name);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { manifest_version: 3, name, version: '1.0.0', description: `${name} の説明` };
  if (withIcon) {
    const png = nativeImage
      .createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
      )
      .resize({ width: 48, height: 48 });
    fs.writeFileSync(path.join(dir, 'icon.png'), png.toPNG());
    manifest.icons = { 48: 'icon.png' };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

app.whenReady().then(async () => {
  try {
    registerIpc();
    browser.initData();

    const ctx = browser.createWindow();
    await sleep(2000);
    const chromeWc = ctx.window.webContents;

    // パズルボタンは拡張が0件のときは出ない(Edge挙動)
    const hiddenAtFirst = await js(chromeWc, `document.getElementById('extensions-menu-btn').classList.contains('hidden')`);
    check('拡張0件ならパズルボタンは非表示', hiddenAtFirst, true);

    // テスト拡張を2つ読み込む(ウェブストアを使わず、そのプロファイルのセッションへ直接)
    const profile = browser.profiles.list().find((p) => p.id === ctx.profileId);
    const session = browser.profiles.sessionFor(profile);
    await session.extensions.loadExtension(makeExtension('アイコン付き拡張', true));
    await session.extensions.loadExtension(makeExtension('Plain Extension', false));
    browser.sendExtensionsFor(ctx.profileId);
    await sleep(500);

    const shownNow = await js(chromeWc, `!document.getElementById('extensions-menu-btn').classList.contains('hidden')`);
    check('拡張があるとパズルボタンが出る', shownNow, true);

    // パズルボタン → オーバーレイに拡張機能メニューが開く
    await clickSelector(chromeWc, '#extensions-menu-btn');
    await sleep(600);
    const overlay = ctx.tabManager.overlay.webContents;
    const open = await js(overlay, `!document.getElementById('ext-menu').classList.contains('hidden')`);
    check('パズルボタンのクリックでメニューが開く', open, true);

    // ---- ここからCSSの実測(未整備だと透明・素のボタン並びになる) ----
    const box = await js(
      overlay,
      `(() => {
        const el = document.getElementById('ext-menu');
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          position: cs.position,
          width: Math.round(r.width),
          bg: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          shadow: cs.boxShadow,
          left: Math.round(r.left),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          winW: window.innerWidth,
          winH: window.innerHeight,
        };
      })()`
    );
    check('メニューは絶対配置', box.position, 'absolute');
    check('メニュー幅は280px', box.width, 280);
    checkThat('背景が透明でない(CSSが当たっている)', box.bg !== 'rgba(0, 0, 0, 0)' && box.bg !== 'transparent', box.bg);
    checkThat('角丸が付いている', box.radius !== '0px', box.radius);
    checkThat('影が付いている', box.shadow !== 'none', box.shadow);
    checkThat('メニューがウィンドウ内に収まる', box.left >= 0 && box.right <= box.winW && box.bottom <= box.winH, box);

    const rows = await js(
      overlay,
      `[...document.querySelectorAll('#ext-items .menu-item')].map((item) => {
        const icon = item.querySelector('.ext-icon');
        const img = icon?.querySelector('img');
        const name = item.querySelector('.name');
        const pin = item.querySelector('.ext-pin');
        const ir = icon.getBoundingClientRect();
        const pr = pin.getBoundingClientRect();
        const nr = name.getBoundingClientRect();
        const rr = item.getBoundingClientRect();
        return {
          name: name.textContent,
          hasImg: !!img,
          fallbackText: img ? null : icon.textContent,
          icon: { w: Math.round(ir.width), h: Math.round(ir.height) },
          imgFits: img ? img.getBoundingClientRect().width <= ir.width + 0.5 : true,
          pin: { w: Math.round(pr.width), h: Math.round(pr.height), opacity: Number(getComputedStyle(pin).opacity) },
          nameClipped: name.scrollWidth > name.clientWidth + 1,
          // 行の中に全部収まっているか(はみ出すとピンが押せない)
          overflows: nr.right > rr.right || pr.right > rr.right + 0.5,
        };
      })`
    );
    check('メニューに2件並ぶ', rows.length, 2);
    const withIcon = rows.find((r) => r.hasImg);
    const noIcon = rows.find((r) => !r.hasImg);
    checkThat('アイコン付きの行がある', !!withIcon, rows);
    checkThat('アイコン無しの行がある', !!noIcon, rows);
    // 設定画面の .ext-icon(36px)を打ち消せていないとここが36になる
    check('アイコン枠は20px(設定画面の36pxに引きずられない)', withIcon?.icon, { w: 20, h: 20 });
    checkThat('アイコン画像が枠に収まる', withIcon?.imgFits === true, withIcon);
    check('アイコン無しは頭文字にフォールバック', noIcon?.fallbackText, 'P');
    check('ピンは24px', withIcon?.pin.w, 24);
    checkThat('ピンが見えている', (withIcon?.pin.opacity ?? 0) > 0.3, withIcon?.pin);
    checkThat('名前が省略されずに収まる', rows.every((r) => !r.nameClipped), rows.map((r) => r.nameClipped));
    checkThat('行からはみ出さない', rows.every((r) => !r.overflows), rows.map((r) => r.overflows));
    await shot(overlay, 'ext-menu.png');

    // ---- ピン留めの切替が保存され、ツールバー側に反映されるか ----
    const pinned0 = browser.bundleFor(ctx.profileId).settings.data.pinnedExtensions ?? [];
    check('初期状態はピン留めなし', pinned0, []);
    await js(
      overlay,
      `(() => { const p = document.querySelector('#ext-items .menu-item .ext-pin'); const r = p.getBoundingClientRect(); window.__pin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
    );
    const pinPos = await js(overlay, `window.__pin`);
    clickAt(overlay, pinPos.x, pinPos.y);
    await sleep(600);
    const pinned1 = browser.bundleFor(ctx.profileId).settings.data.pinnedExtensions ?? [];
    check('ピンを押すと1件ピン留めされる', pinned1.length, 1);
    const stillOpen = await js(overlay, `!document.getElementById('ext-menu').classList.contains('hidden')`);
    check('ピン操作ではメニューを閉じない', stillOpen, true);
    const pinActive = await js(
      overlay,
      `document.querySelector('#ext-items .menu-item .ext-pin').classList.contains('active')`
    );
    check('ピンにactiveが付く', pinActive, true);
    const activeColor = await js(
      overlay,
      `(() => { const p = document.querySelector('#ext-items .menu-item .ext-pin'); const cs = getComputedStyle(p); return { color: cs.color, opacity: cs.opacity }; })()`
    );
    console.log(`   ピン(active)の色: ${activeColor.color} / opacity ${activeColor.opacity}`);
    await shot(overlay, 'ext-menu-pinned.png');

    // ---- 外側クリックで閉じる ----
    clickAt(overlay, 10, box.winH - 10);
    await sleep(500);
    const closed = await js(overlay, `document.getElementById('ext-menu').classList.contains('hidden')`);
    check('外側クリックで閉じる', closed, true);

    console.log(failed ? `\n${failed}件失敗` : '\n全テスト成功');
  } catch (err) {
    console.error('検証中にエラー:', err);
    failed++;
  }
  app.exit(failed ? 1 : 0);
});
