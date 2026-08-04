# SPEC-release: リリース/更新

## 概要
`electron-updater` によるインストール済みビルドの自動更新（GitHub Releases参照）。
CIは `master` へのpush毎にビルド・パブリッシュを自動実行する。

## 詳細

### ファイル構成
- `updater.js`（83行）— アプリ内の自動更新ロジック
- `.github/workflows/release.yml` — CIビルド・リリースワークフロー
- `scripts/vmp-sign.js` — electron-builderの`afterPack`フック。VMP署名（下記）

### updater.js
エクスポート: `setupAutoUpdater`, `checkForUpdatesNow`, `updateStatus`, `quitAndInstall`
定数: `FIRST_CHECK_DELAY=10秒`, `CHECK_INTERVAL=15分`
`app.isPackaged` でない場合は何もしない（`state: 'dev'`）。

### release.yml
- バージョンは `package.json` へのコミットではなく `0.1.<run_number>`（ベースは `VERSION_BASE` で設定可）として都度生成 — 「バージョンbumpコミットがCIを再トリガーするループ」を避けるため。
- `electron-builder` 実行前に空のGitHub Releaseを先に作成する — `electron-builder` からの並列アセットアップロードが同一タグに対して重複リリースを作るレースを防ぐため。
- ビルド後、対象タグのリリースが1件のみであること、`latest.yml` と `.exe` が存在することを検証（欠落でビルド失敗、`.blockmap` 欠落は警告のみ）。
- 古いリリースは直近10件を残してプルーニング（1リリースあたり約100MB）。
- パスignoreリストによりdocsのみの変更ではCIをスキップ。

### 制約・注意点
- 自動ダウンロード・終了時自動インストールは両方有効。ダウンロード済み更新に対する確認ダイアログは1回のみ表示（`prompted` フラグ）、「今すぐ再起動」/「後で」（後で＝次回終了時に無言で適用）を選択。

### VMP署名(Widevine/DRM対応)
electronは公式npm版ではなく castLabs Electron for Content Security(ECS。`package.json`の`electron`が`github:castlabs/electron-releases#v43.x+wvcus`)。DRM動画(YouTubeのレンタル/購入・広告付き無料映画等)を再生可能にするため。詳細: `docs/decisions/ADR-0001-widevine-castlabs.md`

- `scripts/vmp-sign.js`が electron-builder の `afterPack` フックとしてパッケージング直後(NSIS化前)に `python -m castlabs_evs.vmp sign-pkg` を実行する
- 署名アカウントは `EVS_ACCOUNT_NAME` / `EVS_PASSWORD` 環境変数(CIは GitHub Secrets)から供給。未設定なら署名をスキップ(ローカルの`npm run dist`はデフォルトでスキップ=署名なしの速いビルド)
- CIの `env:` に `ELECTRON_MIRROR`(castLabsミラー、末尾に`v`を付けない)を設定し、`npm ci`・`electron-builder`双方のelectron本体取得先を差し替える
- **署名なしで公開すると、DRM動画は「エラーは出ずバッファリングホイールが回り続ける」または「この動画のライセンスに問題が発生しました」で再生できない**(2026-08-04実機確認)

## 検証
- コマンド: `npm run start:verify`（アプリ内自動更新ロジックの起動確認）／ `.github/workflows/release.yml` の実行結果（GitHub Actions）
- 確認項目:
  1. パッケージ版でのみ自動更新チェックが起動すること（開発版では無効）
  2. リリースワークフローが対象タグに対しリリースを1件のみ作成すること
  3. `latest.yml` / `.exe` が生成されていること（欠落時はビルド失敗として検知）
  4. CIログでVMP署名が成功していること（`EVS_ACCOUNT_NAME`/`EVS_PASSWORD` Secrets設定後）。公開後、DRM動画（レンタル/購入・広告付き無料映画）が実機で再生できること

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
- 2026-08-04: Widevine対応（`scripts/vmp-sign.js`によるVMP署名、`ELECTRON_MIRROR`）を追加（YouTubeのDRM映画が再生できないバグ対応。詳細: ADR-0001）
