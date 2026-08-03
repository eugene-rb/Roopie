const { WebContentsView, screen } = require('electron');
const path = require('path');
const { attachContextMenu } = require('./context-menu');
const { searchUrl, DEFAULT_ENGINE } = require('./search-engines');
const { isGoogleDomain } = require('./google-accounts');
const mediaGuard = require('./media-guard');
const popupWindow = require('./popup-window');
const { planDomainGroups, nextGroupColor, GROUP_COLORS } = require('./tab-groups');
const pageTranslate = require('./page-translate');

const NEW_TAB_URL = 'roopie://newtab';
// 復元用に覚えておく「戻る/進む」の履歴の上限(1件あたり1KB前後になるため直近ぶんだけ残す)
const MAX_HISTORY_ENTRIES = 25;
// 1タブぶんの履歴の目安サイズ。超えたら pageState(スクロール位置等)を今のページだけに絞る
const MAX_HISTORY_BYTES = 120_000;
const INTERNAL_SCHEME = 'roopie:';
const DEFAULT_CHROME_HEIGHT = 84;

// Zen Browser風のレイアウト: ページを角丸のカードとして浮かせ、周囲に余白(額縁)を作る
const CONTENT_MARGIN = 8;
const CONTENT_RADIUS = 10;
// F11などOS全画面中、上端からこの距離まで近づいたらタブバー/ツールバーを表示する。
// 一度表示したら、この距離(ツールバーの高さぶん余裕を持たせる)より離れるまで隠さない
const FULLSCREEN_REVEAL_ZONE = 6;
const FULLSCREEN_HIDE_MARGIN = 24;
const ZOOM_LEVELS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];

const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

// 画面分割のペイン間リサイズ
const SPLIT_DIVIDER_URL = 'roopie://splitdivider';
const SPLIT_DIVIDER_HIT = 16; // 仕切りのヒット領域(見た目のグリップより広く取る)
const MIN_SPLIT_RATIO = 0.15; // 片方のペインが消えないよう下限/上限を設ける
const MAX_SPLIT_RATIO = 0.85;

// メディアの next/prev 用。ページのmain worldに setActionHandler の wrapper を仕込み、
// サイトが登録したハンドラを退避する(APIにハンドラ読み出しが無いため)。
// 退避したハンドラは media:control の 'next'/'prev' で呼ぶ。登録されている種類は
// <html data-roopie-media> に書き出し、下のMEDIA_PROBEが可否を読む。
// ページ内のプレイヤーを探して状態を返すスクリプト。各フレーム(iframe含む)で実行する。
// preloadを使わないのは、preloadがメインフレームでしか走らず、ニュースサイトのように
// プレイヤーをiframeの中に置くサイトを取りこぼすため。shadow DOMの中も潜って探す。
const MEDIA_PROBE = `(() => {
  // まず素直に探す。ここで見つかれば、重い全要素走査(shadow DOM探し)はしない
  let found = [...document.querySelectorAll('video, audio')];
  if (!found.length) {
    const walk = (root, depth) => {
      if (!root || depth > 8) return;
      for (const el of root.querySelectorAll('video, audio')) found.push(el);
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    };
    walk(document, 0);
  }
  const playing = found.filter((el) => !el.paused && !el.ended && el.readyState > 0);
  const el = playing[playing.length - 1] || found.filter((e) => e.currentTime > 0).pop() || null;
  if (!el) return null;
  const ms = navigator.mediaSession && navigator.mediaSession.metadata;
  const actions = (document.documentElement.dataset.roopieMedia || '').split(',');
  return {
    title: (ms && ms.title) || document.title || location.hostname,
    artist: (ms && ms.artist) || location.hostname,
    artwork: ms && ms.artwork && ms.artwork.length ? ms.artwork[ms.artwork.length - 1].src : null,
    hasVideo: el.tagName === 'VIDEO',
    playing: !el.paused && !el.ended,
    currentTime: el.currentTime || 0,
    duration: isFinite(el.duration) ? el.duration : 0,
    canNext: actions.indexOf('nexttrack') >= 0,
    canPrev: actions.indexOf('previoustrack') >= 0,
  };
})()`;

// 1フレームへの問い合わせに待つ上限。応答を返さないフレーム(広告等)があるため必須
const PROBE_TIMEOUT = 800;

// 「閉じたタブを再度開く」で遡れる数(プロファイル内の全ウィンドウで共有するので多めに持つ)
const MAX_CLOSED_TABS = 25;

const MEDIA_HOOK = `(() => {
  const ms = navigator.mediaSession;
  if (!ms || window.__roopieMediaHooked) return;
  window.__roopieMediaHooked = true;
  window.__roopieMediaActions = window.__roopieMediaActions || {};
  const orig = ms.setActionHandler.bind(ms);
  const sync = () => {
    try {
      const keys = Object.keys(window.__roopieMediaActions).filter((k) => window.__roopieMediaActions[k]);
      document.documentElement.dataset.roopieMedia = keys.join(',');
    } catch (e) {}
  };
  ms.setActionHandler = function (action, handler) {
    window.__roopieMediaActions[action] = handler || null;
    sync();
    return orig(action, handler);
  };
  sync();
})()`;

// カメラ・マイク・現在地・通知・全画面表示はサイトごとの許可制。
// どのページにも無条件で許可すると、広告や偽の警告画面が画面を乗っ取ったり、
// 断りなくカメラを覗いたりできてしまうため、決まっていないものは decide() に判断を委ねる
// (実アプリでは確認ポップアップを出してユーザーに聞く)。
// 判断は**リクエストの時点で**行う。全画面は後から document.exitFullscreen() で戻すと、
// 一瞬だけ全画面になるうえページ側の状態が残ることがあるため。
// 許可を返すのが数秒後でも全画面・カメラには正しく入れる(検証済み)。
// decide() が扱わない権限(clipboard-read・midi・pointerLock 等)は従来どおり許可する。
//
// **setPermissionCheckHandler は設定しない**。同期でboolean しか返せず「まだ尋ねていない」を
// 表せないため、false にすると `Notification.permission` / `permissions.query()` が denied を返し、
// サイトが requestPermission を呼ばなくなる(=この確認自体が出なくなる)。
const permissionPolicySessions = new WeakSet();
function applyPermissionPolicy(session, decide) {
  if (permissionPolicySessions.has(session)) return;
  permissionPolicySessions.add(session);
  session.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    let allowed = false;
    try {
      allowed = !!(await decide?.(wc, permission, details));
    } catch {
      allowed = false;
    }
    // 返す前にタブが閉じられていることがある(ユーザーの返事を待つ間に起こりうる)
    try {
      callback(allowed);
    } catch {}
  });
}

let nextTabId = 1;

/**
 * WebContentsView を使ってタブを管理するクラス。
 * 各タブは独立した WebContentsView としてメインウィンドウに載せ、
 * アクティブなタブだけを表示する。
 */
class TabManager {
  constructor(window, { history, bookmarks, session, closedTabs, isFullscreenGranted }) {
    this.window = window;
    // そのURLが全画面表示を許可済みか(browser.js がプロファイルの許可リストで答える)。
    // 権限の判定そのものは applyPermissionPolicy 側で済んでいるので、ここは
    // 権限を通らずに全画面へ入る経路が残っていた場合の保険
    this.isFullscreenGranted = isFullscreenGranted ?? (() => true);
    this.history = history;
    this.bookmarks = bookmarks;
    this.session = session; // アクティブなプロファイルのセッション
    this.tabs = []; // { id, view, isInternal, favicon }
    this.activeTabId = null;
    this.splitTabId = null; // 画面分割で並べて表示しているタブ(nullなら分割なし)
    this.splitDirection = 'row'; // 'row'(左右) | 'column'(上下)
    this.splitRatio = 0.5; // 主ペインの割合(ペイン間リサイズで変わる)
    this.splitDivider = null; // ペイン間の仕切り(リサイズ用の小さいView)
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.chromeLeft = 0; // タブバーを左側(縦)表示にしたときの左オフセット
    this.sidePanelSide = 'right'; // サイドパネルを表示する側('left' | 'right')
    this.searchEngine = DEFAULT_ENGINE; // アドレスバーでURLでない入力をしたときの検索エンジン
    this.overlay = null; // メニュー等を表示する、常にタブより手前のView
    this.overlayVisible = false;
    this.htmlFullscreenTabId = null; // ページ側の全画面(YouTube等)にしているタブ
    // 閉じたタブ/ウィンドウの履歴。新しいものが末尾(Chrome同様、閉じた順の逆に戻す)。
    // タブ: { type: 'tab', url, index } / ウィンドウ: { type: 'window', tabs, bounds, maximized }。
    // browser.js からプロファイル単位の配列を渡してウィンドウ間で共有する
    // (別ウィンドウで閉じたタブも「閉じたタブを再度開く」で戻せる)。
    // シークレットと単体テストは共有しないので自前の配列を持つ
    this.closedTabs = closedTabs ?? [];
    // タブグループ。{ id, name, color }。所属はタブ側の tab.groupId が持つ。
    // 二段タブバーの1段目はグループを1枚のチップとして出し、2段目に中身を出す
    this.groups = [];
    this.nextGroupId = 1;
    // アクティブにした順の履歴(先頭=直前にアクティブだったタブ。今のアクティブは含まない)。
    // 設定がONのとき、アクティブなタブを閉じた/別ウィンドウへ移した後の行き先に使う。
    // グループのチップを押したときに「そのグループで最後に見ていたタブ」を選ぶのにも使う
    this.recentTabIds = [];
    this.activatePreviousTab = false; // 設定 activatePreviousTabOnClose
    this._suppressActivationFor = null; // 作成直後の背景タブID(拡張機能の誤アクティブ化を無視する間だけ設定)
    this.fullscreenChromeRevealed = false; // OS全画面(F11)中、マウス接近でタブバー/ツールバーを一時表示しているか
    this._fullscreenPollTimer = null;

    for (const event of ['resize', 'maximize', 'unmaximize']) {
      window.on(event, () => this.layout());
    }
    window.on('enter-full-screen', () => {
      this.fullscreenChromeRevealed = false;
      this.startFullscreenChromeWatch();
      this.layout();
    });
    window.on('leave-full-screen', () => {
      this.stopFullscreenChromeWatch();
      this.fullscreenChromeRevealed = false;
      this.layout();
    });
    window.on('closed', () => this.stopFullscreenChromeWatch());
  }

