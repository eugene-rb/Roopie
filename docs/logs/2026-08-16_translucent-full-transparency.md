# 2026-08-16 半透明テーマを完全透過(0%)まで対応

前提: 同日の [[2026-08-16_focus-material]] の続き。ユーザー依頼「半透明のテーマ時に完全透過まで対応して」。

## State

- 作業対象: `src/main/browser.js`, `src/renderer/pages/window-theme.js`, `src/renderer/tailwind.css`,
  `src/renderer/pages/{settings.html,settings.js}`
- 完了度: 実装100%・ハーネス検証済み。実機目視は未実施(下記参照)
- ブロッカーなし

## 発端

「半透明」(`windowStyle: 'translucent'`)テーマで「UIの透け具合」を下げても20%が下限で、
帯(タブバー・ツールバー)が完全には透けなかった。「完全透過まで対応して」との依頼。

## 調査でわかったこと

- `windowTranslucency` の下限は `browser.js` の `WINDOW_TRANSLUCENCY_RANGE`、
  `window-theme.js` の `Math.max(20, ...)`、`settings.html` の `min="20"` の**3箇所が一致して初めて動く**
  (1箇所だけ変えると「保存はできるが20に描画で戻る」「保存自体が20に巻き戻る」という静かな不整合になる。
  過去ログの「THEME_BACKGROUNDSへの追加漏れ」と同じ形の罠)
- 「内部ページの下地」(`pageScrim`)は liquidglass専用で、半透明では設定行そのものが出ない
  (`settings.js` の `pageScrimRowEl.classList.toggle('hidden', style !== 'glass')`)
- 0%まで下げると次の2つが読めなくなる:
  - メニュー・ドロップダウン(`--menu-bg` が `--surface-alpha` に連動して透明になる)
  - アクティブなタブ(`--tab-active` が同様に透明になり、他のタブと区別できない)

## 決定(ユーザーとの相談で確定)

1. **完全透過の範囲**: 「UIの透け具合」(クロームの帯)に加えて、**内部ページ(設定・履歴・サイドパネル等)も対象**。
   ただし内部ページの既定は**不透明のまま**(半透明は元々内部ページを透かしていなかったため、
   既定値だけでは見た目を変えない)。liquidglassの`pageScrim`(既定0%=透過)とは既定の向きが逆なので、
   **別フィールド`translucentPageScrim`(既定100%=不透明)を新設**した。1フィールドを共用して
   スタイルごとに既定を変える案は分岐が読みにくくなるため採らなかった。
2. **可読性の落とし所**: メニュー・アクティブタブは「面(不透明フロア)ではなく線を残す」方式に。
   - メニュー: 既存の `border: 1px solid var(--border)` が元々 `--surface-alpha` と無関係に描かれているため、
     **変更不要**(0%でも境界線は残る)
   - アクティブタブ: `.tab.split` と同じ手法(`box-shadow: inset 0 -2px 0 var(--accent)`)を追加。
     `--tab-active` の塗りが完全に透明になっても、線と文字色(`--text` vs 非アクティブの`--text-dim`)で判別できる。
     ただし `#tabs > .tab.pinned`(タブバー端に張り付いている間だけ付くクラス。常にアクティブなタブ)は
     `#tabs` というID込みの詳細度で `.tab.active` の `box-shadow` を上書きしてしまうため、
     同じ下線をそちらのルールにも直接追記する必要があった(実装直後の advisor 指摘で発覚)

### 実装中に発覚した設計ミスと修正(重要)

最初の実装は `tailwind.css` の内部ページ用セレクタを丸ごと
`:root[data-window-style="glass"]` → `:root:is([data-window-style="glass"], [data-window-style="translucent"])`
に置き換えるだけだった。advisorの指摘で気づいたが、これは**半透明の既定(下地100%=不透明)の見た目を変えてしまう**:

- 背景色(`background-color: color-mix(page-base, page-scrim%, transparent)`)は係数の掛け算なので、
  scrim=100%なら数式が自動的に「不透明側そのもの」に落ちる → **安全**(見た目は変わらない)
- しかし `--card`/`--card-hover` のトークン差し替え・アクセント色の光(`background-image`)・
  `backdrop-filter`・不透明フロア(`--glass-menu`)は**固定値の上書き**であり、scrimの値を一切見ていない。
  style だけで拡張すると、半透明の既定でも常にこれらが発火し、`.card`の背景が10%アルファの薄いガラス面に、
  `body`にアクセント色の光が乗る、という**意図しない見た目の変化**が起きる

対処: `window-theme.js` に `[data-page-glass="1"]` という別判定フラグを追加した。

```js
const showsPageGlass = windowStyle === 'glass' || (usesTranslucentScrim && scrim < 100);
```

