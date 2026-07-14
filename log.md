
## 現在の状態(2026-07-14 時点)

Electron 43.1.0 / Windows。`npm start` で起動、`npm run start:debug` でCDP検証用に起動。
最新コミット: 拡張機能の管理UI(設定画面+ツールバーアイコン)

| 項目 | 状態 |
|---|---|
| Phase 1: 最小構成ブラウザ | ✅ 完了 |
| Chrome同等の基本機能 | ✅ 完了 |
| Phase 3: プロファイル機能 + 設定画面 | ✅ 完了 |
| Googleアカウントのプロファイル別管理 | ✅ 完了 |
| Phase 2: 拡張機能対応の検証 | ✅ 完了(結論: uBOは不可 → 内蔵広告ブロックで代替。コンテンツスクリプト型拡張は動く) |
| Phase 4: マウスジェスチャー(GUIカスタム対応) | ✅ 完了 |
| Phase 4: サイドパネル(ブックマーク/履歴/メモ/Webパネル) | ✅ 完了 |
| Phase 5: テーマ機能 + Bonjourr風スタートページ | ✅ 完了 |
| Phase 5: Tailwind CSS v4 + Preline UI 導入 | ✅ 完了 |
| Phase 5: UI改善(フレームレス化・SVGアイコン) | ✅ 完了 |
| Phase 6: パスワード保存 | ✅ 完了 |
| Phase 6: 残りのChrome機能(タブ並べ替え/複数ウィンドウ/シークレット) | ✅ 完了 |
| 拡張機能の管理UI(設定画面+ツールバーアイコン) | ✅ 完了 |

### 動く機能(一覧)

- **ブラウザ基本**: タブ(Ctrl+T/W/Tab、中クリックで閉じる、Ctrl+1〜9)、アドレスバー(URL判定/Google検索)、戻る・進む・再読み込み、ズーム(Ctrl+ +/−/0)、ページ内検索(Ctrl+F)、右クリックメニュー、印刷(Ctrl+P)、全画面、マウスの戻る/進むボタン
- **データ**: ブックマーク(Ctrl+D、バー Ctrl+Shift+B、管理 Ctrl+Shift+O)、履歴(Ctrl+H)、ダウンロード(Ctrl+J)
- **プロファイル**: ツールバーのボタンからプルダウンで切り替え。設定画面(Ctrl+,)で追加・名前変更・削除、共有トグル
- **プロファイルアイコン**: 設定画面でアバターをクリックすると選択パネル(既定の絵文字24種+自由入力+画像アップロード+文字に戻す)。画像アップロード時はドラッグ&ズームのGUIクロップ(円形プレビュー)。ツールバー・プロファイルメニュー・設定画面すべてに反映
- **Googleアカウント**: ブラウザ全体に登録し、プロファイルごとに有効化+プライマリ選択
- **マウスジェスチャー**: 右クリック+ドラッグ(軌跡+アクション名を表示)。既定: ←戻る / →進む / ↓新しいタブ / ↓→タブを閉じる / ↑↓再読み込み。設定画面のGUIで自由に追加・変更・削除でき、共有トグルで全プロファイル共通にもできる
- **サイドパネル**(Ctrl+Shift+S / ツールバーの◨ボタン): ブックマーク・履歴クイックアクセス、自動保存メモ、Webパネル(任意サイトの常駐表示・複数登録・ヘッダーのアイコンで切り替え)。データはプロファイル単位
- **広告ブロック(内蔵)**: EasyList等のフィルタで広告・トラッカーを遮断(@ghostery/adblocker-electron)。設定画面のトグルでON/OFF(既定ON、プロファイル単位)
- **Chrome拡張機能(部分対応)**: 設定画面の「拡張機能」セクションでウェブストアIDを指定してインストール・一覧・削除。ツールバーに拡張アイコン(`<browser-action-list>`。クリックでポップアップ)。コンテンツスクリプト型拡張(Dark Reader等)が動く。uBlock Origin等のブロッキング型は不可(下記Phase 2検証を参照)
- **パスワード保存・自動入力**: ログイン送信を検出して保存確認バーを表示。次回以降は自動入力。safeStorage(OSの資格情報ストア)で暗号化。設定画面で一覧・表示・削除、トグルでON/OFF
- **複数ウィンドウ**(Ctrl+N)、**シークレットウィンドウ**(Ctrl+Shift+N。紫の配色、履歴・パスワードを残さない、Cookieはメモリ内のみ)、**タブのドラッグ並べ替え**
- **画面分割**: タブを右クリック→「右に並べて表示」/「下に並べて表示」で2ペイン表示。ツールバーに方向切り替え・解除ボタンが出る(分割中のみ)
- **メディアプレイヤー**: 動画/音声を再生すると四隅常駐のフローティングミニプレイヤーが自動出現(ドラッグで移動→離した位置に近い角へスナップ)。再生/一時停止・シーク・PinP(動画のみ)に対応。「サイドパネルに格納」でフローティングをやめ、サイドパネルの「再生中」セクションのみで操作する形に切り替え可能
- **テーマ**(設定画面): アクセントカラー(プリセット+カラーピッカー)、新しいタブの背景(自動/固定)、カスタムCSS(UIと内部ページに適用)。プロファイル単位+共有トグル対応
- **スタートページ**: Bonjourr風。時間帯で変わるグラデーション背景(夜明け5-8時/昼8-16時/夕暮れ16-19時/夜)、大きな時計+日付+挨拶、すりガラスの検索欄、アイコンタイルのクイックリンク

