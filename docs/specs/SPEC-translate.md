# SPEC-translate: 翻訳

## 概要
Edge風のページ内機械翻訳。Google公開の `translate_a/t` エンドポイントを使い、タブごとの状態・プロファイルごとの設定・分離ワールドpreloadによるDOM置換で実現する。
専用セッション化により拡張機能あり環境でのクラッシュを回避済み（要検証項目）。

## 詳細

### ファイル構成
| ファイル | 行数 | 役割 |
|---|---|---|
| `translate.js` | 358 | 低レベルfetch・キャッシュ・言語判定 |
| `page-translate.js` | 365 | タブ単位のオーケストレーションとIPC |
| `src/preload/translate-preload.js` | 265 | 分離ワールドでのDOM置換・復元 |

### エクスポート
- `translate.js`: `translateTexts`, `fetchSessionFor`, `proxyRulesOf`, `looksForeign`, `normalizeLang`, `baseLang`, `langName`, `clearCache`, `LANGS`（33言語）, `DEFAULT_TARGET='ja'`, `MAX_SEGMENTS=64`, `MAX_CHARS=1600`
- `page-translate.js`: `canTranslate`, `stateFor`, `reset`, `start`, `restore`, `toggle`, `handleTexts`, `handleProgress`, `handlePageInfo`, `requestPopup`, `popupPayload`, `translateSelection`, `clearSelection`, `neverSite`, `neverLang`, `setAlwaysLang`, `normalizeHosts`, `normalizeLangs`, `MAX_SELECTION=2000`

### IPC（`ipc.js`）
- `translate:langs`（handle）, `translate:texts`（handle → `handleTexts`）, `translate:progress`（on → `handleProgress`）, `translate:page-info`（on → `handlePageInfo`）
- `translate:run` / `translate:undo` / `translate:never-site` / `translate:never-lang` / `translate:always-lang` / `translate:selection-close`
- `page-translate.js` → タブへ `translate:start` / `translate:restore`、ウィンドウへ `translate:prompt` / `translate:update`
- preload → `translate:progress` / `translate:page-info` を送信、`translate:texts` をinvoke

### 制約・注意点（重要）
- **過去の重大バグ**: ページの session で直接fetchすると、拡張機能導入環境でアプリ全体がクラッシュしていた（`electron-chrome-extensions` がそのsessionに `webRequest` を付与し、どのタブにも紐付かないメインプロセスからのリクエストがクラッシュを誘発）。対策として `fetchSessionFor` でページごとの非永続専用セッションを使う（プロキシ設定はページのものをミラー＝Tor有効プロファイルでのリーク防止、Cookie/履歴は持たない）。
- テキストは `\p{L}` を含むもののみ送信、4000文字（`MAX_SEGMENT_CHARS`）超のセグメントはスキップ。
- 翻訳設定（`translateTargetLang` / `translateNeverSites` / `translateNeverLangs` / `translateAlwaysLangs` / `translateAutoOffer`）はプロファイル単位で、**`ctx.incognito` の場合は書き込まない**（プライベートウィンドウでのサイト/言語選択を永続化しない）。
- 自動オファーはセッションごと・`profileId|incognito|host` キーごとに1回のみ（上限 `OFFERED_LIMIT=300`、上限到達でクリア）。
- preloadの復元は再翻訳ではなく元テキストを保持して戻す。`RETRANSLATE_LIMIT=6` で同一ノードを書き換え続けるページの無限ループを防止。書き込み中は `MutationObserver` を切ってフィードバックループを回避。
- `webContents.send` はメインフレームのみに届く（iframe内の同preloadは無反応）。

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. 拡張機能インストール済み環境で翻訳を実行してもクラッシュしないこと（最重要）
  2. Torプロファイルで翻訳リクエストがTor経路外にリークしないこと
  3. シークレットウィンドウでの翻訳設定（サイト除外/言語設定）がディスクに保存されないこと
  4. 翻訳の実行・元に戻す（復元）操作が正常動作すること

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
