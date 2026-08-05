# 2026-08-06 グラスモーフィズムを内部ページへ拡張

## State

- 作業対象: `src/renderer/tailwind.css`, `src/renderer/pages/onboarding.css`
- 完了度: 0%（着手直後）
- ブロッカー: なし

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
- [ ] 4. タイマーパネル / メディアプレイヤー — `tailwind.css`
      **要実機確認**: `.player-body` `.timerp-body` は `background: transparent` の
      浮遊オーバーレイ。透明な WebContentsView なら `backdrop-filter` が**本物に効く**が、
      そうでなければ黒が出る。ステップ6の検証で確かめてから実装方針を決める。
      現状はステップ1の除外リストに入れてあり、従来通り不透明のまま（＝安全側）。
- [x] 5. オンボーディングの質感合わせ — `onboarding.css` → `69e1912`
      **計画から逸脱**: 当初は `--tint` 経由にする予定だったが、このページは
      `--ob-bg: #0f1117` で**常にダーク固定**と判明。`--tint` はライトモードで黒側に
      反転するので、暗い背景に黒の重ね色が乗って面が消える。よって白のまま値だけ揃えた
      （`--ob-card` 0.05→0.10、`--ob-border` 0.1→0.18）＋コンテナ級に `backdrop-filter`。
- [ ] 6. `start:verify` + 既存ハーネスでスクショ確認
- [ ] 7. `SPEC-theme.md` 追記・このログの仕上げ

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

## Next Steps

1. ステップ1から順に実施
2. 各ステップ後に `npm run build:css`（`app.css` は生成物、直接編集しない）