### 既知の制約・未対応

- **uBlock Originなどのブロッキング型拡張は動かない**(Electronの制約。内蔵広告ブロックで代替済み。詳細は下の Phase 2 検証記録)
- 画面分割は非アクティブペイン(相方タブ)側でツールバー(戻る/進む/ズーム/アドレスバー)を操作できない。ページ内でのクリック・スクロール・右クリックメニューは相方ペインでも正しく動く
- シークレットウィンドウでは拡張機能が動かない(Electronの制約: 非永続セッションは非対応)
- 起動ログの `blink.mojom.WidgetHost` エラーはChromiumの無害なノイズ(対応不要)

## 今後の計画

要件定義書のPhase 1〜6は一通り完了。残りは以下。

1. サイドパネルの残り機能(AIチャット、カレンダー/TODO、リードリスト。要件定義書 4.2)
2. デザインの継続改善(Preline UIのコンポーネントパターン適用を広げる)
3. 画面分割の発展: ドラッグ&ドロップでの分割(タブを別タブへドロップ)、ペイン間リサイズ、非アクティブペインからの戻る/進む/ズーム操作
4. メディアプレイヤーの発展: next/previous操作(MediaSession Action Handlerの都合上、汎用的な実装は不可。サイト個別対応が必要)、複数メディア同時再生時のUI改善

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

### 2026-07-14: Phase 5 テーマ機能 + Bonjourr風スタートページ

- **テーマ機能**(プロファイル単位、共有トグル「テーマ」有効化済み)
  - `theme.json`: `{ accent, background, customCss }`。IPCは `theme:get` / `theme:set`(部分更新、値はメイン側で検証)/ `theme:state`(配信)
  - アクセントカラー: CSS変数 `--accent` を差し替えるだけで全UIに反映(プリセット7色+カラーピッカー)
  - カスタムCSS: メインUIと全内部ページに適用。**CSPの style-src 'self' を回避するため `adoptedStyleSheets`(CSSOM)で注入**(`<style>`タグはCSPに弾かれる)
  - `src/renderer/pages/theme.js` — 全内部ページ共通の適用スクリプト(各htmlに読み込み)。ページ固有の追随処理は `window.onRoopieTheme` フック
- **スタートページ(Bonjourr風)**: フルスクリーンのグラデーション背景(`body[data-bg=dawn|day|dusk|night|plain]`+ゆっくりズームするアニメーション+ビネット)、大きな時計(weight 200)+日付+挨拶、すりガラス(backdrop-filter)の検索ピル、アイコンタイルのクイックリンク
  - テーマの背景設定が `auto` のときは時間帯(5-8/8-16/16-19/それ以外)で切り替え
- 検証: CDPで背景の自動/固定切り替え・アクセント反映(UI+内部ページ)・カスタムCSS適用/解除・不正値の拒否を確認。スクリーンショットで4背景の見た目も確認済み
- **Tailwind + Preline UI への移行は未着手**: ビルド工程の導入が必要になるため、方針(Tailwind導入 or 手書きCSSでPreline風)をユーザーに確認してから進める

