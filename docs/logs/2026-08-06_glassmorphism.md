# 2026-08-06 グラスモーフィズムを内部ページへ拡張

## State

- 作業対象: `src/renderer/tailwind.css`, `src/renderer/pages/onboarding.css`, `scripts/gen-screenshots.js`
- 完了度: **100%（全7ステップ完了）**
- ブロッカー: なし
- 残った未確認: ミニプレイヤー/タイマーの実描画の目視のみ（透明ビューであることはソースで確定済み）

## 背景

「glassmorphism をアプリ全体に適用」の依頼。調べたところ**すでに実装済みの箇所が2つ**あった。

1. ブラウザUI(クローム) — `windowStyle === 'glass'`(liquidglass)。`tailwind.css:169-189`
2. 新しいタブ / オンボーディング — `newtab.css`(8箇所)、`onboarding.css`(`.ob-glow` + `--ob-card`)

未対応は**それ以外の内部ページ**（履歴・ブックマーク・ダウンロード・設定・サイドパネル・
タイマーパネル・メディアプレイヤー）。ここだけ不透明な `var(--card)` のまま浮いている。

→ 本作業は「新デザインシステム導入」ではなく、**既存の `glass` を内部ページへ届かせる**こと。

## Decisions

- **新しい設定項目は増やさない** → すべて `:root[data-window-style="glass"]` に紐づける。
  常時適用にすると `solid` を選んでいる人のUIが勝手に変わり、設定の意味が壊れるため。
- **本物の透過は使わない** → `window-theme.js:15-19` / `SPEC-theme.md:29` の通り、
  内部ページは WebContentsView が transparent でないため透かすと**黒が出る**。
  代わりに**ページ自身が背景レイヤーを持ち、その上のカードを `backdrop-filter` でぼかす**。
  同一ドキュメント内の背景なので blur が正しく効く。
  → これは `onboarding.css` の `.ob-glow` が既にやっている手法の一般化。
- **`--surface-alpha` には一切触れない** → 触ると黒画面事故になる。
- **色は `rgb(var(--tint) / α)`** → `--tint` がダーク `255 255 255` / ライト `15 23 42` で
  切り替わるので、ライトモード対応が無料で付く。ハードコード白は使わない。
- **`backdrop-filter` はコンテナ単位** → 履歴の数百行に個別に掛けるとGPUが重い。

## 作業ステップ（1ステップ = 1コミット、`glassmorphism: <名前>`）

- [x] 1. ガラストークン + 内部ページ背景レイヤー — `tailwind.css` → `2733e5e`
      追加トークン: `--glass-surface` `--glass-hover` `--glass-border` `--glass-page-blur`
      （既定は `--card`/`--card-hover`/`--border`/`0px` にエイリアス＝glass以外は無変化）
      背景レイヤーは `body` の `background-image`(fixed) として敷く。`::before` にしないのは
      背景伝播とスタッキングの罠を避けるため。除外: `.chrome-body` `.menu-body` `.onboarding`
      `.player-body` `.timerp-body` `.divider-body` `[data-bg]`
- [x] 2. 汎用ページのガラス化 — `tailwind.css` → `f49f83d`
      **トークン差し替え方式**を採用: body スコープで `--card` / `--card-hover` を
      `--glass-surface` / `--glass-hover` に差し替えると、`.card` `.search` `.btn` `.modal`
      とそのホバーが一度に揃う。個々のルールを書き換えるより差分が圧倒的に小さい。
      ぼかしは `:is(.card, .search, .modal)` だけ（行・ボタンは数が多くGPUが重い）。
      `.list` `.empty-state` は背景を持たないコンテナなので対象外だった。
      `.card`/`.modal` は `menu.html` でも使われている（10箇所ヒット）ため body スコープ必須。
- [x] 3. サイドパネルのガラス化 — `tailwind.css` → `f167106`
      `.section-tab.active` `.panel-item:hover` `.panel-menu` `.panel-input` は
      いずれも既に `--card`/`--card-hover` 参照だったので、ステップ2のトークン差し替えで
      色は自動的に揃っていた。足したのは `.panel-menu` `.panel-input` のぼかしのみ。
      `.section-tabs` は背景なし（`border-left` だけ）なので対象外。
