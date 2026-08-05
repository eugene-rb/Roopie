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

### IPC（`ipc.js`）
`theme:get`（handle）, `theme:set`（on）, `theme:get-for` / `theme:set-for`（プロファイル指定、handle/on）, `theme:window-mode-sync`（on）。ブロードキャスト: `theme:state`

### window-theme.js / theme.js
`window.roopieWindowTheme = { apply, resolveMode }` を全内部ページ・メインUIが共用。`theme.js` は `window.roopieInternal.onThemeState` / `getTheme()`（preloadブリッジ）経由でテーマとカスタムCSSを `adoptedStyleSheets` で適用。

### liquidglass（`windowStyle: 'glass'`）の適用範囲
ガラス表現は**背後に何があるか**で3通りに作り分ける。すべて `:root[data-window-style="glass"]` 配下にあり、他のスタイルでは1行も効かない。

| 対象 | 背後にあるもの | 作り方 |
| --- | --- | --- |
| クローム（`#tab-bar` / `#toolbar` / `#bookmark-bar` / `#address-wrap` / `.tab`） | ウィンドウのacrylic | `--surface-alpha` で帯を透かし、`backdrop-filter: blur(--glass-blur)` |
| 内部ページ（履歴・ブックマーク・DL・設定・サイドパネル） | **何もない**（透かすと黒） | ページ自身が `--accent` の光を `background-image`(fixed) で敷き、その上の面をぼかす |
| ミニプレイヤー・タイマー | **実際のウェブページ** | `transparent: true` の浮遊ビューなので面を薄めて素通しでぼかす（本物のガラス） |

- 面の色は `--glass-surface` / `--glass-hover` / `--glass-border` / `--glass-page-blur`。既定（`:root`）では `--card` / `--card-hover` / `--border` / `0px` にエイリアスされ、liquidglass 以外では見た目が変わらない。
- 色は白決め打ちではなく `rgb(var(--tint) / α)` で作る。`--tint` がダーク `255 255 255` / ライト `15 23 42` に切り替わるのでライトモードで面が消えない。
- 内部ページの面は個々のルールではなく **`--card` / `--card-hover` のトークン差し替え**で揃える（`.card` `.search` `.btn` `.modal` とそのホバーが一度に効く）。
- `backdrop-filter` はコンテナ級（`.card` `.search` `.modal` `.panel-menu` `.panel-input`）だけに掛ける。行やボタンは数が多く、1つずつ持たせるとGPUが重い（履歴は数百行になりうる）。
- `.card` / `.modal` は `roopie://menu` でも使われるため、セレクタは必ず内部ページ限定の body スコープ配下に置く。
- 背景の光を敷かない除外先: `.chrome-body`（クローム用ルールが担当）/ `.menu-body`（本物のacrylicが効いている）/ `.onboarding`（自前の `.ob-glow` を持つ）/ `.player-body`・`.timerp-body`・`.divider-body`（透明な浮遊ビュー）/ `[data-bg]`（新しいタブは独自の背景システム）。

### 制約・注意点
- Windows 11のネイティブアクリル素材は `backgroundColor` が**透明**である必要がある（実機確認済み）。不透明度指定とアクリルは併用不可（`setOpacity` がぼかしを打ち消す）。
- `nativeTheme.themeSource` は意図的に書き換えない（アプリ全体に影響しプロファイル単位のライト/ダーク切替が壊れるため）。
- シークレットウィンドウは常にダーク＋単色を強制し、プロファイルのテーマ設定を無視する（`browser.js` のフレーム色、`window-theme.js` の `opts.incognito` 短絡の両方で）。
- `window-theme.js`: 透過が許されるのはクローム/オーバーレイ（`opts.overlay`、`roopie://menu` 等）のみ。内部ページとサイドパネルは不透明のまま（サイドパネルの `WebContentsView` 自体は透過しないため、透過指定すると黒く見える）。**`--surface-alpha` を内部ページで下げてはならない**——これが黒画面事故の原因になる。内部ページのガラスは透過ではなく「自前で敷いた光をぼかす」方式で作る（上表を参照）。
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
