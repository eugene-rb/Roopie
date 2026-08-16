// ウィンドウが**非アクティブ**のときに背景マテリアル(acrylic/mica)が生き残るかを確かめる探り。
// 「他のウィンドウをクリックすると透過が消えて単色になる」という報告の原因が
// DWM側の仕様(非アクティブ時はフォールバック色でべた塗り)なのか、こちらで直せる何かなのかを
// 白黒つける。直し方(再適用で戻るのか / マテリアルを変えれば済むのか)がここで決まる。
//
// 実行: npx electron scripts/test-window-focus-material.js [出力dir]
//
// 測り方は test-window-material.js と同じで、背後に縞模様のウィンドウを敷いて**画面から**撮る
// (capturePage は WebContents 自身の絵しか写さず、DWMの合成が見えないため)。
// ただし判定は目視ではなく数値で出す:
//   - ばらつき(sd)がほぼ0     → 単色。マテリアルが死んでいる
//   - sdが大きく、輪郭(edge)も大 → 縞がくっきり。素通しでぼかしが無い
//   - sdが大きく、輪郭は小      → 縞がぼけて透けている = acrylicが効いている
// 縞は幅120pxにしてある。acrylicのぼかし半径は30px前後あり、細い縞だと
// ぼけきって「単色」と見分けが付かなくなるため。
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'roopie-focus-material');
fs.mkdirSync(OUT, { recursive: true });

const BOUNDS = { x: 200, y: 150, width: 900, height: 500 };

// 撮る範囲は検証ウィンドウの**内側**だけに絞る。こうしておくと、PowerShell側の座標が
// 物理pxでもDIPでも(=画面の拡大率が何であっても)撮れた絵は必ずウィンドウの中身に収まり、
// 画像全体をそのまま数えられる。他人のウィンドウが写り込む事故も防げる
const SHOT_RECT = { x: BOUNDS.x + 100, y: BOUNDS.y + 150, width: 700, height: 250 };

function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
    `$bmp = New-Object System.Drawing.Bitmap ${SHOT_RECT.width}, ${SHOT_RECT.height};`,
    '$g = [System.Drawing.Graphics]::FromImage($bmp);',
    `$g.CopyFromScreen(${SHOT_RECT.x}, ${SHOT_RECT.y}, 0, 0, $bmp.Size);`,
    `$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png);`,
  ].join(' ');
  // windowsHide を付けないと撮影のたびにコンソール窓が一瞬前面に出る。
  // その前面変化だけでDWMが非アクティブ窓のacrylicをフォールバックに戻すため、
  // 付けずに測ると「付け直しても数秒で単色に戻る」という誤った結論が出る(実際に出た)
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return file;
}

// 撮った絵の「ばらつき」と「輪郭の強さ」を出す。
// sd: 画素の標準偏差の平均(単色なら0)。edge: 横に隣り合う画素の差の平均(ぼけていれば小さい)
function measure(file) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  if (!width || !height) return { sd: 0, edge: 0, mean: [0, 0, 0], note: '画像が読めない' };
  const buf = img.toBitmap(); // BGRA
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [buf[i + 2], buf[i + 1], buf[i]];
  };
  let n = 0;
  const sum = [0, 0, 0];
  const sumsq = [0, 0, 0];
  let edgeSum = 0;
  let edgeN = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const [r, g, b] = at(x, y);
      sum[0] += r; sum[1] += g; sum[2] += b;
      sumsq[0] += r * r; sumsq[1] += g * g; sumsq[2] += b * b;
      n++;
      if (x + 1 < width) {
        const [r2, g2, b2] = at(x + 1, y);
        edgeSum += Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2);
        edgeN++;
      }
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  const sd = [0, 1, 2].map((k) => Math.sqrt(Math.max(0, sumsq[k] / n - (sum[k] / n) ** 2)));
  return {
    sd: round((sd[0] + sd[1] + sd[2]) / 3),
    edge: round(edgeSum / edgeN / 3),
    mean: sum.map((s) => Math.round(s / n)),
  };
}

