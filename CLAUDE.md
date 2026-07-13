- 対話・出力
  - 対話は必ず日本語で行う
  - 質問には指定がない限り短い文章で回答
  - 『鋭い指摘です』などの感想や相槌を省き、結論から簡潔に回答
  - 長文のエラーは内容をそのまま出力せず重要な部分のみ出力し、エラーの原因や対処法のみ簡潔に伝える
- MCPやコマンドについて
  - トークン消費を抑えられるように gh コマンドと github MCP を使い分ける
- 進捗管理
  - 作業の進捗や経過を逐一このファイルに記録し、次回以降スムーズに再開できるようにする
- バージョン管理
  - 変更は必ずgitで管理し、いつでも元に戻せるようにする
-ユーザーに求められた改善は逐一ここに追記し、し、必ず次回以降に聞き継ぐ

---

## プロジェクト概要

Roopie: Chromiumベース(Electron)の独自ブラウザ。詳細は `要件定義書.md` を参照。

## 進捗記録

### 2026-07-14: Phase 1 完了(最小構成ブラウザ)

- git初期化、Electron 43.1.0 でプロジェクトをセットアップ(`npm start` で起動)
- 実装済み機能:
  - タブ(新規作成・切り替え・閉じる・中クリックで閉じる・favicon/読み込みスピナー表示)
  - アドレスバー(URL入力/Google検索の自動判定)
  - 戻る・進む・再読み込み
  - target=_blank リンクは新しいタブで開く
  - ショートカット: Ctrl+T / Ctrl+W / Ctrl+L / Ctrl+R / Ctrl+Tab / Alt+←→ / F12
- 構成:
  - `src/main/main.js` — エントリポイント、ウィンドウ生成、メニュー(ショートカット)、IPC受付
  - `src/main/tab-manager.js` — WebContentsView によるタブ管理(1タブ=1 WebContentsView、UI領域の高さは CHROME_HEIGHT=84px)
  - `src/preload/preload.js` — contextBridge で `window.roopie` API を公開
  - `src/renderer/` — ブラウザUI(タブバー+ツールバー、ダークテーマ)
- 技術メモ:
  - webviewタグではなく WebContentsView を採用(Electron推奨の現行方式)
  - セキュリティ: 全WebContentsで contextIsolation: true / sandbox: true / nodeIntegration: false
  - 起動時ログの `blink.mojom.WidgetHost` エラーはChromiumの無害なノイズ

### 2026-07-14: Chrome同等の基本機能を実装

ユーザー判断により **拡張機能対応(Phase 2)は後回し**。先にChrome相当の基本機能を実装した。

- 追加機能:
  - ブックマーク(スターボタン/Ctrl+D、ブックマークバー Ctrl+Shift+B、管理ページ Ctrl+Shift+O、名前変更・削除)
  - 履歴(自動記録、履歴ページ Ctrl+H、検索・個別削除・全削除)
  - ダウンロード(進捗表示、一時停止/再開/キャンセル、開く・フォルダを表示、Ctrl+J)
  - ページ内検索(Ctrl+F、Enter/Shift+Enterで前後移動、件数表示)
  - ズーム(Ctrl+ +/-/0、ツールバーに倍率表示)
  - 右クリックメニュー(リンク/画像/選択テキスト/ページ、検証)
  - 新規タブページ(時計・挨拶・検索欄・ブックマーククイックリンク)
  - タブ番号ショートカット(Ctrl+1〜9)、印刷(Ctrl+P)、全画面、マウスの戻る/進むボタン
- 追加ファイル:
  - `src/main/store.js` — userData配下へのJSON永続化(デバウンス保存 + 終了時flush)
  - `src/main/history.js` / `bookmarks.js` / `downloads.js` — 各データ管理
  - `src/main/context-menu.js` — 右クリックメニュー
  - `src/preload/internal-preload.js` — 内部ページ用API(`window.roopieInternal`)
  - `src/renderer/pages/` — 内部ページ(newtab / history / bookmarks / downloads)
