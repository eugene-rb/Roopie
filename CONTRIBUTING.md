# 貢献するには

Roopie への貢献を歓迎します。不具合の報告、機能の提案、Pull Request、どれも大歓迎です。
やり取りは日本語が基本ですが、英語でも構いません。

参加にあたっては [行動規範](CODE_OF_CONDUCT.md) に従ってください。
脆弱性の報告だけは Issue ではなく [SECURITY.md](SECURITY.md) の手順でお願いします。

## 不具合の報告・機能の提案

- 不具合は [バグ報告](https://github.com/eugene-rb/Roopie/issues/new?template=bug_report.yml) から。
  Roopie のバージョン(設定 →「Roopieについて」)と再現手順があると調査が早く進みます
- 機能の提案は [機能リクエスト](https://github.com/eugene-rb/Roopie/issues/new?template=feature_request.yml) から。
  「他のブラウザではこう動く」という具体例があると判断しやすいです
- 使い方の質問やアイデア出しは [Discussions](https://github.com/eugene-rb/Roopie/discussions) へ

## 開発環境

必要なもの: **Node.js 24 以上** と **Windows**(現時点では Windows のみが対象です)。

```bash
git clone https://github.com/eugene-rb/Roopie.git
cd Roopie
npm ci
npm start
```

| コマンド | 用途 |
|---|---|
| `npm start` | 起動 |
| `npm run start:verify` | 全レンダラーのコンソールエラー・クラッシュ・未捕捉例外をターミナルに出して起動 |
| `npm run build:css` | `src/renderer/tailwind.css` → `src/renderer/pages/app.css` |
| `npm run watch:css` | 上記の監視版 |
| `npm run dist` | インストーラーをローカルにビルド(`dist/`。公開はしない) |

> [!IMPORTANT]
> `src/renderer/pages/app.css` は **生成物**です。直接編集せず、入力の `tailwind.css` を編集してください。

## 動作確認

このリポジトリでは、**その場限りの検証スクリプトを書き捨てにしません**。
`scripts/test-*.js` は再利用できる検証スクリプトで、いずれも一時的な `userData` で本物の
`browser.js` を動かし、DOMの実測値をもとに自分で `OK` / `NG` を出力します。

```bash
npx electron scripts/test-window-theme.js     # 例: ウィンドウの外観テーマ
npx electron scripts/test-tab-scroll.js       # 例: タブがあふれたときの見せ方
```

- 既存の機能を直したときは、**関係する検証スクリプトを実行して `NG` が無いこと**を確認してください
- 新しい機能を足したときは、**同じ形式の検証スクリプトを1つ追加**してください
  (`scripts/` の既存ファイルをそのまま雛形にできます)
- スクリーンショットによる目視確認は最後の手段です。まずは `console.log` や
  `getComputedStyle` の実測など、テキストで確かめられる方法を選んでください

## コードの決まりごと

設計上の前提は [DEVELOPMENT.md](DEVELOPMENT.md) にまとまっています。**変更前に必ず目を通してください。**
特に踏み抜きやすいのは次の点です。

- **データはプロファイル単位**。各機能は `browser.bundleFor(ctx.profileId)` からデータを引きます
  (`browser.bookmarks` などのグローバルはアクティブな束を指す互換ゲッターです)
- **タブの `webContents` にリスナを張るときは `attachEvents` の `on()` 経由**で。
  そうしないとタブをウィンドウ間で移動したときに張り直せません
- **ウィンドウを閉じたら `WebContentsView` を明示的に破棄**します(道連れにはなりません)
- **UIの色は既存トークン**(`--bg` / `--chrome-bar` / `--card` / `--text` / `--border` など)を使います。
  色の直書きは、ライトテーマでも成立する場合に限ります
- コメントと変数名の言語は既存ファイルに合わせてください(コメントは日本語です)

## Pull Request

1. `master` からブランチを切ります(例: `fix/tab-drag-crash`)
2. 変更を小さく保ちます。無関係な整形やリネームは混ぜないでください
3. 関係する検証スクリプトを実行し、結果を PR に貼ってください
4. コミットメッセージは**日本語の常体で「何をしたか」**を書きます(既存の履歴に合わせています)
   - 例: `タブがあふれたときの見せ方を整えた`、`翻訳のドロップダウンが閉じない問題を直した`
5. UIを変えた場合はスクリーンショットを添えてください

> [!NOTE]
> `master` への push は GitHub Actions を起動し、**その場で新しいリリースが公開されて全ユーザーへ配信されます**
> (`**.md` などドキュメントだけの変更を除く)。直接 push せず、Pull Request を使ってください。

## リリースの仕組み(メンテナ向け)

- バージョンは `0.1.<Actionsの実行番号>`。`package.json` は書き換えず、ビルド時にだけ差し替えます
- メジャー/マイナーを上げるときは `.github/workflows/release.yml` の `VERSION_BASE` を変更し、
  あわせて `src/renderer/pages/release-notes.json` に変更点を1件追加します
  (それが全ユーザーに1度だけ表示される「変更点」になります)
- 成果物は1回およそ100MBあるため、ワークフローが古いリリースを消して直近10件だけ残します
