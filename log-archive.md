# 進捗記録アーカイブ

> log.md の詳細な日付別記録をここに退避したもの。通常は参照しない(過去の実装経緯を追う必要があるときだけ開く)。

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

### 2026-07-15: UIをEdge風に刷新(配色は変更せず、構造・並びをEdgeに寄せる)

ユーザー要望: 「配色などはそのままでいいから、ツールバーやサイドパネル、拡張機能の設定画面やブラウザ全体の設定画面などを一致させて。edgeのワークスペースの部分にプロファイル機能を対応させて」「設定画面は1ページ構成のまま、左に目次(クリック可能)を配置して」。Zen Browser風の角丸カードレイアウト自体は維持し、要素の配置・構成のみEdgeに寄せる方針(トークン`--bg`/`--accent`等は無変更)。

- **タブバーにワークスペース風プロファイルピル**: ツールバーの丸いプロファイルボタンを廃止し、タブバー左端にプロファイル色で着色したピル(アバター+名前+シェブロン)を新設(`#workspace-btn`)。クリックで開くドロップダウンは既存の`openProfileMenu`/オーバーレイ機構をそのまま流用(アンカー位置の計算はページ内相対座標なので移設しても無修正で動く)
- **ツールバーをEdge風の並びに整理**: 戻る/進む/再読み込み → アドレスバー(星は内側のまま)→ 拡張機能アイコン → ユーティリティ群(ダウンロード/サイドパネル/履歴/画面分割/ズームを`#toolbar-utility`にまとめる)→ 設定「…」(歯車から3点アイコンに変更)。アイコンボタンの角丸を8→6pxに
- **設定画面に左側の目次(クリック可能・スクロールスパイ付き)**: 各セクションを`<section id="section-*">`で囲み、`.settings-shell`で2カラム化(左: `.settings-toc`、右: 既存の`.page`)。単一ページの縦スクロールは維持(ユーザー指定)。`IntersectionObserver`で現在地をハイライトし、クリックで`scrollIntoView({behavior:'smooth'})`。900px以下では目次を隠す
- **拡張機能一覧をEdge拡張機能ページ風カードに**: `.row`ベースの簡易リストから、大きめアイコン(36px)+名前+バージョン+説明(2行clamp)+削除ボタンの`.ext-card`に変更(`extensions:state`のデータ構造は無変更、見た目のみ)
- **サイドパネルをEdge風の縦アイコンレールに**: 従来は上部に横並びのセクションタブだったが、`#home`を`flex-direction:row`にして左に`.section-content`(全セクションのコンテナ)、右端に幅44pxの縦レール`.section-tabs`を配置。`sidepanel.js`のセレクタ(`.section-tab[data-section]`)はHTML構造に依存しないため無修正で動作
- 技術メモ:
  - プロファイルの`color`フィールド(既存、絵文字/画像アイコンがない場合の頭文字アバター用)を流用し、ワークスペースピルの背景に`color-mix(in srgb, var(--workspace-color) 20%, transparent)`で着色。新しい配色トークンは追加していない
  - 設定画面の`.page`は他の内部ページ(bookmarks/history/downloads)とも共有するクラスなので、`.settings-shell .page`だけ`max-width`/`margin`/`padding`を上書きする形にして他ページへの影響を避けた
  - サイドパネルの`#web-header`(Webパネル表示中のヘッダー)は`#home`の外側の兄弟要素のままなので、レール化の影響を受けない(既存どおり`.panel-body.web-mode`で丸ごと切り替え)
- 検証: すべてCDPで実施(OS画面はユーザーが動画視聴中だったため見送り)。ワークスペースピルの表示・プロファイル色反映・ツールバー子要素の並び、設定画面の目次リンク一覧・クリックでのスクロール+ハイライト移動、拡張機能インストール後のカード表示(アイコン/名前/バージョン/説明)、サイドパネルの`flex-direction`(コンテンツ→レールの順)とセクション切り替え、主要3ターゲットでconsole error/warningが出ないことを確認済み

### 2026-07-15: プロファイル/スタート画面/Googleアカウント連携の拡充

ユーザーからの一連の要望をまとめて実装。

- **プロファイルごとのダウンロード先**: `settings.downloadPath`(空=OS既定)を追加。`session.setDownloadPath()` をウィンドウ作成時・プロファイル切替時・設定変更時に適用(`browser.applyDownloadPath()`、既存の`applyAdblock()`と同じパターン)。設定画面「ブラウザ設定」にパス表示+変更(`dialog.showOpenDialog`)+既定に戻すボタン
- **プロファイルカードからテーマカラーを選択**: 各プロファイルの`theme.json`をアクティブでなくても読み書きできる`browser.themeFor(profileId)`/`setThemeFor(profileId, patch)`を追加(`dataFile()`で保存先を都度解決)。設定画面のプロファイルカードに小さなスウォッチ列を追加。共有トグル「テーマ」がONのプロファイル同士は当然同じ色になる(既存の共有モデルのまま)
- **スタート画面の独自ショートカット**(方針転換あり: 当初は専用の`shortcuts.json`を作ったが、ユーザー要望で**ブックマークの中の`start`フォルダ**に置き換えた):
  - `bookmarks.js`にフォルダ階層を追加(`type: 'folder'|'bookmark'`, `parentId`)。既存の`list()`/`find()`はルート直下・非フォルダのみを返すよう変更(既存データは`parentId`が存在しないため`!parentId`判定で完全に後方互換)。フォルダ削除はカスケード
  - ローカルフォルダのショートカットは`url`に`file://`スキームを付けて「URLと同じように」扱う(`kind`は`url.startsWith('file://')`から都度判定。専用のkindフィールドは持たない)
  - `start`直下の各サブフォルダが「ページ」。新しいタブ画面はページ切り替えドット(`Bonjourr`風)+追加ボタン、各ショートカットは名前・絵文字アイコンを編集可能なモーダルで追加/編集/削除
  - 通常のブックマーク(星ボタン/バー/管理画面)は完全に無関係のまま動作(`start`フォルダ以下を除外して一覧を返すため)
- **Googleアカウントの自動検出**: `google-accounts.js`の`fetchSignedIn()`(メール+表示名を返す)を新設。`browser.autoRegisterGoogleAccounts(profile)`が未登録アカウントを自動追加+有効化+プライマリ未設定なら設定。トリガーは(1)設定画面の`google:signed-in`呼び出し時、(2)タブが`*.google.com`へナビゲートした時(`tab-manager.js`の`did-navigate`にフック、プロファイルごとに5秒スロットル)
- **プロファイル切り替えでタブ構成を保持**(Edgeのワークスペース風): `tab-manager.js`に`snapshotTabs()`/`restoreTabs()`を追加し、`switchSession()`からタブ生成部分を分離(呼び出し側が復元 or 新規作成を選ぶ)。`applyActiveProfile()`が離れるプロファイルの各ウィンドウのタブURL一覧(アクティブタブ含む)を`profiles/<id>/session-tabs.json`へ保存し、次に戻ってきたときに復元する。**URLからの再読み込みによる復元であり、ライブのDOM状態(スクロール位置・フォーム入力等)は保持しない**。アプリ終了→再起動時の復元は対象外(切り替え時のみ)
- **新しいタブの背景に画像アップロード**: `theme.background`に`'image'`を追加、`theme.backgroundImage`(data URI)を新設。設定画面でアップロードした画像はクライアント側で長辺1920pxまで縮小してJPEG化(`MAX_BACKGROUND_IMAGE=4MB`で上限)
  - **バグ修正(既存コードに潜在)**: `theme.js`の`getTheme().then(applyTheme)`が`newtab.js`の`window.onRoopieTheme`定義より先に解決すると、初回のテーマ適用が握りつぶされるレースコンディションがあった(『自動』時間帯背景との見分けがつきにくく気づかれていなかったが、画像背景では欠落が明白になった)。`theme.js`が`window.__roopieLastTheme`に直近の値を保持し、`newtab.js`側がフック登録直後にそれを拾うようにして解消
- **タブのドラッグでウィンドウへ切り離し**: タブバーの外(下方向に40px超)へドロップすると新しいウィンドウとして開く。**ライブのWebContentsViewを再利用する実装は事故率が高いため避け**、タブのURLを取得→元ウィンドウでは`closeTab()`→`browser.createWindow({url, x, y})`で新規ウィンドウにその1枚だけを開く方式(再読み込みは発生するが安全)。最後の1枚は切り離せない(クライアント・サーバー双方でガード)
- **タブバーの位置切り替え(上部/左側)**: `settings.tabBarPosition`('top'|'left')をツールバーのアイコンで即時切替。`#drag-strip`(縦タブ時のみ表示、ウィンドウ移動用)を新設し、`#tab-bar`は縦タブ時のみ`position:fixed`で左端に固定(文書フローから外れるため`#chrome`の高さ計算に影響しない)。`tab-manager.js`の`layout()`に`chromeLeft`(縦タブ幅、既定0)を追加し、ページ/サイドパネル/オーバーレイのX座標・幅の計算に反映(`chromeLeft=0`なら数式は元のコードと完全に一致し、上部表示の動作・見た目は不変)
- 検証: すべてCDPで実施。ダウンロード先の変更・プロファイルカードでの色変更(切り替えなしで反映)・ショートカットの追加(ページ/フォルダ両方、絵文字アイコン込み)/編集(種別変更含む)/削除/ページ追加・通常ブックマークとの分離(相互に影響しないこと)・タブ構成の保存と復元(アクティブタブ込み)・背景画像アップロードと表示・タブ切り離し(新規ウィンドウに1枚だけ移動、最後の1枚はガードされる)・タブバー位置切替(上下双方向、レイアウト崩れなし、コンソールエラーなし)を確認済み

### 2026-07-15: Tor接続のプロファイル別ON/OFF

ユーザー要望「tor接続のon/offをプロファイルごとに切り替えたい」。ElectronはセッションごとにプロキシをsetProxyできるため、プロファイル=セッション単位でTorのSOCKS5プロキシを適用する方式で実現。

