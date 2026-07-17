---
name: verify
description: Roopieの変更をランタイムで検証する手順(ビルド不要・Electron直接起動)。CDPは使えないため、専用ハーネスでsendInputEvent+スクショを使う
---

# Roopie の検証レシピ

ビルド工程なし。`npx electron <script>` で直接起動する。CSSだけ `npm run build:css`(tailwind.css → pages/app.css)が必要。

## 起動・エラー確認

- `npm run start:verify` — 本物のアプリを起動し、全レンダラーのコンソールエラー・クラッシュ・メインの未捕捉例外をターミナルに出す(バックグラウンド実行して出力ファイルをtailする)
- Electron 43ではCDP(9222)が応答しない。**start:debugでのCDP検証は不可**。UI操作の自動化は下記ハーネス方式を使う

## ハーネス方式(実UI検証)

一時userDataで本物のメインプロセスを動かし、`webContents.sendInputEvent`(信頼済みイベント)でクリック/キー入力、`webContents.capturePage()` でスクショを撮る。既存ハーネス(いずれも `npx electron scripts/<name>.js` で実行、全て自己判定でOK/NGを出力):

- `scripts/test-profile-switch-ui.js [スクショdir]` — プロファイル切り替え(Edge挙動)。ピル→メニュー→行クリックまで実UI。ハーネスの雛形としてもこれを参照
- `scripts/test-multi-profile.js` — マルチプロファイルの構造検証(ウィンドウ/データ分離/共有トグル)
- `scripts/test-autofill-preload.js` — ページ内オートフィルのE2E(フェイクipcMain+実preload+テストフォーム)
- `scripts/test-autofill-main.js` — Passwords/Autofillクラスのロジック
- `scripts/test-newtab-widgets.js` — スタート画面ウィジェット(`stub-internal-preload.js` でroopieInternalを差し替えて実DOM描画)

## ハーネス作成時の注意

- `app.setPath('userData', 一時dir)` を **browser.js の require より前に**(実プロファイルを汚さない)
- `registerIpc()` → `browser.initData()` → `browser.createWindow()` の順
- タブはWebContentsViewなので、chrome UIのスクショ(`window.webContents.capturePage()`)にページ内容は写らない。ページ内容はタブの `view.webContents.capturePage()` を別撮り
- オーバーレイ(メニュー)は `ctx.tabManager.overlay.webContents`。クリック座標はそのwebContentsローカル
- `app.on('window-all-closed', () => {})` を入れて自前で `app.exit()` する
- アプリ本体が起動中でも実行できる(別userData=別ロック)。ただし数秒ウィンドウが表示される