  // OS全画面(F11)中はページを画面いっぱいに広げ、タブバー/ツールバーを隠す。
  // マウスカーソルが上端に近づいた間だけ layout() を通じて一時的に出す
  startFullscreenChromeWatch() {
    this.stopFullscreenChromeWatch();
    this._fullscreenPollTimer = setInterval(() => {
      if (this.window.isDestroyed() || !this.window.isFullScreen()) {
        this.stopFullscreenChromeWatch();
        return;
      }
      const bounds = this.window.getBounds();
      const cursor = screen.getCursorScreenPoint();
      const withinWindow = cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width;
      const relativeY = cursor.y - bounds.y;
      // 一度出したら、隠すときはツールバーの高さぶん余裕を持たせて判定する(端でのちらつき防止)
      const shouldReveal = this.fullscreenChromeRevealed
        ? withinWindow && relativeY < this.chromeHeight + FULLSCREEN_HIDE_MARGIN
        : withinWindow && relativeY < FULLSCREEN_REVEAL_ZONE;
      if (shouldReveal !== this.fullscreenChromeRevealed) {
        this.fullscreenChromeRevealed = shouldReveal;
        this.layout();
      }
    }, 80);
  }

  stopFullscreenChromeWatch() {
    if (this._fullscreenPollTimer) {
      clearInterval(this._fullscreenPollTimer);
      this._fullscreenPollTimer = null;
    }
  }

  // anchorId のタブの直後へ挿し込むための位置(その1つ前のタブの添字)。-1なら末尾に足す。
  // 同じタブから続けてリンクを開いたときは、Chromeと同じく開いた順(1枚目→2枚目→…)に
  // 並ぶよう、すでに入っている兄弟(同じリンク元から開いたタブ)の後ろまで送る
  insertIndexAfter(anchorId) {
    if (anchorId === null || anchorId === undefined) return -1;
    let index = this.tabs.findIndex((t) => t.id === anchorId);
    if (index === -1) return -1;
    while (index + 1 < this.tabs.length && this.tabs[index + 1].openerTabId === anchorId) index++;
    return index;
  }

  // background: true なら開くだけで表示は今のタブのまま(ホイールクリック/Ctrl+クリック)。
  // hibernate: true は「読み込みそのものを後回しにする」(セッション復元専用。
  //   起動時に全タブを一斉に読み込ませないため)。initialTitle/initialFavicon は
  //   その休止中の仮表示に使う(restoreTabs参照)。
  // hibernate なしで裏に開いたタブは**読み込むが再生はさせない**(media-guard)。
  // nearActive: true は末尾ではなくアクティブなタブのすぐ右へ挿し込む
  // (ショートカット・マウスジェスチャーで開いたタブ。Chrome/Vivaldi と同じ)。
  // openerTabId: リンクから開いたタブ(ホイールクリック/Ctrl+クリック/target=_blank)。
  //   そのリンク元タブのすぐ右へ入れる。アクティブなタブ基準ではなくリンク元基準なので、
  //   画面分割の非アクティブ側や裏タブのスクリプトから開いた場合も正しい位置に入る。
  createTab(
    url = NEW_TAB_URL,
    {
      background = false,
      hibernate = false,
      initialTitle = '',
      initialFavicon = null,
      nearActive = false,
      openerTabId = null,
      groupId = null,
      history = null,
      zoom = 0,
      muted = false,
      referrer = null,
    } = {}
  ) {
    const id = nextTabId++;
    const isInternal = isInternalUrl(url);
    const view = new WebContentsView({
      webPreferences: {
        // 通常のWebページにはpreloadを渡さない(内部ページのみIPCを使える)
        preload: isInternal ? INTERNAL_PRELOAD : undefined,
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // preloadは既定ではメインフレームでしか走らない。iframeに置かれたプレイヤー(広告など)にも
        // media-guard-preload を届けるために、通常ページだけ全フレームで走らせる
        // (sandbox+contextIsolationのままなので、ページからpreload側の関数は見えない)
        nodeIntegrationInSubFrames: !isInternal,
        // autoplayPolicy は既定(no-user-gesture-required)のままにする。
        // 'document-user-activation-required' にすると、ユーザー操作の有無は**ドキュメント単位**で
        // ナビゲーションのたびに捨てられるため、自分で押した再読み込み(F5)の後ですら
        // YouTube等が NotAllowedError で一時停止したままになる(Chromeの既定は固定ポリシーではなく
        // よく見るサイトを学習するヒューリスティックなので、こうはならない)。
        // 裏で開いたタブが勝手に鳴る問題は「そもそも読み込まない」(hibernated)ことで塞ぐ
      },
    });

    // hasInternalPreload はタブ生成時に固定される(preloadは後から変えられない)
    const hibernated = background && hibernate && !isInternal;
    // 裏で開いたタブは読み込むが、選ぶまでメディアの再生を始めさせない
    const mediaGuarded = background && !hibernated && !isInternal;
    if (mediaGuarded) mediaGuard.block(view.webContents);
    const tab = {
      id,
      view,
      isInternal,
      hasInternalPreload: isInternal,
      // 休止中(まだ読み込んでいない)タブは、渡されたfavicon(セッション復元時の実データ)か、
      // 無ければ同じオリジンの履歴から仮に推測しておく。実際に読み込まれれば
      // page-favicon-updated で正しいものに置き換わる
      favicon: hibernated ? initialFavicon || this.history.faviconForOrigin?.(url) || null : null,
      bookmarkHint: false, // 「Ctrl+Dでブックマーク」の案内を出しているか
      bookmarkHintListener: null, // 案内を出している間だけ張る input-event のリスナ
      mediaTimer: null, // 再生中に全フレームを見に行くタイマー
      isAudible: false, // 音声再生中か(タブのスピーカーアイコン用)
      // バックグラウンドで開いたタブは、実際に選ぶまで読み込まない(「タブを休止する」と同じ復元経路 = switchTab内)
      hibernated,
      hibernatedUrl: hibernated ? url : null,
      // 自動再生を塞いでいる最中か(switchTabで解除する)
      mediaGuarded,
      // 休止中に見せる仮タイトル(セッション復元時の実データ)。読み込まれれば実タイトルが優先される
      hibernatedTitle: hibernated && initialTitle ? initialTitle : null,
      // 復元時に預かった「戻る/進む」の履歴。実際に読み込む(=選ばれた)時点で流し込む。
      // URLだけで開き直すと履歴が消えて戻れなくなるため
      hibernatedHistory: hibernated && history?.entries?.length ? history : null,
      // 復元時の見た目(ズーム)と音の状態。破棄後のスナップショットでも同じ値を返せるよう控える
      restoredZoom: zoom || 0,
      restoredMuted: !!muted,
      // attachEvents で張った webContents のリスナ([イベント名, 関数])。
      // 別ウィンドウへ移すとき、古いTabManagerを指すリスナを外して張り直すために覚えておく
      wcListeners: [],
      // このタブを開いたリンク元のタブ(並び順を決めるためだけに使う)
      openerTabId,
      // 所属するタブグループ(null=グループ無し)。リンクから開いたタブはリンク元のグループを継ぐ
      // (Chromeと同じ。ショートカットや「+」で開いたタブはグループに入れない)
      groupId: groupId ?? (openerTabId != null ? this.getTab(openerTabId)?.groupId ?? null : null),
    };
    // nearActive(ショートカット/ジェスチャー)はアクティブなタブの直後、
    // リンクから開いたタブはリンク元の直後へ。それ以外(「+」ボタン・セッション復元など)は末尾
    const anchorId = openerTabId ?? (nearActive ? this.activeTabId : null);
    const anchorIndex = this.insertIndexAfter(anchorId);
    if (anchorIndex === -1) this.tabs.push(tab);
    else this.tabs.splice(anchorIndex + 1, 0, tab);
    this.window.contentView.addChildView(view);

    this.attachEvents(tab);
    const prevActiveTabId = this.activeTabId;
    const prevRecentTabIds = this.recentTabIds;
    // 拡張機能システム(electron-chrome-extensions)はタブ登録時に必ずchrome.tabs.onActivatedを
    // 発火する仕様で、その結果このタブがswitchTab経由で即アクティブ化・休止解除されてしまう
    // (observeTab内で無条件にonActivatedを呼ぶため)。onTabCreated呼び出し中(同期的に発火する)
    // だけ、このタブへのswitchTabを無視するようにして、背景で作った意味そのものを守る
    if (background) this._suppressActivationFor = id;
    this.onTabCreated?.(tab); // 拡張機能システム等への通知
    this._suppressActivationFor = null;
    // 上のガードをすり抜けて activeTabId だけ変わってしまった場合の保険
    if (background && this.activeTabId !== prevActiveTabId) {
      this.switchTab(prevActiveTabId);
      // 誤アクティブ化と戻しの2回ぶんが履歴に積まれ、一度も見ていない裏タブが
      // 「直前のタブ」になってしまうので、そこだけ無かったことにする
      this.recentTabIds = prevRecentTabIds;
    }
    // 復元時のズーム・ミュートは読み込みの前に入れておく(以後の遷移でも保たれる)
    if (tab.restoredZoom) view.webContents.setZoomLevel(tab.restoredZoom);
    if (tab.restoredMuted) view.webContents.setAudioMuted(true);
    if (!tab.hibernated) {
      // 履歴つきで開き直す場合(閉じたタブを戻す等)は、URLの読み込みではなく履歴ごと流し込む
      if (history?.entries?.length) restoreNavigationHistory(view.webContents, history, url);
      else view.webContents.loadURL(url, referrer?.url ? { httpReferrer: referrer } : undefined);
    }
    if (background) {
      // 見えない位置に置いたままタブバーにだけ足す(今見ているページから離れない)
      this.updateVisibility();
      this.layout();
      this.sendState();
    } else {
      this.switchTab(id);
    }
    this.raiseTopViews(); // 新しいタブを載せた後も仕切り/プレイヤー/メニューが手前に来るようにする
    return tab;
  }