- 技術メモ:
  - 内部ページは独自スキーム `roopie://<host>` で配信(`protocol.handle` → `src/renderer/pages/` を解決)
  - 内部ページのpreloadは `location.protocol === 'roopie:'` のときだけAPIを公開する。通常タブにはpreloadを渡さない
  - 通常タブ→内部ページの遷移は新しいタブで開く(preloadは生成後に変更できないため)
  - UI領域の高さは固定値ではなくレンダラーがResizeObserverで通知(ブックマークバー/検索バーの開閉に追従)
  - データ保存先: `%APPDATA%/Roopie/`(history.json / bookmarks.json / downloads.json / settings.json)
- 検証: CDP(`--remote-debugging-port=9222`)経由でナビゲーション・ブックマーク・履歴・内部ページ・ページ内検索が動作することを確認済み

### 2026-07-14: Phase 3 プロファイル機能 + 設定画面

- プロファイルごとに Electron の session パーティション(`persist:profile-<id>`)を分離。Cookie・ログインセッションは常に独立(トグルなし)
- 「共有する/しない」トグル(実装済み): ブックマーク / 閲覧履歴 / ダウンロード履歴 / ブラウザ設定
  - ONにしたプロファイル同士が `%APPDATA%/Roopie/shared/*.json` を共有する。OFFなら `profiles/<id>/*.json` を使う
  - 未実装項目(保存パスワード・マウスジェスチャー・テーマ・拡張機能)は設定画面に無効トグルで表示だけしてある
- 設定画面 `roopie://settings`(Ctrl+,): プロファイルの追加・名前変更・削除・切り替え、共有トグル、ブックマークバー表示設定
- ツールバーにプロファイルボタン(色付きアバター)。クリックで切り替えバーを開閉
- 追加/変更ファイル:
  - `src/main/profiles.js` — プロファイル管理(一覧・作成・削除・切り替え・共有設定・保存先解決)
  - `src/main/store.js` — 絶対パス受け取りに変更(プロファイルごとの保存先に対応)
  - `src/main/{history,bookmarks,downloads}.js` — `setStore()` で保存先を差し替え可能に
  - `src/main/tab-manager.js` — `switchSession()` でセッション切り替え時に全タブを作り直す
  - `src/renderer/pages/settings.{html,css,js}` — 設定画面
- 重要な技術メモ(ハマりどころ):
  - **`protocol.handle` はセッションごとに登録が必要**。デフォルトセッションにだけ登録すると、プロファイル用セッションでは `roopie://` が真っ白になる(`registerInternalProtocol(session)` を切り替え時にも呼ぶ)
  - Electron のレンダラーでは `prompt()` が使えない(`confirm()` は使える)。名前入力はインライン入力欄で実装
  - プロファイル切り替え時は全タブを閉じるため、`isSwitchingProfile` フラグで「最後のタブを閉じたらウィンドウを閉じる」挙動を抑止している
- 検証: CDP経由でプロファイル作成・切り替え(アプリ生存)・セッション分離・共有トグルON時のデータ共通化を確認済み

### 開発の進め方(ツール)

- 動作確認は `npm run start:debug`(`--remote-debugging-port=9222`)で起動し、CDP(Node の WebSocket)で `window.roopie` / `window.roopieInternal` を直接叩いて検証する。
  スクリーンショットは他アプリが最前面にあると失敗するため、CDP検証を優先する
- `.claude/settings.json` に読み取り系コマンドの許可リストを追加済み(パーミッション確認の削減)

### 次のステップ

- Phase 4: マウスジェスチャー・サイドパネル
- Phase 2(後回し): 拡張機能対応の検証(`electron-chrome-web-store` 等で uBlock Origin が動くか実験)
- 未実装のChrome機能: パスワード保存、タブのドラッグ並べ替え、複数ウィンドウ、シークレットモード
