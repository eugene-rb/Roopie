# SPEC-sidebar: サイドバー

## 概要
Vivaldi準拠のサイドパネル。常時表示のアイコンレール＋組み込みセクション（ブックマーク/履歴/メモ等）＋ユーザー追加の「Webパネル」（常駐ミニブラウザ）を提供する。
中核は `SidePanel` クラス（`side-panel.js`）。AI機能は廃止済み。

## 詳細

### ファイル構成
- `side-panel.js`（405行、`SidePanel` クラスのみexport）

### 主要メソッド
`toggle` / `hide` / `setOpen`, `widthFor`, `resizeBy`, `layout`, `openSection`,
`addWeb` / `removeWeb` / `setWebPanel` / `editWeb` / `promptAddWeb` / `closeEditHost` / `openWeb` / `closeWeb` / `reloadWeb`,
`setStore`, `switchSession`

### IPC（`ipc.js`、`panelOf(e)` 経由）
- `sidepanel:toggle` / `sidepanel:hide` / `sidepanel:open-section` / `sidepanel:context-menu` / `sidepanel:rail-context-menu` / `sidepanel:state`（handle）
- `sidepanel:add-web` / `sidepanel:remove-web` / `sidepanel:web-context-menu` / `sidepanel:set-web` / `sidepanel:prompt-add-web` / `sidepanel:edit-done` / `sidepanel:open-web` / `sidepanel:close-web` / `sidepanel:reload-web` / `sidepanel:set-notes` / `sidepanel:resize`

送信側: `sidepanel:edit-web`, `sidepanel:add-web-prompt`（`sendToPanel` でパネル自身のwebContentsへ）

### 定数
`PANEL_URL='roopie://sidepanel'`, `DEFAULT_WIDTH=360`, `MIN_WIDTH=280`, `MAX_WIDTH=640`, `RAIL_WIDTH=44`, `PANEL_HEADER_HEIGHT=40`, `RESIZE_HANDLE_WIDTH=6`

### 依存関係
- 依存先: `context-menu.js`, `popup-window.js`, `src/preload/internal-preload.js`
- 依存元: `browser.js` / `ipc.js`（ウィンドウごとに生成、`tabManager` と連携）

### 制約・注意点
- 幅は3状態のみ: 非表示(0) / レールのみ(`RAIL_WIDTH`) / 展開（保存幅、ただし狭いウィンドウでは半分にキャップ）
- `resizeBy` の符号は `tabManager.sidePanelSide`（左/右ドック）で反転する（ドラッグ可能な辺が逆になるため）
- 旧AIアシスタント用Webパネルはロード時にフィルタで除外（`!p?.ai`、廃止機能の後始末）
- `panelView` は常にフルバウンズで塗る（Webパネル使用時に角丸から素の背景色ではなくパネル背景を見せるため）
- `destroyWebView` / `destroyPanelView` はウィンドウ破棄済み・webContents消失済みの両方をガードする（CLAUDE.md不変条件9）
- アイコン検証（`normalizeWebIcon`）: 絵文字は16文字以内、画像は `data:image/` 形式かつ400,000文字以内

## 検証
- コマンド: `npm run start:verify`
- 確認項目:
  1. パネルの開閉・レール⇄展開の幅切替でエラーが出ないこと
  2. Webパネルの追加・編集・削除・リロードが正常動作すること
  3. ウィンドウ閉鎖時に `destroyWebView` 系が例外を出さないこと

## 変更履歴
- 2026-08-04: 初版作成（docs/specs/ 新設、3層クエリルールの運用開始に伴う）
