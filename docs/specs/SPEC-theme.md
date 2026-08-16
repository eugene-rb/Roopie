# SPEC-theme: ウィンドウテーマ

## 概要
プロファイル単位のテーマ設定（アクセントカラー・背景スタイル・ウィンドウクロームの様式/不透明度/透過度）。
ネイティブウィンドウフレーム（`browser.js` 経由のElectron API）と、ページ内CSS変数（レンダラーヘルパー）の両方に適用する。

## 詳細

### ファイル構成（テーマ関連部分のみ）
- `browser.js` — テーマストア・パッチ適用・IPC・`applyWindowChrome`
- `src/renderer/pages/theme.js`（61行）— 内部ページのテーマ適用ブートストラップ
- `src/renderer/pages/window-theme.js`（153行）— 純粋DOMヘルパー、`window.roopieWindowTheme`

### browser.js のテーマ関連API
`DEFAULT_THEME`, `THEME_BACKGROUNDS`（auto/dawn/day/dusk/night/plain/image/pattern/gradient/threebody）, `THEME_PATTERNS`（dots/grid/diagonal/crosshatch/hexagon/wave/circuit）,
`applyThemePatch(themeStore, patch)`（唯一の検証済み書き込みパス）, `themeFor(profileId)`, `setThemeFor(profileId, patch)`, `sendThemeFor(profileId)`（共有プロファイルへ `theme:state` をブロードキャスト）, `resolvedWindowMode(theme)`, `applyWindowChrome(ctx)`,
`MATERIAL_STYLES = { translucent: 'acrylic', glass: 'acrylic' }`, `FRAME_COLOR`, `FRAME_COLOR_INCOGNITO`
`windowTranslucency`（クロームの帯の透け具合。範囲 `WINDOW_TRANSLUCENCY_RANGE = [0, 100]`。0で完全透過）,
`pageScrim`（liquidglassの内部ページの下地。既定0=透過、範囲 `PAGE_SCRIM_RANGE = [0, 60]`）,
`translucentPageScrim`（半透明の内部ページの下地。既定100=不透明、範囲 `TRANSLUCENT_PAGE_SCRIM_RANGE = [0, 100]`。
既定の向きがpageScrimと逆なので別フィールドにしている——半透明は元々内部ページを透かしていなかったため）

### IPC（`ipc.js`）
`theme:get`（handle）, `theme:set`（on）, `theme:get-for` / `theme:set-for`（プロファイル指定、handle/on）, `theme:window-mode-sync`（on）。ブロードキャスト: `theme:state`

### window-theme.js / theme.js
`window.roopieWindowTheme = { apply, resolveMode }` を全内部ページ・メインUIが共用。`theme.js` は `window.roopieInternal.onThemeState` / `getTheme()`（preloadブリッジ）経由でテーマとカスタムCSSを `adoptedStyleSheets` で適用。

### liquidglass（`windowStyle: 'glass'`）の適用範囲
ガラス表現は**背後に何があるか**で3通りに作り分ける。すべて `:root[data-window-style="glass"]` 配下にあり、他のスタイルでは1行も効かない。

| 対象 | 背後にあるもの | 作り方 |
| --- | --- | --- |
| クローム（`#tab-bar` / `#toolbar` / `#bookmark-bar` / `#address-wrap` / `.tab`） | ウィンドウのacrylic | `--surface-alpha` で帯を透かし、`backdrop-filter: blur(--glass-blur)` |
| 内部ページ（履歴・ブックマーク・DL・設定・サイドパネル） | ウィンドウのacrylic | Viewを `transparent: true` で作り、bodyの下地を `--page-scrim`（既定 0%＝完全に透過）にして素通しする。`--accent` の光は減光して重ねる |
| ミニプレイヤー・タイマー | **実際のウェブページ** | `transparent: true` の浮遊ビューなので面を薄めて素通しでぼかす（本物のガラス） |

- 2026-08-16: 内部ページの透過は「半透明」（`windowStyle: 'translucent'`）にも拡張した。ただし**既定の向きが異なる**:
  liquidglassの `pageScrim` は既定0%（元から透過）、半透明の `translucentPageScrim` は既定100%（元は不透明だったため下げない限り見た目を変えない）。
  クロームの帯側は元々あった `windowTranslucency` の下限20%を撤廃し、0%（完全透過）まで許可した。
  - `--page-scrim`（背景色の不透明度そのもの）は `color-mix(page-base, page-scrim%, transparent)` で計算しているため、
    半透明の既定(scrim=100%)では数式が「100%:0%」に落ちて**不透明側の値そのもの**になり、`:is([data-window-style="glass"], [data-window-style="translucent"])` に拡張しても安全（見た目が変わらないことを計算上保証できる）。
    この背景色ルールと `.panel-body` の `--page-base` 上書きだけは今もこの`:is()`のまま。
  - 一方、`--card`/`--card-hover` のトークン差し替え、アクセント色の光（`background-image`）、`backdrop-filter`、
    「面を隠すのが仕事の面」の不透明フロア（`--glass-menu`）は**係数の掛け算ではなく固定値の上書き**なので、
    style だけで拡張すると半透明の既定でも常時発火してしまい「見た目を変えない」に反する
    （実測で確認: `.card` の背景・`backdrop-filter`・`body` の `background-image` が solid と食い違った）。
    そこで `window-theme.js` が計算する `[data-page-glass="1"]` という**別の判定フラグ**でこの4箇所だけ更にガードした:
    `windowStyle === 'glass'`（常時true。既存動作）、または `windowStyle === 'translucent'` かつ `scrim < 100`（下地を実際に下げているときだけ）。
  - 不透明フロア（`--glass-menu`、`.modal`/`.panel-menu`/`.icon-picker`/`.tr-more-menu` 用）は**半透明には拡張していない**。
    `--c-card`（`#1e2128`）と `--c-menu`（`#23262e`）は別の色なので、半透明の既定でこれを適用すると
    モーダル等の色が `--card` 経由の色からわずかにずれてしまうため（実測で確認済み）
