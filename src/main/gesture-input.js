// マウスジェスチャーの検出。
//
// 検出はページ(レンダラー)ではなくメインプロセスで行う。ページのJSが重くて
// レンダラーのメインスレッドが詰まっていると、preloadのmousedown/mousemoveも
// 同じスレッドに載っているため一緒に止まってしまい、ジェスチャーが効かなくなる。
// webContents の 'input-event' はブラウザプロセス側(=メインプロセス)で観測できるので、
// ページがどれだけ重くてもジェスチャーの検出と実行だけは必ず動く。
// 実測(scripts/test-gesture-blocked.js): 8秒間ページを固めた状態でも、メイン側は
// 右ドラッグの mouseDown / mouseMove 100件超 / mouseUp をすべて受け取れる
// (同じ操作でページ側が受け取れたのは、固まりが解けた後にまとめて届いた26件だけ)。
//
// ページ側でしかできないこと(軌跡の描画・ページ内スクロール・右クリックメニューの抑止)は
// gesture-preload.js が担当する。そちらは重いページでは遅れるが、動作には影響しない。
const { app } = require('electron');
const windows = require('./windows');
const { ACTIONS } = require('./gestures');

const START_DIST = 10; // この距離を右ドラッグしたらジェスチャー開始とみなす(px)
const STEP = 20; // 方向を1つ確定するのに必要な移動量(px)
const MAX_PATTERN = 8;
const TRAIL_STEP = 4; // 軌跡を描き足す最小移動量(px)。細かすぎるIPCを間引く

const ARROWS = { U: '↑', D: '↓', L: '←', R: '→' };
const ACTION_LABELS = new Map(ACTIONS.map((a) => [a.id, a.label]));
// スクロール系はページ内で完結する(メイン側はスクロール位置もビューポートの高さも持たない)
const SCROLL_ACTIONS = new Set(['scrollTop', 'scrollBottom', 'scrollPageUp', 'scrollPageDown']);
// ジェスチャーを動かさないページ(プルダウンメニュー用のオーバーレイと開発者ツール)
const EXCLUDED_URLS = ['roopie://menu', 'devtools://'];

const enabledSessions = new WeakSet();

/**
 * gesture-preload.js と同じ範囲(プロファイルのセッション全体)でジェスチャーを有効にする。
 * そのセッションのWebContents(ウィンドウ本体・タブ・サイドパネル・内部ページ等)すべてが対象。
 */
function enableForSession(session) {
  if (session) enabledSessions.add(session);
}

// 見張りは全WebContentsに付け、対象かどうかは押された時点で判定する。
// セッションの登録(registerPagePreloads)はウィンドウ生成の後に走るため、
// 生成時点で絞り込むとウィンドウ本体を取りこぼす
app.on('web-contents-created', (_e, wc) => attach(wc));

// browser は require の循環の下流にあるため、イベント発生時(=完全ロード後)に遅延requireする
function gesturesFor(wc) {
  const browser = require('./browser');
  const ctx = windows.contextFor(wc);
  return browser.bundleFor(ctx?.profileId ?? browser.profiles?.activeId)?.gestures ?? null;
}

function attach(wc) {
  let tracking = false; // 右ボタンを押している
  let moved = false; // START_DIST を超えて動いた(=ジェスチャー扱い)
  let pattern = '';
  let mappings = null; // 押した時点の割り当て(プロファイル切り替えで差し替わるので毎回引き直す)
  let zoom = 1; // ページズーム(input-eventの座標はズームの影響を受けないため、描画側に合わせて割る)
  let startX = 0, startY = 0, anchorX = 0, anchorY = 0, trailX = 0, trailY = 0;

  const send = (payload) => {
    if (!wc.isDestroyed()) wc.send('gestures:trail', payload);
  };

  const stop = () => {
    if (!tracking) return;
    tracking = false;
    if (moved) send({ type: 'end' });
  };

  wc.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown') {
      // ジェスチャー中に他のボタンを押したらキャンセル(誤爆させない)
      if (input.button !== 'right') {
        stop();
        return;
      }
      if (!enabledSessions.has(wc.session) || isExcluded(wc)) return;
      const gestures = gesturesFor(wc);
      if (!gestures?.data.enabled) return;
      tracking = true;
      moved = false;
      pattern = '';
      mappings = gestures.data.mappings;
      zoom = wc.getZoomFactor() || 1;
      startX = anchorX = trailX = input.x;
      startY = anchorY = trailY = input.y;
      return;
    }

    if (input.type === 'mouseMove') {
      if (!tracking) return;
      // ウィンドウ外でボタンを離した等でmouseUpを取り逃した場合はキャンセル
      if (Array.isArray(input.modifiers) && !input.modifiers.includes('rightbuttondown')) {
        stop();
        return;
      }
      if (!moved) {
        if (Math.hypot(input.x - startX, input.y - startY) < START_DIST) return;
        moved = true;
        send({ type: 'start', x: startX / zoom, y: startY / zoom });
      }
      // 軌跡は少し間引いて送る(重いページでは描画が遅れて溜まるだけなので)
      if (Math.hypot(input.x - trailX, input.y - trailY) >= TRAIL_STEP) {
        trailX = input.x;
        trailY = input.y;
        send({ type: 'move', x: input.x / zoom, y: input.y / zoom });
      }

      const dx = input.x - anchorX;
      const dy = input.y - anchorY;
      if (Math.hypot(dx, dy) < STEP) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
      if (pattern[pattern.length - 1] !== dir && pattern.length < MAX_PATTERN) {
        pattern += dir;
        send({ type: 'label', text: labelFor(pattern, mappings) });
      }
      anchorX = input.x;
      anchorY = input.y;
      return;
    }

    if (input.type === 'mouseUp' && input.button === 'right') {
      if (!tracking) return;
      const done = moved && pattern;
      stop();
      if (!done) return;
      const action = mappings[pattern];
      if (!action) return;
      // ページ内で完結するものはページ側で、それ以外はメイン側で実行する
      if (SCROLL_ACTIONS.has(action)) send({ type: 'scroll', action });
      else require('./browser').performGesture?.(wc, action);
    }
  });

  // ウィンドウを切り替えられた場合など、mouseUpが来ないまま終わる経路の保険
  wc.on('blur', stop);
}

function isExcluded(wc) {
  const url = wc.getURL();
  return EXCLUDED_URLS.some((prefix) => url.startsWith(prefix));
}

// 軌跡と一緒に出すラベル(例: 「↓ → タブを閉じる」)。
// アクション名の解決はメイン側で済ませるので、ページ側は設定を持たなくてよい
function labelFor(pattern, mappings) {
  const arrows = [...pattern].map((d) => ARROWS[d]).join(' ');
  const name = ACTION_LABELS.get(mappings[pattern]);
  return name ? `${arrows}  ${name}` : arrows;
}

module.exports = { enableForSession };
