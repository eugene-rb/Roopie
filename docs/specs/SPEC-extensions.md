# SPEC-extensions: 拡張機能

## 概要
Chrome拡張機能をプロファイル/セッション単位でサポート。`electron-chrome-extensions` + `electron-chrome-web-store` を使用し、ウェブストアからのインストールと「フォルダから読み込み（unpacked）」に対応する。
中核は `ExtensionSupport` クラス（`extension-support.js`）。全ウィンドウで単一インスタンスを共有。

## 詳細

### ファイル構成
- `extension-support.js`（431行、`ExtensionSupport` クラス、default export）

### 主要メソッド
`setBrowser({tabManager, window})`, `attach(session, profileId, disabledIds)`, `install(session, profileId, extensionId)`, `loadUnpacked(session, profileId, sourceDir)`, `list(session)`, `setEnabled(session, profileId, extensionId, enabled)`, `remove(session, profileId, extensionId)`, `addTab(wc)`, `moveTab(wc)`, `selectTab(wc)`

### IPC（`ipc.js`、`browser.extensions.*` を呼ぶ）
`extensions:install`（handle）, `extensions:load-unpacked`（handle）, `extensions:list`（handle）, `extensions:remove`（on）, `extensions:set-enabled`（on）, `extensions:open-options`（on）, `extensions:set-pinned`（on）, `menu:open-extensions` → `menu:show-extensions` をオーバーレイへ送信

### 定数
`LOCAL_DIR_PREFIX = 'local-'`, `LOCAL_INDEX_FILE = '.roopie-local.json'`

### 依存関係
- 依存先: `electron-chrome-extensions`, `electron-chrome-web-store`
- 依存元: `browser.js`（単一インスタンス生成・全ウィンドウ共有）, `ipc.js`

### 制約・注意点
- **ライセンス注記（ファイル内に明記）**: `electron-chrome-extensions` はGPL-3.0（または有償ライセンス）— Roopieの配布にはGPL-3.0条項が適用される。
- 全ウィンドウで `ExtensionSupport` を1インスタンス共有し、`contexts`（tabManager+windowペア）を追跡することで、ツールバーのアクションアイコンが別ウィンドウのアクティブタブ状態を表示してしまう不具合（実際に発生した不具合）を回避。
- `movingTabs` Set により、ウィンドウ間移動中に `electron-chrome-extensions` が呼ぶ `removeTab` がタブを実際に閉じてしまうのを防止。
- MV3 Service Workerは `startWorker` で手動（再）起動（最大5回、200ms間隔）。`loadExtension` だけでは `onInstalled` が発火しないため。フレッシュロード直後の初回試行は失敗する想定（登録レース）。
- 拡張機能の無効化＝`removeExtension` の呼び出し（Electronにネイティブな「無効化」はない）。再有効化は保存済みパスから再ロード（`metaBySession` にキャッシュ、removeされたextensionは `session.extensions` から完全に消えるため）。
- 「フォルダから読み込み」拡張は `profiles/<id>/extensions/local-<slug>-<hash>/` に**コピー**して保存（元フォルダの削除/移動を安全にするため）。同じソースフォルダの再読み込みは重複作成せず上書き更新し、拡張IDを保持（ピン留め/有効状態が持続）。
- アイコンのdata URIは `iconDataFor` で64pxにキャップ。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. ウェブストアからのインストール・フォルダからの読み込みが正常動作すること
  2. 拡張機能の無効化→再有効化でピン留め/設定が保持されること
  3. 複数ウィンドウでツールバーアイコンの状態が混線しないこと
  4. タブのウィンドウ間移動時に拡張機能側で誤ってタブが閉じられないこと

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
