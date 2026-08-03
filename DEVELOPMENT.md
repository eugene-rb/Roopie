# 開発ガイド

Roopie の内部構造と、コードを変更するときに守っている決まりごとをまとめています。
新しい機能を足すときは、まずここに目を通してください。

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

## 動作確認

- 実行時エラーの確認は `npm run start:verify`。全レンダラーのコンソールエラー・クラッシュ・
  メインプロセスの未捕捉例外がターミナルに出ます。
  Electron 43 では CDP(9222)の HTTP/WS が応答しないため、`start:debug` での CDP 検証は使えません。
- 動作検証は使い捨てにせず、`scripts/test-*.js` として**再利用できる形**で置いてください。
  多くは `npx electron scripts/test-xxx.js [スクショ保存先]` で単体実行できます。
- 確認はスクリーンショットより、`executeJavaScript` での DOM 計測など**テキストで残る形**を優先します。
- CSS の入力は `src/renderer/tailwind.css` です。`src/renderer/pages/app.css` は
  `npm run build:css` の生成物なので直接編集しないでください。

## 設計上の決まりごと

### プロファイルは「ウィンドウ単位」

これがアーキテクチャの前提です。メインプロセスの各機能は `browser.bundleFor(ctx.profileId)` で
データを引きます(`browser.bookmarks` などのグローバルは、アクティブな束を指す互換ゲッターです)。
新機能も必ずこの前提で書いてください。

### UI の流儀

- **サイドパネルは Vivaldi 準拠**を維持します: レールの並び(ブックマーク/ダウンロード/履歴/メモ/
  リーディングリスト/ピン留め Web パネル/+)、同じアイコンの再クリックで折りたたみ、
  F4 でパネル全体の表示切替、「+」で Web パネル追加。新機能も同じ流儀に合わせます。
- **Web パネルに「管理画面」は持ちません**。追加は「+」またはレールの右クリック、
  編集・削除はピン留めアイコンの右クリックメニューのみです。
- **アイコン設定 UI は全箇所で共通の `icon-picker.js`** を使います(プロファイル/Web パネル/
  スタート画面のショートカット)。Web パネルとショートカットのアイコン既定はリンク先の favicon です。
  新たにアイコンを持つ要素を作るときも、必ずこの共通ピッカーと favicon 既定に合わせてください。
- **サイドバーの AI 機能は廃止済み**です。復活させません。

### タブ

- **ウィンドウ間の移動は WebContentsView ごと載せ替えます**(`TabManager#releaseTab` / `#adoptTab`)。
  URL で作り直すと再読み込みになって再生が止まり、未読み込みのタブが「新しいタブ」に化けます。
  タブの webContents にリスナを張る機能は、必ず `attachEvents` の `on()` 経由で `tab.wcListeners` に
  載せてください(移動時に張り直せないと、古いウィンドウを指したまま残ります)。
  セッション(プロファイル)が違うウィンドウへは移せないので、URL 引き継ぎにフォールバックします。
- **WebContentsView はウィンドウを破棄しても道連れになりません**。ウィンドウを閉じたら
  `window.on('closed')` で `tabManager.dispose()` / `sidePanel.destroyWebView()` /
  `mediaPlayer.destroy()` などを必ず呼びます(呼ばないと、2枚目以降のウィンドウを閉じた後も音が鳴り続けます)。
  ウィンドウ破棄後は `window.contentView` に触れないので、View 破棄系は `window.isDestroyed()` で守ります。
  検証: `scripts/test-window-tabs.js`
- ショートカット・マウスジェスチャーで開いた新しいタブは、**アクティブなタブのすぐ右**に入れます
  (`createTab(url, { nearActive: true })`。Chrome / Vivaldi と同じ挙動)。
  「+」ボタン(`tabs:new`)・リンク(`setWindowOpenHandler`)・セッション復元は末尾のままです。
- 「閉じたタブ/ウィンドウを再度開く」(Ctrl+Shift+T)の履歴は**プロファイル単位で共有**します
  (`browser.bundleFor().closedTabs` を `new TabManager(...)` に渡す)。別ウィンドウで閉じたタブも戻せます。
  シークレットにはそのウィンドウ限りの配列を渡し、通常ウィンドウへ URL を漏らしません。
  履歴はタブ `{ type: 'tab', url, index }` とウィンドウ `{ type: 'window', tabs, bounds, maximized }` が
  **閉じた順**で1本に混ざります。**ウィンドウごと閉じたときはタブを1枚ずつ積まず、ウィンドウ1件として積みます**
  (1ウィンドウ分で履歴が埋まってしまうため)。

