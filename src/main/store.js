const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const SAVE_DELAY = 300;

/**
 * userData配下のJSONファイルにデータを永続化する簡易ストア。
 * 書き込みはデバウンスし、終了時に flush() で確実に保存する。
 */
class Store {
  constructor(filename, defaultValue) {
    this.file = path.join(app.getPath('userData'), filename);
    this.data = defaultValue;
    this.timer = null;
    this.load();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // 初回起動(ファイルなし)や破損時は既定値のまま使う
    }
  }

  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error(`保存に失敗しました: ${this.file}`, err.message);
    }
  }
}

module.exports = Store;
