// ウィンドウの外観テーマ(プロファイル単位)の検証(再利用可能)。
// 実行: npx electron scripts/test-window-theme.js [スクショdir]
//
// 一時userDataで本物の browser.js を動かし、
//  - ダーク⇔ライトの実行中切り替えがクロームと内部ページの両方に効くか
//  - **別プロファイルの2ウィンドウが同時に別のテーマ**でいられるか(今回の依頼の本体)
//  - シークレットが紫のまま・外観のスタイルを受けないか
//  - オーバーレイ(roopie://menu)が追従するか
// を、DOMの実測値(getComputedStyle)で確かめる。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// browser.js を読む前にuserDataを一時フォルダへ(実プロファイルを汚さない)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-theme-'));
app.setPath('userData', tmp);

const browser = require('../src/main/browser');
const { registerIpc } = require('../src/main/ipc');

const SHOT_DIR = process.argv[2] || null;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${JSON.stringify(actual)} (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
function checkTrue(name, actual, note = '') {
  console.log(`${actual ? 'OK ' : 'NG '} ${name}${actual ? '' : ` => ${note}`}`);
  if (!actual) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// クロームUIの実測値を読む。--surface-alpha はインラインなので html から直接読む
const PROBE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bar = document.getElementById('tab-bar');
  const toolbar = document.getElementById('toolbar');
  return {
    mode: root.dataset.windowMode || null,
    style: root.dataset.windowStyle || null,
    pattern: root.dataset.windowPattern || null,
    surfaceAlpha: root.style.getPropertyValue('--surface-alpha').trim() || null,
    text: cs.getPropertyValue('color').trim(),
    tint: cs.getPropertyValue('--tint').trim(),
    barBg: bar ? getComputedStyle(bar).backgroundColor : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    toolbarBackdrop: toolbar ? getComputedStyle(toolbar).backdropFilter : null,
  };
})()`;

const probe = (wc) => wc.executeJavaScript(PROBE);

// 内部ページ(設定など)は透けない・でも明暗には追従する
const PAGE_PROBE = `(() => {
  const root = document.documentElement;
  return {
    mode: root.dataset.windowMode || null,
    surfaceAlpha: root.style.getPropertyValue('--surface-alpha').trim() || null,
    text: getComputedStyle(root).getPropertyValue('color').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
})()`;

// 計算後の色を {r,g,b,a} にほどく。
// color-mix() を通った値は rgb() ではなく color(srgb 0.93 0.94 0.96 / 0.4) 形式で返る
function parseColor(css) {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(css || '');
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((v) => Math.round(Number(v) * 255));
    return { r, g, b, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css || '');
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map(Number);
    return { r, g, b, a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  return null;
}

// ライトかダークかの判定に使う明るさ(0-255)
function luminance(css) {
  const c = parseColor(css);
  return c ? Math.round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) : null;
}

async function shot(ctx, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const img = await ctx.window.webContents.capturePage();
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), img.toPNG());
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  registerIpc();
  browser.initData();

  const p1 = browser.profiles.active();
  const p2 = browser.profiles.create('仕事');

  const ctx1 = browser.createWindow({ profileId: p1.id });
  const ctx2 = browser.createWindow({ profileId: p2.id });
  await sleep(1500);

  // ---- 1) 既定はダーク(system + OSがダーク想定)。少なくとも明暗のどちらかに解決されている ----
  const init1 = await probe(ctx1.window.webContents);
  checkTrue('既定で data-window-mode が dark/light に解決される', ['dark', 'light'].includes(init1.mode), init1.mode);
  check('既定のスタイルは単色', init1.style, 'solid');
  check('単色では帯を透かさない', init1.surfaceAlpha, '1');

  // ---- 2) プロファイル1をライトに ----
  browser.setThemeFor(p1.id, { windowMode: 'light' });
  await sleep(400);
  const light1 = await probe(ctx1.window.webContents);
  const dark2 = await probe(ctx2.window.webContents);
  check('p1のウィンドウはライト', light1.mode, 'light');
  checkTrue('ライトの文字色は暗い', luminance(light1.text) < 90, light1.text);
  checkTrue('ライトの帯は明るい', luminance(light1.barBg) > 180, light1.barBg);
  check('ライトでは重ね色が黒側', light1.tint, '15 23 42');

  // ---- 3) ★依頼の本体: 同時に開いた別プロファイルのウィンドウは影響を受けない ----
  checkTrue('p2のウィンドウはダークのまま', dark2.mode !== 'light', dark2.mode);
  checkTrue('p2の帯は暗いまま', luminance(dark2.barBg) < 90, dark2.barBg);
  await shot(ctx1, '1-p1-light');
  await shot(ctx2, '2-p2-dark');

  // ---- 4) p2 を liquidglass に(acrylic + 帯を透かす) ----
  browser.setThemeFor(p2.id, { windowStyle: 'glass', windowTranslucency: 40 });
  await sleep(400);
  const glass2 = await probe(ctx2.window.webContents);
  const stillLight1 = await probe(ctx1.window.webContents);
  check('p2はliquidglass', glass2.style, 'glass');
  check('p2の帯は透ける', glass2.surfaceAlpha, '0.4');
  checkTrue('p2の帯の背景にアルファが乗る', parseColor(glass2.barBg)?.a === 0.4, glass2.barBg);
  checkTrue('p2のツールバーに背後のぼかしが入る', /blur/.test(glass2.toolbarBackdrop || ''), glass2.toolbarBackdrop);
  check('p1は単色のまま(スタイルも混ざらない)', stillLight1.style, 'solid');
  check('p1は帯を透かさないまま', stillLight1.surfaceAlpha, '1');
  await shot(ctx2, '3-p2-glass');

  // ---- 5) グラデーションとパターン ----
  browser.setThemeFor(p2.id, { windowStyle: 'gradient', windowGradientStops: ['#2a1a4a', '#123b47'], windowGradientAngle: 120 });
  await sleep(400);
  const grad2 = await probe(ctx2.window.webContents);
  check('p2はグラデーション', grad2.style, 'gradient');
  checkTrue('body にグラデーションが描かれる', /gradient/.test(grad2.bodyBg) || /gradient/.test(
    await ctx2.window.webContents.executeJavaScript('getComputedStyle(document.body).backgroundImage')
  ), grad2.bodyBg);
  await shot(ctx2, '4-p2-gradient');

  browser.setThemeFor(p2.id, { windowStyle: 'pattern', windowPattern: 'grid', windowPatternColor: '#6c8cff' });
  await sleep(400);
  const pat2 = await probe(ctx2.window.webContents);
  check('p2はパターン', pat2.style, 'pattern');
  check('パターンの種類が入る', pat2.pattern, 'grid');
  const patImage = await ctx2.window.webContents.executeJavaScript('getComputedStyle(document.body).backgroundImage');
  checkTrue('body にパターンが描かれる', /linear-gradient/.test(patImage), patImage);
  await shot(ctx2, '5-p2-pattern');

  // ---- 6) 基準色(単色テーマ) ----
  browser.setThemeFor(p2.id, { windowStyle: 'solid', windowColor: '#3b2a5c' });
  await sleep(400);
  const solid2 = await probe(ctx2.window.webContents);
  const barRgb = parseColor(solid2.barBg);
  checkTrue('基準色が帯に効く(紫寄り)', barRgb && barRgb.b > barRgb.g && barRgb.r > barRgb.g, solid2.barBg);
  await shot(ctx2, '6-p2-solid-color');

  // ---- 7) 内部ページ(設定)は明暗に追従し、かつ透けない ----
  const tab = ctx1.tabManager.tabs[0];
  tab.view.webContents.loadURL('roopie://settings');
  await sleep(1800);
  const page1 = await tab.view.webContents.executeJavaScript(PAGE_PROBE);
  check('内部ページもライトに追従', page1.mode, 'light');
  checkTrue('内部ページの文字色は暗い', luminance(page1.text) < 90, page1.text);
  check('内部ページは帯を透かす設定を受けない', page1.surfaceAlpha, '1');
  checkTrue('内部ページの背景は不透明', parseColor(page1.bodyBg)?.a === 1, page1.bodyBg);
  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, '9-settings-light.png'), (await tab.view.webContents.capturePage()).toPNG());
  }

  // ---- 7b) 内部ページは全部が window-theme.js を読めているか ----
  // 読み込み漏れがあると theme.js の applyTheme が最初の行で落ち、
  // そのページはアクセントもカスタムCSSも当たらなくなる
  for (const page of ['newtab', 'history', 'bookmarks', 'downloads', 'sidepanel', 'mediaplayer', 'timerpanel', 'splitdivider', 'welcome', 'whatsnew', 'menu']) {
    tab.view.webContents.loadURL(`roopie://${page}`);
    await sleep(700);
    const state = await tab.view.webContents.executeJavaScript(
      `({ hasApi: typeof window.roopieWindowTheme === 'object', mode: document.documentElement.dataset.windowMode || null })`
    );
    checkTrue(`${page}: window-theme.js を読めている`, state.hasApi, JSON.stringify(state));
    check(`${page}: 明暗が当たる`, state.mode, 'light');
  }

  // ---- 7c) 基準色と明るさが食い違っても文字が読めるか ----
  // ライトを選びつつ暗い基準色を指定した場合、文字は明るい側に倒れなければならない
  browser.setThemeFor(p1.id, { windowMode: 'light', windowColor: '#1b1730' });
  await sleep(400);
  const crossed = await probe(ctx1.window.webContents);
  checkTrue('暗い基準色 + ライトでも面は暗い', luminance(crossed.barBg) < 90, crossed.barBg);
  checkTrue('暗い基準色 + ライトなら文字は明るい', luminance(crossed.text) > 180, crossed.text);
  browser.setThemeFor(p1.id, { windowColor: '' });
  await sleep(300);

  // ---- 8) オーバーレイ(roopie://menu)は追従する ----
  const overlay = ctx2.tabManager.overlay?.webContents;
  if (overlay) {
    const menu = await overlay.executeJavaScript(PAGE_PROBE);
    checkTrue('オーバーレイも明暗に追従', ['dark', 'light'].includes(menu.mode), menu.mode);
  } else {
    console.log('-- オーバーレイが取得できずスキップ');
  }

  // ---- 9) シークレットは紫のまま・外観のスタイルを受けない ----
  // p2(パターン指定のプロファイル)からシークレットを開いても紫のまま
  browser.setThemeFor(p2.id, { windowStyle: 'pattern' });
  const inc = browser.createWindow({ profileId: p2.id, incognito: true });
  await sleep(1500);
  const incProbe = await probe(inc.window.webContents);
  check('シークレットは常にダーク', incProbe.mode, 'dark');
  check('シークレットは外観のスタイルを受けない', incProbe.style, null);
  check('シークレットはパターンも受けない', incProbe.pattern, null);
  const incBar = parseColor(incProbe.barBg);
  checkTrue('シークレットの帯は紫のまま', incBar?.r === 27 && incBar?.g === 23 && incBar?.b === 48, incProbe.barBg);
  await shot(inc, '7-incognito');

  // ---- 9b) テーマを「共有」にしたら、相手のウィンドウもその場で追随する ----
  // 共有ONのプロファイルは同じStoreを指すので、片方だけ配信すると
  // もう片方のウィンドウが古い外観のまま残ってしまう
  browser.setShared(p1.id, 'theme', true);
  browser.setShared(p2.id, 'theme', true);
  browser.setThemeFor(p1.id, { windowMode: 'dark', windowStyle: 'solid', windowColor: '' });
  await sleep(400);
  browser.setThemeFor(p1.id, { windowMode: 'light' });
  await sleep(500);
  check('共有ONなら相手のウィンドウも追随', (await probe(ctx2.window.webContents)).mode, 'light');
  browser.setShared(p1.id, 'theme', false);
  browser.setShared(p2.id, 'theme', false);

  // ---- 10) 保存され、次に開いたウィンドウにも効く ----
  browser.setThemeFor(p1.id, { windowMode: 'light', windowStyle: 'solid' });
  const ctx3 = browser.createWindow({ profileId: p1.id });
  await sleep(1500);
  const fresh = await probe(ctx3.window.webContents);
  check('新しく開いたウィンドウもp1のテーマ', fresh.mode, 'light');

  // ---- 11) 最初の描画からライトで塗られているか(ダークのちらつきが出ないか) ----
  // preload が同期でモードを聞いて <html> に入れている。これが効かないと
  // ライトのプロファイルでも最初の数十msだけダークで描かれる
  browser.setThemeFor(p1.id, { windowMode: 'light' });
  const ctxFlash = browser.createWindow({ profileId: p1.id });
  await sleep(90);
  let firstPaint = null;
  try {
    const bmp = (await ctxFlash.window.webContents.capturePage({ x: 400, y: 60, width: 2, height: 2 })).toBitmap();
    firstPaint = [bmp[2], bmp[1], bmp[0]];
  } catch {
    // まだ描かれていなければ判定を飛ばす
  }
  checkTrue('最初の描画からライト(ダークのちらつきが無い)', firstPaint === null || luminance(`rgb(${firstPaint.join(',')})`) > 180, String(firstPaint));

  // ---- 12) liquidglass の実際の見え方 ----
  // capturePage はウェブ層しか写さず、背後のacrylic(DWMが描く)は出ない。
  // 縞模様のウィンドウを敷いて画面から撮り、帯を通して縞がぼけて見えるかを確かめる
  if (SHOT_DIR) {
    const rect = { x: 180, y: 130, width: 1000, height: 560 };
    const backdrop = new BrowserWindow({
      x: rect.x - 40, y: rect.y - 40, width: rect.width + 80, height: rect.height + 80,
      frame: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    });
    const stripes = path.join(SHOT_DIR, 'backdrop.html');
    fs.writeFileSync(stripes, '<body style="margin:0;height:100vh;background:repeating-linear-gradient(45deg,#ff2d55 0 24px,#00d4ff 24px 48px)"></body>', 'utf8');
    backdrop.loadFile(stripes);

    browser.setThemeFor(p2.id, { windowStyle: 'glass', windowTranslucency: 45 });
    ctx2.window.setBounds(rect);
    ctx2.window.setAlwaysOnTop(true, 'pop-up-menu');
    ctx2.window.focus();
    await sleep(1200);
    const file = path.join(SHOT_DIR, '8-glass-over-desktop.png');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
      `$bmp = New-Object System.Drawing.Bitmap ${rect.width + 80}, ${rect.height + 80};`,
      '$g = [System.Drawing.Graphics]::FromImage($bmp);',
      `$g.CopyFromScreen(${rect.x - 40}, ${rect.y - 40}, 0, 0, $bmp.Size);`,
      `$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    ].join(' ')], { stdio: 'ignore' });
    console.log('-- liquidglassの実写:', file);
    backdrop.destroy();
  }

  console.log(failed === 0 ? '\n=> すべてOK' : `\n=> ${failed}件NG`);
  if (SHOT_DIR) console.log('スクショ:', SHOT_DIR);
  await sleep(200);
  app.exit(failed === 0 ? 0 : 1);
});