### タブがあふれたときの見せ方

「フェード + 送りボタン + アクティブタブの張り付き」で見せています。触るときの注意:

- タブの最小幅は設定 `tabMinWidth`(CSS 変数 `--tab-min-w`)。`.tab` と `.tab-drop-slot.open` の
  両方が読みます(スロットを揃えないと、ドラッグ中の隙間が実際のタブとずれます)。
- 端のフェードは**タブ自身をマスクで消します**(`-webkit-mask-image`)。帯の色を重ねる方式は使いません
  (半透明・グラデーション・パターンの外観で色が合わなくなるため)。
- 送りボタンは**あふれている間は場所を空けたままにします**(`hidden` = 場所ごと消す /
  `off` = 場所は残して見せない)。押せる側が変わるたびにタブの幅が変わると、
  直前に決めたスクロール位置がずれて端のタブが隠れます。
- アクティブなタブは `position: sticky` + 左右(縦タブは上下)両方 0 で張り付かせます。
  張り付き中は `.pinned` で**不透明**にします(`--tab-active` は半透明なので、不透明な `--bg` を下敷きに)。
- **位置の判定は `measure-raw` クラスを付けて測ります**。sticky 中の矩形は見た目の位置を返し、
  FLIP アニメーション中の transform も矩形に乗るため、どちらも `!important` で一時的に無効化してから測ります。
- `scrollIntoView` は使いません(張り付いているタブは「見えている」と判定されて動かないため)。
  `ensureTabVisible()` で足りない分だけ動かします。
- 検証: `scripts/test-tab-scroll.js [スクショdir]`

### 裏タブの自動再生対策(media-guard)

方針は「**読み込むが、そのタブを選ぶまで再生を始めさせない**」です。

- `src/preload/media-guard-preload.js` が各ドキュメントの先頭でメインワールドへ入り、
  `HTMLMediaElement.prototype.play()` を NotAllowedError で拒否し、`autoplay` 属性/プロパティを外します
  (= 一度も鳴りません)。解除は `switchTab` → `src/main/media-guard.js` の `release()` で
  全フレームの `__roopieMediaGuard.release()` を呼び、そこで初めて鳴り始めます。
- **「鳴ってから止める」一時停止方式もミュートも使いません。**
- 試して外したもの(戻しません): `webPreferences.autoplayPolicy: 'document-user-activation-required'`
  (メインプロセスの `loadURL()` 由来の遷移では実サイトに効かず、user activation はドキュメント単位なので
  自分で押した再読み込みまで止まる)、`autoPauseMedia`(自分で開いたタブが約1秒鳴ってから止まる)。
- **セッション復元だけは `hibernate`(= そもそも読み込まない)**です。起動時に数十タブを
  一斉に読み込ませないため(`createTab(url, { background, hibernate: true })`)。
  タイマーの「タブを休止する」も同じ `hibernated` を使います。
- 通常ページは `nodeIntegrationInSubFrames: true`。preload は既定だとメインフレームでしか走らず、
  iframe に置かれたプレイヤー(広告など)を取りこぼすためです(sandbox + contextIsolation は維持)。
  セッション全体への preload 登録は `browser.js` の `registerPagePreloads`。
- 検証: `scripts/test-autoplay-policy.js`(iframe 込み)/ `test-background-tab.js` / `test-restore-autoplay.js`

### サイトの権限

カメラ/マイク/現在地/通知/全画面表示は、**アドレスバーのサイト情報アイコンからぶら下がる
ドロップダウン**(Edge 風)で尋ねます。描画先はオーバーレイ(`roopie://menu` の `#perm-popup`)です
= タブはネイティブ View なので、クローム UI の DOM ではページに重ねられません。

- 選択肢は**「許可」「今回だけ許可」「ブロック」の3択**で、覚えるのは「許可」だけです
  (`settings.sitePermissions` = 種類ごとのホスト名一覧)。「今回だけ許可」はメモリのみで、
  そのタブがサイトを離れたら失効します。「ブロック」は覚えません。
- **`setPermissionCheckHandler` は入れません**。同期で boolean しか返せず「まだ尋ねていない」を
  表せないため、false にすると `Notification.permission` / `permissions.query()` が denied を返し、
  サイトが requestPermission を呼ばなくなります(= 確認自体が出なくなる)。
