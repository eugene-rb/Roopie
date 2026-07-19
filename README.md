# Roopie

Chromium(Electron)ベースの、自分好みに組み替えられるウェブブラウザ。Windows向け。

- **プライバシーが見える** — 広告・トラッカーを標準で遮断。さらにサイドパネルの「トラッキング」で、どの企業が自分に固有IDを付けているかを企業単位で確認・削除できます
- **ウィンドウごとのプロファイル** — 仕事用と個人用を同時に開けます。ブックマーク・履歴・パスワードなどは項目ごとに共有/分離を選べます
- **サイドパネル(F4)** — ブックマーク・履歴・ダウンロード・メモ・リーディングリストに加え、好きなサイトを常駐させるWebパネル
- **組み替えられるスタート画面** — 時計・天気・カレンダー・ニュース・ノートパッドをドラッグで自由に配置
- **マウスジェスチャー / 画面分割 / タブの縦配置 / パスワード・住所の自動入力**

## インストール

[Releases](https://github.com/eugene-rb/Roopie/releases/latest) から `Roopie Setup x.x.x.exe` をダウンロードして実行してください。
インストール後は起動時に自動で更新を確認し、新しいバージョンがあれば裏でダウンロードして再起動時に適用します。

## 開発

```bash
npm install
npm start              # 起動
npm run start:verify   # コンソールエラーをターミナルに出して起動(検証用)
npm run build:css      # tailwind.css → src/renderer/pages/app.css
npm run dist           # インストーラーをローカルにビルド(dist/)
```

主要な検証スクリプト(いずれも `npx electron scripts/<name>.js`。自己判定でOK/NGを出力):

| スクリプト | 対象 |
|---|---|
| `test-onboarding.js` | 初回起動のイントロ / アップデート後の変更点 |
| `test-multi-profile.js` / `test-profile-switch-ui.js` | プロファイル |
| `test-bookmarks-manager.js` | ブックマーク管理画面 |
| `test-newtab-widgets.js` | スタート画面ウィジェット |
| `test-trackers-panel.js` | トラッキング分析 |
| `test-autofill-main.js` / `test-autofill-preload.js` | パスワード・自動入力 |
| `test-media-player.js` | メディアプレイヤー |
| `test-tor.js` | 同梱Torの起動〜Torネットワーク接続(30〜90秒) |

構成の詳細は [CLAUDE.md](CLAUDE.md)、現在の状態は [log.md](log.md) を参照してください。

## リリース

`master` へpushすると GitHub Actions がインストーラーをビルドして Releases へ公開し、インストール済みのRoopieが自動更新します。
バージョンは `0.1.<Actionsの実行番号>`。メジャー/マイナーを上げるときは `.github/workflows/release.yml` の `VERSION_BASE` を変更し、
あわせて `src/renderer/pages/release-notes.json` に変更点を1件追加します(次回起動時に全ユーザーへ1度だけ表示されます)。

## 同梱している Tor について

プロファイルごとの「Torで接続」を追加インストール無しで使えるよう、Tor Project 公式の
[Tor Expert Bundle](https://www.torproject.org/download/tor/)(Windows x86_64)から `tor.exe` を同梱しています。

- 取得は `npm run fetch:tor`(`scripts/fetch-tor.js`)。公開されている SHA256 と照合し、起動確認まで行います
- **リリースのたびにCIが最新の安定版を取り直す**ので、Roopieを更新すると同梱のTorも新しくなります。同梱バージョンは設定画面のTorの状態表示で確認できます
- ブリッジ用の pluggable transports(obfs4/snowflake)と geoip は同梱していません(サイズ削減。検閲環境向けのブリッジ接続は未対応です)
- 既に Tor Browser や素の Tor が動いている場合はそちらを優先して使います。`%APPDATA%\Roopie\tor\tor.exe` を置けば自分でビルドしたものに差し替えられます
- tor 本体のライセンスは同梱の `resources/tor/docs/` を参照してください。Roopie は tor を別プロセスとして SOCKS5 経由で利用するだけで、リンクはしていません

## 既知の制約

- uBlock Origin などのブロッキング型拡張は動きません(Electronの制約。内蔵の広告ブロックで代替しています)
- シークレットウィンドウでは拡張機能が動きません(Electronの制約)
- 検閲された回線からのブリッジ接続には未対応です(pluggable transports 非同梱)

## ライセンス

MIT — [LICENSE](LICENSE) を参照。
