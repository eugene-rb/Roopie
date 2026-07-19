; NSISインストーラー/アンインストーラーへの追加処理。
; electron-builder が build/installer.nsh を自動で取り込む(package.json の nsis.include でも明示している)。
;
; ここでやること: アンインストール時に「ユーザーデータを残すか」を尋ねる。
;   はい(既定)= %APPDATA%\Roopie を残す。再インストールするとブックマーク等が元に戻る
;   いいえ      = 完全に削除する
; 自動アップデート(--updated 付き)やサイレント実行では尋ねず、必ず残す(/SD IDYES)。
; これがないと更新のたびにデータが消える、または無人インストールが止まってしまう。

!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "ブックマーク・履歴・パスワード・プロファイルなどのユーザーデータを残しますか?$\r$\n$\r$\n\
「はい」= 残す(再インストールすると元に戻ります)$\r$\n\
「いいえ」= すべて削除する" \
      /SD IDYES IDYES roopieKeepUserData

      ; Electronのデータは常にユーザー単位なので、全ユーザー向けにインストールされていても
      ; 実行中のユーザーのフォルダを消す(electron-builder本体の削除処理と同じ考え方)
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ; 差分アップデートのキャッシュ
      RMDir /r "$LOCALAPPDATA\${APP_FILENAME}-updater"
      ; あとに続くショートカット削除・レジストリ削除のために元の文脈へ戻す
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}

    roopieKeepUserData:
  ${endIf}
!macroend