- 権限を足すときは `src/main/site-permissions.js` の `KINDS` / `LABELS` と `kindsFor()` に足します。
- 検証: `scripts/test-site-permissions.js`

### ウィンドウの外観テーマ

**プロファイル単位**です(`theme` ストアの `windowMode` / `windowStyle` / `windowColor` /
`windowTranslucency` / `windowGradient*` / `windowPattern*`)。既存の `background` は
**「新しいタブ」専用**なので混ぜないでください。

- UI の色を足すときは必ず既存トークンを使います(`--bg` / `--chrome-bar` / `--bg-toolbar` /
  `--card` / `--text` / `--hover` / `--border` / `--menu-bg`)。色を直書きするならライトでも
  成立する色に限ります(白の重ね色は `rgb(var(--tint) / a)`。`--tint` はダーク = 白、ライト = 黒)。
- 面の色は `--c-*`(生の色)→ `--bg` 等(`--surface-alpha` 込み)の**2段**です。
  **カスタムプロパティの中の `var()` は宣言した要素で展開される**ので、子孫(`.chrome-body.incognito` など)から
  `--c-*` を差し替えても `--bg` には届きません。子孫では**最終トークンを直接**上書きします。
- 帯を透かすのは `--chrome-bar`(タブバー/ツールバー/ブックマークバー)だけです。
  `--bg` は不透明のままにします(内部ページまで透かすと、後ろに何も無く色が壊れます)。
- `nativeTheme.themeSource` は**書きません**(アプリ全体に効き、プロファイルごとに別の明暗にできなくなるため)。
  `system` は読むだけ(メイン = `shouldUseDarkColors` / レンダラー = `matchMedia`)で解決します。
- 半透明・liquidglass は Windows 11 の acrylic(`setBackgroundMaterial`)です。`backgroundColor` を
  `#00000000` にしないと見えず、`setOpacity()` を下げるとぼかしごと消えるので併用しません。
  `mica` は壁紙しか拾わないので使いません。
- ライト/ダークだけは preload の同期 IPC(`theme:window-mode-sync`)で**最初の描画より前に**当てます
  (`MutationObserver` で `<html>` の出現を待つ)。これが無いとライトでも 45〜90ms ダークで描かれます。
- 検証: `scripts/test-window-theme.js [スクショdir]` / マテリアルの下調べは `scripts/test-window-material.js`

### ページの翻訳

Edge 準拠です。UI も、次の機能を足すときも Edge の流儀に合わせます。
作りは**メイン(取り回し)+ 分離ワールドの preload(DOM 差し替え)+ オーバーレイ(ドロップダウン)**の3枚です。

- 状態は **`tab.translate`**(`state` / `source` / `target`)に持ちます。タブのオブジェクトに載っているので
  ウィンドウ間移動でも運ばれます。リセットは `tab-manager.js` の既存 `did-navigate` で行います
  (新しいリスナは張りません)。UI へは `tabs:state` の `translate` / `canTranslate` で届きます。
- DOM の差し替えは `src/preload/translate-preload.js`(分離ワールド。メインワールドには何も置きません)。
  **原文はノードごとに控え、「元の言語を表示」はその書き戻し**です(逆翻訳は絶対にしません)。
  書き込みの間は `MutationObserver` を外します(付けたままだと自分の書き込みで訳し直しが無限に走ります)。
  同じノードは6回で打ち切ります(ページ側の書き戻しとの綱引きを止めるため)。
- **訳文の通信は必ず要求元タブのセッション**(`sender.session.fetch`)で行います。
  `net.fetch`(既定セッション)にすると、Tor を有効にしたプロファイルのページの文面が Tor の外へ出ます。
  内部ページと file:// では翻訳の導線を出しません。
- 設定はプロファイル単位です(`translateTargetLang` / `translateAutoOffer` / `translateAlwaysLangs` /
  `translateNeverLangs` / `translateNeverSites`)。**シークレットでは何も書きません**
  (見ていたサイト名・言語をディスクへ残さないため)。
- ドロップダウンはオーバーレイ(`roopie://menu` の `#translate-popup`)で、
  **ツールバーがアンカーを測って戻す**経路です(サイトの権限と同じ)。
  `menu.js` のポップアップは close() / backdrop / othersHidden / 他ポップアップの前置きの**5か所すべて**に足します。
