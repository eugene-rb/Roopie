- 対話・出力
  - 対話は必ず日本語で行う
  - 質問には指定がない限り短い文章で回答
  - 『鋭い指摘です』などの感想や相槌を省き、結論から簡潔に回答
  - 長文のエラーは内容をそのまま出力せず重要な部分のみ出力し、エラーの原因や対処法のみ簡潔に伝える
- MCPやコマンドについて
  - トークン消費を抑えられるように gh コマンドと github MCP を使い分ける
- 進捗管理
  - 作業の進捗や経過をlog.mdに記録する。
  -トークン節約のため、log.mdを参照するのは初回起動時のみ
- バージョン管理
  - 変更は必ずgitで管理し、いつでも元に戻せるようにする
-ユーザーに求められた改善は逐一ここに追記し、し、必ず次回以降に聞き継ぐ

---

## Response Guidelines for Claude
- Be concise. Skip pleasantries, introductions, and summaries.
- Output ONLY code changes unless specifically asked for an explanation.
- Use incremental edits or unified diff format if possible to save tokens.

## プロジェクト概要

Roopie: Chromiumベース(Electron)の独自ブラウザ。詳細は `要件定義書.md` を参照。

## ファイル構成(メインプロセス)

| ファイル | 責務 |
|---|---|
| `main.js` | エントリポイント。アプリのライフサイクルのみ(24行) |
| `browser.js` | ブラウザ本体。プロファイル単位のデータ、ウィンドウ生成、状態配信 |
| `ipc.js` | IPCの受付(全チャンネル)。`windows.contextFor(e.sender)` で送信元ウィンドウに振り分け |
| `menu.js` | アプリメニュー(キーボードショートカット)。フォーカス中のウィンドウに作用 |
| `windows.js` | ウィンドウコンテキストのレジストリ |
| `tab-manager.js` | タブ(WebContentsView)の管理とレイアウト |
| `side-panel.js` / `gestures.js` / `passwords.js` / `adblock.js` / `extension-support.js` | 各機能 |
| `store.js` / `history.js` / `bookmarks.js` / `downloads.js` / `profiles.js` / `google-accounts.js` | データ管理 |