- **面ではなく線で識別する箇所**: 帯を0%まで透かすとメニューやアクティブタブの塗りも消えるため、不透明フロアを設けず「境界線・下線だけ残す」方式にした。
  - メニュー・ドロップダウン・モーダル: 既存の `border: 1px solid var(--border)` が元々 `--surface-alpha` と無関係に描かれているため無変更で足りる
  - アクティブなタブ: `.tab.active` に `.tab.split` と同じ手法（`box-shadow: inset 0 -2px 0 var(--accent)`）で下線を追加。`--tab-active` の塗りが透明でも、下線と文字色（`--text` vs 非アクティブの `--text-dim`）で判別できる。
    タブバーが横スクロールで端に張り付く間だけ付く `.tab.pinned`（`#tabs > .tab.pinned`。常にアクティブなタブに付く）は
    `#tabs` というID込みの詳細度で `.tab.active` の `box-shadow` を上書きしてしまうため、同じ下線をそちら側にも直接追記した

- 面の色は `--glass-surface` / `--glass-hover` / `--glass-border` / `--glass-page-blur`。既定（`:root`）では `--card` / `--card-hover` / `--border` / `0px` にエイリアスされ、liquidglass 以外では見た目が変わらない。
- 色は白決め打ちではなく `rgb(var(--tint) / α)` で作る。`--tint` がダーク `255 255 255` / ライト `15 23 42` に切り替わるのでライトモードで面が消えない。
- 内部ページの面は個々のルールではなく **`--card` / `--card-hover` のトークン差し替え**で揃える（`.card` `.search` `.btn` `.modal` とそのホバーが一度に効く）。
- `backdrop-filter` はコンテナ級（`.card` `.search` `.modal` `.panel-menu` `.panel-input`）だけに掛ける。行やボタンは数が多く、1つずつ持たせるとGPUが重い（履歴は数百行になりうる）。
- `.card` / `.modal` は `roopie://menu` でも使われるため、セレクタは必ず内部ページ限定の body スコープ配下に置く。
- 背景の光を敷かない除外先: `.chrome-body`（クローム用ルールが担当）/ `.menu-body`（本物のacrylicが効いている）/ `.onboarding`（自前の `.ob-glow` を持つ）/ `.player-body`・`.timerp-body`・`.divider-body`（透明な浮遊ビュー）/ `[data-bg]`（新しいタブは独自の背景システム）。

### 制約・注意点
- Windows 11のネイティブアクリル素材は `backgroundColor` が**透明**である必要がある（実機確認済み）。不透明度指定とアクリルは併用不可（`setOpacity` がぼかしを打ち消す）。
- **非アクティブになるとDWMがacrylicを描くのをやめ、単色のフォールバックで塗り潰す**（ウィンドウ全体。クローム側のCSSは半透明のままなので「うっすら透けてはいるが明らかに別物」に見える）。押し直せば非アクティブのままでも復活するが**数秒でまた戻る**ため、`syncMaterialKeepAlive()` が非アクティブの間だけ `MATERIAL_KEEP_ALIVE_MS`（1.5秒）間隔で同じ値を押し直し続ける。`blur` / `focus` / `closed` と `applyWindowChrome()` から見直しをかける。最小化中はタイマーを残したまま押すのを休む。
  - 実測（`scripts/test-window-focus-material.js`）: 押さなければ非アクティブになった時点で単色（ばらつき sd=0）。1秒間隔で押し続けると400ms刻み20回とも透過。押し方（同値を渡す/`none`を挟む）で復活するかは変わらず、**どれも数秒で落ちる**ので一発の再適用では直らない。`mica` / `tabbed` も非アクティブでは同様に消えるため代替にならない。
  - **押し続けても数%のフレームは単色を掴む**（約300ms刻みで40回撮ると 1〜3 回）。これは間隔を変えても減らない——12秒あたりの押す回数が 12/6/5 回になる 1000/2000/2500ms で、単色フレームは 1/3/1 回とばらつくだけで相関しない。つまり「押し直しの瞬間に一瞬フォールバックが見える」わけではなく、間隔の調整では消せない残差。間隔は減衰（3〜5秒で落ちる）に余裕を残しつつ起きる回数を抑えられる 1500ms を採る（見た目は間隔に依存しないため、選ぶ基準は電力側）。