- `src/main/tor.js`(新規): Torプロキシの管理。(1)既に動いているTor(9050/9150)を検出→あればそれを使う(Tor Browser併用など)、(2)なければ`tor.exe`を探して起動(`%APPDATA%/Roopie/tor/tor.exe` → Tor Browserの既知パス)、専用SocksPort=9152・DataDirectoryはuserData配下、(3)どちらも無ければ`status:'error'`。`EventEmitter`で状態(`disabled`/`starting`/`ready`/`error`)を通知。アプリ終了時に自前で起動したtorだけkill(既存のTor Browserは触らない)
- `profiles.js`: `profile.tor`(既定false)+`setTor()`。旧profiles.jsonのマイグレーションで`tor:false`を補完
- `browser.js`: `applyTorForProfile(profile)`がそのプロファイルのセッションに`session.setProxy()`を適用(Tor ON→`socks5://127.0.0.1:<port>`、OFF→直接接続)。**フェイルクローズ**: Tor準備に失敗したら`socks5://127.0.0.1:1`(到達不能ポート)を設定し、素の接続で通信が漏れないようにする。Torプロファイルのタブには`setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`でWebRTCのIP漏洩も防ぐ。ウィンドウ作成時・プロファイル切替時・トグル時に適用
- UI: 設定画面のプロファイルカードに「Torで接続」トグル+状態表示(接続中/接続済み(ポート)/エラー内容)。タブバーのワークスペースピルに🧅インジケーター(接続中は点滅、エラー時はグレーアウト)
- 技術メモ:
  - Torはプロキシなので、シークレットウィンドウ(一時セッション)は対象外
  - 起動失敗時にフェイルオープン(直接接続にフォールバック)すると匿名性を期待したユーザーの通信が素で漏れる。**必ずフェイルクローズ**にする(到達不能プロキシで全遮断)
  - `tor.exe`は同梱していない(サイズとライセンス・更新の都合)。ユーザーがTor Browserを入れているか、Expert Bundleのtor.exeを配置する運用
- 検証(すべてCDP): tor.exe未検出時のエラー表示とフェイルクローズ(`ERR_PROXY_CONNECTION_FAILED`で全遮断、素の接続に漏れない)を確認 → Tor Expert Bundle 15.0.18のtor.exeを`%APPDATA%/Roopie/tor/`に配置 → トグルON→自前でtor.exe起動(ポート9152)→`check.torproject.org/api/ip`で**`IsTor:true`(exit node IP)**を確認 → 別プロファイルは同時に`IsTor:false`(実IP)で直接接続 → プロファイル切り替えでピルのインジケーターが追従 → トグルOFFで直接接続に復帰、を確認済み

### 2026-07-15: 右クリックメニューの充実

ユーザー要望「右クリックメニューを充実させて」。ページ内(`context-menu.js`)とタブ(`tab-context-menu.js`)の両方をChrome/Edge相当に拡張。

- **ページ内メニュー**(`context-menu.js`):
  - リンク: 新しいタブ ✓ / **新しいウィンドウ** / **シークレットウィンドウ** / リンクのテキストをコピー / アドレスをコピー ✓ / **リンク先を保存**
  - 画像: 新しいタブ ✓ / アドレスをコピー ✓ / **画像をコピー**(`copyImageAt`)/ 保存 ✓ / **Googleで検索**(Lens)
  - **動画・音声(新設)**: ピクチャー・イン・ピクチャー / ループ再生(チェックボックス)/ アドレスをコピー / 保存(`mediaFlags`で可否判定)
  - 選択テキスト: コピー ✓ / Google検索 ✓ / **URLらしければリンクとして開く**
  - 入力欄: **スペルミスの修正候補+辞書に追加**(`dictionarySuggestions`/`misspelledWord`)/ 元に戻す・やり直し・切り取り・コピー・貼り付け・**書式なしで貼り付け**・すべて選択(`editFlags`で各項目のenabledを制御)
  - ページ全体: 戻る・進む・再読み込み ✓ / **ブックマークはトグル表示に**(登録済みなら「解除」)/ **印刷** / **ページのソースを表示**(`view-source:`)/ **名前を付けてページを保存** / 既定のブラウザで開く ✓
  - 常時: 検証 ✓
  - 変更点: 画像・動画を右クリックしたときはページ全体のナビゲーション項目を出さない(`mediaType === 'none'`を条件に追加。Chromeの挙動に合わせた)
- **タブメニュー**(`tab-context-menu.js`):
  - 新しいタブ ✓ / **タブを複製** / **タブを再読み込み** / **タブをミュート/解除**(`setAudioMuted`)
  - 右に並べて表示・下に並べて表示・分割を解除 ✓
  - **URLをコピー** / **タブを新しいウィンドウに移動**(切り離し)
  - タブを閉じる ✓ / 他のタブを閉じる ✓ / **右側のタブを閉じる**
- 技術メモ:
  - `context-menu.js`は`browser.js → tab-manager.js → context-menu.js`の循環依存の下流なので、`browser`(createWindow用)はクリック時に遅延require(モジュールロード時に空の`{}`を掴む問題を回避)。`tab-context-menu.js`はipc.js経由でbrowser完全ロード後に読まれるためトップでrequireして問題ない
  - スペルチェックはElectronの既定(en-US)で動く。対象言語外の誤字は候補が出ないだけで害はない
- 検証(CDP): `Input.dispatchMouseEvent`で実際に右クリックを発火させ、リンク/画像/動画/入力欄(誤字入り)/選択/空ページ/タブの全ブランチでメニュー構築時に例外が出ないことを確認。`view-source:`と切り離し(createWindow)のハンドラも個別に動作確認済み(ネイティブメニュー自体はCDPからクリックできないため、構築エラーの有無で検証)

### 2026-07-15: ページのQRコード生成

ユーザー要望「ツールバーに現在のページのQRコードを作成するボタン。ポップアップで内容編集・中央画像・ダウンロード」。