- 「この言語は翻訳しない/常に翻訳する」の判定は `<html lang>` だけで行います
  (実際の言語は最初の訳文の応答で分かるため)。宣言の無いページで提案が出るのは仕様です。
  **読み込みごとに検出用の通信を足さないでください。**
- 検証: `scripts/test-translate.js [スクショdir]`

### 既定のブラウザ

「**OS に正しく登録** → 設定アプリの Roopie のページへ直行」の2段で扱います。
`app.setAsDefaultProtocolClient` だけでは設定アプリの一覧に出ないので、あれを既定化の手段として当てにしません。

- 登録は `src/main/default-browser-registry.js`(HKCU に ProgId `RoopieHTML` +
  `StartMenuInternet\Roopie\Capabilities` + `InstallInfo` + `RegisteredApplications`。
  `reg.exe` を execFile し、**`app.isPackaged` のときだけ**実行します = 開発中の electron.exe を登録しません)。
- **`InstallInfo`(ReinstallCommand / HideIconsCommand / ShowIconsCommand / IconsVisible)を消さないでください。**
  Capabilities を正しく書いても、これが無いと Windows は Roopie を「ブラウザ」として数えず、
  **設定アプリの一覧に出てきません**(実測。Chrome / Vivaldi も書いています)。
- 関連付けを増やすときは `Capabilities` の URLAssociations / FileAssociations に足し、
  `build/installer.nsh` の削除も揃えます(**削除は `${ifNot} ${isUpdated}` の中に置きます**。
  自動更新でもアンインストーラーが走るため、外すと更新のたびに既定から外れます)。
- **既定かどうかの判定は UserChoice の ProgId を読みます**
  (`HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\<http|https>\UserChoice` が
  `RoopieHTML` か)。`app.isDefaultProtocolClient()` は `HKCU\Software\Classes\http` のコマンドしか
  見ないので、`setAsDefaultProtocolClient()` を呼んだ**その場で true になります**
  (実際の既定は Edge のままなのに「押しただけで設定済み」に見えます)。
  そのため Windows では `setAsDefaultProtocolClient` も**呼びません**(Capabilities 登録で足ります)。
  判定結果はキャッシュし、起動時・フォーカス時・設定画面を開いたときに `refresh()` します。
- 最後の「既定に設定する」は UserChoice の保護でアプリからは押せません(手動操作が必要です)。
- **「既定にする」を一度でも押したら、その後は二度とお願いを出しません**(`settled`)。
  設定アプリで実際に押したかどうかはアプリからは分からないので、押さずに閉じた場合も同じ扱いです。
  ここを「既定になっていないなら出す」にすると、設定しに行ったのに毎起動で同じお願いが出てしまいます
  (見送り回数のリセットだけだと、押すほど催促が復活します)。
- 他アプリから渡される URL は `src/main/url-args.js` で受けます(http/https と実在する .htm/.html だけ。
  `javascript:` / `roopie://` は無視)。起動時の `process.argv` と `second-instance` の argv の**両方**で拾い、
  `browser.openExternalUrl()` が非シークレットウィンドウの**末尾**に開きます。
- 検証: `scripts/test-default-browser.js`(**本物の `setAsDefaultProtocolClient` を呼ぶと
  検証用の electron.exe が http ハンドラとして居座る**ので、スタブを最後まで戻します)

### 拡張機能

ウェブストア以外の拡張機能は「**プロファイルの `extensions/` へコピーしてから読み込む**」方式です
(`ExtensionSupport#loadUnpacked`)。コピー先は `extensions/local-<名前>-<元パスのハッシュ>/`、
読み込み元は `extensions/.roopie-local.json` に控えます。

- **次回起動時の読み込みは `installChromeWebStore({ allowUnpackedExtensions: true })` に任せます**
  (独自の「起動時に読み込むパス一覧」は持ちません。無効化・ピン留め・一覧はストアの拡張機能と同じ経路のままです)。
  ストアの拡張機能は manifest に `key` が入るので、このフラグを立てても分類は変わりません。
- **`loadExtension()` の直後の `startWorkerForScope()` は必ず失敗します**(登録がまだ済んでいないため)。
  MV3 のバックグラウンドは `startWorker()`(200ms × 5回)で起こし直します。
  読み込み系を足すときは必ず `_load()` を通してください。