- `nativeTheme.themeSource` は意図的に書き換えない（アプリ全体に影響しプロファイル単位のライト/ダーク切替が壊れるため）。
- シークレットウィンドウは常にダーク＋単色を強制し、プロファイルのテーマ設定を無視する（`browser.js` のフレーム色、`window-theme.js` の `opts.incognito` 短絡の両方で）。
- **`--surface-alpha` を内部ページで下げてはならない**——これが黒画面事故の原因になる。`window-theme.js` の `--surface-alpha` はクローム/オーバーレイ（`opts.overlay`、`roopie://menu` 等）専用のまま。内部ページの透過は別系統の `--page-scrim` が担当する（2つは別の仕組みなので混同しない）。
- 内部ページを透過させるには**Viewの生成時に `transparent: true` を渡す必要がある**。後から変えられないので、`tab-manager.js` の内部ページと `side-panel.js` の `panelView` は常に透明で作り、実際に透けるかはCSSだけで決める。通常のWebページと、任意サイトを開くWebパネル（`side-panel.js` の `webView`）には**付けない**——背景を宣言していないサイトがデスクトップを透かしてしまう。
  - 2026-08-06 以前は「`WebContentsView` は透過しないので透かすと黒が出る」と記していたが、これは誤り。生成時オプションの話であってプラットフォームの限界ではない。`scripts/test-view-transparency.js` で実測すると、`transparent:false` のまま body だけ透かすと出るのは黒ではなく**白**、`transparent:true` にすればウィンドウのacrylicがそのまま出る。
- `desktopCapturer`（`gen-screenshots.js`）は WGC の初期化に失敗した環境だと**透明な子Viewの中身を取りこぼす**（ページが真っ黒に写る）。これはレンダリングの不具合ではなくキャプチャ側の限界で、liquidglass の透過はスクショでは判定できず**実機の目視が要る**。画面全体のキャプチャ（`CopyFromScreen`）は他ウィンドウが重なると無関係な画面を撮るため、汎用の代替にはできない。
- ミニプレイヤー（`media-player.js:39`）とタイマー（`timer-panel.js:41`）だけは例外で、`transparent: true` + `setBackgroundColor('#00000000')` の**本物の透明ビュー**。背後に実ページがあるので `backdrop-filter` が実際に効き、面を薄めても黒は出ない。
- 検証用の起動（`npm run start:verify`）は、既に Roopie が動いていると単一インスタンスロックで即 `exit 0` する。ログが空なら `Get-Process Roopie` をまず疑う。
- 文字色は単純なライト/ダーク判定ではなく**実際の背景輝度計算**から導出（カスタム背景色がダークなライトモード等に対応するため）。
- OSのダーク/ライト変更リスナーはウィンドウのモードが `'system'` の場合のみ再適用（直近テーマは `window.__roopieLastWindowTheme` にキャッシュ）。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. テーマ変更（背景/パターン/アクセント）が即座に反映されエラーが出ないこと
  2. Windows 11でアクリル/半透明素材と不透明度設定を切り替えてもクラッシュしないこと
  3. シークレットウィンドウが常にダーク固定になっていること
- スクショ: `npx electron scripts/gen-screenshots.js <出力dir>`
  - `07-theme-glass-dark` / `07-theme-glass-light` — liquidglass で内部ページの面がガラスになり、ライトでも面が消えていないこと
  - `04-settings`（solid）と見比べて、**liquidglass 以外では従来通り不透明**であること（退行の確認）
  - ミニプレイヤー・タイマーはこのハーネスに写らないため、見るなら `scripts/test-media-player.js` / `scripts/test-timer-ui.js`

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
- 2026-08-06: liquidglass を内部ページ・オンボーディング・ミニプレイヤー・タイマーへ拡張。背後にあるものごとに3通りの作り分けを追加（詳細節の表）。設定項目は増やしていない
- 2026-08-06: 内部ページとサイドパネルを**本物の透過**に切り替え（Viewを `transparent: true` で作る）。下地の濃さの設定 `pageScrim` を追加。新しいタブの背景に `glass`（リキッドガラス）を追加
- 2026-08-16: 非アクティブ時に透過が消える件を修正。DWMの仕様なので、非アクティブの間だけacrylicを押し直し続ける（`syncMaterialKeepAlive()`）。設定項目は増やしていない
- 2026-08-16: 半透明（`windowStyle: 'translucent'`）を完全透過（0%）まで対応。`windowTranslucency` の下限20%を撤廃、内部ページ用に `translucentPageScrim`（既定100=不透明）を新設、`.tab.active` に線での識別を追加（詳細: [[2026-08-16_translucent-full-transparency]]）
