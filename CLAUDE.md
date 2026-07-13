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

## 現在の状態(2026-07-14 時点)

Electron 43.1.0 / Windows。`npm start` で起動、`npm run start:debug` でCDP検証用に起動。
最新コミット: `9e79643`(プロファイル切り替えのプルダウン化)

| 項目 | 状態 |
|---|---|
| Phase 1: 最小構成ブラウザ | ✅ 完了 |
| Chrome同等の基本機能 | ✅ 完了 |
| Phase 3: プロファイル機能 + 設定画面 | ✅ 完了 |
| Googleアカウントのプロファイル別管理 | ✅ 完了 |
| Phase 2: 拡張機能対応 | ⏸ 後回し(ユーザー判断) |
| Phase 4: マウスジェスチャー(GUIカスタム対応) | ✅ 完了 |
| Phase 4: サイドパネル(ブックマーク/履歴/メモ/Webパネル) | ✅ 完了 |
| Phase 5: デザイン作り込み(Tailwind + Preline / Bonjourr風) | ⬜ 未着手 |
| Phase 6: パスワード保存・細部の作り込み | ⬜ 未着手 |

### 動く機能(一覧)

- **ブラウザ基本**: タブ(Ctrl+T/W/Tab、中クリックで閉じる、Ctrl+1〜9)、アドレスバー(URL判定/Google検索)、戻る・進む・再読み込み、ズーム(Ctrl+ +/−/0)、ページ内検索(Ctrl+F)、右クリックメニュー、印刷(Ctrl+P)、全画面、マウスの戻る/進むボタン
- **データ**: ブックマーク(Ctrl+D、バー Ctrl+Shift+B、管理 Ctrl+Shift+O)、履歴(Ctrl+H)、ダウンロード(Ctrl+J)
- **プロファイル**: ツールバーのボタンからプルダウンで切り替え。設定画面(Ctrl+,)で追加・名前変更・削除、共有トグル
- **Googleアカウント**: ブラウザ全体に登録し、プロファイルごとに有効化+プライマリ選択
- **マウスジェスチャー**: 右クリック+ドラッグ(軌跡+アクション名を表示)。既定: ←戻る / →進む / ↓新しいタブ / ↓→タブを閉じる / ↑↓再読み込み。設定画面のGUIで自由に追加・変更・削除でき、共有トグルで全プロファイル共通にもできる
- **サイドパネル**(Ctrl+Shift+S / ツールバーの◨ボタン): ブックマーク・履歴クイックアクセス、自動保存メモ、Webパネル(任意サイトの常駐表示・複数登録・ヘッダーのアイコンで切り替え)。データはプロファイル単位

### 既知の制約・未対応

- Googleの**パスワード自動入力はなし**(各プロファイルで初回のみ手動ログイン。以降はCookieで保持)
- 拡張機能、マウスジェスチャー、サイドパネル、テーマ/カスタムCSS、画面分割、メディアプレイヤーは未実装
- Chrome機能の残り: タブのドラッグ並べ替え、複数ウィンドウ、シークレットモード
- 起動ログの `blink.mojom.WidgetHost` エラーはChromiumの無害なノイズ(対応不要)

## 今後の計画

優先順は「プロファイルの影響を受ける機能(先)→ 影響を受けないUI機能(後)」。
プロファイル基盤が固まったので、以降は独立性の高い機能から着手できる。

1. **Phase 5: デザイン作り込み**(Tailwind CSS + Preline UI、スタートページはBonjourr風)
   - テーマ/カスタムCSS機能もここ。設定画面の共有トグル「テーマ」を有効化する
2. **Phase 2(後回し分): 拡張機能対応の検証**(`electron-chrome-web-store` で uBlock Origin が動くか)
   - 動かない場合は方針転換の判断が必要な重要マイルストーン
3. **Phase 6: パスワード保存**(`safeStorage` で暗号化。プロファイル単位、共有トグル「保存パスワード」を有効化)
4. **Phase 6: 残りのChrome機能**(タブのドラッグ並べ替え、複数ウィンドウ、シークレットモード)
5. 画面分割・メディアプレイヤー(要件定義書 4.3 / 4.4)

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

### 2026-07-14: Googleアカウントのプロファイル別管理

