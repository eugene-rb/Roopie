# ADR-0001: Widevine DRM対応にcastLabs Electron for Content Securityを採用

## 状況
YouTubeのレンタル/購入映画(DRM保護コンテンツ)が「この動画を再生できません」と表示され再生不可だった。npm公式配布のElectronにはWidevine CDMが同梱されておらず、EMEがブロックされていたことが原因。

## 決定
`devDependencies.electron` を公式npmパッケージ(`^43.1.0`)から、Widevine CDMを同梱するcastLabsのフォーク「Electron for Content Security (ECS)」に差し替えた。

```json
"electron": "github:castlabs/electron-releases#v43.2.0+wvcus"
```

現行の`43.1.0`と同じChromiumメジャー系列(150)。ECS側に`43.1.x`のリリースがなかったため、直近上位の`43.2.0+wvcus`を採用。

`src/main/main.js`の`app.whenReady()`内で、ウィンドウ生成前に`await components.whenReady()`を追加(CDMの準備完了待ち。ECSのAPI要件)。

## 影響
- `electron`がsemver範囲からGitHub固定タグ参照になったため、以後のElectron更新は castlabs/electron-releases の対応タグを手動で確認して追従する必要がある(`npm outdated`が効かない)
- 実際のYouTube等でのDRM再生には、`castlabs-evs`によるVMP署名を配布ビルドに施す必要がある。未署名ビルドでは実際に「エラーは出ずバッファリングホイールが回り続ける」「この映画のライセンスに問題が発生しました」という形でDRM再生に失敗することを実機確認した(2026-08-04)
- 検証: `npm run start:verify` で起動確認済み。`WidevineCdm`がuserDataに正常にダウンロード・配置されることを確認済み(`widevinecdm.dll`)。既存機能(拡張機能・タブ等)にリグレッションなし
- ローカルで手動VMP署名(`python -m castlabs_evs.vmp sign-pkg dist/win-unpacked`)したビルドでは、レンタル/購入・広告付き無料映画とも実際に再生できることを確認した(2026-08-04)

### CI/自動配布パイプラインへの反映(2026-08-04)
`master`へのpushで自動リリースする`.github/workflows/release.yml`にも同じ対応が必要(でないと自動更新で配布される公開ビルドがWidevine非対応に戻ってしまう)。
- `scripts/vmp-sign.js` を electron-builder の `afterPack` フック(`package.json` の `build.afterPack`)として追加し、パッケージング直後にVMP署名する
- CIワークフローに `ELECTRON_MIRROR`(castLabsミラー)・Pythonセットアップ・`castlabs-evs`インストールを追加
- 署名用アカウント情報はリポジトリの GitHub Secrets(`EVS_ACCOUNT_NAME` / `EVS_PASSWORD`)から供給。未設定の場合は `vmp-sign.js` が署名をスキップする(ローカル開発でも同様にスキップされ、署名アップロードが毎回走らないようにするため)
- 詳細: `docs/specs/SPEC-release.md`

## 変更履歴
- 2026-08-04: 初版。Electron依存の差し替えとcomponents.whenReady()追加
