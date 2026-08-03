// 裏で開いたタブの「読み込むけれど再生は始めさせない」仕組み(レンダラー側)。
// プロファイルのセッション全体(session.registerPreloadScript)に登録される。
//
// 一時停止(鳴ってから止める)ではなく、**再生が始まる経路そのものを塞ぐ**のが目的:
//   1. HTMLMediaElement.prototype.play() を NotAllowedError で拒否する
//      (Chromeが自動再生を止めたときと同じ例外なので、サイト側は「大きな再生ボタン」を
//       出すなど想定済みの経路に落ちる)
//   2. autoplay 属性/プロパティを外す(<video autoplay> は play() を呼ばずに鳴り出すため)
// このpreloadは分離ワールドで動くのでページの prototype には触れない。
// webFrame.executeJavaScript でメインワールドへ入れる(ページのスクリプトより先に動く)。
//
// 解除はメインプロセスから window.__roopieMediaGuard.release() を呼ぶ(src/main/media-guard.js)。
const { ipcRenderer, webFrame } = require('electron');

// 内部ページ・DevToolsは対象外(毎ドキュメントの同期IPCを減らす意味もある)
const SKIP = ['roopie:', 'devtools:', 'chrome-extension:', 'chrome:'];
if (!SKIP.includes(location.protocol) && ipcRenderer.sendSync('media-guard:blocked') === true) {
  webFrame.executeJavaScript(GUARD_SOURCE(), false).catch(() => {});
}

// メインワールドで評価されるソース。ここから外側の変数は見えないので自己完結させる
function GUARD_SOURCE() {
  return `(() => {
  if (window.__roopieMediaGuard) return;
  const proto = HTMLMediaElement.prototype;
  const origPlay = proto.play;
  const autoplayDesc = Object.getOwnPropertyDescriptor(proto, 'autoplay');
  const blockedPlay = new Set(); // play() を拒否した要素
  const wantedAutoplay = new Set(); // autoplay を外した要素
  let active = true;

  proto.play = function () {
    if (!active) return origPlay.apply(this, arguments);
    blockedPlay.add(this);
    // 一度も再生させないので pause() は呼ばない(呼ぶと「鳴ってから止まる」に戻ってしまう)
    return Promise.reject(new DOMException('autoplay blocked in background tab', 'NotAllowedError'));
  };

  // el.autoplay の読み書きは、ページから見た値を保ったまま実際の属性だけ外す
  Object.defineProperty(proto, 'autoplay', {
    configurable: true,
    enumerable: autoplayDesc.enumerable,
    get() {
      return active ? wantedAutoplay.has(this) : autoplayDesc.get.call(this);
    },
    set(value) {
      if (!active) return autoplayDesc.set.call(this, value);
      if (value) wantedAutoplay.add(this);
      else wantedAutoplay.delete(this);
      autoplayDesc.set.call(this, false);
    },
  });

  const strip = (el) => {
    if (!el || !el.hasAttribute || !(el instanceof HTMLMediaElement)) return;
    if (!el.hasAttribute('autoplay')) return;
    wantedAutoplay.add(el);
    el.removeAttribute('autoplay');
  };
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    strip(node);
    if (node.querySelectorAll) for (const el of node.querySelectorAll('video,audio')) strip(el);
  };

  // documentElement はまだ無いことがあるので document 自体を見張る
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') strip(r.target);
      else for (const node of r.addedNodes) scan(node);
    }
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay'] });
  for (const el of document.querySelectorAll('video,audio')) strip(el);

  window.__roopieMediaGuard = {
    // タブが選ばれた時点でメインプロセスから呼ばれる。
    // 塞いでいた分を元に戻し、鳴るはずだったものはここで初めて再生する
    release() {
      if (!active) return;
      active = false;
      observer.disconnect();
      proto.play = origPlay;
      Object.defineProperty(proto, 'autoplay', autoplayDesc);
      const wake = new Set([...wantedAutoplay, ...blockedPlay]);
      for (const el of wantedAutoplay) {
        try { autoplayDesc.set.call(el, true); } catch (e) {}
      }
      wantedAutoplay.clear();
      blockedPlay.clear();
      for (const el of wake) {
        try {
          const p = origPlay.call(el);
          if (p && p.catch) p.catch(() => {});
        } catch (e) {}
      }
    },
  };
})()`;
}