  // サイドパネル(レイアウト時に幅と領域を問い合わせる)
  setSidePanel(sidePanel) {
    this.sidePanel = sidePanel;
    this.layout();
  }

  // フローティングのミニプレイヤー
  setMediaPlayer(mediaPlayer) {
    this.mediaPlayer = mediaPlayer;
    this.layout();
  }

  // フローティングのタイマー表示
  setTimerPanel(timerPanel) {
    this.timerPanel = timerPanel;
    this.layout();
  }

  // オーバーレイ(メニュー用の透明View)を登録する
  setOverlay(view) {
    this.overlay = view;
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    this.layout();
  }

  // 子Viewは後から追加したものが手前に来るため、追加し直して最前面へ戻す
  raiseOverlay() {
    if (!this.overlay || this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.overlay);
  }

  // タブより手前に載るView群を、正しい重なり順(仕切り<プレイヤー<タイマー<オーバーレイ)で最前面へ戻す。
  // 新しいタブを追加するとそのタブが最前面に来てしまうため、生成後に呼ぶ
  raiseTopViews() {
    if (this.window.isDestroyed()) return;
    const cv = this.window.contentView;
    if (this.splitDivider) cv.addChildView(this.splitDivider);
    if (this.mediaPlayer?.view) cv.addChildView(this.mediaPlayer.view);
    if (this.timerPanel?.view) cv.addChildView(this.timerPanel.view);
    if (this.overlay) cv.addChildView(this.overlay);
  }

  // ペイン間リサイズ用の仕切りViewを用意する(分割中だけ使う)
  ensureSplitDivider() {
    if (this.splitDivider || this.window.isDestroyed()) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: INTERNAL_PRELOAD,
        session: this.session,
        transparent: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#00000000');
    this.splitDivider = view;
    this.window.contentView.addChildView(view);
    view.webContents.loadURL(SPLIT_DIVIDER_URL);
    // ページ読込前に送った方向メッセージは失われるため、読込後に再レイアウトして送り直す
    view.webContents.once('did-finish-load', () => this.layout());
    this.raiseOverlay(); // 仕切りの上にオーバーレイ(メニュー)を戻す
  }

