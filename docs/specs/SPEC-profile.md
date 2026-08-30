# SPEC-profile: プロファイル

## 概要
独立したブラウザIDを複数管理（Cookie/セッション/ブックマーク等を分離）。各プロファイルは専用のElectronセッションパーティションを持ち、項目単位でプロファイル間データ共有をオプション設定できる。
ウィンドウ単位でプロファイルが紐づく。

## 詳細

### ファイル構成
- `profiles.js`（221行、`Profiles` クラス）

### エクスポート
`Profiles`（default）, `Profiles.SHARABLE_KEYS`, `Profiles.partitionFor`
主要メソッド: `list()`, `active()`, `create(name)`, `rename(id, name)`, `remove(id)`, `switchTo(id)`, `setGoogleEnabled` / `setGooglePrimary` / `forgetAccount`, `setIcon(id, icon)`, `setShared(id, key, shared)`, `setTor(id, enabled)`, `dataFile(profile, key)`, `sessionFor(profile)`, `partitionFor(profile)`

`SHARABLE_KEYS`: `bookmarks, history, downloads, settings, gestures, theme, passwords, autofill`（Cookie/ログイン状態はこのリストに含まれず常にプロファイル分離、トグル不可）

### IPC（`ipc.js`）
`profiles:list`（handle）, `profiles:create` / `profiles:rename` / `profiles:remove` / `profiles:switch` / `profiles:set-shared` / `profiles:set-icon` / `profiles:set-tor`（すべて on）

### 制約・注意点
- `remove(id)` は最後の1プロファイルの削除を拒否する。削除時はディスク上の `profiles/<id>` ディレクトリを除去し、セッションパーティションのストレージデータをクリアする。
- セッションパーティション名は `persist:profile-<id>`（`partitionFor` で決定）。
- アイコン検証はサイドパネルのWebパネルアイコンと同ルール: 絵文字16文字以内、画像は `data:image/...` 形式かつ400,000バイト以内。
- `dataFile(profile, key)` が共有/非共有のファイル振り分けの基点: 共有時は `profiles/shared/<key>.json`、非共有時は `profiles/<id>/<key>.json`。
- コンストラクタは旧 `profiles.json` 構造（`shared` / `google` / `icon` / `tor` フィールド欠落）を後方互換で補完し、非推奨の `googleAccount` フィールドを削除する。

### 横断ルール（CLAUDE.md 不変条件8）
`browser.js` / `gesture-input.js` / `page-translate.js` / `ipc.js` / `toolbar-context-menu.js` など多くのモジュールは、
`browser.bundleFor(ctx?.profileId ?? browser.profiles?.activeId)` というパターンでプロファイル単位の設定を解決する。
すなわち各機能は「ウィンドウの `ctx.profileId`」を経由して設定/テーマ/ジェスチャーを読むべきで、ウィンドウ文脈が無い場合のみグローバルなアクティブプロファイルにフォールバックする。
`browser.js` がプロファイルIDをキーにした `profileData` マップ（`bundleFor`）を保持し、各バンドルが `{ settings, theme, gestures, ... }` ストア＋セッション/拡張機能配線を持つ — これが `profiles.js`（ID/セッションパーティション）と各設定利用機能との結節点。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. プロファイルの作成・切替・削除（最後の1件削除拒否含む）が正常動作すること
  2. 共有設定（`SHARABLE_KEYS`）の切替でデータファイルの参照先が `shared/` ⇄ プロファイル個別に正しく切り替わること
  3. Cookie/ログイン状態が共有設定に関わらず常にプロファイル分離されていること

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
