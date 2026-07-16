// メディア再生状態の監視用preload。
// ページ内の <video>/<audio> を見つけて再生状態・メタデータをメインプロセスへ通知する。
// (フローティング/サイドパネルのミニプレイヤーで使う。ページにAPIは公開しない)
const { ipcRenderer } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  initMediaWatcher();
}

function initMediaWatcher() {
  const tracked = new WeakSet();
  let sendTimer = null;

  // 再生中のものを優先。なければ直近まで再生が進んでいたものを使う
  function pickActiveElement() {
    const elements = [...document.querySelectorAll('video, audio')];
    const playing = elements.filter((el) => !el.paused && !el.ended && el.readyState > 0);
    if (playing.length) return playing[playing.length - 1];
    const withProgress = elements.filter((el) => el.currentTime > 0);
    return withProgress[withProgress.length - 1] ?? null;
  }

  function metadataFor(el) {
    const ms = navigator.mediaSession?.metadata;
    const artwork = ms?.artwork?.[ms.artwork.length - 1]?.src ?? null;
    return {
      title: ms?.title || document.title || location.hostname,
      artist: ms?.artist || location.hostname,
      artwork,
      hasVideo: el.tagName === 'VIDEO',
    };
  }

  function report() {
    const el = pickActiveElement();
    if (!el) {
      ipcRenderer.send('media:state', null);
      return;
    }
    // main worldのwrapper(tab-manager.jsのMEDIA_HOOK)が data-roopie-media に
    // 登録済みのアクションを書き出す。next/prevボタンの表示可否に使う
    const actions = (document.documentElement.dataset.roopieMedia || '').split(',');
    ipcRenderer.send('media:state', {
      ...metadataFor(el),
      playing: !el.paused && !el.ended,
      currentTime: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      canNext: actions.includes('nexttrack'),
      canPrev: actions.includes('previoustrack'),
    });
  }

  // timeupdate等の連続イベントをまとめて間引く
  function scheduleReport() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      report();
    }, 200);
  }

  function watch(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    for (const type of ['play', 'pause', 'ended', 'loadedmetadata', 'emptied', 'timeupdate']) {
      el.addEventListener(type, scheduleReport);
    }
  }

  function scan(root) {
    for (const el of root.querySelectorAll?.('video, audio') ?? []) watch(el);
  }

  scan(document);
  // preloadはHTML解析前(document.documentElementが無い段階)で走ることがあるため、
  // documentElementではなくdocument自体を監視対象にする
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('video, audio')) watch(node);
        scan(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });

  window.addEventListener('pagehide', () => ipcRenderer.send('media:state', null));
  scheduleReport();
}