  destroySplitDivider() {
    if (!this.splitDivider) return;
    // ウィンドウ破棄後(dispose)はcontentViewを触れないので、webContentsを閉じるだけにする
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.splitDivider);
    this.splitDivider.webContents.close();
    this.splitDivider = null;
  }

  showOverlay(visible) {
    if (!this.overlay) return;
    if (visible) this.raiseOverlay();
    this.overlay.setVisible(visible);
    this.overlayVisible = visible;
    if (visible) this.overlay.webContents.focus();
    else this.activeWebContents()?.focus();
  }

  // 張ったリスナは tab.wcListeners に控える(detachEvents で外して別ウィンドウへ張り直せるように)
  attachEvents(tab) {
    const wc = tab.view.webContents;
    const update = () => this.sendState();
    const on = (event, listener) => {
      wc.on(event, listener);
      tab.wcListeners.push([event, listener]);
    };

    on('page-title-updated', (_e, title) => {
      this.history.update(wc.getURL(), title);
      this.sendState();
    });
    on('did-start-loading', update);
    on('did-stop-loading', update);
    on('did-navigate-in-page', update);

    on('did-navigate', (_e, url) => {
      tab.favicon = null;
      tab.isInternal = isInternalUrl(url);
      // 前のページの翻訳状態(訳した/提案中)を持ち越さない。
      // 新しいページの判定は preload の translate:page-info から始まる
      pageTranslate.reset(tab);
      // ページを離れたら、前のページのメディアを「再生中」と言い続けない
      // (旧方式ではpreloadがnullを送っていた経路。今はメイン側で明示的に消す)
      this.stopMediaWatch(tab);
      this.onMediaReport?.(tab.id, null, null);
      tab.isAudible = false;
      // ブックマークの案内は「また来たのにまだ入れていないページ」にだけ出す。
      // 履歴へ足す前に判定する(足した後だと必ず1件見つかってしまう)。
      // フォルダの中(スタート画面のショートカット等)にあるページでも出さない
      this.setBookmarkHint(tab, !tab.isInternal && this.history.has(url) && !this.bookmarks.existsAnywhere(url));
      if (!tab.isInternal) this.history.add(url, wc.getTitle());
      this.sendState();

      // Googleにログインした可能性があるタイミングでアカウント一覧を確認する。
      // google.com だけでなく、ログインが共有される他のGoogleサービスも見る
      // (YouTubeやGmailからログインする人を取りこぼさないため)
      if (isGoogleDomain(url)) this.onGoogleDomainVisit?.(this.session);
    });

    // Chromiumが再生の開始/停止を教えてくれる(iframeの中でもshadow DOMの中でも飛ぶ)。
    // これをきっかけに全フレームを見に行く
    on('media-started-playing', () => this.startMediaWatch(tab));
    on('media-paused', () => this.probeMedia(tab));

    // タブのスピーカーアイコン用。実際に音が鳴っているかどうかはこちらの方が正確
    // (media-started-playingは無音のvideo要素でも飛ぶため)
    on('audio-state-changed', (e) => {
      tab.isAudible = e.audible;
      this.sendState();
    });

    on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[favicons.length - 1] || null;
      this.history.update(wc.getURL(), null, tab.favicon);
      this.sendState();
    });

    // メディアの next/prev 用wrapperをmain worldへ注入(http/httpsのみ)。
    // ページ側は再生開始のたびにハンドラを登録し直すため、dom-readyで先に仕込んでおけば拾える
    on('dom-ready', () => {
      const scheme = wc.getURL().split(':')[0];
      if (scheme === 'http' || scheme === 'https') {
        wc.executeJavaScript(MEDIA_HOOK, true).catch(() => {});
      }
    });

    on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 (ABORTED) はユーザー操作による中断なので無視する
      if (isMainFrame && code !== -3) {
        console.error(`読み込み失敗: ${url} (${code} ${description})`);
      }
    });

    // ページ内検索の結果をUIへ
    on('found-in-page', (_e, result) => {
      this.window.webContents.send('find:result', {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    // 内部ページ(roopie://)はpreloadを持つタブでしか動かせないため、
    // 通常タブから内部ページへ遷移しようとした場合は新しいタブで開く。
    // (逆方向の内部ページ→通常ページは同じタブで遷移できる。preloadは
    //  roopie:以外ではAPIを公開しないため安全)
    on('will-navigate', (event, url) => {
      if (isInternalUrl(url) && !tab.hasInternalPreload) {
        event.preventDefault();
        this.createTab(url);
      }
    });

    // ページ側の全画面(YouTubeの全画面ボタン等)。許可済みのサイトだけを受け入れ、
    // それ以外はすぐ解除する(広告や偽の警告画面に画面を占有されないようにする)
    on('enter-html-full-screen', () => {
      if (!this.isFullscreenGranted(wc.getURL(), wc)) {
        // Electronはこの時点で既にウィンドウを全画面にしているので、ページ側とウィンドウ側の
        // 両方を戻す(ページ側だけだとウィンドウが全画面のまま残る)
        wc.executeJavaScript('document.exitFullscreen && document.exitFullscreen()', true).catch(() => {});
        this.window.setFullScreen(false);
        return;
      }
      this.setHtmlFullscreen(tab.id, true);
    });
    on('leave-html-full-screen', () => this.setHtmlFullscreen(tab.id, false));

    // target="_blank" 等のリンクは新しいタブで開く。
    // ホイールクリック/Ctrl+クリックは disposition が background-tab で来るので、
    // Chrome同様にそのタブへは切り替えず裏で開く。
    // 位置は末尾ではなくリンク元タブのすぐ右(openerTabId)。
    // ただしサイズ指定付きの window.open(Googleログイン等)だけは、Chrome/Edgeと同じく
    // 本物のポップアップウィンドウで開く(タブにすると window.opener が切れて認証が終わらない)
    wc.setWindowOpenHandler((details) => {
      if (popupWindow.isPopupRequest(details)) return popupWindow.responseFor(details, this.window);
      this.createTab(details.url, {
        background: details.disposition === 'background-tab',
        openerTabId: tab.id,
        // target="_blank" 等で新規タブに移ると既定ではリファラが消え、
        // pixiv等のリファラチェックに引っかかる(ホットリンク防止エラー)ため引き継ぐ
        referrer: details.referrer,
      });
      return { action: 'deny' };
    });
    on('did-create-window', (win, details) => popupWindow.setup(win, details, this));

    tab.wcListeners.push(['context-menu', attachContextMenu(wc, this)]);
  }

  // ---- タブグループ ----
  //
  // グループは「1段目に出すチップ」と「2段目に出す中身」の2段タブバーのための入れ物。
  // 所属は tab.groupId(null=グループ無し)で持ち、グループ側はタブIDを持たない
  // (タブの生成・移動・破棄の経路すべてで両側を同期させるのは事故のもとなので、
  //  一覧が要るところでは tabs から引く)。

  getGroup(id) {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  tabsInGroup(groupId) {
    return this.tabs.filter((t) => t.groupId === groupId);
  }

  // グループの中身が1枚も無くなったら、そのグループごと消す(空のチップを残さない)
  pruneEmptyGroups() {
    const alive = new Set(this.tabs.map((t) => t.groupId).filter((id) => id != null));
    const before = this.groups.length;
    this.groups = this.groups.filter((g) => alive.has(g.id));
    return this.groups.length !== before;
  }

  // グループの中身をタブバー上で連続させる(1段目のチップの位置を安定させるため)。
  // 先頭メンバーの位置へ残りを寄せる
  gatherGroup(groupId) {
    const members = this.tabsInGroup(groupId);
    if (members.length < 2) return;
    const anchor = this.tabs.indexOf(members[0]);
    const rest = members.slice(1);
    for (const tab of rest) this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.tabs.splice(anchor + 1, 0, ...rest);
  }

  createGroup(tabIds, { name, color, silent = false } = {}) {
    const members = (tabIds ?? []).map((id) => this.getTab(id)).filter(Boolean);
    if (!members.length) return null;
    const group = {
      id: this.nextGroupId++,
      name: name || '新しいグループ',
      color: GROUP_COLORS.includes(color) ? color : nextGroupColor(this.groups.map((g) => g.color)),
    };
    this.groups.push(group);
    for (const tab of members) tab.groupId = group.id;
    this.gatherGroup(group.id);
    this.pruneEmptyGroups(); // 移動元のグループが空になった場合
    if (!silent) this.sendState();
    return group;
  }

  addToGroup(groupId, tabIds) {
    if (!this.getGroup(groupId)) return;
    for (const id of tabIds ?? []) {
      const tab = this.getTab(id);
      if (tab) tab.groupId = groupId;
    }
    this.gatherGroup(groupId);
    this.pruneEmptyGroups();
    this.sendState();
  }

  removeFromGroup(tabIds) {
    for (const id of tabIds ?? []) {
      const tab = this.getTab(id);
      if (tab) tab.groupId = null;
    }
    this.pruneEmptyGroups();
    this.sendState();
  }

  renameGroup(groupId, name) {
    const group = this.getGroup(groupId);
    if (!group) return;
    group.name = String(name ?? '').trim().slice(0, 40) || group.name;
    this.sendState();
  }

  setGroupColor(groupId, color) {
    const group = this.getGroup(groupId);
    if (!group || !GROUP_COLORS.includes(color)) return;
    group.color = color;
    this.sendState();
  }

  // グループを解除(中身のタブはそのまま残す)
  ungroup(groupId) {
    if (!this.getGroup(groupId)) return;
    for (const tab of this.tabsInGroup(groupId)) tab.groupId = null;
    this.pruneEmptyGroups();
    this.sendState();
  }

  closeGroup(groupId) {
    for (const id of this.tabsInGroup(groupId).map((t) => t.id)) this.closeTab(id);
  }

  // グループのチップを押したとき: そのグループで最後に見ていたタブへ移る
  // (履歴に無ければ先頭。既にそのグループの中に居るなら何もしない)
  selectGroup(groupId) {
    const members = this.tabsInGroup(groupId);
    if (!members.length) return;
    if (members.some((t) => t.id === this.activeTabId)) return;
    const recent = this.recentTabIds.find((id) => members.some((t) => t.id === id));
    this.switchTab(recent ?? members[0].id);
  }

  // タブバーの右クリックメニューからの自動仕分け。
  // 同じドメインが2タブ以上あるときだけグループにする(1件だけのグループは作らない)。
  // 既にグループへ入れてあるタブは動かさない(手で作ったグループを壊さないため)
  groupByDomain() {
    const loose = this.tabs
      .filter((t) => t.groupId == null)
      .map((t) => ({ id: t.id, url: this.tabUrl(t) ?? '' }));
    const plan = planDomainGroups(loose);
    for (const { name, tabIds } of plan) {
      // 既に同じ名前のグループがあればそこへ足す(2回実行しても増えない)
      const existing = this.groups.find((g) => g.name === name);
      if (existing) {
        for (const id of tabIds) {
          const tab = this.getTab(id);
          if (tab) tab.groupId = existing.id;
        }
        this.gatherGroup(existing.id);
      } else {
        this.createGroup(tabIds, { name, silent: true });
      }
    }
    this.pruneEmptyGroups();
    this.sendState();
    return plan.length;
  }

  // アクティブなタブを取り除いた後の行き先(呼ぶのは取り除いた後。indexは取り除いた位置)。
  // 既定は同じ位置のタブ(=右隣、末尾だったら左隣)。設定がONなら、
  // まだ残っている中で直前にアクティブだったタブへ戻る
  nextActiveAfterRemoval(index) {
    if (this.activatePreviousTab) {
      const previous = this.recentTabIds.find((tabId) => this.getTab(tabId));
      if (previous != null) return previous;
    }
    return this.tabs[Math.min(index, this.tabs.length - 1)].id;
  }

  setActivatePreviousTab(on) {
    this.activatePreviousTab = !!on;
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    if (id === this.splitTabId) this.splitTabId = null;

    const [tab] = this.tabs.splice(index, 1);
    this.recentTabIds = this.recentTabIds.filter((t) => t !== id);
    this.pruneEmptyGroups();
    this.rememberClosedTab(tab, index);
    this.setBookmarkHint(tab, false); // 入力イベントの見張りを外す
    this.stopMediaWatch(tab);
    if (this.htmlFullscreenTabId === tab.id) this.setHtmlFullscreen(tab.id, false);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.onTabClosed?.(tab);

    if (this.tabs.length === 0) {
      // プロファイル切り替え中は、全タブを閉じた直後に新しいタブを開くので閉じない
      if (!this.isSwitchingProfile) this.window.close();
      return;
    }

    if (this.activeTabId === id) {
      if (this.splitTabId && this.getTab(this.splitTabId)) {
        // 分割中に主ペインを閉じた場合は、相方のペインを主ペインへ昇格させる
        const promoted = this.splitTabId;
        this.splitTabId = null;
        this.switchTab(promoted);
      } else {
        this.switchTab(this.nextActiveAfterRemoval(index));
      }
    } else {
      this.updateVisibility();
      this.layout();
      this.sendState();
    }
  }

  closeActiveTab() {
    if (this.activeTabId !== null) this.closeTab(this.activeTabId);
  }

  // ---- タブをウィンドウ間で移す(切り離し / 別ウィンドウのタブバーへドロップ) ----
  //
  // 以前はURLだけ引き継いで元を閉じ・移動先で開き直していたため、(1)まだ読み込んでいない
  // タブ(裏で開いた/セッション復元した休止中のタブ)は getURL() が空でそのまま
  // 「新しいタブ」に化け、(2)必ず再読み込みになるのでYouTube等の再生が止まっていた。
  // WebContentsView は removeChildView / addChildView でウィンドウ間を移せる
  // (webContents はそのまま生き続けるので再読み込みも再生の中断も起きない)ので、
  // View そのものを引き渡す。

  // このTabManagerが張ったリスナを外す(古いウィンドウを指したまま残らないように)
  detachEvents(tab) {
    const wc = tab.view.webContents;
    if (!wc.isDestroyed()) {
      for (const [event, listener] of tab.wcListeners) wc.off(event, listener);
    }
    tab.wcListeners = [];
  }

  // このウィンドウへ引き取れるタブか(セッション=プロファイルが同じでなければViewは移せない)
  canAdopt(tab) {
    return !!tab && !tab.view.webContents.isDestroyed() && tab.view.webContents.session === this.session;
  }

  // タブが指しているURL。まだ読み込んでいない(休止中の)タブでも空にならない。
  // Viewを移せない場合(プロファイルが違う)に、URLだけ引き継ぐために使う
  tabUrl(tab) {
    if (!tab) return null;
    const wc = tab.view.webContents;
    const url = wc.isDestroyed() ? '' : wc.getURL();
    return url || tab.hibernatedUrl || null;
  }

  // タブを破棄せずにこのウィンドウから外して返す(移動先で adoptTab に渡す)。
  // 最後の1枚を外すとタブ0枚になるが、ウィンドウを閉じるかは呼び出し側が決める
  releaseTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return null;

    if (id === this.splitTabId) this.splitTabId = null;

    const [tab] = this.tabs.splice(index, 1);
    this.recentTabIds = this.recentTabIds.filter((t) => t !== id);
    this.pruneEmptyGroups();
    // 移動先のウィンドウにこのグループは無いので所属は捨てる(グループIDはウィンドウ内で採番している)
    tab.groupId = null;
    // ブックマークの案内は移動先で出し直す(見張りのリスナは一度外す)
    const bookmarkHint = tab.bookmarkHint;
    this.setBookmarkHint(tab, false);
    tab.pendingBookmarkHint = bookmarkHint;
    this.stopMediaWatch(tab);
    if (this.htmlFullscreenTabId === tab.id) this.setHtmlFullscreen(tab.id, false);
    this.detachEvents(tab);
    // 先にViewを外しておく(この後この窓が空になって閉じても、Viewは巻き添えにならない)
    this.window.contentView.removeChildView(tab.view);
    this.onTabClosed?.(tab); // このウィンドウ側の再生表示などの後始末

    if (this.tabs.length === 0) {
      this.activeTabId = null;
      return tab;
    }

    if (this.activeTabId === id) {
      if (this.splitTabId && this.getTab(this.splitTabId)) {
        const promoted = this.splitTabId;
        this.splitTabId = null;
        this.switchTab(promoted);
      } else {
        this.switchTab(this.nextActiveAfterRemoval(index));
      }
    } else {
      this.updateVisibility();
      this.layout();
      this.sendState();
    }
    return tab;
  }

  // releaseTab で外したタブをこのウィンドウへ引き取る。toIndex 省略で末尾
  adoptTab(tab, toIndex) {
    if (!this.canAdopt(tab) || this.window.isDestroyed()) return null;
    const to = Number.isInteger(toIndex) ? Math.max(0, Math.min(toIndex, this.tabs.length)) : this.tabs.length;
    this.tabs.splice(to, 0, tab);
    this.window.contentView.addChildView(tab.view);
    this.attachEvents(tab);
    if (tab.pendingBookmarkHint) this.setBookmarkHint(tab, true);
    tab.pendingBookmarkHint = false;
    // 拡張機能システムに「このウィンドウのタブ」として登録し直す。
    // switchTab(→onTabSelected)より先に行わないと、選択の通知が届かない
    this.onTabAdopted?.(tab);
    this.switchTab(tab.id);
    this.raiseTopViews(); // 追加したViewの上に仕切り/プレイヤー/メニューを戻す
    // 再生したまま運ばれてきたタブを、移動先のミニプレイヤーにも映す
    // (再生は途切れないので media-started-playing は二度と飛んでこない)
    if (!tab.hibernated) this.startMediaWatch(tab);
    return tab;
  }

  switchTab(id) {
    // 作成直後の背景タブに対して拡張機能システムが誤って発火させたものは無視する
    // (createTab側の説明を参照。ここで無視しないと「裏では読み込まない」意味が無くなる)
    if (id === this._suppressActivationFor) return;
    const tab = this.getTab(id);
    if (!tab) return;
    // 裏で開いたタブは読み込みだけ済ませて再生を止めてある。選ばれた今が解除の時点で、
    // 塞いでいた分(autoplay/play())はここで初めて鳴り始める
    if (tab.mediaGuarded) {
      tab.mediaGuarded = false;
      mediaGuard.release(tab.view.webContents);
    }
    // タイマーの「タブを休止する」で退避したタブは、選び直された時点で元のURLへ復元する。
    // 閉じたウィンドウ/前回セッションから戻したタブは「戻る/進む」の履歴も預かっているので、
    // URLの読み込みではなく履歴ごと流し込む(こうしないと戻れないタブになる)
    if (tab.hibernated) {
      const history = tab.hibernatedHistory;
      const url = tab.hibernatedUrl;
      tab.hibernated = false;
      tab.hibernatedUrl = null;
      tab.hibernatedHistory = null;
      if (history?.entries?.length) restoreNavigationHistory(tab.view.webContents, history, url);
      else tab.view.webContents.loadURL(url ?? NEW_TAB_URL);
    }
    // ページ全画面(YouTube等)のまま別のタブへ移ると、UIが消えたまま別ページが
    // 全画面表示になり戻る手段が無くなる。切り替える前に全画面を抜ける
    if (this.htmlFullscreenTabId != null && this.htmlFullscreenTabId !== id) {
      const fullscreenTab = this.getTab(this.htmlFullscreenTabId);
      fullscreenTab?.view.webContents
        .executeJavaScript('document.exitFullscreen && document.exitFullscreen()', true)
        .catch(() => {});
      this.setHtmlFullscreen(this.htmlFullscreenTabId, false);
    }
    // 分割相手のタブをそのままアクティブにした場合は、同じ内容が重複するので分割を解除する
    if (id === this.splitTabId) this.splitTabId = null;
    if (this.activeTabId !== null && this.activeTabId !== id) {
      this.recentTabIds = [this.activeTabId, ...this.recentTabIds.filter((t) => t !== this.activeTabId)];
      if (this.recentTabIds.length > 100) this.recentTabIds.length = 100;
    }
    this.recentTabIds = this.recentTabIds.filter((t) => t !== id); // これから使う分は履歴から降ろす
    this.activeTabId = id;
    this.updateVisibility();
    this.layout();
    tab.view.webContents.focus();
    this.onTabSelected?.(tab);
    this.sendState();
  }

  // ブックマークの案内の出し入れ。案内を出している間だけページの入力を見張る
  // (常時リスナを張ると、案内が出ていないほとんどの時間もマウス移動のたびに
  //  レンダラーからメインへイベントが飛び続ける)
  setBookmarkHint(tab, on) {
    if (!!tab.bookmarkHint === !!on) return;
    tab.bookmarkHint = !!on;
    const wc = tab.view.webContents;
    if (on) {
      tab.bookmarkHintListener = (_e, input) => {
        if (input.type === 'mouseDown' || input.type === 'mouseWheel' || input.type === 'keyDown') {
          this.setBookmarkHint(tab, false);
          this.sendState();
        }
      };
      wc.on('input-event', tab.bookmarkHintListener);
    } else if (tab.bookmarkHintListener) {
      if (!wc.isDestroyed()) wc.off('input-event', tab.bookmarkHintListener);
      tab.bookmarkHintListener = null;
    }
  }

  // ---- 閉じたタブを開き直す(Chromeの Ctrl+Shift+T 相当) ----

  rememberClosedTab(tab, index) {
    // プロファイル切り替えで閉じたタブは覚えない。覚えると、切り替えた先のプロファイルで
    // 「閉じたタブを再度開く」を実行したときに前のプロファイルのURLが開いてしまう
    if (this.isSwitchingProfile) return;
    const wc = tab.view.webContents;
    const url = wc.isDestroyed() ? this.tabUrl(tab) ?? '' : wc.getURL();
    // 新しいタブページや空のタブを覚えても意味がない
    if (!url || isNewTabUrl(url) || url === 'about:blank') return;
    // 戻す時は「戻る/進む」の履歴・ズーム・ミュートまでそのまま戻す
    this.closedTabs.push({
      type: 'tab',
      url,
      index,
      history: this.tabHistory(tab),
      zoom: wc.isDestroyed() ? tab.restoredZoom ?? 0 : wc.getZoomLevel(),
      muted: wc.isDestroyed() ? !!tab.restoredMuted : wc.isAudioMuted(),
    });
    if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
  }

  // ウィンドウごと閉じたときは、その構成をまとめて1件だけ覚える(browser.js の window 'close' から。
  // タブを1枚ずつ積むと、1回ウィンドウを閉じただけで他のウィンドウ分の履歴が押し出されてしまう)。
  // 破棄前(=タブがまだ生きている 'close')に呼ぶこと
  rememberClosedWindow(bounds, maximized = false) {
    if (this.isSwitchingProfile) return;
    // 新しいタブページや空のタブしか無いウィンドウは覚えても意味がない
    const tabs = this.snapshotTabs().tabs.filter((t) => t.url && !isNewTabUrl(t.url) && t.url !== 'about:blank');
    if (!tabs.length) return;
    // アクティブだったタブが除外された場合に備えて、必ず1枚はアクティブにしておく
    if (!tabs.some((t) => t.active)) tabs[0].active = true;
    this.closedTabs.push({ type: 'window', tabs, bounds, maximized });
    if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
  }

  // 直近に閉じたタブ/ウィンドウから順に開き直す(Chrome同様、閉じた順の逆にたどる)。
  // タブは元の位置に、ウィンドウは元の位置・大きさで開き直す
  reopenClosedTab() {
    const entry = this.closedTabs.pop();
    if (!entry) return null;
    if (entry.type === 'window') {
      // ウィンドウの生成は browser.js の仕事(TabManagerからは作れない)
      const reopened = this.onReopenWindow?.(entry);
      if (reopened) return reopened;
      // ハンドラが無い/開けなかったときは、せめてこのウィンドウにタブとして戻す
      this.restoreTabs(entry.tabs);
      return null;
    }
    const tab = this.createTab(entry.url, {
      history: entry.history,
      zoom: entry.zoom,
      muted: entry.muted,
    });
    const to = Math.min(Math.max(0, entry.index), this.tabs.length - 1);
    const from = this.tabs.indexOf(tab);
    if (from !== -1 && from !== to) {
      this.tabs.splice(from, 1);
      this.tabs.splice(to, 0, tab);
      this.sendState();
    }
    return tab;
  }

  duplicateTab(id) {
    const tab = this.getTab(id);
    if (!tab) return null;
    const url = tab.view.webContents.getURL();
    return this.createTab(url || undefined);
  }

  closeOtherTabs(id) {
    for (const other of [...this.tabs]) {
      if (other.id !== id) this.closeTab(other.id);
    }
  }

  toggleMute(id) {
    const wc = this.getTab(id)?.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.setAudioMuted(!wc.isAudioMuted());
    this.sendState();
  }

  // ---- メディアの検出(ミニプレイヤー用) ----
  // preloadは各フレームに配れない(メインフレームでしか走らない)ので、メインプロセスから
  // 全フレームを見に行く。再生中だけ1秒おきに更新し、止まって少ししたら見るのをやめる

  startMediaWatch(tab) {
    // next/prev用のwrapperはメインフレームにしか入れていないので、iframeにも入れておく
    for (const frame of tab.view.webContents.mainFrame?.framesInSubtree ?? []) {
      frame.executeJavaScript(MEDIA_HOOK, true).catch(() => {});
    }
    this.probeMedia(tab);
    if (tab.mediaTimer) return;
    tab.mediaIdleTicks = 0;
    tab.mediaTimer = setInterval(() => this.probeMedia(tab), 1000);
  }

  stopMediaWatch(tab) {
    clearInterval(tab.mediaTimer);
    tab.mediaTimer = null;
  }

  async probeMedia(tab) {
    const wc = tab.view.webContents;
    if (!wc || wc.isDestroyed()) {
      this.stopMediaWatch(tab);
      return;
    }
    // 応答が返ってこないフレームがある(広告のsrcdocフレーム等)。全フレームを同時に、
    // かつ時間を区切って問い合わせる。直列かつ無制限に待つと、1つ詰まっただけで検出が止まる
    const frames = (wc.mainFrame?.framesInSubtree ?? []).filter((frame) => !frame.isDestroyed?.());
    const results = await Promise.all(
      frames.map((frame) =>
        Promise.race([
          frame.executeJavaScript(MEDIA_PROBE, true).catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT)),
        ])
      )
    );

    let best = null;
    let bestFrame = null;
    for (const [index, state] of results.entries()) {
      const frame = frames[index];
      if (!state) continue;
      // 再生中のものを最優先。次に再生位置が進んでいるもの
      if (!best || (state.playing && !best.playing) || (state.playing === best.playing && state.currentTime > best.currentTime)) {
        best = state;
        bestFrame = frame;
      }
    }

    // 何も無い状態がしばらく続いたら監視を止める(音を止めただけの直後は残す)
    if (!best) {
      if (++tab.mediaIdleTicks >= 3) this.stopMediaWatch(tab);
    } else {
      tab.mediaIdleTicks = best.playing ? 0 : (tab.mediaIdleTicks ?? 0) + 1;
      if (tab.mediaIdleTicks >= 60) this.stopMediaWatch(tab); // 一時停止のまま1分放置
    }
    this.onMediaReport?.(tab.id, best, bestFrame);
  }

  // ページ側の全画面(YouTube等)。ページをウィンドウ一杯に広げ、UIを隠し、
  // ウィンドウ自体もOSの全画面にする。解除(Esc)で元に戻す
  setHtmlFullscreen(tabId, on) {
    const next = on ? tabId : null;
    if (this.htmlFullscreenTabId === next) return;
    // 全画面中のタブ以外からの解除通知は無視する(別タブの終了で抜けてしまわないように)
    if (!on && this.htmlFullscreenTabId !== tabId) return;
    this.htmlFullscreenTabId = next;
    this.window.setFullScreen(!!on);
    this.window.webContents.send('ui:html-fullscreen', !!on);
    this.updateVisibility(); // 分割相手の表示/非表示を切り替える
    this.layout();
  }

  updateVisibility() {
    // 全画面中は分割相手を隠す(layout側でも分割をたたんでいる)
    const fs = this.htmlFullscreenTabId != null;
    for (const t of this.tabs) {
      t.view.setVisible(t.id === this.activeTabId || (!fs && t.id === this.splitTabId));
    }
  }

  // ---- 画面分割 ----

  // アクティブなタブの隣に、別のタブを並べて表示する
  splitWith(id, direction) {
    if (id === this.activeTabId || !this.getTab(id)) return;
    this.splitTabId = id;
    this.splitDirection = direction === 'column' ? 'column' : 'row';
    this.splitRatio = 0.5; // 新しい分割は毎回半々から始める
    this.updateVisibility();
    this.layout();
    this.sendState();
  }

  toggleSplitDirection() {
    if (!this.splitTabId) return;
    this.splitDirection = this.splitDirection === 'row' ? 'column' : 'row';
    this.layout();
    this.sendState();
  }

  closeSplit() {
    if (!this.splitTabId) return;
    this.splitTabId = null;
    this.updateVisibility();
    this.layout();
    this.sendState();
  }

  // タブをページ領域のゾーンにドロップして分割する(D&D分割)。
  // zone: 'left'|'right'|'top'|'bottom'。left/topはドラッグしたタブを主ペイン(先頭)にする
  dropSplit(draggedId, zone) {
    if (!this.getTab(draggedId) || this.tabs.length < 2) return;
    if (draggedId === this.activeTabId) return; // 自分自身とは分割しない
    const direction = zone === 'top' || zone === 'bottom' ? 'column' : 'row';
    const draggedFirst = zone === 'left' || zone === 'top';
    if (draggedFirst) {
      // ドラッグしたタブを主(左/上)にするため、先にアクティブへ昇格させてから相方を並べる
      const partner = this.activeTabId;
      this.switchTab(draggedId);
      this.splitWith(partner, direction);
    } else {
      this.splitWith(draggedId, direction);
    }
  }

  // タブのドラッグ中だけ、ページ領域にドロップゾーン(オーバーレイ)を出す
  showDropZones() {
    if (!this.overlay || this.window.isDestroyed()) return;
    this.raiseTopViews(); // オーバーレイを最前面に(ドロップを受け取れるように)
    this.overlay.setVisible(true);
    this.overlay.webContents.send('overlay:drop-zones', { show: true });
  }

  hideDropZones() {
    if (!this.overlay || this.window.isDestroyed()) return;
    this.overlay.webContents.send('overlay:drop-zones', { show: false });
    this.overlay.setVisible(false);
  }

  // ---- ペイン間リサイズ(仕切りViewのドラッグから呼ばれる) ----
  splitResizeStart() {
    this._resizeStartRatio = this.splitRatio;
  }

  // 仕切りが送ってくるドラッグ開始からの累積移動量(dx, dy)を分割比率へ変換する
  splitResizeBy(dx, dy) {
    if (this._resizeStartRatio == null || !this._splitAxis) return;
    const delta = this.splitDirection === 'column' ? dy : dx;
    const ratio = this._resizeStartRatio + delta / this._splitAxis;
    this.splitRatio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, ratio));
    this.layout();
  }

  splitResizeEnd() {
    this._resizeStartRatio = null;
  }

  switchRelative(offset) {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const next = (index + offset + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[next].id);
  }

  switchToIndex(index) {
    // Ctrl+9 は Chrome と同じく「最後のタブ」
    const tab = index >= 8 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (tab) this.switchTab(tab.id);
  }

  // ドラッグ&ドロップによる並べ替え(タブバーから呼ばれる)
  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    const to = Math.max(0, Math.min(toIndex, this.tabs.length - 1));
    if (from === to) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.sendState();
  }

  // アドレスバー入力: URLらしければURLとして、それ以外は設定した検索エンジンで検索
  navigate(input) {
    const url = toUrl(input, this.searchEngine);
    const tab = this.getTab(this.activeTabId);
    if (!tab) return;
    // 内部ページはpreloadを持つタブでしか動かせない
    if (isInternalUrl(url) && !tab.hasInternalPreload) {
      this.createTab(url);
      return;
    }
    tab.view.webContents.loadURL(url);
  }

  goBack() {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward() {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload() {
    this.activeWebContents()?.reload();
  }

  stop() {
    this.activeWebContents()?.stop();
  }

  toggleDevTools() {
    this.activeWebContents()?.toggleDevTools();
  }

  // ---- ズーム ----
  zoom(direction) {
    const wc = this.activeWebContents();
    if (!wc) return;
    if (direction === 0) {
      wc.setZoomLevel(0);
    } else {
      const current = wc.getZoomLevel();
      const levels = direction > 0 ? ZOOM_LEVELS : [...ZOOM_LEVELS].reverse();
      const next = levels.find((l) => (direction > 0 ? l > current + 0.01 : l < current - 0.01));
      if (next !== undefined) wc.setZoomLevel(next);
    }
    this.sendState();
  }

  // ---- ページ内検索 ----
  find(text, options = {}) {
    const wc = this.activeWebContents();
    if (!wc || !text) return;
    wc.findInPage(text, { forward: options.forward !== false, findNext: !!options.findNext });
  }

  stopFind() {
    this.activeWebContents()?.stopFindInPage('clearSelection');
  }

  // ---- ブックマーク ----
  toggleBookmarkForActiveTab() {
    const tab = this.getTab(this.activeTabId);
    if (!tab || tab.isInternal) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!url) return;
    this.bookmarks.toggle(url, wc.getTitle() || url, tab.favicon);
    // ブックマークしたらもう案内は要らない(見張りも外す)
    if (this.bookmarks.find(url)) this.setBookmarkHint(tab, false);
  }

  // ウィンドウを閉じたときの後始末(browser.js の window 'closed' から呼ぶ)。
  // WebContentsView の webContents はウィンドウを破棄しても道連れにならないため、
  // 明示的に閉じないと動画・音声が鳴り続ける(最後の1枚はアプリ終了で消えるので
  // 2枚目以降のウィンドウを閉じたときだけ表面化していた)。
  // closeTab は使わない: 「閉じたタブを再度開く」の履歴(プロファイル共有)を
  // ウィンドウ1枚分のタブで埋めてしまうし、最後の1枚で window.close() を呼び返してしまう
  dispose() {
    for (const tab of this.tabs) {
      this.setBookmarkHint(tab, false); // input-event の見張りを外す
      this.stopMediaWatch(tab); // 破棄済みのwebContentsを叩き続けるタイマーを止める
      const wc = tab.view.webContents;
      if (wc && !wc.isDestroyed()) wc.close();
    }
    this.tabs = [];
    this.activeTabId = null;
    this.splitTabId = null;
    this.destroySplitDivider();
    // ウィンドウ破棄の順序によっては view.webContents が先に消えて undefined になる
    // (実機のアプリ終了時に main の未捕捉例外として出ていた)
    const overlayWc = this.overlay?.webContents;
    if (overlayWc && !overlayWc.isDestroyed()) overlayWc.close();
    this.overlay = null;
    if (this._fullscreenPollTimer) {
      clearInterval(this._fullscreenPollTimer);
      this._fullscreenPollTimer = null;
    }
  }

  // プロファイル切り替え: セッションが変わるので全タブを作り直す
  // タブは閉じるだけ。新しいタブの生成は呼び出し側に任せる
  // (Edgeのワークスペースのように、プロファイルごとのタブ構成を復元できるようにするため)
  switchSession(session) {
    this.isSwitchingProfile = true;
    this.session = session;
    this.splitTabId = null;
    this.destroySplitDivider(); // 仕切りは旧セッションのViewなので作り直す
    for (const id of this.tabs.map((t) => t.id)) {
      this.closeTab(id);
    }
    // 前のプロファイルのURLを持ち越さない。共有配列(browser.js)から切り離した空の配列にするので、
    // プロファイル切り替えを本実装するときは切り替え先のプロファイルの配列を渡し直すこと
    this.closedTabs = [];
    this.isSwitchingProfile = false;
  }

  // 戻る/進むの履歴。Chromiumの NavigationEntry は { url, title, pageState } で、
  // pageState にはスクロール位置やフォームの入力状態まで入っている。
  // まだ読み込んでいない(休止中の)タブは、復元時に預かった履歴をそのまま持ち回す
  tabHistory(tab) {
    if (tab.hibernated) return tab.hibernatedHistory ?? null;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return tab.hibernatedHistory ?? null;
    try {
      const all = wc.navigationHistory.getAllEntries();
      if (!all?.length) return null;
      // 長い履歴をそのまま保存すると1件1KB前後×件数になるので上限を設ける。
      // 切り出す窓は**今いる位置を中心**にする(末尾から取ると、履歴を戻った状態で閉じたときに
      // 今見ていたページが窓から外れ、別のページで復元されてしまう)
      const activeIndex = wc.navigationHistory.getActiveIndex();
      const start = Math.max(
        0,
        Math.min(activeIndex - Math.floor(MAX_HISTORY_ENTRIES / 2), all.length - MAX_HISTORY_ENTRIES)
      );
      let entries = all.slice(start, start + MAX_HISTORY_ENTRIES);
      let index = Math.max(0, Math.min(activeIndex - start, entries.length - 1));
      // roopie:// の内部ページは専用のpreloadを持つタブでしか動かない。復元先のタブのpreloadは
      // 「今いるページ」のURLで決まるので、外部ページのタブの履歴に内部ページが混ざっていると、
      // 戻ったときに何も動かないスタート画面が出てしまう。その分は捨てる
      if (!isInternalUrl(entries[index]?.url)) {
        const kept = entries.filter((e) => !isInternalUrl(e.url));
        if (kept.length !== entries.length) {
          index = kept.indexOf(entries[index]);
          entries = kept;
          if (index < 0) index = kept.length - 1;
        }
      }
      // pageState(スクロール位置やフォームの入力状態)はページによっては極端に大きくなる。
      // 膨らみすぎたら、今見ているページのぶんだけ残して他は捨てる(URLと履歴の並びは保つ)
      if (JSON.stringify(entries).length > MAX_HISTORY_BYTES) {
        return {
          index,
          entries: entries.map((e, i) => (i === index ? e : { url: e.url, title: e.title })),
        };
      }
      return { index, entries };
    } catch {
      return tab.hibernatedHistory ?? null;
    }
  }

  // 画面分割中の役割。相方と向き・比率も一緒に持たせて、この配列だけで分割を組み直せるようにする
  tabSplitRole(tab) {
    if (this.splitTabId == null) return undefined;
    const isMain = tab.id === this.activeTabId;
    const isPartner = tab.id === this.splitTabId;
    if (!isMain && !isPartner) return undefined;
    return {
      role: isMain ? 'main' : 'partner',
      direction: this.splitDirection,
      ratio: this.splitRatio,
    };
  }

  // 現在開いているタブのURL・タイトル・favicon・アクティブなタブ・戻る/進むの履歴・
  // ズーム・ミュート・画面分割を記録する(プロファイル切り替え前や、ウィンドウを閉じるときに呼ぶ。
  // タイトル/faviconは休止中タブの仮表示に使う)
  snapshotTabs() {
    return {
      // 休止中(まだ読み込んでいない)タブは getURL()/getTitle() が空なので、
      // 控えてある hibernatedUrl / hibernatedTitle で補う(補わないと復元のたびに消えてしまう)
      tabs: this.tabs.map((tab) => {
        const wc = tab.view.webContents;
        const destroyed = wc.isDestroyed();
        const group = tab.groupId != null ? this.getGroup(tab.groupId) : null;
        return {
          url: this.tabUrl(tab) ?? '',
          title: (destroyed ? '' : wc.getTitle()) || tab.hibernatedTitle || '',
          favicon: tab.favicon,
          active: tab.id === this.activeTabId,
          // グループ・戻る/進むの履歴・分割は各タブに丸ごと持たせる(この配列だけで復元できる
          // ようにするため。呼び出し側は tabs 配列しか受け渡ししていない)
          group: group ? { key: group.id, name: group.name, color: group.color } : undefined,
          history: this.tabHistory(tab),
          zoom: destroyed ? tab.restoredZoom ?? 0 : wc.getZoomLevel(),
          muted: destroyed ? !!tab.restoredMuted : wc.isAudioMuted(),
          split: this.tabSplitRole(tab),
        };
      }),
    };
  }

  // snapshotTabs() で記録した構成を再現する(URLからの再読み込みで復元する)。
  // ここだけは hibernate: true(=そもそも読み込まない)を使う。復元は数十タブになりうるので、
  // 起動と同時に全部読み込ませると重く、通信も食うため(Chrome/Edgeも復元タブは遅延読み込み)。
  // タイトル/faviconは記録済みの実データをそのまま仮表示に使うので、読み込まなくても見た目が揃う
  restoreTabs(entries) {
    let activeId = null;
    let splitMain = null; // 画面分割の主ペイン(向き・比率も持つ)
    let splitPartnerId = null;
    // 記録側のグループキー -> 復元後のグループ。同じキーのタブは同じグループへ入れる
    const restoredGroups = new Map();
    for (const entry of entries ?? []) {
      if (!entry?.url) continue;
      let groupId = null;
      if (entry.group?.key != null) {
        if (!restoredGroups.has(entry.group.key)) {
          const group = {
            id: this.nextGroupId++,
            name: entry.group.name || '新しいグループ',
            color: GROUP_COLORS.includes(entry.group.color)
              ? entry.group.color
              : nextGroupColor(this.groups.map((g) => g.color)),
          };
          this.groups.push(group);
          restoredGroups.set(entry.group.key, group);
        }
        groupId = restoredGroups.get(entry.group.key).id;
      }
      const tab = this.createTab(entry.url, {
        background: !entry.active,
        hibernate: true,
        initialTitle: entry.title,
        initialFavicon: entry.favicon,
        groupId,
        history: entry.history,
        zoom: entry.zoom,
        muted: entry.muted,
      });
      if (entry.active) activeId = tab.id;
      if (entry.split?.role === 'main') splitMain = { tabId: tab.id, ...entry.split };
      if (entry.split?.role === 'partner') splitPartnerId = tab.id;
    }
    this.pruneEmptyGroups();
    if (activeId) this.switchTab(activeId);
    // 記録にアクティブなタブが無かった場合の保険(何も選ばれていないウィンドウを作らない)
    else if (this.activeTabId === null && this.tabs.length) this.switchTab(this.tabs[0].id);

    // 画面分割は両方そろっているときだけ組み直す(相方だけ残っていても意味がない)。
    // splitWith() は「今アクティブなタブと並べる」なので使わず、状態を直に組む
    if (splitMain && splitPartnerId != null && splitMain.tabId !== splitPartnerId) {
      // 相方のペインは画面に出るので、休止のままにはできない(空のペインになる)。
      // splitTabId を立てる**前**に一度アクティブにして読み込ませる
      // (立てた後だと switchTab の「分割相手を選んだら分割を解除する」に引っかかる)
      this.switchTab(splitPartnerId);
      this.switchTab(splitMain.tabId);
      this.splitTabId = splitPartnerId;
      this.splitDirection = splitMain.direction === 'column' ? 'column' : 'row';
      const ratio = Number(splitMain.ratio);
      this.splitRatio = Number.isFinite(ratio) ? Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio)) : 0.5;
      this.ensureSplitDivider();
      this.updateVisibility();
      this.layout();
      this.sendState();
    }
  }

  setChromeHeight(height) {
    if (!Number.isFinite(height) || height === this.chromeHeight) return;
    this.chromeHeight = height;
    this.layout();
  }

  // タブバーを左側(縦)表示にしたときの左オフセット(0なら通常の上部表示)
  setChromeLeft(left) {
    if (!Number.isFinite(left) || left === this.chromeLeft) return;
    this.chromeLeft = left;
    this.layout();
  }

  // サイドパネルを表示する側を切り替える('left' | 'right')
  setSidePanelSide(side) {
    const next = side === 'left' ? 'left' : 'right';
    if (next === this.sidePanelSide) return;
    this.sidePanelSide = next;
    this.layout();
  }

  setSearchEngine(engineId) {
    this.searchEngine = engineId || DEFAULT_ENGINE;
  }

  // 全画面表示のときは余白なし(ページを画面いっぱいに出す)
  get margin() {
    return this.window.isFullScreen() ? 0 : CONTENT_MARGIN;
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    // ページ側の全画面(YouTube等の全画面ボタン)の間は、ページだけをウィンドウ一杯に広げる。
    // 余白・角丸・ツールバー・タブバー・サイドパネルの領域をすべて0にすれば同じ経路で描ける
    const fs = this.htmlFullscreenTabId != null;
    // OS全画面(F11)中も同様にタブバー/ツールバーを隠すが、マウスが上端に近づいている間だけは出す
    const hideChrome = fs || (this.window.isFullScreen() && !this.fullscreenChromeRevealed);
    const m = fs ? 0 : this.margin;
    const radius = fs ? 0 : m ? CONTENT_RADIUS : 0;
    const chromeLeft = hideChrome ? 0 : this.chromeLeft;
    const chromeHeight = hideChrome ? 0 : this.chromeHeight;

    // ページ・サイドパネルを載せる領域(周囲に余白を残す。縦タブ時は左側にも余白を空ける)
    const areaX = m + chromeLeft;
    const areaY = chromeHeight;
    const areaWidth = Math.max(0, width - m * 2 - chromeLeft);
    const areaHeight = Math.max(0, height - chromeHeight - m);

    const panelWidth = fs ? 0 : this.sidePanel?.widthFor(areaWidth) ?? 0;
    // パネルがあるときは、ページとの間にも余白を入れて2枚のカードに見せる
    const gap = panelWidth ? m : 0;
    const pageAreaWidth = Math.max(0, areaWidth - panelWidth - gap);
    const panelOnLeft = this.sidePanelSide === 'left';
    // パネルを左に置く場合はページ領域をその分右へ押し出す
    const pageX = panelOnLeft ? areaX + panelWidth + gap : areaX;
    const panelX = panelOnLeft ? areaX : areaX + areaWidth - panelWidth;

    const activeView = this.getTab(this.activeTabId)?.view;
    // 全画面中は分割を一時的にたたむ(たたまないと動画が画面の半分にしか広がらず、
    // 隣に無関係なタブと仕切り線が残ったままになる)。全画面を抜ければ元の分割に戻る
    const splitView = this.splitTabId && !fs ? this.getTab(this.splitTabId)?.view : null;
    let dividerBounds = null; // 仕切りを置く位置(分割中のみ)

    // 表示していないタブにもページ領域と同じ大きさを与えておく。
    // 大きさが 0x0 のままだと、裏で開いたタブ(ホイールクリック等)が幅0のビューポートで
    // 読み込まれ、読み込み時に一度だけ寸法を測るサイトがモバイル表示や崩れたままになる
    for (const tab of this.tabs) {
      if (tab.view === activeView || tab.view === splitView) continue;
      tab.view.setBounds({ x: pageX, y: areaY, width: pageAreaWidth, height: areaHeight });
    }

    if (activeView) {
      if (splitView) {
        // 2ペインの間にも余白を入れて、それぞれ独立したカードに見せる。
        // splitRatio(主ペインの割合)で分割位置が変わる(ペイン間リサイズ)
        if (this.splitDirection === 'column') {
          const axis = Math.max(0, areaHeight - m); // gap控除後の2ペイン合計高さ
          this._splitAxis = axis;
          const paneHeight = Math.round(axis * this.splitRatio);
          activeView.setBounds({ x: pageX, y: areaY, width: pageAreaWidth, height: paneHeight });
          splitView.setBounds({
            x: pageX,
            y: areaY + paneHeight + m,
            width: pageAreaWidth,
            height: Math.max(0, axis - paneHeight),
          });
          // 仕切りは隙間(m)の中央に、ヒット領域ぶんの幅で重ねる
          dividerBounds = {
            x: pageX,
            y: Math.round(areaY + paneHeight + m / 2 - SPLIT_DIVIDER_HIT / 2),
            width: pageAreaWidth,
            height: SPLIT_DIVIDER_HIT,
          };
        } else {
          const axis = Math.max(0, pageAreaWidth - m); // gap控除後の2ペイン合計幅
          this._splitAxis = axis;
          const paneWidth = Math.round(axis * this.splitRatio);
          activeView.setBounds({ x: pageX, y: areaY, width: paneWidth, height: areaHeight });
          splitView.setBounds({
            x: pageX + paneWidth + m,
            y: areaY,
            width: Math.max(0, axis - paneWidth),
            height: areaHeight,
          });
          dividerBounds = {
            x: Math.round(pageX + paneWidth + m / 2 - SPLIT_DIVIDER_HIT / 2),
            y: areaY,
            width: SPLIT_DIVIDER_HIT,
            height: areaHeight,
          };
        }
        splitView.setBorderRadius(radius);
      } else {
        activeView.setBounds({ x: pageX, y: areaY, width: pageAreaWidth, height: areaHeight });
      }
      activeView.setBorderRadius(radius);
    }

    // ペイン間の仕切り: 分割中だけ用意して隙間に重ねる。方向をViewへ伝える
    if (dividerBounds) {
      this.ensureSplitDivider();
      this.splitDivider.setVisible(true);
      this.splitDivider.setBounds(dividerBounds);
      this.splitDivider.webContents.send('split:divider', { direction: this.splitDirection });
    } else {
      this.splitDivider?.setVisible(false);
    }

    // オーバーレイ(メニュー)は余白も含めた全域を覆う(外側クリックで閉じるため)。
    // 縦タブ時はタブバー部分を除く(そこは常設のHTML UIなので覆う必要がない)
    this.overlay?.setBounds({
      x: this.chromeLeft,
      y: this.chromeHeight,
      width: Math.max(0, width - this.chromeLeft),
      height: Math.max(0, height - this.chromeHeight),
    });

    this.sidePanel?.layout(
      {
        x: panelX,
        y: areaY,
        width: panelWidth,
        height: areaHeight,
      },
      radius
    );

    // ミニプレイヤーはページ全体の領域を基準に置く(分割の影響は受けない)。
    // サイドパネルが開いている側の隅は、パネルとの間にも余白を空ける
    this.mediaPlayer?.layout({ x: areaX, y: areaY, width: areaWidth, height: areaHeight }, radius, {
      left: panelWidth && panelOnLeft ? panelWidth + m : 0,
      right: panelWidth && !panelOnLeft ? panelWidth + m : 0,
    });
    this.timerPanel?.layout({ x: areaX, y: areaY, width: areaWidth, height: areaHeight }, radius, {
      left: panelWidth && panelOnLeft ? panelWidth + m : 0,
      right: panelWidth && !panelOnLeft ? panelWidth + m : 0,
    });
  }

  // 内部ページ(履歴・ダウンロード等)を開いているタブへ通知を送る
  broadcastToInternal(channel, payload) {
    for (const tab of this.tabs) {
      if (tab.isInternal && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send(channel, payload);
      }
    }
  }

  getTab(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  activeWebContents() {
    return this.getTab(this.activeTabId)?.view.webContents || null;
  }

  // タブの状態をUI(レンダラー)へ送信
  sendState() {
    if (this.window.isDestroyed()) return;
    const state = {
      activeTabId: this.activeTabId,
      splitTabId: this.splitTabId,
      splitDirection: this.splitDirection,
      windowId: this.window.id,
      tabs: this.tabs.map((t) => {
        const wc = t.view.webContents;
        const url = wc.getURL();
        const isBookmarked = !t.isInternal && !!this.bookmarks.find(url);
        // 案内の抑制はフォルダの中(スタート画面のショートカット等)も含めて判定する
        const savedAnywhere = isBookmarked || (!t.isInternal && this.bookmarks.existsAnywhere(url));
        return {
          id: t.id,
          // 拡張機能システム(electron-chrome-extensions)から見たタブID。
          // ツールバーの <browser-action-list> に「このウィンドウの今のタブ」を教えるのに使う
          wcId: wc.id,
          title: wc.getTitle() || t.hibernatedTitle || (t.hibernated ? hostnameOf(t.hibernatedUrl) : '新しいタブ'),
          // 新しいタブページではアドレスバーを空にする(Chromeと同じ挙動)
          url: isNewTabUrl(url) ? '' : url,
          favicon: t.favicon,
          isInternal: t.isInternal,
          isLoading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          isBookmarked,
          // ブックマークすれば当然消える(did-navigateを待たずにここで打ち消す)
          bookmarkHint: !!t.bookmarkHint && !savedAnywhere,
          zoomLevel: wc.getZoomLevel(),
          isAudible: !!t.isAudible,
          isMuted: wc.isAudioMuted(),
          groupId: t.groupId ?? null,
          // 翻訳(アドレスバーの翻訳アイコン用)。訳していないタブは null
          translate: pageTranslate.stateFor(t),
          canTranslate: pageTranslate.canTranslate(t),
        };
      }),
      // タブグループ(1段目のチップ。中身は tabs[].groupId から引く)
      groups: this.groups.map((g) => ({ ...g })),
    };
    this.window.webContents.send('tabs:state', state);
  }
}