- Googleアカウントは**ブラウザ全体で1つの一覧**として保存(`%APPDATA%/Roopie/google-accounts.json`)。プロファイルはそのIDを参照する
- プロファイルごとに「使うアカウント(複数可)」と「プライマリ(既定でログインするアカウント)」を選べる
  - `profile.google = { enabled: [accountId], primaryId }`
  - 有効化を外すとプライマリは自動で別の有効アカウントへ移る
- 設定画面(`roopie://settings`)に追加:
  - 「Googleアカウント」セクション: メールアドレスと表示名で登録・削除、どのプロファイルで使われているか表示
  - 各プロファイルカード内: アカウントごとのチェックボックス + プライマリのラジオ + 「このアカウントでログイン」/「ログアウト」
- 実装メモ:
  - ログイン中のアカウントは Chromium と同じ `accounts.google.com/ListAccounts` をそのプロファイルのセッションで叩いて取得(`net.fetch(url, { session })`)。失敗時は空配列
  - ログインURLは `accounts.google.com/AccountChooser?Email=<メール>` でアカウントを指定した状態で開く(**パスワードの自動入力は行わない**。初回のみ手動ログインが必要で、以降はそのプロファイルのCookieに保持される)
  - ログアウトは google.com / youtube.com のCookieをそのセッションから削除
  - `profiles.js` のコンストラクタで古い形式のprofiles.jsonを補正(`shared` / `google` の欠損を補う)
- 検証: アカウント2件登録 → プロファイルごとに有効化とプライマリ設定 → 無効化時のプライマリ自動移動、までCDPで確認済み

### 2026-07-14: プロファイル切り替えをプルダウン化

- ツールバーのプロファイルボタンを押すと、ページの上にプルダウンメニューが出る(以前は行形式のバーだった)
- **重要な制約**: タブは `WebContentsView`(ネイティブView)なので、メインUI(index.html)側にHTMLでドロップダウンを描いてもページの下に隠れて見えない
  - → 対策として「オーバーレイView」を導入。透明な `WebContentsView`(`roopie://menu`)をページ領域と同じ位置に重ね、そこにメニューを描画する
  - 子Viewは**後から追加したものが手前**に来るため、タブを作るたびに `raiseOverlay()`(= `addChildView(overlay)` を呼び直す)で最前面へ戻す
  - 非表示時は `setVisible(false)` にしておけば入力を奪わない。表示中は全面を覆うので、外側クリック=メニューを閉じる、として扱える
- 今後のドロップダウン(サイドパネルのメニュー等)もこのオーバーレイViewに乗せれば同じ問題を回避できる
- 検証: ボタンクリック→メニュー表示→現在プロファイルにチェック→別プロファイル選択で切り替え→自動クローズ、までCDPで確認済み

### 2026-07-14: Phase 4 マウスジェスチャー(GUIカスタム対応)

- 右クリック+ドラッグで実行。ドラッグ中は青い軌跡と「← 戻る」のようなラベルを表示する
- パターンは U/D/L/R の並び(最大8方向)→ アクションIDの対応表として保存(`gestures.json`)
  - 既定: `L=back, R=forward, UD=reload, DR=closeTab, D=newTab`
  - アクション: 戻る/進む/再読み込み/タブを閉じる/新しいタブ/次のタブ/前のタブ/ページの先頭へ/末尾へ
- 設定画面(`roopie://settings`)にカスタムGUIを追加:
  - 有効/無効トグル、割り当て一覧(アクションはその場でプルダウン変更・削除可)
  - 方向ボタン(←↑↓→)でパターンを組み立てて「追加」(登録済みパターンは上書きの注意書きを表示)
  - 「既定の割り当てに戻す」ボタン
- プロファイル単位の設定。共有トグル「マウスジェスチャー」を有効化した(`SHARABLE_KEYS` に `gestures` を追加)
- 追加/変更ファイル:
  - `src/main/gestures.js` — 設定の管理(検証・既定値・リセット)
  - `src/preload/gesture-preload.js` — ジェスチャー検出+軌跡描画。**`session.registerPreloadScript({ type: 'frame' })` でセッション全体に注入**するため、通常タブ・内部ページの両方で動く(webPreferences.preload と併用される)。ページには何もAPIを公開しない
  - `src/main/main.js` — `registerGesturePreload(session)`(プロファイル切り替え時も呼ぶ)、IPC(`gestures:config/set/reset/perform`)。アクションは `e.sender` のタブに対して実行
