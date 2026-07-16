- 対話・出力
  - 対話は必ず日本語で行う
  - 質問には指定がない限り短い文章で回答
  - 『鋭い指摘です』などの感想や相槌を省き、結論から簡潔に回答
  - 長文のエラーは内容をそのまま出力せず重要な部分のみ出力し、エラーの原因や対処法のみ簡潔に伝える
- MCPやコマンドについて
  - トークン消費を抑えられるように gh コマンドと github MCP を使い分ける
- トークン節約(品質は維持)
  - 巨大ファイル・生成物は全読みしない。Grep と Read の範囲指定(offset/limit)で必要箇所だけ読む。特に生成物 `src/renderer/pages/app.css` は読まない(入力は `tailwind.css`)。目安: 数百行を超えるファイル(tailwind.css / qrcode.js / settings.js など)
  - 動作検証は毎回使い捨てスクリプトを作らず、再利用できる検証スクリプトを使う。確認は可能な限りスクショではなく console.log → read_console_messages などのテキストDOM確認を優先し、スクショは最終確認のみに絞る
  - 実行時エラーの確認は `npm run start:verify` を使う(全レンダラーのコンソールエラー・クラッシュ・メインの未捕捉例外がターミナルに出る)。Electron 43ではCDP(9222)のHTTP/WSが応答しないため start:debug でのCDP検証は当面使えない
- 進捗管理
  - 現在の状態の要約は log.md、詳細な日付別の記録は log-archive.md に分離。作業の詳細記録は log-archive.md に追記し、log.md は要約のみ最新に保つ
  - トークン節約のため、初回起動時に参照するのは log.md のみ(log-archive.md は必要時だけ開く)
- バージョン管理
  - 変更は必ずgitで管理し、いつでも元に戻せるようにする
- ユーザーに求められた改善は逐一ここに追記し、必ず次回以降に聞き継ぐ
  - (2026-07-17) サイドバーのAI機能は廃止した。今後も復活させない(ユーザー指示)
  - (2026-07-17) サイドバー(パネル)の挙動はVivaldi準拠を維持する: レールの並び(ブックマーク/ダウンロード/履歴/メモ/リーディングリスト/ピン留めWebパネル/+)、同じアイコン再クリックで折りたたみ、F4でパネル全体の表示切替、「+」でウェブパネル追加。新機能もVivaldiの流儀に合わせる
  - (2026-07-17) Webパネルの「管理画面」は持たない(ユーザー指示で廃止)。追加=「+」またはレール右クリック、編集・削除=ピン留めアイコンの右クリックメニューのみ

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