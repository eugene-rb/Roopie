// hitomi.la 固有の広告枠とポップアンダー。汎用の cosmetic filters は
// YouTube と衝突するため、このサイトだけ document_start で処理する。
const { ipcRenderer, webFrame } = require('electron');

if (location.protocol === 'https:' || location.protocol === 'http:') {
  const host = location.hostname;
  if (host === 'hitomi.la' || host.endsWith('.hitomi.la')) {
    let active = ipcRenderer.sendSync('adblock:hitomi-enabled') === true;
    webFrame.executeJavaScript(`(${install.toString()})(${active})`, false).catch(() => {});
    ipcRenderer.on('adblock:hitomi-state', (_event, enabled) => {
      active = enabled === true;
      webFrame.executeJavaScript(`window.__roopieHitomiAdblock?.setEnabled(${active})`, false).catch(() => {});
    });
  }
}

function install(initiallyEnabled) {
  if (window.__roopieHitomiAdblock) {
    window.__roopieHitomiAdblock.setEnabled(initiallyEnabled);
    return;
  }
  const style = document.createElement('style');
  style.textContent = `
    .Qnuv8an0, .Jjctjvn, .yahUrQK, .JoUksu,
    .bottom-content,
    div:has(> script[data-cfasync="false"][src*="/code.js"]) { display: none !important; }
  `;
  const originalOpen = window.open;
  const blockedOpen = function () { return null; };
  let enabled = false;
  const attachStyle = () => {
    if (enabled && !style.isConnected) document.documentElement?.appendChild(style);
  };
  document.addEventListener('DOMContentLoaded', attachStyle, { once: true });
  window.__roopieHitomiAdblock = {
    setEnabled(value) {
      enabled = value === true;
      if (enabled) {
        attachStyle();
        window.open = blockedOpen;
      } else {
        style.remove();
        if (window.open === blockedOpen) window.open = originalOpen;
      }
    },
  };
  window.__roopieHitomiAdblock.setEnabled(initiallyEnabled);
}