function isInternalUrl(url) {
  return typeof url === 'string' && url.startsWith(INTERNAL_SCHEME);
}

// 「戻る/進む」の履歴ごとページを開き直す(Chromiumの NavigationEntry をそのまま流し込む)。
// URLだけで開き直すと戻れないタブになるので、履歴が残っているときは必ずこちらを使う
function restoreNavigationHistory(wc, history, fallbackUrl) {
  const entries = history.entries;
  const index = Math.min(Math.max(0, history.index ?? entries.length - 1), entries.length - 1);
  try {
    wc.navigationHistory.restore({ index, entries });
  } catch (err) {
    console.error('履歴の復元に失敗:', err);
    wc.loadURL(entries[index]?.url || fallbackUrl || NEW_TAB_URL);
  }
}

// 未読み込み(休止中)のタブに出す仮のタイトル。読み込めば実際のタイトルに置き換わる
function hostnameOf(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

// roopie:// はstandardスキームのため、読み込み後は末尾に "/" が付く
function isNewTabUrl(url) {
  return url === NEW_TAB_URL || url === `${NEW_TAB_URL}/`;
}

// 入力文字列をURLに変換(URLでなければ設定した検索エンジンで検索するURLにする)
function toUrl(input, engineId) {
  const text = String(input).trim();
  if (/^(https?|file|roopie|about):/i.test(text)) return text;
  // スペースを含まず、ドットかlocalhostを含むならURLとみなす
  if (!/\s/.test(text) && (/\./.test(text) || /^localhost(:\d+)?/.test(text))) {
    return `https://${text}`;
  }
  return searchUrl(engineId, text);
}

module.exports = TabManager;
module.exports.NEW_TAB_URL = NEW_TAB_URL;
module.exports.applyPermissionPolicy = applyPermissionPolicy;