liquidglassは常時true(既存動作を維持)。半透明は**実際に下地を下げているときだけ**true。
`tailwind.css`側は4箇所を整理し直した:
- 背景色・`.panel-body`の`--page-base`: `:is(glass, translucent)`のまま(係数計算なので安全)
- `--card`swap+光+`backdrop-filter`: `[data-page-glass="1"]`に変更(固定値上書きなので既定では発火させない)
- 不透明フロア(`.modal`等): **半透明には拡張しなかった**。`--c-card`(#1e2128)と`--c-menu`(#23262e)は
  別の色で、適用すると既定でもモーダルの色が微妙にずれるため

修正後、`.card`の背景・`backdrop-filter`・`body`の`background-image`が
半透明の既定で**solidと完全に一致する**ことを実測で確認した(下記検証)。

## 作業ステップ

- [x] 1. `windowTranslucency` の下限を20→0に(3箇所: `browser.js` / `window-theme.js` / `settings.html`)
- [x] 2. `translucentPageScrim` フィールドを新設(既定100・範囲0-100)。`window-theme.js` の
      `--page-scrim` 算出をスタイル別分岐(`translucent`→`translucentPageScrim`/既定100、
      それ以外→`pageScrim`/既定0)に変更
- [x] 3. `tailwind.css` の内部ページ用セレクタ(トークン定義・背景色・backdrop-filter・不透明フロアの4箇所)を
      `:root[data-window-style="glass"]` → `:root:is([data-window-style="glass"], [data-window-style="translucent"])` に拡張。
      あわせて古くなっていたコメント(「WebContentsViewはtransparentではないので黒が出る」という
      2026-08-06以前の誤った前提)を実態に合わせて修正
- [x] 4. `.tab.active` にアクセント色の下線(box-shadow)を追加
- [x] 5. `settings.html`/`settings.js` に半透明専用の「内部ページの透過(半透明)」行を追加
- [x] 6. `npm run build:css`
- [x] 7. 検証(下記)
- [x] 8. `SPEC-theme.md` 更新・このログ

## 検証

- 既存の再利用ハーネス `scripts/test-window-theme.js`(全55項目)は**全てOK**(既存の回帰なし)。
  1回だけ「シークレットの帯は紫のまま」がoklab形式のシリアライズ違いでNGになったが、
  今回の変更を`git stash`で完全に外した状態(変更前のコード)でも同じNGが再現することを確認済み。
  今回の作業と無関係な既存のタイミング依存フレーク(値そのものは同じ紫、`getComputedStyle`の
  色空間シリアライズがoklabになることがあるだけ)と判断した
- 今回分の一時検証(scratchpadに作成、使い捨て。既存ハーネスと同じ「一時userData + browser.js直読み」の型):
  - `windowTranslucency: 0` が20に戻されず保存される/`--surface-alpha`が実際に`0`になる/帯の背景alphaが0になる
  - アクティブタブの`box-shadow`に`inset`が残る(透明でも判別可能)
  - 半透明の既定では`--page-scrim`が`100%`(内部ページは不透明のまま=既定の見た目は不変)
  - `translucentPageScrim: 0`にすると`--page-scrim`が`0%`になり、設定ページの`body`背景色が実際に変化する
  - liquidglassの既定(`pageScrim`)は今回の分岐追加後も`0%`のまま(既存動作に影響なし)
  - **(設計ミス修正後の再検証)** 半透明の既定(`translucentPageScrim: 100`)で `document.querySelector('.card')` の
    背景色・`backdropFilter`・`body`の`backgroundImage`を`windowStyle: 'solid'`と比較し、**3つとも完全一致**することを確認。
    半透明で下地を30%まで下げると`data-page-glass="1"`が立ち、`.card`の背景がsolidと異なる(薄いガラス面になる)ことも確認。
    liquidglassは変更前と同じく常に`data-page-glass="1"`で`.card`がsolidと異なることも確認(既存動作の非退行)

### 未確認(実機目視が必要)

SPEC-theme.mdに既存の通り、**liquidglass/半透明の透過はスクショで判定できない**
(`capturePage()`は透明領域をそのまま透明として返す/`desktopCapturer`はこの環境で透明な子Viewを取りこぼす)。
今回追加した0%まわりは実機の目視で未確認:

- 半透明0%で実際にデスクトップの壁紙まで透けて見えるか
- メニューの境界線(`--border`のalpha0.08)が明るい壁紙で薄すぎないか
- アクティブタブの下線(`--accent`)が背景0%でも十分な太さ・コントラストで見えるか
- `translucentPageScrim`を下げたときの内部ページの読みやすさ

## Risks

- `translucentPageScrim`と`pageScrim`は独立フィールドなので、将来どちらかだけ触って
  もう一方を忘れると「liquidglassだけ直った/半透明だけ直った」になり得る。両方を触る変更は
  必ずこのログのように両方セットで確認すること
- メニュー・アクティブタブの「線」はどちらも固定の薄いalpha(`--border`は0.08、下線は`--accent`そのまま)。
  明るい壁紙・低コントラストのアクセント色では見えにくくなる可能性があり、目視で問題が出たら
  ここを起点に調整する
