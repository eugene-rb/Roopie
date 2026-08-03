# SPEC-tabs: タブ管理

## 概要
`WebContentsView` ベースのタブ管理。ウィンドウ内のタブ生成・切替・分割（Split View）・ドラッグ移動・ドメインベースのグループ化を担う。
ウィンドウ間移動は View ごと載せ替え（URL再読み込みはしない）。
中核は `TabManager` クラス（`tab-manager.js`）。グループ化・ドラッグ判定・コンテキストメニューは補助モジュールに分離。

## 詳細

### ファイル構成
| ファイル | 行数 | 役割 |
|---|---|---|
| `tab-manager.js` | 1736 | `TabManager` クラス本体。View生成・切替・分割・状態配信 |
| `tab-groups.js` | 64 | ドメイングルーピングの純粋関数群 |
| `tab-drag.js` | 23 | ドラッグ離脱判定（`shouldDetach`） |
| `tab-context-menu.js` | 155 | タブ/タブグループの右クリックメニュー |

### エクスポート
- `tab-manager.js`: `TabManager`（default）, `TabManager.NEW_TAB_URL`, `TabManager.applyPermissionPolicy`
- `tab-groups.js`: `GROUP_COLORS`, `registrableDomain`, `planDomainGroups`, `nextGroupColor`
- `tab-drag.js`: `shouldDetach`
- `tab-context-menu.js`: `showTabMenu`, `showTabGroupMenu`

### IPC（`ipc.js` に集約登録、`tabsOf(e)` でウィンドウの `TabManager` に振り分け）
- `tabs:new` / `tabs:close` / `tabs:switch` / `tabs:move` / `tabs:toggle-mute`
- `tabs:drag-start` / `tabs:drag-end` / `tabs:move-from-window`
- `tabs:navigate` / `tabs:back` / `tabs:forward` / `tabs:reload` / `tabs:stop` / `tabs:zoom`
- `tabs:context-menu`
- `tab-group:select` / `tab-group:rename` / `tab-group:new-tab` / `tab-group:assign` / `tab-group:create` / `tab-group:context-menu`
- `tabs:split-with` / `tabs:split-toggle-direction` / `tabs:split-close`
- `split:drop` / `split:resize-start` / `split:resize` / `split:resize-end`

送信側（`webContents.send`）: `tabs:state`（全体状態のブロードキャスト）, `find:result`, `ui:html-fullscreen`, `overlay:drop-zones`, `split:divider`, `tab-group:rename-request`（インライン改名トリガー）。

### 依存関係
- 依存先: `context-menu.js`, `search-engines.js`, `google-accounts.js`, `media-guard.js`, `popup-window.js`, `tab-groups.js`, `page-translate.js`, Electron `WebContentsView` / `screen`
- 依存元: `ipc.js`, `browser.js`, `tab-context-menu.js`, `extension-support.js`（`tabManager.tabs` / `createTab` / `closeTab` 経由）, `page-translate.js`

### 制約・注意点
- ドラッグ離脱判定は DOM `dragend` 座標ではなく、メインプロセス側で `screen.getCursorScreenPoint()` を再取得して行う（高速ドラッグやウィンドウ外ドロップで座標がズレる不具合の回避）。
- ドメイングルーピングは完全な Public Suffix List ではなく、日本語利用でよく使う実効TLDの一部（`co` / `ne` / `or` / `com` 等）のみを手動サポート（`co.jp` / `com.au` など）。
- グループ化は同一ドメインのタブが2件以上（`minTabs`）ある場合のみ発生させ、意味のない単独グループを作らない。
- 「右側のタブを全て閉じる」はインデックスのズレを避けるため、対象IDを先に収集してから閉じる。
- グループ色は固定9色パレットを使い切ったら先頭から再利用する。
- `target="_blank"` / Ctrl+クリック等で `setWindowOpenHandler` 経由に開く新規タブは、`details.referrer` を `createTab` の `referrer` オプションへ引き継ぎ、`loadURL` に `httpReferrer` として渡す。渡さないとリファラが消え、pixiv等のホットリンク防止に引っかかる。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. タブの新規作成・切替・クローズでコンソールエラーが出ないこと
  2. タブ分割（Split View）の作成・リサイズ・解除が正常に動作すること
  3. ドメイングループの自動生成・手動アサイン・ウィンドウ間ドラッグ移動でクラッシュしないこと

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
- 2026-08-04: 新規タブへのリファラ引き継ぎを追加（ユーザー報告「pixivでリファラエラーが出る」。target=_blankで開いた画像等のリファラが消えていたため）
