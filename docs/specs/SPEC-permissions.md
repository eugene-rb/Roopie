# SPEC-permissions: サイト権限

## 概要
サイト単位の権限付与（カメラ/マイク/位置情報/通知/フルスクリーン）。許可のみを永続化し、拒否は保存しない（3択方式）。
Chromium自体は権限を記憶しないため、永続化はRoopie側の責務として `site-permissions.js` が担う。

## 詳細

### ファイル構成
- `site-permissions.js`（136行、純粋関数群、クラスなし）

### エクスポート
`hostFor`, `kindsFor`, `isGranted`, `addHost`, `addGrant`, `normalizeHosts`, `normalizeGrants`, `migrateSettings`,
`KINDS = ['camera','microphone','geolocation','notifications','fullscreen']`, `LABELS`, `MAX_SITES=500`

### IPC
本ファイル自体は直接IPCを持たない。`browser.js` が `setPermissionRequestHandler` 等の判定に利用し、ユーザーの許可/拒否応答は `permission:respond`（`ipc.js`）1チャンネルで受ける。`browser.js` 内（約1336〜1480行付近）で `topHost` 算出・ナビゲーション時の一時許可キャッシュ無効化・`isGranted` 判定・許可時の `addGrant`・`kindsFor(permission, details, {ask:true})` によるプロンプト構築を行う。

### 制約・注意点
- **Chromium自体は権限を何も記憶しない**（同一ページで `getUserMedia` を2回呼ぶと両方リクエストハンドラが発火し、ナビゲーション後も再度発火することを実機確認済み）— 永続化は全てRoopie側の責務。
- 永続化されるのは「許可」のみ。「拒否」は一時的（次回再度プロンプト）。「今回のみ許可」（一時許可）はメモリ内のみ（`browser.js` の `tempGrants`）でディスクには書かない。
- ホストマッチングは**完全一致のみ**（サフィックスマッチ禁止）。`youtube.com.evil.net` が `youtube.com` にマッチするなりすましを防ぐため。サブドメイン（`music.youtube.com` 等）は別サイト扱い。
- `kindsFor` のメディア判定: `details.mediaTypes` が空でも `ask: true` の場合はカメラ・マイク両方をリクエストしたものとして扱う（`mediaTypes` が経験的に欠落することがあるため、「空＝何もリクエストなし」と解釈すると過剰許可になる懸念への対応）。
- `migrateSettings` は旧 `fullscreenAllowedSites` 配列を新しい `sitePermissions.fullscreen` 構造へ移行し、**旧キーを削除**することで再マイグレーションを防止。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. カメラ/マイク/位置情報/通知/フルスクリーンの許可・拒否・一時許可が3択どおりに動作すること
  2. `youtube.com.evil.net` のようなホストが正規サイトの許可を誤って引き継がないこと（完全一致確認）
  3. 旧 `fullscreenAllowedSites` を持つ設定ファイルで起動時にマイグレーションが1回だけ実行されること

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
