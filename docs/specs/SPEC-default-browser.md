# SPEC-default-browser: 既定ブラウザ

## 概要
Roopieを Windows の「ブラウザ」として選択可能な状態にレジストリ登録し、Windows設定アプリ経由で既定に設定するようバックオフ付きで促す。
`Capabilities` 登録方式（Chrome/Edge/Vivaldi等と同様の仕組み）。

## 詳細

### ファイル構成
- `default-browser-registry.js`（84行）— HKCUレジストリ書き込み
- `default-browser.js`（189行）— 状態判定・プロンプト制御

### default-browser-registry.js
エクスポート: `register()`（非同期、`reg.exe` 経由でHKCUキーを書き込み）, `stamp()`, `APP_NAME='Roopie'`, `PROG_ID='RoopieHTML'`

### default-browser.js
エクスポート: `init`, `isDefault`, `refresh`, `shouldPrompt`, `markShown`, `dismiss`, `setAsDefault`, `decidePrompt`（純粋関数、テスト容易）, `settle`, `SNOOZE_AFTER=2`, `SNOOZE_MS=14日`
状態変化検出時、全ウィンドウへ `default-browser:state` を送信。

### IPC（`ipc.js`）
`default-browser:set`（on）, `default-browser:dismiss`（on）, `default-browser:get`（handle）, `default-browser:request`（handle）

### 制約・注意点
- レジストリ書き込みは `app.isPackaged` の場合のみ実行（開発中に `electron.exe` がOSの既定ブラウザ枠を乗っ取らないようにするため）。
- `app.setAsDefaultProtocolClient` / `app.isDefaultProtocolClient` は `HKCU\Software\Classes\http` のみを操作し、それだけではWindowsの既定アプリ一覧にすら表示されない。Chrome/Edge/Vivaldi同様に `StartMenuInternet` + `InstallInfo` + `Capabilities` + `RegisteredApplications` を追加で書き込む必要がある（`InstallInfo` サブキーはレガシーSPAD時代のものだが、Windowsがアプリを「ブラウザ」として数えるのに依然必須なことを実機確認済み）。
- 現在の実際の既定ブラウザは `app.isDefaultProtocolClient()` ではなく `UserChoice` レジストリ（`reg.exe query` 経由）から読む。前者はRoopieが自身の `HKCU\...\http` キーを書いた直後にWindowsの実際の既定が変わっていなくても `true` を返してしまうため。
- プロンプトのバックオフ: 最初の2回は起動毎に表示、以降2週間スヌーズ。ユーザーが「既定に設定」をクリックすると（`setAsDefault`）`settle()` され二度と聞かれない。ただし実際にOSダイアログを完了したかはアプリ側では確認不能（設定を開いた時点で意図ありとみなす）。
- アンインストール時のレジストリ削除は本モジュールではなく `build/installer.nsh` で行う。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. パッケージ版起動時にレジストリ登録が行われ、Windows設定の既定アプリ一覧にRoopieが表示されること
  2. 開発版（`app.isPackaged=false`）ではレジストリ書き込みが行われないこと
  3. プロンプトのバックオフ（2回表示→2週間スヌーズ→設定後は表示なし）が仕様どおり動作すること

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