// 数値から「何が見えているか」を言葉にする
function verdict(m) {
  if (m.sd < 5) return '単色(マテリアルが死んでいる)';
  if (m.edge > 6) return '縞がくっきり(ぼかし無しで素通し)';
  return '縞がぼけて透けている(acrylicが効いている)';
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pageFile(name, body) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const rows = [];
  const capture = (name, label, win) => {
    const file = shot(name);
    const m = measure(file);
    rows.push({ name, label, focused: win.isFocused(), ...m, verdict: verdict(m) });
    console.log(
      `${name}: focused=${win.isFocused()} sd=${m.sd} edge=${m.edge} mean=[${m.mean}] → ${verdict(m)}`
    );
  };

  // ---- 背後に敷く縞模様。これがぼけて見えればマテリアルが効いている ----
  // 最前面に固定する。固定しないと他のアプリのウィンドウが撮影範囲に被り、
  // 実際に2回続けて全数値が使い物にならなくなった。
  // 「最前面だとDWMが活性扱いして非アクティブ時の挙動が歪むのでは」という懸念は、
  // ケース2(非アクティブ・再適用なし)が単色に戻ることを見張りにして潰す。
  // あれが単色なら、最前面でも活性判定は効いている = 測れている
  const backdrop = new BrowserWindow({
    x: BOUNDS.x - 60,
    y: BOUNDS.y - 60,
    width: BOUNDS.width + 120,
    height: BOUNDS.height + 120,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
  });
  backdrop.loadFile(
    pageFile(
      'backdrop',
      `<body style="margin:0;height:100vh;background:repeating-linear-gradient(45deg,#ff2d55 0 120px,#00d4ff 120px 240px)"></body>`
    )
  );
  await wait(600);

  // ---- 検証ウィンドウ: browser.js の applyWindowChrome と同じ指定(acrylic + 透明backgroundColor) ----
  // 中身は帯を置かず全面透過にする。どこを撮ってもacrylicそのものを測れるようにするため
  const win = new BrowserWindow({
    ...BOUNDS,
    title: 'focus material probe',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e5e7eb', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu'); // 背景(alwaysOnTop)よりさらに手前へ
  win.setBackgroundMaterial('acrylic');
  win.loadFile(
    pageFile('probe', `<body style="margin:0;height:100vh;background:transparent"></body>`)
  );
  await wait(1000);

  // ---- 1) アクティブなとき(基準) ----
  capture('1-acrylic-focused', 'acrylic / アクティブ', win);

  // ---- フォーカスを奪う窓。撮影範囲と重ならないよう作業領域の左上隅に小さく置く ----
  const wa = screen.getPrimaryDisplay().workArea;
  const stealer = new BrowserWindow({
    x: wa.x, y: wa.y, width: 140, height: 90,
    frame: false, skipTaskbar: true, backgroundColor: '#222222',
  });
  stealer.loadFile(pageFile('stealer', '<body style="margin:0;background:#222"></body>'));
  await wait(400);

  // フォーカスの奪い合いが決着してから撮る。決着前に撮ると「非アクティブのはずが
  // focused=true」という壊れた結果になる(実際に一度出て、その回は全数値が使い物にならなかった)
  const settle = async (target, want, label) => {
    for (let i = 0; i < 6; i++) {
      target.focus();
      await wait(400);
      if (win.isFocused() === want) return true;
    }
    console.log(`  [警告] ${label}に失敗(win.isFocused=${win.isFocused()})。この回の数値は信用しないこと`);
    return false;
  };
  const deactivate = () => settle(stealer, false, '非アクティブ化');
  const activate = () => settle(win, true, 'アクティブ化');

  await deactivate();
  await wait(600);

  // ---- 2) 非アクティブにしただけ(これが報告された症状) ----
  capture('2-acrylic-blurred', 'acrylic / 非アクティブ', win);

  // ---- 3) 非アクティブのままマテリアルを付け直す(いちばん安い直し方の検証) ----
  win.setBackgroundMaterial('none');
  await wait(300);
  win.setBackgroundMaterial('acrylic');
  await wait(900);
  capture('3-acrylic-reapplied', 'acrylic / 非アクティブ / 付け直し', win);

  // ---- 4) mica は非アクティブでも残るか(残るなら代替になりうる) ----
  win.setBackgroundMaterial('mica');
  await wait(900);
  capture('4-mica-blurred', 'mica / 非アクティブ', win);

  // ---- 5) tabbed(mica alt)も一応見る ----
  win.setBackgroundMaterial('tabbed');
  await wait(900);
  capture('5-tabbed-blurred', 'tabbed / 非アクティブ', win);

  // ---- 6) フォーカスを戻せば復活するか(復活するならDWMの活性状態が原因で確定) ----
  win.setBackgroundMaterial('acrylic');
  await wait(400);
  await activate();
  await wait(600);
  capture('6-acrylic-refocused', 'acrylic / アクティブに戻す', win);

  // ---- 7) もう一度フォーカスを外す。毎回死ぬのか(=blurのたびに付け直しが要るのか) ----
  await deactivate();
  await wait(600);
  capture('7-acrylic-blurred-again', 'acrylic / 再び非アクティブ', win);

  // ---- 8) 「どの押し方なら戻るか / 戻ったあと保つか」の比較 ----
  // 一度は戻っても数秒で単色に落ちる回があり、しかも落ちる時刻が回ごとにばらつく。
  // 押し方(同値を渡すだけ / 'none' を挟む)で差が出るのかをここだけ変数にして測る。
  // 各変種で「押す前」「押した直後」「5秒後」を撮る
  const alive = (name) => measure(path.join(OUT, `${name}.png`)).sd >= 5;
  const variants = [
    { key: 'same-value', label: '同値を渡すだけ', apply: async () => win.setBackgroundMaterial('acrylic') },
    {
      key: 'none-gap',
      label: "'none'を挟む(200ms空ける)",
      apply: async () => {
        win.setBackgroundMaterial('none');
        await wait(200);
        win.setBackgroundMaterial('acrylic');
      },
    },
    {
      // 実装ではこれが使えると嬉しい。間を空けると、その間だけ背景が透明になって
      // 黒が見える恐れがある(このリポジトリの既知の事故モード)
      key: 'none-sametick',
      label: "'none'を挟む(同じtickで連続)",
      apply: async () => {
        win.setBackgroundMaterial('none');
        win.setBackgroundMaterial('acrylic');
      },
    },
  ];

  for (const v of variants) {
    // いったんアクティブに戻してから外し、「死んだ状態」を作り直してから押す
    await activate();
    await wait(600);
    await deactivate();
    await wait(800);
    capture(`8-${v.key}-before`, `${v.label} / 押す前`, win);
    await v.apply();
    await wait(800);
    capture(`8-${v.key}-after`, `${v.label} / 押した直後`, win);
    await wait(5000);
    capture(`8-${v.key}-5s`, `${v.label} / 5秒後`, win);
  }

  // 押し直しで戻る変種のうち、いちばん手数の少ないものを採る。
  // 'none' を経由する形は、押すたびに一瞬フォールバックが見える危険がある
  // (500ms間隔で押すと20回中1回だけ単色を掴んだ。押す回数が多いほど掴みやすい)
  const winner = variants.filter((v) => alive(`8-${v.key}-after`))[0];
  console.log(`\n押し直しの勝者: ${winner ? winner.label : 'なし(どれも戻らない)'}`);

  // ---- 12) 本番と同じ形: blurで押し、非アクティブの間は一定間隔で押し続ける ----
  // 一発では保たないことが分かったので、「押し続ける」形そのものを測る。
  // 12秒のあいだ2秒ごとに撮り、全部が透過のままなら実装としてこの形で足りる
  if (winner) {
    let timer = null;
    let keepAliveInterval = 1000;
    const stopKeepAlive = () => { if (timer) { clearInterval(timer); timer = null; } };
    win.on('focus', stopKeepAlive);
    win.on('blur', () => {
      if (win.isDestroyed()) return;
      winner.apply();
      stopKeepAlive();
      timer = setInterval(() => {
        if (win.isDestroyed() || win.isFocused()) return stopKeepAlive();
        winner.apply();
      }, keepAliveInterval);
    });

    // 押し直しの隙間でフォールバックが見えるか(=ちらつくか)を、細かく撮って生存率で測る。
    // 落ちてから押し直すまでの間は単色が見えるので、間隔が長いほどちらつきやすい
    for (const interval of [1000, 2000, 2500]) {
      keepAliveInterval = interval;
      await activate();
      await wait(600);
      await deactivate();
      let live = 0;
      const total = 40;
      for (let i = 0; i < total; i++) {
        await wait(50);
        const f = shot(`12-keepalive-${interval}ms-${i}`);
        if (measure(f).sd >= 5) live++;
      }
      const label = `押し続ける(${interval}ms間隔) / 400ms刻みで20回`;
      rows.push({ name: `12-keepalive-${interval}ms`, label, focused: win.isFocused(), sd: live, edge: total - live, mean: [], verdict: `透過のまま ${live}/${total} 回` });
      console.log(`${label}: 透過 ${live}/${total}`);
      stopKeepAlive();
    }
  }

  console.log('\n--- まとめ ---');
  for (const r of rows) {
    console.log(`${r.label.padEnd(34)} focused=${String(r.focused).padEnd(5)} sd=${String(r.sd).padEnd(6)} edge=${String(r.edge).padEnd(6)} ${r.verdict}`);
  }
  console.log('\n出力:', OUT);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(rows, null, 2), 'utf8');

  await wait(300);
  stealer.destroy();
  backdrop.destroy();
  win.destroy();
  app.exit(0);
});