- 技術メモ(ハマりどころ):
  - ジェスチャー後の右クリックメニュー抑止は、preloadのcaptureリスナーで `contextmenu` を `preventDefault` する(Windowsではcontextmenuはmouseupの後に発火)。ページがpreventDefaultするとElectronの `context-menu` イベント自体が発火しない
  - 軌跡はcanvasをページDOMに一時挿入して描く。ページのCSPに関わらず効くよう、スタイルは `el.style.x = y`(CSSOM)で設定
  - オーバーレイView(`roopie://menu`)ではジェスチャーを無効化(URLで判定)
  - **CDP検証の注意**: `Runtime.evaluate` で `location.href` を変えると user activation なしのナビゲーションになり、Chromiumの履歴介入で `canGoBack()` が false になる(戻るジェスチャーが効かないように見える)。`userGesture: true` を付ければ実利用と同じ挙動になる
- 検証: CDPで D(新しいタブ)/ DR(タブを閉じる)/ L(戻る)/ 無効化 / リセット / 設定GUIでの追加・変更・削除・共有トグル表示を確認済み

### 2026-07-14: Phase 4 サイドパネル

- ページ右側(幅360px、狭いウィンドウでは半分まで)に表示。Ctrl+Shift+S / ツールバーの◨ボタンで開閉
- 4セクション: **ブックマーク**(クリックで現在のタブ、中クリックで新しいタブ)/ **履歴**(検索付き)/ **メモ**(自動保存)/ **Webパネル**
- **Webパネル**: 任意のサイトを登録してパネル内に常駐表示(Vivaldi/Operaのウェブパネル相当)
  - 表示中はパネルUIを44pxのヘッダーに縮め、その下にWebコンテンツ用の `WebContentsView` を配置
  - ヘッダーには登録サイトのfaviconが並び、クリックで切り替え。◀で一覧へ戻る(webViewは破棄)、↻再読み込み、⤈タブで開く
  - プロファイルのセッションを共有するのでログイン状態が使える。リンクの新規ウィンドウは通常タブで開く
  - タイトル・faviconはWebパネル表示中に自動取得して登録エントリへ反映
- データはプロファイル単位: `profiles/<id>/sidepanel.json`(`{ webPanels: [], notes: '' }`)
- 追加/変更ファイル:
  - `src/main/side-panel.js` — パネルView(`roopie://sidepanel`)とWebパネルViewの管理、レイアウト、データ管理
  - `src/main/tab-manager.js` — `layout()` でパネル幅分ページを狭める(`setSidePanel()` で連携)。オーバーレイは全域のまま
  - `src/renderer/pages/sidepanel.{html,css,js}` — パネルUI(通常モード / web-modeヘッダーの2モード)
  - `src/main/main.js` — IPC(`sidepanel:toggle/state/add-web/remove-web/open-web/close-web/reload-web/set-notes`)。`broadcast()` がパネルUIにも届くよう `sendToPanel()` を追加(パネルはタブ一覧に含まれないため)
- 技術メモ:
  - パネルUIとWebコンテンツは別View。Webパネル表示中のヘッダーはパネルUI自身が web-mode 表示に切り替わる(高さはメイン側の定数 `WEB_HEADER_HEIGHT=44` と一致させる)
  - プロファイル切り替え時は `switchSession()` で両Viewを破棄して作り直す(タブと同じ方針)
- 検証: CDPで開閉・ボタンactive・メモ自動保存とプロファイル別分離・Webパネル追加/切替/削除/タイトル反映・タブ幅の縮小(1264→904→1264)を確認済み

### 開発の進め方(ツール)

- 動作確認は `npm run start:debug`(`--remote-debugging-port=9222`)で起動し、CDP(Node の WebSocket)で `window.roopie` / `window.roopieInternal` を直接叩いて検証する。
  スクリーンショットは他アプリが最前面にあると失敗するため、CDP検証を優先する
- `.claude/settings.json` に読み取り系コマンドの許可リストを追加済み(パーミッション確認の削減)

(次にやることは冒頭の「今後の計画」を参照)