- [x] 4. タイマーパネル / メディアプレイヤー — `tailwind.css` → `87ec2e8`
      懸案だった「透明ビューか否か」は**ソースで決着**: `media-player.js:39` と
      `timer-panel.js:41` がどちらも `transparent: true` かつ
      `setBackgroundColor('#00000000')`。よって背後にあるのは自前の光ではなく
      **実際のウェブページ**で、`backdrop-filter` が本当にページをぼかす。
      ここだけは**本物のガラス**にできるので、面を薄めた（薄めても黒は出ない）。
      タイマーのピルは iOS ライブアクティビティ風の固定色だが、実機のそれ自体が
      半透明マテリアルなのでガラス化は意図に沿う。高さ44pxは `ROW_HEIGHT` と
      対応しているので触っていない。
      color-mix 非対応時のフォールバックは**不透明側**に落ちるので黒くならない。
      **未実施**: この2つは `gen-screenshots.js` に写らないため、実描画の目視は未確認。
      見るなら `npx electron scripts/test-media-player.js` / `test-timer-ui.js`。
- [x] 5. オンボーディングの質感合わせ — `onboarding.css` → `69e1912`
      **計画から逸脱**: 当初は `--tint` 経由にする予定だったが、このページは
      `--ob-bg: #0f1117` で**常にダーク固定**と判明。`--tint` はライトモードで黒側に
      反転するので、暗い背景に黒の重ね色が乗って面が消える。よって白のまま値だけ揃えた
      （`--ob-card` 0.05→0.10、`--ob-border` 0.1→0.18）＋コンテナ級に `backdrop-filter`。
- [x] 6. `start:verify` + 既存ハーネスでスクショ確認 → `b9f865f`
      `start:verify`: 起動しエラーなし。ログに出るのは既存のもの（ユーザーの拡張機能の
      権限警告と、復元されたYouTubeタブのCORS）だけで、CSS変更由来のものは無し。
      **注意**: Roopie が起動中だと単一インスタンスロックで検証用の起動が即 exit 0 する。
      ログが空で終わったらまず `Get-Process Roopie` を疑うこと。
      スクショ: `gen-screenshots.js` に `07-theme-glass-{dark,light}` を追加して撮影。
      - glass × ダーク → 光が出てカードが半透明ガラスになる ✓
      - glass × ライト → 光もカードも見える（`--tint` 反転が効き面が消えない）✓
      - **solid × ダーク（既存の `04-settings`）→ 完全に従来通り。退行なし** ✓
- [x] 7. `SPEC-theme.md` 追記・このログの仕上げ
      「背後にあるものごとに3通り」の表を詳細節に追加。制約節に
      「`--surface-alpha` を内部ページで下げてはならない」と単一インスタンスロックの罠を明記。
      検証節にスクショの見どころを追加。

## 中断したときの再開手順

1. `git log --oneline | grep glassmorphism` で最後に終わったステップを見る
2. このファイルのチェックリストと突き合わせる
3. 次の未チェック項目から再開する

各ステップは独立して価値を持つので、どこで止まっても壊れた状態にはならない。

## スコープ外（理由付き）

- **`newtab.css`** — 既にガラス完成済み。背景画像/グラデ前提で白半透明が正解なので、
  `--tint` 化するとライトモードでかえって崩れる。触らない。
- **`roopie://menu` (`.menu-body`)** — `theme.js:43` で `overlay: true`、本物の acrylic が
  効いている。偽の背景レイヤーを敷くと潰すので除外。
- **シークレット** — `window-theme.js:86` で `data-window-style` 自体が外れるので元から当たらない。

## Risks

- CSS衝突（CLAUDE.md に過去事故の記載）→ `.card`/`.modal` はクローム側で未使用と grep 済み。
  それでもセレクタは `body:not(.chrome-body):not(.menu-body)` で内部ページに限定する。
- パターン様式の細線が blur で消える → `data-window-pattern` 系には blur を掛けない
  （`tailwind.css:191-193` の既存方針を踏襲）。

## 結果

`liquidglass` を選ぶと、クロームだけでなく**内部ページ・オンボーディング・
ミニプレイヤー・タイマー**までガラスになる。設定項目は1つも増やしていない
（既存の外観スタイル選択にすべて紐づく）。`solid` 等では1行も効かない。

背後にあるものが3通りあり、それぞれ作り方が違うのがこの実装の要点:

| 対象 | 背後 | 作り方 |
| --- | --- | --- |
| クローム | ウィンドウのacrylic | 帯を透かして `backdrop-filter` |
| 内部ページ | **何もない**（透かすと黒） | 自前で光を敷き、その上の面をぼかす |
| プレイヤー・タイマー | **実ページ** | 面を薄めて素通しでぼかす＝本物のガラス |

## Next Steps

- ミニプレイヤー / タイマーの実描画を見る:
  `npx electron scripts/test-media-player.js` / `scripts/test-timer-ui.js`
- 光の強さ（`--accent` 40%/22%/26%）は控えめにしてある。もっと出したい/抑えたいと
  言われたら `tailwind.css` の内部ページ用 `background-image` の3つの radial-gradient を触る。
