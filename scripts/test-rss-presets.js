// スタート画面ニュースのRSSプリセットの検証(再利用可能)。
// 実行: npx electron scripts/test-rss-presets.js
// アプリと同じ取得経路(widgets.js の fetchRss)で各プリセットを取り、
// newtab.js の parseFeed と同じセレクタでDOMParserにかけて記事が取れるか確認する。
// プリセットを増やす・URLが変わったときはこれを流す。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'roopie-rss-')));

const { fetchRss } = require('../src/main/widgets');

// src/renderer/pages/newtab.js の NEWS_PRESETS から実際の定義を読む(二重管理を避ける)
function loadPresets() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pages', 'newtab.js'), 'utf8');
  const block = /const NEWS_PRESETS = \[([\s\S]*?)\];/.exec(source);
  if (!block) throw new Error('NEWS_PRESETS が見つかりません');
  return [...block[1].matchAll(/\{\s*label:\s*'([^']+)',\s*url:\s*'([^']+)'\s*\}/g)].map((m) => ({
    label: m[1],
    url: m[2],
  }));
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ` => ${detail}`}`);
  if (!ok) failed++;
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const presets = loadPresets();
    console.log(`プリセット ${presets.length}件\n`);
    // parseFeed と同じDOMParserで解釈するためのレンダラー
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('about:blank');

    for (const preset of presets) {
      const xml = await fetchRss(preset.url);
      if (!xml) {
        check(preset.label, false, '取得できず(null)');
        continue;
      }
      // newtab.js の parseFeed と同じ抽出(RSS 2.0 の item / Atom の entry)
      const parsed = await win.webContents.executeJavaScript(
        `(() => {
          const doc = new DOMParser().parseFromString(${JSON.stringify(xml)}, 'text/xml');
          if (doc.querySelector('parsererror')) return { error: 'XMLとして解釈できない' };
          const source = doc.querySelector('channel > title, feed > title')?.textContent?.trim() ?? '';
          const items = [...doc.querySelectorAll('item')];
          const entries = items.length ? items : [...doc.querySelectorAll('entry')];
          const first = entries[0];
          return {
            source,
            count: entries.length,
            title: first?.querySelector('title')?.textContent?.trim() ?? '',
            link: first?.querySelector('link')?.textContent?.trim() || first?.querySelector('link')?.getAttribute('href') || '',
          };
        })()`,
        true
      );
      if (parsed.error) {
        check(preset.label, false, parsed.error);
        continue;
      }
      check(
        preset.label,
        parsed.count > 0 && !!parsed.title,
        `記事${parsed.count}件 title='${parsed.title}'`
      );
      console.log(`     ${parsed.count}件 / ${parsed.source || '(フィード名なし)'} / 先頭: ${parsed.title.slice(0, 40)}`);
      if (!parsed.link) console.log('     ⚠ 先頭記事のリンクが空');
    }
    win.destroy();
  } catch (err) {
    console.log('NG  例外:', err.stack || err.message);
    failed++;
  }
  console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
  app.exit(failed ? 1 : 0);
});