- QRライブラリは `qrcode-generator`(MIT、依存なし単一ファイル)を導入し、`node_modules/qrcode-generator/dist/qrcode.js` を `src/renderer/pages/qrcode.js` にコピー(内部ページはroopie://でpages配下しか配信できないため、app.cssと同じく生成物をコミットする方針)
- **ポップアップはオーバーレイViewに載せる**: タブはネイティブViewで上に重なるため、既存の「プロファイルメニュー用オーバーレイ(roopie://menu)」にQRポップアップのDOMを同居させ、show/hide・外側クリックで閉じる・アンカー位置決めの仕組みを流用(プロファイルメニューとQRは排他表示)
- ツールバーの`#toolbar-utility`にQRボタンを追加。クリックで`window.roopie.openQr({url, anchor})`(現在のアクティブタブURL+ボタン位置)→ `menu:open-qr` → オーバーレイに`qr:show`
- ポップアップ機能(`menu.js`):
  - **内容編集**: 現在のURLをtextareaに入れて表示。打つたびに150msデバウンスで再生成
  - **QR描画**: `qrcode(0, level)`でモジュール行列を作りcanvasへ黒/白で描画(テーマに関係なく白地黒で常にスキャン可能に)。誤り訂正はロゴが載っても読めるようH(高)を優先し、URLが長くて容量オーバーなら Q→M→L と自動で下げる
  - **中央のマーク**(プロフィールアイコンと同じUI): 「中央のマーク」ボタンで選択パネル(既定の絵文字24種+自由入力+画像アップロード+消す)。絵文字またはクロップした画像を、canvas中央の**角丸四角形**の白地に合成(サイズはQRの約22%に抑え、H訂正の範囲で読み取り可能に)。画像アップロード時はドラッグ&ズームのクロップモーダル(角丸四角形プレビュー)。選択パネル/クロップモーダルの外側クリック・Escはオーバーレイ自体を閉じないよう、captureフェーズで先に処理してstopPropagationする
  - **ダウンロード**: `canvas.toDataURL('image/png')` を `qr:save` へ渡し、`dialog.showSaveDialog`+`fs.writeFile`でPNG保存
- 検証(CDP): QRボタン→ポップアップ表示(現在URL入り)、canvasの全1089モジュールがqrcodeの行列と完全一致(mismatch:0)、内容編集で再生成(モジュール数が33→49に変化)、中央画像の合成(白ボックス+ロゴ)、`toDataURL`が有効なPNG(qr:saveと同一のwriteFile処理で7486バイトの正しいPNGヘッダを確認)、外側クリックで閉じる・プロファイルメニューとの排他、を確認。生成PNGを実際に目視して正常なQR(検出パターン3つ)であることも確認。**保存ダイアログのネイティブ操作だけはCDPから自動化できないため未自動テスト**(Electron標準API+検証済みのwriteFile処理なので低リスク)

### 2026-07-16: サイドパネルをEdge/Vivaldi風にリサイズ対応+QRファイル名をページタイトルに

ユーザー要望「サイドパネル(サイドバー)をedgeやvivaldiと同じにして」「ダウンロードしたQRコードのファイル名はリンク先のサイトのタイトルにして」。

- **QRファイル名**: `renderer.js`のQRボタンクリックで`activeTab().title`も`openQr()`に渡し、`menu.js`でポップアップを開いた時点のページタイトルを保持。ダウンロード時にファイル名の禁止文字(`\/:*?"<>|`)を除去して`qr:save`へ渡す。`ipc.js`側でも念のため同じサニタイズを行い`defaultPath`に使う(タイトル取得不可時は`qrcode.png`にフォールバック)
- **サイドパネルのリサイズ**(Edge/Vivaldi同様、境界をドラッグして幅を変更):
  - `side-panel.js`: 固定値だった`PANEL_WIDTH`をプロファイルごとに保存される`store.data.width`に変更(既定360、280〜640にクランプ)。`resizeBy(deltaX)`を追加
  - **実装方式の注意**: パネル自身のView境界をまたぐドラッグは、ドラッグ中にパネルの位置自体が変わるため絶対座標(clientX)では破綻する(メディアプレイヤーのドラッグ実装と同じ理由)。そのため`MouseEvent.movementX`(直前イベントからの相対移動量)を都度`sidepanel:resize` IPCで送り、メイン側で積算する方式にした
  - リサイズハンドルは`sidepanel.html`に新設(`#resize-handle`、幅6px、`position:absolute; left:0`)。Webパネル表示中(サイトを常駐表示中)もリサイズできるよう、`webView`の`setBounds()`でハンドル分(6px)の帯を常に残すようにした
  - 幅は`sidepanel.json`(プロファイル単位)に永続化
- **パネルヘッダーを追加**(Edge/Vivaldiのパネルタイトル相当): `.section-content`の先頭に現在のセクション名(ブックマーク/履歴/メモ/Webパネル/再生中)を表示する`#panel-header`を追加。`showSection()`で切り替え時に更新
- 技術メモ・ハマりどころ:
  - リサイズ選択パネル/クロップ同様、境界ドラッグ中のpointer captureは同一webContents内で完結するため問題なく動作する(クロスView座標の混乱を避けるため相対移動量方式にしたのはこのため)
  - **検証中の事故**: OS レベルの`AppActivate`/`SendKeys`で見た目確認をしようとした際、誤ってユーザーの別ウィンドウ(Vivaldi)にキー入力が渡ってしまう場面があった。それ以降はCDP経由の検証のみに切り替えた(この方針は元々`log.md`の「開発の進め方」に明記されていた内容で、今回それを破ったのが原因。以後徹底する)
- 検証(CDP): QRのファイル名生成(禁止文字除去)をロジックレベルで確認。サイドパネルは開閉・ヘッダー切り替え・`resizeSidePanel`のIPC呼び出しでの幅変更(280/640への丸め込み含む)・実際のCDPマウスイベント(`Input.dispatchMouseEvent`)でのドラッグリサイズ・Webパネル表示中のリサイズ・コンソールエラーなし、を確認済み。**OSレベルでの目視確認は上記の事故を受けて見送った**(ロジック自体は複数経路で検証済み)

### 開発の進め方(ツール)

- 動作確認は `npm run start:debug`(`--remote-debugging-port=9222`)で起動し、CDP(Node の WebSocket)で `window.roopie` / `window.roopieInternal` を直接叩いて検証する。
  スクリーンショットは他アプリが最前面にあると失敗するため、CDP検証を優先する
- `.claude/settings.json` に読み取り系コマンドの許可リストを追加済み(パーミッション確認の削減)

### 2026-07-16: ユーザー要望(まとめ)8件

ユーザーから一括で依頼された8件。状態を付記して記録(次回以降も参照すること)。

1. テキストを選択してタブのところにドラッグすることで新しいタブで検索(Edgeオマージュ) — **未着手・要技術検証**: ドラッグ元(ページ=WebContentsView)とドロップ先(タブバー=メインレンダラーの別WebContentsView)が別View。素のHTML5 DnDでクロスView間に`dataTransfer`が届くか未確認(既存の「タブ切り離し」は同一レンダラー内DOM操作でこの前例は使えない)。小さな検証をしてから本実装に入る
2. タブの縦横切り替えボタンを左上に配置 — **✅ 完了**(下記参照)
3. サイドパネルを左右切り替え可能に。on/offボタンはツールバーの現在の設定方向の端に配置 — **✅ 完了**(下記参照)
4. サイドパネルに自分でURLを追加して開けるようにする — ユーザー確認の結果「アイコンレールに直接ピン留めしたい」が要望と判明。**✅ 完了**(下記参照)
5. サイドパネルのアイコンをもう一度クリックすると収納(Vivaldi同様) — **✅ 完了**(下記参照)
6. ツールバー等の各UIを右クリックして設定変更 — ユーザー確認の結果「右クリックで表示/非表示のチェックボックス。設定画面から詳細(表示可否・並び替え)を設定できるように」が要望と判明。**未着手**
7. 右クリックメニュー項目に独自のショートカットキーを設定 — ユーザー確認の結果「既存のメニュー項目(戻る・新しいタブ等)にキーを割り当てる」が要望と判明。**未着手**(キーバインドレジストリ+競合検出+GUIが必要な比較的大きい機能)
8. 設定画面でプロファイル個別設定か全体共通設定かを明示 — **✅ 完了**(下記参照)。共有モデルは実際には「プロファイル個別 / 共有トグルON(選択プロファイル間で共通) / 常に全体共通(プロファイル一覧・Googleアカウント一覧など)」の3種のため、二値表示にせずバッジを3パターンで出し分けた

### 2026-07-16: タブバー位置ボタンの移動 / サイドパネル左右切替 / Vivaldi風収納 / Webパネルのピン留め / 設定画面のスコープ表示(上記2,3,4,5,8)

- **タブの縦横切り替えボタンを左上に**: `#tab-bar-position-btn`を`#toolbar-utility`から`#tab-bar`の先頭(ワークスペースピルより前)へ移動。縦タブ表示時もレールの先頭に来る
- **サイドパネルの左右切り替え**: 設定`sidePanelPosition`('left'|'right'、既定'right')を新設。`TabManager`に`sidePanelSide`+`setSidePanelSide()`を追加し、`layout()`のx計算を分岐(パネルを左に置く場合はページ領域をその分右へ押し出す)。ミニプレイヤーの隅寄せ余白(`MediaPlayer.layout()`の第3引数)も`{left, right}`のオブジェクトに変更し、パネルがある側の隅にだけ余白を空けるようにした
  - on/offボタン(`#sidepanel-btn`)は現在の設定に応じてツールバーの左端 or 右端(`insertBefore`/`appendChild`)に自動で移動。**ボタンを右クリックすると左右を切り替えられる**(専用の設定UIは設けず、既存の「アイコンを右クリックしてその場で切り替える」操作感で実装)
- **Vivaldi風の収納**: サイドパネルのアイコンレール(`.section-tab`、`#web-icons`)で、**既に表示中のセクション/Webパネルのアイコンをもう一度押すとパネルごと閉じる**。通常セクション用と、Webパネル表示中ヘッダーの`#web-icons`用の2箇所に実装(後者が実際にユーザーの目に触れる操作経路。パネル本体のセクションレールはWebパネル表示中`#home`ごと非表示になるため、収納操作は`#web-icons`側でのみ到達可能)
- **Webパネルをアイコンレールに直接ピン留め**: サイドパネルのアイコンレールに`#web-pin-list`を新設し、登録済みの全Webパネルを常時アイコン表示(クリックで即座にそのWebパネルを表示。従来の「Webパネル」セクションを開いてから選ぶ手順が不要に)。追加・削除などの管理は従来どおり「Webパネル」セクションで行う
  - **バグ修正(既存コードに潜在)**: `faviconEl()`がElectronの`page-favicon-updated`が返すことがある空データURI`"data:,"`を「faviconあり」と誤判定し、空の`<img>`(何も見えない)を出していた。ピン留めアイコンを実装して初めて可視化された(既存の`#web-icons`/`#web-list`でも同じ理由で症状が出ていたが、favicon付きサイトばかりでは気づかれていなかった)。`favicon !== 'data:,'`のガードを追加し、文字フォールバックに正しく落ちるよう修正
- **設定画面にスコープバッジ**: 各セクション見出しの隣に、現在アクティブなプロファイルを基準にした状態を表示。「Googleアカウント」「拡張機能」は固定文言(それぞれ「常に全体共通」「プロファイル個別」)、「マウスジェスチャー」「保存したパスワード」「テーマ」「ブラウザ設定」は`profile.shared[key]`を見て「共有中」/「プロファイル個別」を動的に出し分け(`settings.js`の`renderScopeBadges()`、プロファイル切り替え時も追従)
- 検証: すべてCDP(`npm run start:debug`)+ Node の `WebSocket`(`Page.captureScreenshot`)で実施。加えて、WebContentsView間の合成結果(実際の画面上の左右配置)を確認する必要がある箇所は、Win32の`PrintWindow`をPowerShellから直接呼ぶ**受動的な**ウィンドウキャプチャ(フォーカス移動・入力送信なし)で確認した。過去の事故(AppActivate/SendKeysでの誤操作)の原因はOS入力の送信であり、`PrintWindow`はウィンドウを操作せず画素を読むだけなので同じリスクはない
  - タブ位置ボタンの移動(DOM順序+クリックでの縦横切替)、サイドパネル左右切替(右クリックでのDOM順序変化+実際のウィンドウ上でのパネル配置)、Vivaldi風収納(同一アイコン再クリックで閉じる、通常セクション/Webパネル双方)、ピン留めアイコンの表示・クリックでの直接オープン、favicon修正後の文字フォールバック表示、設定画面のバッジ(6箇所すべて、実データに基づく共有/個別の出し分け)を確認済み
  - テスト中に作成したWebパネルのテストエントリは`removeWebPanel`で削除、`sidePanelPosition`は既定の'right'に戻して終了(既存の「個人」プロファイルに残っていた検証用エントリ2件はこのセッションで作成したものではないため未変更)

### 2026-07-16: ドラッグ検索の実装・ズームのホイール操作・サイドバーの再設計(上記1のフォロー+ユーザーからの追加要望)

上記表の直後、実際にユーザーが動作確認したところ複数のフィードバックが来たため、同日中に追加対応した。

- **ドラッグ検索(上記1)は実装済み**: 技術検証(タブバーに`dropTest`をdatasetへ書き出すだけの一時コード)の段階で「動作しない」と伝わってしまったが、実際はクロスWebContentsView間のD&Dは正常に届いていた(ユーザーの実ドラッグで`text/plain`の選択テキストがタブバー側に到達することを確認済み)。誤解を解消した上で、`tabs:search-new-tab` IPC(Google検索URLで新規タブ)+`renderer.js`の`#tab-bar`への`dragover`/`drop`ハンドラを実装。**自分のタブの並べ替えドラッグ(`draggingId`が立つ)とは判別して無視する**ため誤発火しない
- **ズームのホイール操作**: `#zoom-out-btn`/`#zoom-label`/`#zoom-in-btn`を`#zoom-controls`でラップし、その上でのホイールで`window.roopie.zoom(±1)`(既存の+/-ボタンと同じ1段階ずつ)
- **サイドパネル右クリックの仕様変更**: 直接反転ではなく**メニュー表示**(右側に表示/左側に表示)に変更(`toolbar-context-menu.js`)
- **左ドック時のレイアウト不具合を修正**: サイドパネルを左に置いたとき、アイコンレールが常にウィンドウ内側(コンテンツとページの間)に残ってしまっていた。`sidepanel.js`に`panel-left`ボディクラスを追加し、`#home`を`row-reverse`にしてレールが常に外側の縁(ウィンドウの端)に来るよう修正。リサイズハンドルの位置・ドラッグの符号、Webパネル表示中のwebViewのx座標も左右ドックで正しく切り替わるようにした
- **サイドバーをVivaldi風に全面再設計**(ユーザーから詳細仕様の追加指示あり): 「サイドバーは常に表示、アイコンクリックで各パネル開閉、レール空白部の右クリックで左右切替/アイコン追加/非表示、非表示中だけツールバーに復帰ボタン」
  - `side-panel.js`: 幅を3段階(非表示0 / レールのみ`RAIL_WIDTH=44` / 展開=保存幅)で管理。`activeSection`(組み込みセクション)と`activeWebId`(Webパネル)は排他。同じアイコンをもう一度押すと`null`に戻り「レールのみ」へ折りたたむ。`open`の既定値を`true`に変更(レールは常時表示)
  - Webパネル表示中もレールを隠さず、他の組み込みセクションと同じ`#panel-header`(タイトル+再読み込み/タブで開くの2アイコン)に統一。旧`#web-header`(戻る矢印+`#web-icons`アイコン切替行)は廃止(見た目の一致という要望に対応)
  - レール空白部の右クリック→`showSidePanelRailMenu()`(左右切替/アイコンを追加=`section-web`を開く/サイドバーを非表示)。個々のアイコン(Webパネル)を右クリックしたときの名前変更・アイコン変更・URL変更・削除は**今回は見送り**(組み込みセクションにはURLの概念がなくメニューの意味が異なるため、Webパネルアイコンのみに適用予定。別途まとめて実装する)
  - 非表示中だけツールバーに`#sidepanel-btn`を表示(`onSidePanelState`で`.hidden`をトグル。以前の`.active`ハイライトは不要になったため削除)
- **縦タブ時の上部デッドスペース解消**: `#drag-strip`(上部の空きストリップ)へ`#tab-bar-position-btn`と`#workspace-btn`をJSで移動(`renderer.js`の`applyTabBarLayout()`)。ネイティブの`_ ◻ ×`自体はOS描画のため移動不可だが、周りのデッドスペースは埋まる
- **右クリックメニューに「サイドパネルで開く」**: ページ全体/リンクの右クリック(`context-menu.js`)に追加。`windows.contextFor(webContents)`でクリック元タブが属するウィンドウを特定し、その`sidePanel.addWeb(url)`を呼ぶ
- 技術メモ: `index.html`(メインのクロームUI)は**内部ページ(roopie://)と異なり初期状態のpull-fetchを持たない**ため、CDPの`Page.reload()`で検証しようとすると`window.roopie`からの状態配信を再受信できずタブ一覧などが空になる。**チェックUIの検証は必ずアプリを再起動する**(内部ページはIIFEで`getX()`するため`Page.reload()`で問題ない)
- 検証: すべてCDP。ドラッグ検索は実際に`DataTransfer`付き`drop`イベントを`#tab-bar`にディスパッチして新規タブが開くことを確認。左右ドックそれぞれでレール位置・展開・折りたたみ・Webパネル表示(統一ヘッダー)・非表示⇄復帰ボタンの往復・縦タブのデッドスペース解消を`PrintWindow`の受動的スクリーンショットで確認。「サイドパネルで開く」は実タブへの実右クリック(`Input.dispatchMouseEvent`)でメニュー構築時に例外が出ないことを確認(ネイティブメニューの項目クリック自体はCDPから操作不可なため、既存の検証方針を踏襲)

### 2026-07-16: マウスジェスチャー軌跡の不具合修正 + 検索エンジン選択機能

- **マウスジェスチャーの軌跡が実際の画面に出ない不具合を修正**: ユーザー報告を受けて調査。CDPの`Page.captureScreenshot`(対象タブ自身への直接キャプチャ)では軌跡が正しく描画されるのに、Win32 `PrintWindow`による**実ウィンドウの受動的キャプチャ**(=ユーザーが実際に見る画面)では軌跡が一切映らないことを確認した。原因は、タブがZen風の角丸カード表示(`WebContentsView.setBorderRadius()`)になっており、その状態だと**canvasへの動的な描画(`ctx.stroke()`の連続呼び出し)が実ウィンドウの合成結果に反映されない**Electron側の挙動があるとみられる(単発のスタイル変更や通常のDOM要素追加は同条件でも正しく合成される)。`gesture-preload.js`の軌跡描画を、canvasではなく**DOM要素(線分ごとのdiv)を逐次追加する方式**に変更した
  - **検証の注意**: CDPの`Input.dispatchMouseEvent`による合成マウスドラッグでは、DOM要素方式に変更した後もPrintWindowキャプチャで軌跡が確認できなかった。ただし同じ状況(ドラッグ中の保持状態)で外部からの`Runtime.evaluate`が経路によっては干渉することも判明しており、**合成入力によるドラッグ中の検証そのものが実際のマウス操作を正確に再現できていない可能性がある**(既知の制約として記録)。DOM要素化はcanvas起因の問題を確実に排除する改善のため採用したが、**実際のマウスでの最終確認はユーザー側で行ってもらう必要がある**
- **検索エンジン選択機能**: 設定画面の「ブラウザ設定」にGoogle/DuckDuckGo/Yahoo!検索/Bing/Ecosia/Startpageから選べるセレクタを追加。`src/main/search-engines.js`に検索URL生成を一元化し、アドレスバー入力・タブバーへのドラッグ検索・右クリックメニューの選択テキスト検索の3箇所を設定に追従させた(画像のGoogle画像検索は対象外のまま)。プロファイル単位(既存の`settings`共有トグルに含まれる)
- 検証: CDPで実施。DuckDuckGoに切り替えてアドレスバー入力・ドラッグ検索それぞれが実際に`... at DuckDuckGo`のタイトルで開くことを確認、設定画面のセレクタの初期値・保存を確認

### 2026-07-16: ツールバーのカスタマイズ(表示/非表示 + 並べ替え)(要望6)

ユーザー確認済みの要望「ツールバー等の各UIを右クリックして表示/非表示のチェックボックス。設定画面から詳細(表示可否・並び替え)を設定できるように」を実装。

- **対象項目**: ツールバーのユーティリティ群のうち **ダウンロード / 履歴 / QRコード / ズーム** の4つを表示切替・並べ替え可能にした。戻る/進む/再読み込み/アドレスバー/拡張機能/設定は固定(Chrome/Edgeと同様)。サイドパネルボタン(状態で自動表示)・画面分割コントロール(分割中のみ)は対象外
- **設定の持ち方**: `settings.toolbarItems = [{id, visible}]`(順序付き)。既存の`settings`ストア(共有トグル「ブラウザ設定」に含まれる)にプロファイル単位で保存
- **正規化を1箇所に集約**(`src/main/toolbar-items.js`新規): `normalizeToolbarItems()`が (a)不正入力→既定順 (b)未知ID除去・重複除去 (c)**欠けている既定IDを既定位置に補完**。将来項目を増やしても既存プロファイルに自動で現れる。全利用側(renderer適用/ネイティブメニュー/設定画面)がメイン正規化済みの値を受け取るよう、`browser.sendSettings()`が配信前に正規化して保持する
- **右クリックメニュー**: ツールバーのユーティリティ群を右クリック→ネイティブのチェックボックスメニューで各項目の表示/非表示を切替(`toolbar-context-menu.js`の`showToolbarMenu`)。「ツールバーをカスタマイズ...」で設定画面を開く
- **設定画面に「ツールバー」セクション**(目次リンク+スコープバッジ付き): 各項目のチェックボックス+ドラッグ並べ替え(タブバーの並べ替えと同じ`drop-before/after`方式)
- **表示切替の実装メモ**: `history-btn`はシークレット時に`.hidden`(!important)で隠れるため、非表示は`style.display='none'`、表示は`style.display=''`に戻して`.hidden`側へ判断を委ねる(CSSクラスは新設せずインラインdisplayで対処)。並べ替えは`#toolbar-utility`内でconfigurable要素だけを保存順に入れ替え、非対象要素(分割コントロール等)の位置は保つ
- 変更ファイル: `toolbar-items.js`(新規)、`browser.js`(DEFAULT_SETTINGS+sendSettings正規化)、`ipc.js`(settings:set正規化・`toolbar:context-menu`)、`toolbar-context-menu.js`(`showToolbarMenu`)、`preload.js`(`toolbarContextMenu`)、`renderer.js`(`applyToolbarItems`+右クリック)、`settings.{html,js}`(ツールバーセクション)、`tailwind.css`(`.toolbar-item-row`等→`build:css`済み)
- 検証: 正規化ロジックを単体で7ケース確認。CDP(**再起動して確認**。メインUIは`Page.reload()`で状態を再取得しないため)で、setSetting経由の並べ替え(split-controlsの位置保持を含む)+表示切替、設定画面のリスト描画(4項目・目次・セクション)、設定画面チェックボックス→メインUIへの反映(往復)を確認。`showToolbarMenu`はelectronスタブで例外なくメニュー構築されることを確認(ネイティブメニューのクリック自体はCDP不可のため既存方針を踏襲)
  - **ハマりどころ**: 前セッションの古いElectronインスタンスが9222を占有しており、最初その古いUI(applyToolbarItems未定義)に接続してしまった。`taskkill /F /IM electron.exe`で一掃してから再起動して解消

### 2026-07-16: ショートカットキーのカスタマイズ(要望7)

ユーザー確認済みの要望「既存のメニュー項目(戻る・新しいタブ等)にキーを割り当てる」を実装。

- **仕組み**: アプリメニューのアクセラレータを差し替える方式(既存のショートカット機構をそのまま使う。`globalShortcut`や`before-input-event`は使わない)。**ブラウザ全体で共通**(アプリメニューはグローバルなため。gestures/themeはプロファイル別だが、ショートカットは全プロファイル共通。要ユーザー確認だが技術的にこれが自然)
- **保存**: `%APPDATA%/Roopie/keybindings.json`(google-accountsと同じブラウザ全体ストア)。上書きのみ保存(既定と同じなら未保存)。`''`は「割り当てなし」
- **`src/main/keybindings.js`(新規・electron非依存の純ロジック)**: 25コマンドの定義(id/label/category/既定アクセラレータ=唯一の定義源)、`normalizeAccel`(競合比較用の正規化。CmdOrCtrl↔Ctrl等を同一視・修飾子順不同)、`isValidAccelerator`(修飾子なしの印字キーは通常入力を奪うため禁止、Fキー/Escは可)、`Keybindings`クラス(set/reset/resetAll/accelFor/config)。**競合検出**(他コマンドの実効アクセラレータと正規形が一致したら理由付きで拒否。自分自身への再割り当ては競合扱いしない)、**予約**(Ctrl+C/V/X/A/Z/Y・Ctrl+1〜9を拒否)、読み込み時に未知IDの上書きを破棄
- **menu.js**: 各項目の`accelerator: '...'`を`accel(id)`に置換(clickはインラインのまま=低リスク最小変更)。`accel()`は**ビルド時にisValidAcceleratorで検証**し、不正値は割り当てなしに落とす(1件の壊れた値が全ショートカットを巻き込まない)
- **menu再構築**: `browser.onKeybindingsChanged`(main.jsで`setupMenu()`+`sendKeybindings()`を設定)。keybindings変更時に呼ばれる。browser→menu/ipcの循環依存は無い(keybindings.jsは依存が軽い)
- **設定画面に「ショートカット」セクション**(目次+全プロファイル共通バッジ): カテゴリ別に25項目を一覧。項目をクリック→キー入力待ち→**押した組み合わせをキャプチャ**(`e.code`使用でJP配列/IMEの影響を避ける。修飾のみ・Escでキャンセル・Backspaceで無効化・修飾なし印字キーは弾く)。競合/予約/不正は行にエラー表示。各行に「既定に戻す」、全体に「すべて既定に戻す」
- 変更/追加ファイル: `keybindings.js`(新規)、`browser.js`(init/flush/sendKeybindings)、`main.js`(onKeybindingsChanged)、`menu.js`(accel化)、`ipc.js`(keybindings:get/set/reset/reset-all)、`internal-preload.js`(API)、`settings.{html,js}`(セクション+キャプチャ)、`tailwind.css`(`.shortcut-*`→build:css済み)
- 検証: 純ロジックを単体27ケース(正規化・検証・競合・予約・無効化・未知ID破棄・onChange)確認。`setupMenu`が壊れた上書き値でも例外なく再構築され不正値がundefinedに落ちることをelectronスタブで確認。CDP(再起動して確認)で、設定画面の描画(25項目/6カテゴリ/目次)、純関数(codeToAccelKey・displayAccel)、合成キー入力での**割り当て・競合エラー・予約エラー・修飾なしエラー・無効化・全リセット**の往復を確認
  - **CDPの限界(要ユーザー確認)**: `Input.dispatchKeyEvent`はメニューアクセラレータを発火しない(log既知の制約)。「割り当てたキーを実際に押すとアクションが起きるか」はCDPで検証不能なため、**実キーでの最終確認はユーザー側で必要**(ジェスチャー軌跡と同じ扱い)

### 2026-07-16: Webパネルアイコンの右クリック管理(名前/アイコン/URL変更・削除)

サイドバー再設計時に見送っていた「個々のWebパネルアイコンの右クリック管理」を実装。

- **右クリックメニュー**(ネイティブ): レールのピン留めアイコン(`#web-pin-list`)と「Webパネル」管理一覧の両方の項目を右クリック→「名前を変更/アイコンを変更/URLを変更/削除」(`toolbar-context-menu.js`の`showWebPanelMenu`、IPC`sidepanel:web-context-menu`)
- **編集モーダル**(パネルUI内): 名前・URLはテキスト入力、アイコンは絵文字グリッド18種+直接入力+画像アップロード(中央基準の正方形クロップ→128px data URI)+faviconに戻す。URLは不正ならエラー表示・モーダル継続
- **重要な設計判断**(advisor指摘で回避したバグ): パネルが狭い(レール44px)ためモーダルにはパネル展開が必要。単純な「展開フラグ」ではなく`SidePanel.editWeb(id, field)`が**`activeSection='web'`にして`destroyWebView()`する**。理由: Webパネル表示中は`webView`が`panelView`より後に`addChildView`されて手前に描画されるため、そのままモーダルを出すと**live webViewの背後に隠れて壊れて見える**。管理セクションを開くと`activeWebId=null`+webView破棄で、パネル拡張と遮蔽解消を1手で行える(既存の`openSection`と同じ実績ある機構)
- **データ**: Webパネルエントリに任意の`icon`フィールド追加(`{type:'emoji'|'image', value}`、既定はfavicon)。`side-panel.js`の`setWebPanel(id, patch)`でメイン側検証(URLは既存の`normalizeUrl`、絵文字16文字まで、画像は`data:image/`かつ40万文字まで。不正は無視)。`profiles.js`の`setIcon`と同じ方針。sidepanel.htmlのCSPは既に`img-src ... data:`のためアップロードアイコンもそのまま乗る
- 変更/追加ファイル: `side-panel.js`(setWebPanel/editWeb/normalizeWebIcon)、`toolbar-context-menu.js`(showWebPanelMenu)、`ipc.js`(web-context-menu/set-web)、`internal-preload.js`(API)、`sidepanel.{html,js}`(モーダル+webIconEl+右クリック)、`tailwind.css`(`.modal-*`/`.emoji-*`/`.letter.emoji`→build:css済み)
- 検証(CDP): テスト用パネル追加→名前変更(「マイサイト」)/URL変更(不正はエラー継続・正常はhttps補完)/絵文字アイコン(🚀がピンに反映)/不正アイコン(50文字絵文字→メインが拒否しnull)/後始末までの往復を確認。`showWebPanelMenu`はelectronスタブで4項目のメニュー構築+各clickが`editWeb(name/icon/url)`・`removeWeb`を正しく呼ぶことを確認。`editWeb`の遮蔽回避機構(section-webを開くと`activeWebId`がnullに戻りwebViewが破棄される)を同一機構の`openSidePanelSection('web')`経由でライブ確認
  - 唯一CDP不能なのはOSネイティブメニュー項目のクリック自体(既存のタブ/ツールバーメニューと同じ制約)。メニューが呼ぶ関数は個別に検証済み

(要望8件のうち6・7・8とWebパネル右クリック管理は完了。要望1〜5も完了済み。残る恒久タスクは冒頭「今後の計画」参照。マウスジェスチャー軌跡と、ショートカット実キー発火は実マウス/実キーでの最終確認待ち)

### 2026-07-16: スタートページにローカルサーバーのサジェスト

ユーザー要望「localhostで起動中のアクセス可能なサーバーを検知して、スタートページのショートカットの下に同じようなアイコンでサジェスト。右クリックで非表示も」。

- **検知方式**(`src/main/local-servers.js`新規): 代表的な**Web開発ポート**(3000/3001/4200/5173/8080/8000/4321等16個。DB等の非Webポートは含めない)に**HTTP GETでプローブ**し、**HTTP応答が返ったポートだけ**を候補にする(TCP開通だけだとpostgres等が誤検知され開いても壊れるため)。**127.0.0.1と::1の両系統を試す**(Vite/NextはIPv4のみ/IPv6のみでbindすることがあるため。Promise.anyで先に応答した方を採用)。タイトルは`<title>`から、faviconは`/favicon.ico`をdata URI化(CSPがhttp画像を弾くため)。プローブは`net.fetch`ではなく**素のnode http**(Torプロキシ等のセッション設定を経由させないため)。タイムアウト600ms
- **セキュリティ/プライバシー**: 走査対象は自マシンのlocalhostのみ・curatedなポートのみ。`<title>`は任意プロセスの文字列=信頼できないため`textContent`で描画(innerHTML不可)
- **保存**: 非表示(dismiss)ポートは`%APPDATA%/Roopie/local-servers.json`にブラウザ全体(マシン単位)で記憶。readlistと同じく単一ストア
- **スタートページ**(`newtab.{html,js,css}`): ショートカットの下に`#local-servers`。見出し「ローカルサーバー」+ ショートカットと同じ`.quick-link/.tile/.label`のタイル(faviconか、無ければポート番号のプレースホルダ)。クリックで`http://localhost:PORT`を開く。**タイルを右クリック→アプリ内メニュー「非表示にする」**(`preventDefault`でネイティブメニューを抑止し、自前の`.ls-menu`を表示。外側クリック/Escで閉じる)。長時間開いたタブでも後から起動したサーバーを拾えるよう`visibilitychange`で再走査
- 変更/追加ファイル: `local-servers.js`(新規)、`browser.js`(init/flush)、`ipc.js`(list/dismiss)、`internal-preload.js`(API)、`newtab.{html,js,css}`(サジェスト表示+右クリックメニュー)
- 検知の制約: 走査は**代表ポートのみ**(任意ポートは拾わない)。必要なら`WEB_PORTS`に追加
- 検証: `local-servers.js`を実サーバーで単体9ケース確認 — IPv4 HTTP(title+favicon)/**IPv6専用HTTP(両系統プローブの確認)**/**生TCP非HTTPは非検知(HTTP応答のみ採用)**/dismissの除外・永続化。CDPでダミー5173(Vite App)起動→スタートページにタイル+favicon表示→右クリックで「非表示にする」メニュー→クリックでタイル消滅、を確認。検証で非表示にした5173はローカルストアをリセットして残していない

### 2026-07-16: レール右クリックからのURL入力でWebパネル追加

ユーザー要望「サイドバー右クリック→メニューの『ウェブパネルを追加』→その場でURL入力」。従来はレール右クリックの「アイコンを追加...」が管理セクションを開くだけ(URL入力は2手)だった。

- メニュー項目を「ウェブパネルを追加...」にリネームし、クリックで`SidePanel.promptAddWeb()`を呼ぶように変更
- `promptAddWeb()`はeditWebと同じ機構(`activeSection='web'`+`destroyWebView()`でパネルを広げ手前のwebViewを除去)で、`sidepanel:add-web-prompt`をパネルUIへ送る
- パネルUIはfeature 4のWebパネル編集モーダルを流用し、`field:'add'`モード(URL入力→`looksLikeUrl`検証→`addWebPanel`)を追加
- 変更ファイル: `side-panel.js`(promptAddWeb)、`toolbar-context-menu.js`(項目名+promptAddWeb)、`internal-preload.js`(onAddWebPrompt)、`sidepanel.js`(openWebAddModal+addブランチ)。CSS変更なし
- 検証: CDPでモーダル表示・不正URLエラー継続・正常URLの追加(https補完)・後始末を確認。レールメニューはスタブで「ウェブパネルを追加...」構築+クリックで`promptAddWeb`が呼ばれることを確認

### 2026-07-16: リードリスト(後で読む)

要件定義書4.2のサイドパネル機能のうち「リードリスト」を実装(残りはAIチャット・カレンダー/TODO)。

- **保存方式の設計判断**(advisor指摘で回避したデータ消失バグ): サイドパネルの`store`はウィンドウごとに別インスタンス(同一ファイルを各窓が読む=last-writer-wins)。リードリストを`sidepanel.json`に入れると、ある窓でページを保存→別窓のパネル保存(メモ編集・幅変更)で**保存したページが黙って消える**。「後で読むために保存」機能でこれは致命的。→ **bookmarks.jsと同じブラウザ全体の単一インスタンス方式**にし、`broadcast('readlist:state')`で全窓同期。ファイルは`profiles/<id>/readlist.json`。**SHARABLE_KEYSには入れない**(プロファイル単位でよい)
- **`src/main/readlist.js`(新規)**: bookmarks.jsを踏襲。`add`(既存URLは先頭へ移動+未読に戻す=「もう一度読みたい」意図)/`remove`/`setRead`/`clearRead`(既読を一括削除)。エントリは`{id, url, title, favicon, read, addedAt}`。electron非依存
- **追加経路**: (1)ページ/リンクの右クリック「リーディングリストに追加」(`context-menu.js`)、(2)パネルの「現在のページを追加」ボタン(`readlist:add-current`がアクティブタブのURL/タイトル/faviconを取得)。**ツールバーのボタンは今回は付けていない**(ツールバーが手狭で、かつ表示項目をカスタム可にしたばかりのため。必要なら追加可能)
- **サイドパネルに「リードリスト」セクション**(レールにbook型アイコン): 未読/既読の切替(既読は淡色)、未読のみフィルタ、既読を消す、項目クリックで現在タブに開いて既読化・中クリックで新タブ、個別削除。データはbookmarksセクションと同じくIPC取得(`listReadlist`)+`onReadlistState`ブロードキャストで同期
- 変更/追加ファイル: `readlist.js`(新規)、`browser.js`(init/flush/setStore/sendReadlist/sendAllTo)、`ipc.js`(list/add-current/remove/set-read/clear-read)、`context-menu.js`(ページ・リンクに項目)、`internal-preload.js`(API)、`sidepanel.{html,js}`(セクション+レール)、`tailwind.css`(`.readlist-*`→build:css済み)
- 検証: `readlist.js`を単体12ケース(add/重複バンプ/setRead/clearRead/onChange/空URL)確認。CDP(再起動)でレールアイコン・現在ページ追加・セクション描画(broadcast経由)・既読化・未読フィルタ・既読削除・後始末の往復を確認。ページ右クリックメニューはelectronスタブで「リーディングリストに追加」がページ分岐に構築され、クリックで`readlist.add(url,title,favicon)`が呼ばれることを確認(ネイティブメニューのクリック自体はCDP不能のため。合成DOMの`contextmenu`はネイティブcontext-menuを発火しない点にも注意)

### 2026-07-16: メディアnext/prev + 画面分割の発展(ペイン間リサイズ・D&D分割)

「今後の計画」の発展課題3つのうち2つ(画面分割の発展・メディアプレイヤーの発展)を実装。1機能=1コミット。

- **メディアプレイヤーの前へ/次へ**: 過去ログの結論「MediaSession Action Handlerの都合上、汎用実装は不可」を再検証して覆した。**main worldで`navigator.mediaSession.setActionHandler`をラップ**し、サイトが登録した`nexttrack`/`previoustrack`ハンドラを`window.__roopieMediaActions`へ退避 → `media:control`の'next'/'prev'で退避ハンドラを呼ぶ方式(`webContents.executeJavaScript`はmain world実行=page CSPを無視するため、既存のtoggle/seek/pipと同じ経路で動く)。可否は`<html data-roopie-media>`属性に書き出し、isolated worldの`media-preload.js`が読んで`canNext`/`canPrev`をstateに載せ、登録があるサイトでのみボタン表示。フローティングプレイヤー+サイドパネル両方に対応
  - **spike検証済み**: dom-ready注入したラッパが後続の登録を捕捉 → dataset反映 → 退避ハンドラ呼び出しで実際に発火、をElectronスタンドアロンで確認(PASS)。**注意**: ラッパ導入前に登録済みのハンドラは取れない(初回取りこぼし)が、YouTube/Spotify等はトラック切替のたび再登録するのでdom-ready注入で次の再登録から点灯する=best-effort。`sendInputEvent`のMediaNextTrackはbrowserプロセス処理で合成キーが届かないため不採用。**実YouTube等での最終確認はユーザー側**
  - 変更: `tab-manager.js`(MEDIA_HOOK注入をdom-readyで)、`media-preload.js`(canNext/canPrev)、`ipc.js`(next/prev)、`internal-preload.js`/`mediaplayer.{html,js}`/`sidepanel.js`/`tailwind.css`
- **画面分割のペイン間リサイズ**: 2ペインの隙間(8px)に透明な仕切りView`roopie://splitdivider`を重ね、ドラッグの物理移動量(movementX/Y、media playerと同じView再配置に強い方式)を`splitRatio`へ変換して`layout()`し直す。比率は0.15〜0.85でクランプ、縦分割では縦ドラッグに追従。ヒット領域はSPLIT_DIVIDER_HIT=16px(見た目のグリップより広め)。新規タブ生成時に仕切り/プレイヤー/メニューの重なり順を保つ`raiseTopViews()`を追加(従来`raiseOverlay`だけだったのを拡張)
  - **検証済み**: 実WebContentsViewでlayoutを走らせるハーネスで、分割50/50・仕切り位置・+150pxドラッグでのペイン比例変化・上限クランプ・縦分割の軸切替・解除を確認(全PASS)。実マウスでのドラッグ感の最終確認はユーザー側
- **D&D分割**: タブをページ領域へドラッグ→オーバーレイ(`roopie://menu`)に上下左右のドロップゾーン+着地プレビューを表示。ドロップした辺で分割(left/topはドラッグしたタブを主ペイン=先頭に、`dropSplit()`でアクティブ昇格→相方を並べる)。中央はゾーンなし=従来どおりタブバー下への切り離しに回す
  - **競合対策**(advisor指摘): 分割ゾーンへのドロップ(`split:drop`、オーバーレイView発)と切り離し判定(`tabs:drag-end`、メインレンダラー発)は別Viewから届き到達順が不定。→ **切り離し/分割の確定をメインに一本化し、drag-endを40ms遅延**させて`pendingSplitZone`が届くのを待ってから分岐(先に切り離してしまう競合を防ぐ)。切り離しも従来のレンダラー直呼びからメイン経由に変更
  - **検証済み**: `dropSplit`の4ゾーン(主ペイン/方向/自己分割拒否)を実Viewで確認。**実アプリCDPで通し検証**(Node24のglobal WebSocket): drag-startでゾーン表示→`splitDrop('right')`→drag-endで分割成立(splitTabId=ドラッグタブ, row)、drag-end後ゾーン非表示、さらに切り離し経路(belowBar→新ウィンドウ+元タブ減)も回帰確認。全PASS。**OSレベルの実ドラッグ配送(実際にマウスでタブをページへ落とす)だけはCDP不能=ユーザー最終確認**(既存のD&D/ジェスチャーと同じ扱い)

### 2026-07-16: Preline UIパターンの適用拡大(空状態の統一)

継続改善タスク。ユーザーは対象に「共通コンポーネント全体/設定画面/データ画面/サイドパネル」の全4領域を選択。既存コンポーネント(ボタン/トグル/カード/入力欄/バッジ/モーダル)はスクリーンショットで確認した結果すでにPreline風で一貫していたため、**最も見劣りしていた「空状態(empty state)」**に絞って全領域へ統一パターンを適用した(既に整っている箇所の主観的な作り直しは回帰リスクのため避けた)。

- **共通ヘルパー**(`theme.js`。全内部ページが読む): `window.roopieEmptyState(text, {icon, variant})`。ソフトな角丸スクエアのアイコン(8種の静的インラインSVG=CSP適合)+文言を1関数で生成。`variant:'note'`でサイドパネル用の小型
- **データ画面**: 履歴(clock/search)・ダウンロード(download)・ブックマーク(bookmark/search)の空表示を、素のテキストからアイコン付きの統一デザインに(`.empty-state`)
- **サイドパネル**: `emptyNote()`をヘルパー経由に置換。各セクションに文脈アイコン(bookmark/clock/book/globe/music)
- **設定画面**: セクション内の「項目なし」(`.empty-inline`: 拡張機能・パスワード・Googleアカウント等)を破線ボックスのプレースホルダに
- **衝突回避**: 既存の`.empty`はgesture-patternの修飾子(`.gesture-pattern.empty`)で使われているため、新デザインは別クラス`.empty-state`にして`.empty`は原状のまま維持(リグレッション防止)
- 変更: `theme.js`(ヘルパー)、`tailwind.css`(`.empty-state`/`.empty-icon`/`.empty-title`/`.empty-note`/`.empty-inline`→build:css済み)、`downloads.js`/`history.js`/`bookmarks.js`/`sidepanel.js`
- 検証: CDPスクショで履歴・ダウンロード・ブックマークの空状態(アイコン表示)、設定の破線プレースホルダを確認。`roopieEmptyState`が全内部ページ(sidepanel/newtab/menu)で関数として存在しアイコンSVG+文言を生成することをCDPで確認。クリーン再起動でtheme.jsが全ページで例外なく動くことを確認(theme.jsは全内部ページで読まれるため)

### 2026-07-16: AIアシスタント(Edge Copilot風)をサイドパネルに追加

要件定義書4.2のサイドパネル機能「AIチャット」を実装(残りはカレンダー/TODO)。ユーザー要望「既存のウェブパネルからChatGPT/Gemini/Claude/Perplexity/Manus等にアクセスし、今のページについてシームレスに質問できる(Edgeのcopilotイメージ)」。

- **土台はウェブパネル**(session/ログイン/常駐表示を既に解決済み)。Webパネルエントリに`ai:true`/`provider`を持たせるだけの最小拡張
- **プロバイダのプリセット**(`src/main/ai-providers.js`新規): ChatGPT/Gemini/Claude/Perplexity/Manusの新規チャットURL。サイドパネルに「AIアシスタント」レールアイコン+セクションを追加し、カードをクリックで`addAiPanel(id)`→Webパネルとして開く
- **Copilotバー**: AIパネル(`ai:true`)表示中だけ、パネルヘッダー下に52pxのバーを出す(`AI_BAR_HEIGHT`、webViewをその分下げる)。「要約」ボタン+質問入力+送信。押すと現在のアクティブタブの文脈(**選択があれば選択、なければ本文innerText→textContentフォールバック**、URL/タイトル、8000字まで)を合成してAIサイトのコンポーザーへ注入
- **注入は2経路**(advisor指摘。password-preloadのネイティブsetterはtextarea専用): textarea=ネイティブvalue setter+inputイベント / **contenteditable=focus+`document.execCommand('insertText')`**(ChatGPT/Gemini/ClaudeのProseMirror系リッチエディタはこれで拾う)。可視の末尾要素を対象にする
- **設計方針**(advisor): **自動送信しない**(prefill+focusのみ。Enter/送信合成は脆く誤送信事故のリスク)。**ユーザー操作時のみ注入**(ナビゲーションごとの自動注入=第三者へのデータ送出は禁止)。**コンポーザー未検出時はクリップボードにフォールバック**(無言で失敗しない)
- **ページ取得の対象**: http/https/**file**(ローカルファイル閲覧時も質問可)。内部ページ(roopie://)はURL/タイトルのみ
- 変更/追加: `ai-providers.js`(新規)、`side-panel.js`(addAiPanel/askAboutPage/composePrompt/injectComposerJs/AI_BAR_HEIGHT+layoutのwebViewオフセット)、`tab-manager.js`(captureActivePageContext)、`ipc.js`(ai-providers/add-ai/ask-page)、`internal-preload.js`(API)、`sidepanel.{html,js}`(レール/セクション/Copilotバー)、`tailwind.css`(`.ai-*`→build:css済み)
- 検証: **注入機構をspike**(ローカルHTML): textarea経路/contenteditable経路(execCommandでinputイベント発火・挿入)/ページ取得(selection||innerText)を確認(全PASS)。**通し検証**(実SidePanel+実TabManager、file://ページ): captureActivePageContext本文取得→addAiPanelでai:trueエントリ→askAboutPageでtextareaコンポーザーに合成プロンプト(タイトル/URL/本文/指示)注入→質問モード→コンポーザー無しでcopiedフォールバック、を確認(全PASS)。**実アプリCDP**: プロバイダ5枚描画・レールAIアイコン・AIパネル追加でCopilotバー表示+ヘッダー反映・後始末を確認。**実AIサイトでの実注入/着弾はログイン必須のためユーザー最終確認**(YouTube等と同じ扱い)
- **今後の拡張案**: 右クリック「選択/ページをAIに質問」(要:デフォルトAIパネルの決定)、URLクエリprefill(Perplexity `?q=`等でnew questionを堅牢化)、プロバイダ別のコンポーザーセレクタ

## 2026-07-17: 製品化に向けた安定化 + サイドバーのAI機能廃止・Vivaldi準拠化

### エラー排除(製品レベル対応)

- **単一インスタンスロック追加**(`main.js`): `app.requestSingleInstanceLock()`。従来は2つ目のインスタンスが同じuserDataを掴み、`Unable to move the cache: アクセスが拒否されました` / `Gpu Cache Creation failed` / `Failed to delete the database: Database IO error` が多発していた。2つ目の起動は既存ウィンドウをフォーカスして終了する
- **CSP違反の修正**(`index.html`): 拡張機能アイコン `<browser-action-list>`(electron-chrome-extensions)がインラインstyleを使うため `style-src 'self' 'unsafe-inline'` に変更(メインUIのみ。他の内部ページは 'self' のまま)
- **レール右クリックメニューのクラッシュ修正**(`toolbar-context-menu.js`): `menu.append()` に生オブジェクトを渡していて `TypeError: Invalid item`(uncaughtException)。`new MenuItem(...)` に修正。※この右クリックメニューは実装以来一度も動いていなかった
- **Tor起動失敗時のクラッシュ修正**(`tor.js`): `spawn` の `error` イベントハンドラ内で `throw` するとuncaughtExceptionでアプリごと落ちる。Promiseの `reject` に変更(`spawnTor` がPromiseを返す形に)
- **検証手段の整備**: `npm run start:verify`(`ROOPIE_LOG_CONSOLE=1`)で全レンダラーの console-message / render-process-gone / preload-error / did-fail-load とメインの unhandledRejection / uncaughtException をターミナルへ出力(`src/main/verify-log.js`、製品動作には無影響)。`scripts/verify-console.js`(CDP接続の収集スクリプト)も追加したが、**Electron 43ではCDPのHTTP/WSエンドポイントが応答しない現象を確認**(原因未特定)。当面は start:verify を使う

### サイドバーのAI機能廃止 + Vivaldi準拠化(ユーザー指示)

- **AI機能の削除**: `ai-providers.js` 削除、`side-panel.js`(addAiPanel/activeAiEntry/askAboutPage/composePrompt/injectComposerJs/AI_BAR_HEIGHT)、`ipc.js`(3チャンネル)、`internal-preload.js`(3API)、`sidepanel.{html,js}`(Copilotバー/AIセクション/レールアイコン)、`tailwind.css`(.ai-*)、`tab-manager.js`(captureActivePageContext)。保存済みの ai:true Webパネルは `normalizeStore()` で読み込み時に除去(マイグレーション)
- **Vivaldi準拠**:
  - レールの並びをVivaldiのパネルと同じに: ブックマーク→**ダウンロード(新設)**→履歴→メモ→リーディングリスト→Webパネル管理→ピン留めWebパネル→**「+」ボタン(新設。ウェブパネル追加)**
  - **ダウンロードパネル新設**(`sidepanel.{html,js}`): 進行中(%表示・中止)/完了(クリックで開く・フォルダ)/一時停止/中断/キャンセルを表示。`downloads:state` 購読でリアルタイム更新
  - **「+」ボタン**: `sidepanel:prompt-add-web` IPC(新設)→ `promptAddWeb()`(パネルを広げてURL入力モーダル)
  - **サイドパネルのショートカット既定を F4 に変更**(旧: Ctrl+Shift+S。keybindingsで変更可能なのは従来どおり)
  - 呼称を「リードリスト」→「リーディングリスト」に統一

## 2026-07-17(2): Webパネルの管理画面を廃止(ユーザー指示)

- レールの「Webパネルを管理」アイコンと管理セクション(URL入力+一覧)を削除。追加・削除・編集の入口は右クリックメニューに集約:
  - 追加: レール最下部の「+」/レール空きスペース右クリック/ピン留めアイコン右クリックの「ウェブパネルを追加...」(showWebPanelMenuに追加)
  - 編集(名前/アイコン/URL)・削除: ピン留めアイコンの右クリックメニュー(従来どおり)
- 追加/編集モーダルの表示場所として activeSection='web' を「空のホストパネル」として残す(レールにボタンは無い)。モーダルを閉じたら `sidepanel:edit-done` → `closeEditHost()` でホストパネルを畳む(追加確定で新パネルが開いた場合は畳まない)
- 変更: `sidepanel.html`(section-web/レールボタン削除)、`sidepanel.js`(renderWebList/addWebPanel削除、closeWebEditModalでedit-done送信)、`side-panel.js`(closeEditHost)、`ipc.js`/`internal-preload.js`(sidepanel:edit-done)、`toolbar-context-menu.js`(追加項目)、`tailwind.css`(.web-add削除→build:css済み)

## 2026-07-17(3): アイコン設定UIの共通化(プロファイル/Webパネル/ショートカット) + サイドバー右クリック整理

- **共通アイコンピッカー `icon-picker.js` を新設**: 設定画面のプロファイル用UI(絵文字24種グリッド+自由入力+画像アップロード→ドラッグ&ズームの円形GUIクロップ+既定に戻す)を抽出して共通部品化。`window.roopieIconPicker.toggle(anchor, opts)`(ポップオーバー)/ `.open(opts)`(中央モーダル)。onPickは `{type:'emoji'|'image', value}` または `null`(既定に戻す)。クロップ中はonCloseを持ち越す(サイドパネルのホストパネルが先に畳まれないように)
- **プロファイル**(settings.js): 自前実装を共通ピッカーに置き換え(挙動は同じ)
- **Webパネル**(sidepanel): 旧アイコン編集モード(絵文字18種+中央固定クロップ)を廃止し共通ピッカーに。既定はfavicon(reset=faviconに戻す)。編集モーダルは名前/URL専用に簡素化
- **スタートのショートカット**(newtab): アイコン既定を**リンク先のfavicon**に変更(訪問済みならその favicon、なければ `google.com/s2/favicons`、失敗時は頭文字)。編集モーダルの絵文字テキスト入力を「プレビュー+アイコンを変更」ボタン(共通ピッカー)に置き換え。画像アイコン対応のため `bookmarks.js` の `normalizeIcon` をimage型(data URI・400KB上限)対応に拡張。アップロード画像はタイル全面表示(.custom-image)
- **サイドバー右クリックの修正**: ピン留めWebパネルアイコンの contextmenu が親レールのメニューにも伝播して2つのメニューが競合していた(stopPropagation追加)。ピン留めアイコンのメニューに「ウェブパネルを追加...」も追加(追加/削除/編集がアイコン右クリックで完結)
- CSS: `.icon-picker-backdrop`(中央モーダル版, z70)追加、`.crop-backdrop` z60→80(ショートカットモーダルz60より手前に)。旧web-editアイコンUI(.emoji-grid/.emoji-btn/.modal-btn-row)と `.web-add` を削除。newtab.cssに `.shortcut-icon-row`/`.shortcut-icon-preview`/`.custom-image` を追加

## 2026-07-17(4): 縦タブ時の上部デッドスペースを解消(ユーザー指示)

- 縦タブ専用だった上部の `#drag-strip`(40pxのウィンドウ移動用ストリップ)を廃止。縦タブ時のクローム高さが 40px 減り、ページ領域が広がる
- 代わりに縦タブ時は**ツールバーがタイトルバーを兼ねる**: `-webkit-app-region: drag` + 直下の子要素は no-drag、右端はOSウィンドウ操作ボタンのオーバーレイ分を `env(titlebar-area-width)` で空ける
- タブ位置切替ボタン+ワークスペースピルは新設の `#tab-bar-head` に格納。横タブでは `display: contents` で従来どおりタブバーの行に並び、縦タブではレール最上部の1行(ドラッグ領域)になる。ピルはレール幅いっぱいに伸長
- レールは `top: 40px` → `top: 0`(全高)
- renderer.js の `applyTabBarLayout()`(縦横切替時にDOMを移動していた処理)を削除。縦横差はCSSのみで完結

## 2026-07-17(5): ショートカットのタイトル自動取得 + ドラッグ操作のアニメーション + settings CSP修正

- **スタートのショートカット追加でタイトル自動取得**: 名前が空欄で保存すると、リンク先の `<title>` を自動設定(失敗時はホスト名、それも無ければ入力値)。メインに `page:fetch-title` IPC(`ipc.js` の `fetchPageTitle`: net.fetch、8秒タイムアウト、先頭256KBのみ読む、Content-Typeのcharset対応、HTMLエンティティのデコード)。取得中は保存ボタンが「タイトル取得中…」
- **ドラッグ操作のアニメーション**(ユーザー指示「操作感をよくする」):
  - タブ並べ替えにFLIPアニメーション(renderTabsで再描画前後の位置差をWAAPIでスライド、160ms)
  - ドラッグ中のタブは `scale(0.94)` + 半透明、挿入マーカー(アクセント色の線)はフェード+スケールイン
  - **縦タブ時の挿入判定をY座標に修正**(従来はX判定で誤動作)。マーカーも左右の縦線→上下の横線に
  - ドラッグ検索(選択テキストをタブバーへ): ドラッグ中はバー全体をアクセント色でハイライト(`#tab-bar.drag-search`)、ドロップ受理時に短いフラッシュ
- **settings.htmlのCSP違反を解消**: インラインstyle6箇所をクラス化(`.note-tight`、`#accounts`/`#extensions-list`/`#passwords-list`のマージン。`#extension-id`のは`.account-add .search`で既カバーのため削除のみ)
- コミットを2つに分割: 前セッション未コミットの「拡張機能パズルボタン」(WIP、#ext-menuのCSS未整備)→ 9c3c8ce、今回分 → 4b4b574

## 2026-07-17(6): パスワードマネージャーとオートフィルをChrome並みに拡充(ユーザー指示) → 8621ce1

- **新規 `src/main/autofill.js`**: 住所・個人情報(姓名/フリガナ/組織/郵便番号/都道府県/市区町村/番地/建物/電話/メール)とクレジットカードのストア。カード番号はsafeStorage暗号化+表示用に下4桁とブランド(Visa/MC/Amex/JCB/Discover/Diners)を平文保持、CVCは保存しない。プロファイル単位(`autofill.json`)、共有トグル対応(profiles.jsのSHARABLE_KEYSに`autofill`追加)
- **`passwords.js` 拡張**: ストア形式を`{items, neverSave}`に移行(旧配列から自動移行)。`usernamesForOrigin`(ドロップダウン用・最近使った順)/`credential`(選択時のみ復号+lastUsedAt更新)/`update`(編集。重複ユーザー名は失敗)/`exportAll`/除外リスト(`addNeverSave`等)
- **`password-preload.js` → `autofill-preload.js` に改名・全面拡張**:
  - フィールド分類: autocomplete属性優先+日本語ヒューリスティック(姓/名/セイ/メイ/郵便分割zip1・zip2/都道府県/市区町村/番地/建物/電話/メール/会社、cc-number等)。ラベル・placeholder・td隣接セルも判定材料
  - 候補ドロップダウン: closedなshadow DOM+position:fixed(ページのCSS/JSから隔離)。フォーカスで表示、↑↓Enter/Esc対応、mousedownで選択(blurより先)。ライト/ダーク対応
  - 選択時のみ `passwords:credential`/`autofill:card-fill` で復号値を取得(一覧表示はユーザー名・マスク済みカードのみ)
  - パスワード生成(新規登録フォームで「強力なパスワードを生成」16文字)。選択直後の再表示抑制は「同じ欄のみ」(グローバル抑制だと選択→即別欄クリックで出ないバグをE2Eで検出して修正)
  - select対応: 都道府県(テキスト一致)、月/年('07'と'7'、'2026'と'26'の揺れ吸収)。tel は数字のみに整形
- **ipc.js**: オリジンをページの申告でなく `e.senderFrame.url` から導出(`frameOrigin`)。`autofill:page-data`/`passwords:credential`/`passwords:update`/`passwords:never-save`/`passwords:excluded*`/`passwords:export`/`passwords:import`(RFC4180ミニパーサー`parseCsv`、Chrome/Edge/Firefox形式対応)/`autofill:*` CRUD追加
- **UI**: 確認バーに「このサイトでは保存しない」。設定画面: パスワード検索・編集・エクスポート/インポート・除外リスト解除、「自動入力」セクション(住所・カードのCRUDモーダル`.af-modal-*`、ON/OFFトグル=`autofillAddresses`/`autofillCards`設定)
- **検証スクリプト(再利用可)**: `scripts/test-autofill-main.js`(ロジック27件)、`scripts/test-autofill-preload.js`(sendInputEventの信頼済みイベントでクリック→ドロップダウン選択→入力まで27件)、`scripts/test-autofill-page.html`+`serve-test-page.js`(手動確認用: node scripts/serve-test-page.js → localhost:8931)。全件成功

## 2026-07-17(7): スタート画面ウィジェット+グリッド並べ替え(ユーザー指示) → 287af57

- **新規 `src/main/widgets.js`**: ページID→アイテム配列のlayouts(`{type:'shortcut', refId}` | `{type:'widget', id, widgetType, config}`)。ショートカットの実体はbookmarksのまま、並び順だけ持つ。プロファイル単位(`start-widgets.json`)。天気(Open-Meteo geocoding+forecast、15分キャッシュ)・RSS(生XML、10分キャッシュ、512KB上限)のメイン代理取得も担当(newtab.htmlのCSPがconnect-src 'self'のため)
- **newtab.js**: `renderShortcuts`→`renderGrid`に全面改修。reconcileLayout(消えたブックマーク参照は落とし、新規は末尾へ)。「+」は追加メニュー(ショートカット/天気/ノート/カレンダー/ニュース)に変更。DnDはウィジェット=ヘッダー、ショートカット=タイル全体をつまみ、insertBefore+FLIPでライブに詰め直し→dragendで`widgets:set-layout`保存
- **各ウィジェット**: 天気=都市名検索(geocode)→現在+3日予報(絵文字アイコン、weather_code対応表)/ノート=textarea自動保存(500msデバウンス)/カレンダー=月表示・今日強調・月送り/ニュース=RSS/Atomパース(DOMParser)、NHK・Yahoo!プリセット、新しい順8件。⋮メニューで場所変更/フィード編集/更新/削除
- **CSS(newtab.css)**: #quick-linksをCSS Grid化(84pxセル、auto-fill、dense)。ウィジェットはspan 2x2(ニュースは3x2)のすりガラスカード。`.grid-popup`(追加/ウィジェットメニュー)
- **バグ修正**: コンテナに付く`widget-notepad`(widget-<type>)クラスがテキストエリアのクラスと衝突→`.notepad-textarea`に改名(E2Eの自動保存テスト失敗で検出。querySelectorがコンテナを拾い、textarea用CSSがコンテナにも当たっていた)
- **検証**: `scripts/test-newtab-widgets.js` + `stub-internal-preload.js`(roopieInternalをスタブして実DOM描画、追加メニュー→天気設定→ノート保存→カレンダー→ニュース→削除まで18件)。全件成功

## 2026-07-17(8): プロファイル切り替えをEdge挙動に(ユーザー指示) → 324e356

- **アーキテクチャ変更**: 「アクティブプロファイル1つ(切替時に全ウィンドウのストアを差し替え)」→「ウィンドウ単位のプロファイル」。複数プロファイルのウィンドウを同時に開ける
- browser.js: `bundleFor(profileId)` がプロファイルごとのデータ束(history/bookmarks/readlist/downloads/settings/gestures/theme/passwords/autofill/widgets)を生成・キャッシュ。インスタンスはプロファイルにつき1つ維持し、共有トグル変更は `applyProfileStores` で setStore 差し替え(TabManagerの参照は生きたまま)。Storeは実ファイルパスでキャッシュ共有。`browser.bookmarks` 等は互換ゲッター(アクティブ束)として残置
- `switchProfile(id)` = そのプロファイルの新ウィンドウを開く(既存はそのまま)。ウィンドウが無いプロファイルは前回のタブ構成を復元(最後のウィンドウの close で session-tabs に保存)。`removeProfile` はウィンドウも閉じる。`applyActiveProfile` は廃止
- 配信は `sendXFor(profileId)` + `broadcastProfile`。`profiles:state` の activeId は送信先ウィンドウのプロファイル(ピル・設定画面の「使用中」がウィンドウごとに正しく出る)
- ipc.js: 全ハンドラを `bundleOf(e)`(送信元ウィンドウのプロファイル)基準に移行。設定変更のapply(adblock/downloadPath/tabBarPosition/sidePanelPosition/searchEngine/mediaDocked)もプロファイル単位。Ctrl+N・シークレット・タブ切り離し・右クリック「新しいウィンドウで開く」は呼び出し元のプロファイルを引き継ぐ。Googleログインは別プロファイルなら新ウィンドウで
- context-menu.js / toolbar-context-menu.js / menu.js / tab-context-menu.js も ctx.profileId 基準に
- **adblock.js の潜在バグ修正**: ghosteryの `enableBlockingInSession` はグローバルな ipcMain.handle を毎回登録するため、2セッション目で二重登録エラー(シークレット併用でも起きていた)。有効化前に removeHandler、無効化後は残セッションのコンテキストでハンドラ復旧
- **検証**: `scripts/test-multi-profile.js` 新設(一時userDataで本物のbrowser.jsを起動し22件: 切替=新ウィンドウ/既存維持/データ・設定・ブックマーク分離/共有トグルのストア共有と解除/削除時のウィンドウクローズ/閉じ時のタブ保存)。既存スイート(autofill 27+27、widgets 18)も全て成功。start:verify クリーン

## 2026-07-18: スタート画面グリッドの列数・行数をAndroidホーム画面風に設定可能に → 0fbad81

- 前セッションが未コミットのまま残していた実装(main側の設定値`startGridCols`/`startGridRows`、IPCバリデーション、設定画面UI、newtab.jsのグリッド伸縮ロジック)を引き継いで検証・仕上げ
- **newtab.js**: `applyGridMetrics()` が列数(4〜10)・行数(3〜8)とウィンドウ幅からセルサイズを算出し、`--grid-cols`/`--cell`/`--grid-height` のCSS変数に反映。設定変更は`onSettings`でライブ反映、リサイズはデバウンス(120ms)
- **newtab.css**: `#quick-links`のセルサイズ・アイコン・文字サイズを固定値からすべて`var(--cell)`基準の`calc()`に変更
- **バグ修正2件(E2Eで検出)**:
  - テスト側: `getPropertyValue('--cell')`は`"84px"`のような文字列を返すため`Number()`ではなく`parseFloat()`で読む必要があった(既存のテストコードの不具合)
  - アプリ側: 縦の行数を増やした状態で画面が狭いと、セルをMIN_CELL(30px)まで縮めても`#newtab`の`margin-top: -6vh`により時計が画面上端からはみ出るケースがあった → `--newtab-shift`というCSS変数を新設し、セル縮小だけで収まらない場合は上方向オフセットを-6vh→0vhの範囲で段階的に緩める二段の安全弁に変更
- **検証**: `scripts/test-newtab-widgets.js`にグリッド設定のライブ反映・縮小・安全弁のテストを追加(既定列数反映/セルサイズ正の数/列数変更のライブ反映/行数を増やすとセル縮小/時計が画面上端で欠けない/列数を戻すと反映、の6件)。全24件成功。`npm run build:css`でapp.css再生成、start:verifyでクラッシュ・コンソールエラー無し確認

## 2026-07-18(2): スタートページのスワイプ切り替え・デフォルトアイコン拡大・アイコンピッカーのはみ出し修正(ユーザー指示) → d8ebf71

- **スワイプ切り替え**: newtab.jsの`#quick-links`にwheel(トラックパッドの横スワイプはdeltaXとして届く。閾値24px、350msクールダウンで1スワイプ=1ページ送り)とtouchstart/touchend(閾値50px、横方向優先)を追加。`switchToPage(pageId, dir)`でスライド+フェードのWAAPIアニメーション(120ms out→ロード→160ms in)。ページドットのクリックも同じ関数に統一(方向は現在ページとの前後関係から自動算出)
- **デフォルトアイコン拡大**: 実機相当(1280x800ウィンドウ)で計測すると既定の6列x4行はセルが57pxまで縮んでいた(4行分の高さを常に確保する設計のため、-6vhの上シフトと合わせて735px高のビューポートに収まらず安全弁が効いていた)。既定の行数を4→3に変更するだけで81pxまで回復(列数を減らしても効果なし、高さ制約が支配的だったため行数の方を調整)。`DEFAULT_SETTINGS.startGridRows`(browser.js)と各所のフォールバック値(newtab.js/settings.js)を3に統一
- **アイコンピッカーのはみ出し修正**: 共通`.icon-picker-row`(icon-picker.js/menu.jsのQR中心マークピッカーが共用)に`flex-wrap: wrap`を追加。「画像をアップロード」+「既定に戻す(favicon)」のような長いラベル2つがパネル幅220pxを超えて右にはみ出していた不具合(ボタンはflex-shrink:0のため縮まず、wrapで2行に分かれるようにして解消)。プロファイル/Webパネル/ショートカット/QR中心マークの全ピッカーに一括で効く
- **stub-internal-preload.jsをページ単位に拡張**: 従来は`shortcuts`/`layout`が1ページ分の固定値だったのをp1/p2の2ページ分(`shortcutsByPage`/`layoutByPage`)に対応させ、`addStartPage`も実際にページを追加するよう実装。既存の天気/ノート/カレンダー/ニュースのテストは全てp1で完結するため無改造で成功
- **検証**: `scripts/test-newtab-widgets.js`にスワイプ(wheel/touch双方向、ページドットのactive確認)とアイコンピッカーのはみ出し(パネル右端を超えるボタンが無いこと)のテストを追加。全31件成功。`npm run build:css`でapp.css再生成、start:verifyでクラッシュ・コンソールエラー無し確認

## 2026-07-18(3): スタート画面グリッドの幅をウィンドウ横幅の約40%基準に拡大(ユーザー指示「グリッド全体が横幅の40%を占めるイメージ」) → f889c82

- **原因**: `applyGridMetrics()`の`availW`が`Math.min(window.innerWidth, 680) - 48`で、実質#newtabの箱幅(680px)に頭打ちだった。プローブで確認したところ、グリッド自体(`#quick-links`)は`align-items:center`で非stretchのため`#newtab`の箱幅に縛られず独立に伸縮・中央寄せされる(1920px幅ウィンドウで`--cell:200px`を強制してもクリップされず正しく中央表示された)。つまりCSS側の制約ではなくJS側の計算式が原因と判明
- **修正**: `availW`を`window.innerWidth * 0.4`基準に変更(`GRID_WIDTH_RATIO`定数)。`MAX_CELL`も116→160に拡大(1920px前後の一般的な解像度でも40%比を維持できるように)。実測: 1280x800でcell 57→72px、1920x1080でグリッド幅が横幅の39.9%
- **検証**: `test-newtab-widgets.js`にグリッド幅がウィンドウ幅の30〜45%に収まることを確認するテストを追加。全32件成功。start:verifyでエラー無し確認