### 2026-07-14: Phase 5 Tailwind CSS v4 + Preline UI 導入

- **CSSのビルド工程を導入**: `npm run build:css`(生成)/ `npm run watch:css`(監視)
  - 入力: `src/renderer/tailwind.css` → 出力: `src/renderer/pages/app.css`(**gitにコミットする**。実行時にビルド不要にするため)
  - **⚠ CSSを変更するときは必ず `tailwind.css` を編集して `npm run build:css` を実行する。`app.css` を直接編集しない**
- 旧CSS 5ファイル(style.css / pages.css / settings.css / sidepanel.css / menu.css)を `tailwind.css` に統合し削除。newtab.css だけはBonjourr専用として残した
- 全ページが `app.css` を読む。内部ページは `roopie://` が `pages/` 配下しか配信できないため、出力先を `pages/app.css` にして index.html からは `pages/app.css` を相対参照
- bodyレベルのルールはページごとのbodyクラスでスコープ: `.chrome-body`(index.html)/ `.menu-body`(オーバーレイ、背景透過)/ `.panel-body`(サイドパネル、`web-mode` はここに付く)
- デザイン刷新(Preline風): トークン刷新(--bg #16181d 等)、ピル型タブ(hover付き)、ツールバーに境界線、入力欄のフォーカスリング(`--ring` = color-mix)、カードに影、控えめなスクロールバー
- 技術メモ:
  - Tailwind v4 はCSSファースト(`@import "tailwindcss"`)。クラス検出は `source(none)` + `@source "./**/*.{html,js}"` で生成物(app.css)を除外
  - Preline 4 はTailwindプラグインが廃止され `variants.css` を読む方式。exportsに"style"条件がないため**相対パス**(`../../node_modules/preline/variants.css`)でimportする(`preline@2`+`tailwindcss@3`の旧方式は使わない)
  - `.hidden { display:none !important }` は自前定義を維持(Tailwindの`.hidden`はID指定の`display:flex`に負けるため)
  - JSが生成するDOMのクラス名はそのまま(セマンティッククラスを維持し、tailwind.css内で定義する方針)。Tailwindユーティリティは今後HTML側で自由に使える
- 検証: ブラウザUIのスクリーンショットと、内部ページ(menuオーバーレイ)でapp.cssの読み込み・透過背景・トークンを確認済み

### 2026-07-14: UI改善(フレームレスウィンドウ + SVGアイコン)

- **フレームレス化**: `titleBarStyle: 'hidden'` + `titleBarOverlay`(色 #16181d / 高さ40px)。タブバーがタイトルバーを兼ねる
  - タブバーの空き領域は `-webkit-app-region: drag` でウィンドウ移動(ダブルクリック最大化もOSが処理)。タブと+ボタンは `no-drag`
  - 右上のウィンドウ操作ボタン(OSオーバーレイ)との重なりは `padding-right: calc(100vw - env(titlebar-area-width, 100vw) + 8px)` で回避
  - メニューバーは非表示になるが**アクセラレータ(Ctrl+T等)は動く**(実キー送信で確認済み。CDPの `Input.dispatchKeyEvent` はメニューアクセラレータを通らないので検証には使えない)
- **SVGアイコン化**: ツールバー・タブバー・検索バー・サイドパネルの文字記号(←↻⚙など)を全てlucide風のインラインSVG(stroke: currentColor)に置き換え。`.icon-btn svg` 等で共通スタイル
- その他: アドレスバー左にサイト種別アイコン(https=鍵 / それ以外=検索)、タブの閉じるボタンはホバー/アクティブ時のみ表示、faviconがないタブは頭文字表示、ブックマーク済みの星は塗りつぶし(スターはJSでtextContentを書き換えない方式に変更)
- 検証: スクリーンショットでツールバー/タブ/サイドパネルの描画、env()による右上余白(145px)、実キーCtrl+Tでタブ作成を確認済み

### 2026-07-14: Phase 2 拡張機能対応の検証 → 内蔵広告ブロックへ方針転換

**検証結果(重要)**:
- `electron-chrome-extensions`(GPL-3.0。**配布時はGPL条件が適用される**点に注意)+ `electron-chrome-web-store` を導入し、ウェブストアからのインストール自体は成功
- **uBlock Origin (MV2) は動かない**: インストール・バックグラウンドページ起動までは成功するが、`chrome.webRequest.onBeforeRequest` にアクセスすると undefined。バックグラウンドページのログに `No source for require(webRequestEvent)` — **ElectronはwebRequestブロッキングの拡張機能バインディングを実装していない**(公式ドキュメントの「対応」記載は名前空間のみで、イベントは使えない)。electron-browser-shell も webRequest ブロッキングは「検討中」段階
- **uBlock Origin Lite (MV3) も不可**: `chrome.declarativeNetRequest` が undefined
- **コンテンツスクリプト型の拡張は動く**: Dark Reader 4.9.128 をインストール → example.com が実際にダーク化されるのを確認済み
- 検証用にインストールしたuBO/Dark Readerは削除済み(拡張の保存先: `profiles/<id>/extensions/`)

**方針転換: 内蔵広告ブロックを実装**(`@ghostery/adblocker-electron`)
- `src/main/adblock.js` — EasyList等のプリセットフィルタをダウンロードして `adblock-engine.bin` にキャッシュ(オフライン時は前回分)。ElectronのwebRequestでリクエスト遮断
- 設定 `adblock`(既定ON)を `DEFAULT_SETTINGS` に追加。設定画面「ブラウザ設定」にトグル。切り替え時は `applyAdblock()` がアクティブプロファイルのセッションへ適用/解除
- 検証: googlesyndication / doubleclick への fetch が blocked、通常サイトは loaded。トグルOFF→loaded、再ON→blocked を確認済み

**拡張機能サポートの実装**(残してある。コンテンツスクリプト型拡張が使えるため):
- `src/main/extension-support.js` — セッションごとに `ElectronChromeExtensions`(license: 'GPL-3.0')+ `installChromeWebStore` を取り付け。拡張はプロファイル別に保存・自動読み込み
- TabManagerに `onTabCreated` / `onTabSelected` フックを追加して chrome.tabs API と連動
- IPC: `extensions:install`(ウェブストアID指定)/ `extensions:list`。管理UI・ツールバーの拡張ボタン(browser-action)は未実装(今後の計画に記載)

### 2026-07-14: Phase 6 パスワード保存・自動入力

- **保存**: ページのpreloadがログイン送信(submit / ボタンクリック / Enter)を検出 → 画面遷移時にメインへ通知 → **未保存のときだけ**ツールバー下に保存確認バーを表示。「保存する」で保存
- **自動入力**: 次回以降、同じオリジンのログインフォームにユーザー名・パスワードを自動入力(Reactにも効くようネイティブsetter経由で値を入れる)
- **暗号化**: `safeStorage.encryptString`(OSの資格情報ストアの鍵)でパスワードを暗号化し、base64でJSONに保存。**ディスク上に平文は残らない**(検証済み)。復号は自動入力/表示のときだけ
- **管理**: 設定画面「保存したパスワード」に一覧(パスワードは伏せ字、「表示」で復号)・個別削除・すべて削除・ON/OFFトグル。共有トグル「保存パスワード」も有効化
- 追加/変更ファイル:
  - `src/main/passwords.js` — 暗号化・保存・検索・復号(保存単位は オリジン + ユーザー名)
  - `src/preload/password-preload.js` — 検出と自動入力。ジェスチャー用と同様に `session.registerPreloadScript` でセッション全体へ注入(**ページにAPIは公開しない**)
  - `src/main/main.js` — IPC(`passwords:captured / confirm-save / dismiss / for-origin / list / reveal / remove / clear / available`)。平文は `pendingPassword` に一時保持し、保存 or 却下で破棄
  - `src/renderer/index.html` + `renderer.js` — 保存確認バー(UI領域なので `reportChromeHeight()` で高さを通知)
- 技術メモ:
  - `safeStorage.isEncryptionAvailable()` が false の環境(Linuxで鍵ストアなし等)では保存機能自体を無効化し、設定画面にその旨を表示する
  - 復号できないデータ(別マシン/別OSユーザーで作られた)は一覧から自動的に除外される
- 検証: safeStorage利用可否 / 保存バー表示 / 保存 / 復号 / 自動入力 / 同一パスワード時にバーを出さない / 一覧APIとディスクのJSONに平文が含まれない、をCDPで確認済み

### 2026-07-14: Phase 6 タブ並べ替え・複数ウィンドウ・シークレットモード

- **タブのドラッグ並べ替え**: HTML5のD&D。ドラッグ中は挿入位置に縦線(`.drop-before` / `.drop-after`)を表示。`tabs:move` → `TabManager.moveTab(id, toIndex)` で配列を並べ替え
- **複数ウィンドウ**(Ctrl+N / プロファイルメニュー): **main.jsを1ウィンドウ前提から多ウィンドウ対応に再構成**
  - `src/main/windows.js` — ウィンドウコンテキスト(`{ window, tabManager, sidePanel, session, incognito }`)のレジストリ。`contextFor(sender)` でIPCの送信元がどのウィンドウかを判定する
  - **重要**: `WebContentsView` のwebContentsは `BrowserWindow.fromWebContents()` では引けないため、各コンテキストのタブ/オーバーレイ/サイドパネルのViewを総当たりで照合している
  - IPCは `tabsOf(e)` / `panelOf(e)` 経由で送信元ウィンドウに対して処理する。データ(履歴・ブックマーク等)はプロファイル単位で全ウィンドウ共通
  - メニュー(ショートカット)は `windows.focused()` に対して動作
- **シークレットウィンドウ**(Ctrl+Shift+N): 紫の配色 + タブバーに「シークレット」バッジ。履歴ボタンは非表示
  - セッションは `session.fromPartition('incognito-N')`(**`persist:` を付けない = メモリ内のみ**)。ウィンドウを閉じるとCookie・キャッシュを破棄
  - 履歴は残さない(`NULL_HISTORY` を渡す)、パスワードの保存・自動入力もしない(IPC側で `ctx.incognito` を判定)、サイドパネルのメモはメモリ内のみ
  - **拡張機能は取り付けない**(Electronは非永続セッションでの拡張機能に非対応)
  - ブックマークと広告ブロックは通常ウィンドウと共通
- 検証: 新規ウィンドウ / ウィンドウごとに独立したタブ / 並べ替え(2,3,4→3,4,2)/ シークレット判定 / シークレットの閲覧が履歴に残らない / 通常の閲覧は残る / **Cookieが分離されている**(通常で設定したCookieがシークレットから見えない)をCDPで確認済み

### 2026-07-14: 構造の最適化 + Zen Browser風UI

**構造の最適化**: 819行あった `main.js` を責務ごとに4ファイルへ分割(上の「ファイル構成」参照)
- `main.js`(24行)= アプリのライフサイクルのみ / `browser.js` = 本体 / `ipc.js` = IPC / `menu.js` = メニュー
- 循環依存なし(`menu.js` と `ipc.js` が `browser.js` を参照する一方向)

**Zen Browser風UI**:
- **ページを角丸のカードとして浮かせる**: `WebContentsView.setBorderRadius()` + レイアウトで周囲に8pxの余白(`CONTENT_MARGIN` / `CONTENT_RADIUS` in tab-manager.js)。ウィンドウの `backgroundColor` をクロームと同色にして「額縁」に見せる。全画面時は余白なし
- サイドパネルも同じ角丸カードに。**Webパネル表示中はパネルUIを領域全体に敷いたまま、その上にWebコンテンツを重ねる**(角丸から透けるのが額縁ではなくパネル背景色になるため)
- クローム全体を同色(`--bg`)で統一し、**アドレスバーだけを一段明るいピルとして浮かせる**。ページ内検索バー・パスワード保存バーも角丸のフローティングカードに
- **集中モード(Ctrl+Shift+H)**: ツールバーとブックマークバーを隠してタブバーだけ残す(クローム高さ 114px → 40px)
- 検証: OSレベルのスクリーンショットで角丸カードを確認。サイドパネル・複数ウィンドウ・シークレット・ジェスチャー・集中モードの回帰テストを実施済み

### 2026-07-14: 画面分割機能(要件定義書 4.4)

- タブバーでタブを**右クリック**すると「右に並べて表示」「下に並べて表示」が出る。選んだタブが、現在のアクティブタブの隣にもう1枚の角丸カードとして並ぶ(Zen風レイアウトの余白がそのままペイン間の区切りになる)
- ツールバーに分割中だけ表示されるコントロール(方向切り替え / ✕で解除)。方向アイコンは現在の状態に応じて切り替わる(既存のアドレスバーの鍵/検索アイコンと同じ手法)
- `TabManager`: `splitTabId` / `splitDirection`('row'|'column')を追加。`splitWith(id, direction)` / `toggleSplitDirection()` / `closeSplit()`。`layout()` は分割時に領域を2つに割り、間にも余白(額縁)を入れて独立したカードに見せる
- **主ペイン(アクティブタブ)を閉じると、相方のペインが自動的に主ペインへ昇格する**(分割が唐突に消えない)。分割相手のタブをクリックしてアクティブにした場合は、同じ内容が重複するため分割を自動解除する
- `src/main/tab-context-menu.js` — タブの右クリックメニュー(新規タブ/分割操作/タブを閉じる/他のタブを閉じる)。既存の `context-menu.js`(ページ内容の右クリック)とは別ファイル
- **バグ修正**: `context-menu.js`(ページ右クリックの「戻る」「進む」「ブックマーク」等)が `tabManager` の「アクティブタブ」に対して操作していたため、画面分割で非アクティブペイン上で右クリックすると誤って主ペインを操作してしまう問題があった。右クリックされた **webContents自身** に対して操作するよう修正(分割の有無に関わらず正しい動作になった)
- 既知の制約: ツールバー(戻る/進む/ズーム/アドレスバー/ブックマーク)は常に主ペインを操作する。非アクティブペインはページ内操作(クリック・スクロール・右クリック)のみ
- 検証: 分割前後のUI表示切り替え、両ペインの実在、方向アイコンの切り替え、タブへの強調表示、分割解除、**主ペインを閉じたときの昇格**、自分自身との分割不可、をCDPで確認。OSレベルのスクリーンショットで左右/上下どちらの分割も正しく2枚のカードとして描画されることを確認済み

### 2026-07-14: プロファイルアイコンのカスタマイズ(絵文字・画像)

- `profile.icon = { type: 'letter' } | { type: 'emoji', value } | { type: 'image', value: dataURI }`。既定は従来どおり `letter`(頭文字+プロファイルカラー)
- **設定画面でアバターをクリック**するとポップオーバーが開く: 既定の絵文字24種(6×4グリッド)/ 任意の絵文字を直接入力 / 画像をアップロード / 「既定に戻す」
  - 画像は選択時に**クライアント側でcanvasを使って中央基準の正方形に切り抜き、128x128にリサイズ**してから `data:image/png;base64,...` としてIPCで送る。専用の画像配信の仕組み(ファイル保存+protocol.handle)は増やさず、既存の `img-src ... data:` CSPにそのまま乗せた
  - メイン側(`profiles.js` の `setIcon()`)でも型と値を検証(絵文字は16文字まで、画像は `data:image/` で始まり40万文字まで)。不正な値は無視される
- ツールバーのプロファイルボタン(`index.html` の `#profile-btn` を `<span class="avatar">` でラップ)、プロファイルメニュー(`menu.js`)、設定画面(`settings.js`)の3箇所で同じロジック(`buildAvatar`/`renderAvatar`、type別に文字/絵文字/画像を出し分け)を実装。3ファイルとも内部ページ用preloadを共有するだけでJSモジュールは共有できないため、小さな関数を複製している
- 検証: 絵文字選択→3箇所すべてへの反映、カスタム絵文字入力、画像アップロード→保存→ツールバー表示、既定へのリセット、不正な画像値(`javascript:`スキームなど)がメイン側で拒否されることをCDPで確認済み

### 2026-07-14: プロファイルアイコンのGUIクロップ

- 画像アップロード時、自動の中央正方形切り抜き(前回実装)を**ドラッグ&ズームの円形クロップモーダル**に置き換えた(`settings.js` の `openCropModal()`)
  - ビューポート240px(円形・overflow hidden)。画像を `<img>` の position:absolute + 明示的な width/height/left/top で配置(CSS transformではなく実寸を直接計算)
  - ドラッグは **Pointer Events + `setPointerCapture`** で実装。ビューポート外に出ても追従する(window側にリスナーを足す必要がない)
  - ズームはスライダー(0〜100 → 1〜3倍)とホイールの両方に対応。**ビューポート中心を保ったまま拡大縮小**(中心の画像座標を計算→倍率変更後に再配置)
  - 「適用」時にcanvas(160x160)へ現在の表示状態をそのまま `drawImage` で書き出し、data URLとして `setProfileIcon` に渡す。Escキー/「キャンセル」/外側クリックなしでも閉じられる(バックドロップの直接クリックは未実装、キャンセルボタンかEscで閉じる)
  - 円形ビューポートの見た目は最終的なアバター表示(`.avatar img { border-radius:50% }`)と完全に一致するWYSIWYG(切り抜き領域は正方形だが、四隅は元々表示されないので気にする必要がない)
- 検証: モーダルの開閉、初期スケール(短辺がビューポートを覆う)、ドラッグでの位置変更(境界でのクランプを含む)、スライダー/ホイールでのズーム、キャンセルで変更されないこと、Escで閉じることをCDPで確認。実際に色分けした画像でクロップ結果のスクリーンショットも確認済み

### 2026-07-14: メディアプレイヤー(要件定義書 4.3)

- **フローティングミニプレイヤー**: 動画/音声の再生を検知すると四隅のいずれかに自動出現。タイトル・アーティスト・アートワーク(`navigator.mediaSession.metadata` があれば利用、無ければページタイトル/ホスト名にフォールバック)、再生/一時停止、シークバー、動画なら PinP ボタン
  - `roopie://mediaplayer` という**専用の小さな WebContentsView**(272x88px)として実装。既存のオーバーレイ(メニュー)やサイドパネルと同じ「ページの上に別Viewを重ねる」手法だが、**bounds をウィジェットの大きさだけに絞ることで、それ以外のページ領域の操作を一切妨げない**(全画面を覆う既存のオーバーレイとは異なる新パターン)
  - ドラッグで自由に移動 → 離した位置から最も近い四隅へスナップ。位置は設定(`mediaCorner`)に永続化
- **検出**: `src/preload/media-preload.js` を全ページへ注入(`session.registerPreloadScript`)。`<video>/<audio>` を `MutationObserver` で監視し、再生/一時停止/進捗を200msデバウンスでメインプロセスへ通知
  - **ハマりどころ**: `session.registerPreloadScript({ type: 'frame' })` はHTML解析より前(`document.documentElement` が存在しない段階)に実行されることがある。`MutationObserver.observe(document.documentElement, ...)` は落ちるため、**`document` 自体を監視対象にする**(Documentノードは常に存在する)
- **制御**: メイン側は「今どのタブが再生中か(tabId)」だけを覚えており、操作コマンドは毎回 `webContents.executeJavaScript('...', true)` でそのタブに対して `document.querySelectorAll('video,audio')` を再検索して実行する(preloadに状態を持たせず、DOMを都度問い合わせる方式)。第2引数 `true`(userGesture)が **`play()` の自動再生ブロックと `requestPictureInPicture()` のユーザー操作要件を回避するために必須**
- **ドラッグの実装**: プレイヤー自身の座標系はViewの再配置で歪むため、**`MouseEvent.movementX/Y`(直前イベントからの相対移動量)を積算**してメインへ送る方式にした(`clientX`の差分だと自分の移動でフレームがずれて破綻する)
- **サイドパネルに格納**: 設定 `mediaDocked`(既定false)。ONにするとフローティングを隠し、サイドパネルの新セクション「再生中」(既存の bookmarks/history/notes/web と同じ仕組み)のみで操作する。トグルはフローティングウィジェット自身(格納ボタン)とサイドパネルの両方に用意
- 追加ファイル: `src/preload/media-preload.js`、`src/main/media-player.js`、`src/renderer/pages/mediaplayer.{html,js}`。既存ファイルへの主な変更: `tab-manager.js`(`setMediaPlayer`/レイアウト計算に追加/`onTabClosed`フック)、`windows.js`(`contextFor`にmediaPlayerを追加)、`browser.js`/`ipc.js`(状態配信・制御IPC)、`sidepanel.html/js`(再生中セクション)
- **既知の制約**: 次の曲/前の曲は実装していない(`chrome.mediaSession` の action handler は登録専用のAPIで、外部から一覧取得・呼び出しができないため汎用実装が不可能。サイト個別対応が必要になる)
- 検証: ffmpegで生成したRange対応の実テスト動画で、フローティング出現・タイトル表示・再生/一時停止の相互反映・シーク・PinP起動(`document.pictureInPictureElement`で確認)・タブ切り替え・閉じる・サイドパネルの「再生中」セクション表示・ドラッグ後のプレイヤー生存・ドック/アンドックの往復、を全てCDPで確認。実際のスクリーンショットでフローティング+サイドパネル同時表示も確認済み
  - **テスト環境の注意**: 簡易HTTPサーバーでは動画の `seekable` が空になりシークできない(ブラウザは Range リクエスト対応を前提にシーク可否を判断する)。テスト用サーバーは206 Partial Content(Range)に対応させる必要があった

### 2026-07-15: 拡張機能の管理UI(設定画面 + ツールバーアイコン)

- **設定画面に「拡張機能」セクション**: ウェブストアID(a〜pの32文字)を入力してインストール、一覧(アイコン・名前・バージョン・説明)、削除。`extensions:state` ブロードキャストで設定画面・ツールバーに即時反映
- **ツールバーに拡張アイコン**: `electron-chrome-extensions` の `<browser-action-list>` Web Component。アイコンクリックで拡張のポップアップが開く(表示位置・ポップアップ管理はライブラリ任せ)
  - サンドボックス化されたpreloadは `electron` 以外をrequireできないため、`dist/cjs/browser-action.js` を `preload.js` に直接埋め込んでいる(パッケージ更新時は差し替えが必要。preload.js冒頭のコメント参照)
- **ハマりどころ(重要)**:
  - `crx://`(アイコン配信)はURLの `?partition=` から対象セッションを自前解決するため、**`<browser-action-list>` を表示するメインUI(デフォルトセッション)側への `handleCRXProtocol` 登録が必須**(プロファイルセッションだけでは404)。index.htmlのCSP `img-src` にも `crx:` が必要
  - **`<browser-action-list>` はDOM接続時のpartitionでしか更新を購読しない**(partition属性を後から変えてもobserverが張り替わらず、拡張の増減が届かない)→ HTMLには置き場の `#extensions-area` だけを用意し、プロファイル確定・切り替えのたびに要素ごと作り直す(`renderer.js` の `renderExtensionActions()`)
  - 設定画面の拡張アイコンは `chrome-extension://` だと **web_accessible_resources 制限**で通常ページから読めない → メイン側で `nativeImage` でファイルから読み、64pxのdata URIにして渡す(`extension-support.js` の `iconDataFor()`)
  - **CDP検証の注意**: ウィンドウが他アプリに完全に隠れていると `visibilityState=hidden` で rAF が止まり、browser-actionの描画(タイトル・アイコン設定)が保留される。実使用では問題ない
- シークレットウィンドウには拡張アイコンを出さない(拡張機能自体が非対応のため)
- 検証(すべてCDP): 一覧表示とdata URIアイコン / インストール(ボタン無効化→入力クリア→一覧・ツールバー反映)/ 削除(一覧・ツールバーから即時消滅)/ アクションクリックでポップアップ表示 / コンテンツスクリプト動作(example.comのダーク化)/ プロファイル切り替えでpartition追従(新プロファイルでは0件、戻すと復活)/ シークレットで非表示

### 開発の進め方(ツール)

- 動作確認は `npm run start:debug`(`--remote-debugging-port=9222`)で起動し、CDP(Node の WebSocket)で `window.roopie` / `window.roopieInternal` を直接叩いて検証する。
  スクリーンショットは他アプリが最前面にあると失敗するため、CDP検証を優先する
- `.claude/settings.json` に読み取り系コマンドの許可リストを追加済み(パーミッション確認の削減)

(次にやることは冒頭の「今後の計画」を参照)