- 削除は分岐します(`uninstallExtension` は `extensions/<拡張機能ID>/` しか消さないので、
  フォルダから読み込んだものには効きません)。シークレットからは読み込ませません。
- **`package.json` の `overrides` で `adm-zip: ^0.6.0` を固定しています**(crx の展開に使います。
  electron-chrome-web-store は最新でも `^0.5.16` のままで、外すと脆弱性が戻ります)。
  electron-chrome-web-store を上げたときは、この override を外せるか確かめてください。
- **入れ直し・削除では `disabledExtensions` から ID を外します**(`ipc.js` の `forgetDisabled`)。
  ID は入れ直しても変わらないので、外さないと「その場では動くのに次の起動でまた無効になる」ことになります。
- 検証: `scripts/test-extensions-unpacked.js` / `test-extensions-unpacked-ui.js` /
  `test-extension-install.js`(**ネットワークが必要**)

### タイマーのフローティング表示

画面の隅に浮かぶタイマー(`src/main/timer-panel.js` + `roopie://timerpanel`)は、
サイドパネルの「タイマー」セクションを開いている間は隠れます。ただし**鳴動中(ringing)は
格納・一時非表示より優先して必ず出します**(音を止められないまま実行される事故を防ぐため)。

- どの行を出すかは `activeFor()` と `visibleRows()` が決めます。
  **📌(`float`)で固定したものは待機中(idle)でも出します**——出ないと
  「📌したのに何も出てこない/フロートから始められない」ことになります。
  アラーム(clock)だけは、時刻が来るまで動かないので予約中(running)のときだけ出します。
- フロート上のボタンは状態で意味が変わります: 鳴動中 = 止める / 待機中・一時停止中 = 開始・再開 /
  実行中 = 一時停止 / 予約中のアラーム = 押しても消えないベル表示(誤操作で予定を消さないため)。
- 経過時間はレンダラー側が `Date.now() - receivedAt` で自前に進めます
  (メインからの再送を待たずに毎秒描き替わります)。
- 検証: `scripts/test-timer-ui.js [スクショdir]` / `scripts/test-timer.js`

## 配布とリリース

- **master へ push するだけ**で GitHub Actions(`.github/workflows/release.yml`)がビルドして
  Releases へ公開し、インストール済みの Roopie が自動更新します(起動時 + 15分ごとに確認)。
  手動で `npm run release` を叩く必要はありません。
- バージョンは `0.1.<GitHub Actions の実行番号>` を**ビルド時にだけ**適用します
  (package.json は 0.1.0 のまま = CI が push し返さないので無限ループしません)。
  メジャー/マイナーを上げるときはワークフローの `VERSION_BASE` を変えます。
- `publish.releaseType: "release"` は必須です。既定の `draft` だと electron-updater から見えず、自動更新が動きません。
- 成果物は1回約 100MB なので、ワークフローが古いリリースを消して直近10件だけ残します。
  `**.md` だけの変更ではビルドしません。
- ローカルで確認したいときだけ `npm run dist`(dist/ に出力、公開はしません)。
- 形式は electron-builder の NSIS(アシスト形式 / `oneClick: false`)です。
  MSI は electron-updater 非対応なので使いません。
  インストーラーの左側・ヘッダーの画像は `npx electron scripts/gen-installer-art.js` で生成します
  (build/*.bmp。NSIS は 24bit BMP しか受け付けません)。
  アイコンは `build/icon.ico` で、`npx electron scripts/gen-icon.js` で再生成できます。

### イントロと変更点

初回起動のイントロ(`roopie://welcome`)とアップデート後の変更点(`roopie://whatsnew`)があります。

- **出し分けはアプリのバージョンではなく `src/renderer/pages/release-notes.json` の
  先頭エントリの version で行います**(push ごとにビルド番号が上がるため、
  バージョン一致だと毎回ポップアップが出てしまいます)。
  `VERSION_BASE` を上げるときは release-notes.json に1件追加します(それが全ユーザーへの「変更点」になります)。
- 状態は `userData/app-state.json` に持ちます。
- イントロに機能カードや選択肢を足すときは**縦にあふれないか実測してください**(カード6枚が収まる想定)。
  あふれたステップだけ `welcome.js` が `.ob-actions.sticky` を付けてボタンを下端に貼り付けます
  (常に付けると、短いステップでぼかしの帯だけが浮いて見えます)。
- 検証: `scripts/test-onboarding.js`
