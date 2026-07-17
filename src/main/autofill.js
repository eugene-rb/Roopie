const crypto = require('crypto');
const { safeStorage } = require('electron');

// カード番号のブランド判定(表示用)
function detectBrand(number) {
  if (/^4/.test(number)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/.test(number)) return 'Mastercard';
  if (/^3[47]/.test(number)) return 'American Express';
  if (/^(352[89]|35[3-8])/.test(number)) return 'JCB';
  if (/^(6011|65|64[4-9])/.test(number)) return 'Discover';
  if (/^(30[0-5]|36|38)/.test(number)) return 'Diners Club';
  return 'カード';
}

// Luhnチェック(保存時の入力ミス検出用。失敗しても保存は許す)
function luhnValid(number) {
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const ADDRESS_FIELDS = [
  'familyName',
  'givenName',
  'familyKana',
  'givenKana',
  'org',
  'postal',
  'region',
  'city',
  'street',
  'building',
  'tel',
  'email',
];

/**
 * 自動入力データ(住所・個人情報/クレジットカード)の管理。
 * 住所は平文でJSONに保存(Chromeと同じくローカル保存)。
 * カード番号だけは safeStorage で暗号化し、表示用に下4桁とブランドを平文で持つ。
 * CVC(セキュリティコード)は保存しない(Chromeの既定と同じ)。
 */
class Autofill {
  constructor(store) {
    this.store = store;
    this.normalize();
  }

  setStore(store) {
    this.store?.flush();
    this.store = store;
    this.normalize();
  }

  normalize() {
    const d = this.store.data;
    if (!Array.isArray(d.addresses)) d.addresses = [];
    if (!Array.isArray(d.cards)) d.cards = [];
  }

  static available() {
    return safeStorage.isEncryptionAvailable();
  }

  // ---- 住所・個人情報 ----

  listAddresses() {
    return this.store.data.addresses;
  }

  saveAddress(patch) {
    if (!patch || typeof patch !== 'object') return null;
    const clean = {};
    for (const key of ADDRESS_FIELDS) {
      clean[key] = String(patch[key] ?? '').trim().slice(0, 200);
    }
    // 全項目空は保存しない
    if (!Object.values(clean).some(Boolean)) return null;

    const existing = this.store.data.addresses.find((a) => a.id === patch.id);
    if (existing) {
      Object.assign(existing, clean, { updatedAt: Date.now() });
      this.store.save();
      return existing;
    }
    const item = { id: crypto.randomUUID(), ...clean, createdAt: Date.now(), updatedAt: Date.now() };
    this.store.data.addresses.push(item);
    this.store.save();
    return item;
  }

  removeAddress(id) {
    const list = this.store.data.addresses;
    const index = list.findIndex((a) => a.id === id);
    if (index === -1) return;
    list.splice(index, 1);
    this.store.save();
  }

  // ---- クレジットカード ----

  // 一覧は常にマスク済み(番号は返さない)
  listCards() {
    return this.store.data.cards.map((c) => ({
      id: c.id,
      holder: c.holder,
      last4: c.last4,
      brand: c.brand,
      expMonth: c.expMonth,
      expYear: c.expYear,
      luhnOk: c.luhnOk,
    }));
  }

  // number は追加時必須、編集時は省略可(省略なら既存の番号を保持)
  saveCard({ id, holder, number, expMonth, expYear } = {}) {
    if (!Autofill.available()) return null;
    const cleanHolder = String(holder ?? '').trim().slice(0, 100);
    const cleanNumber = String(number ?? '').replace(/[\s-]/g, '');
    const month = Math.min(12, Math.max(0, Number(expMonth) || 0));
    const year = Math.min(2100, Math.max(0, Number(expYear) || 0));

    const existing = this.store.data.cards.find((c) => c.id === id);
    if (cleanNumber && !/^\d{12,19}$/.test(cleanNumber)) return null;
    if (!existing && !cleanNumber) return null;

    if (existing) {
      existing.holder = cleanHolder;
      existing.expMonth = month;
      existing.expYear = year;
      if (cleanNumber) {
        existing.encrypted = safeStorage.encryptString(cleanNumber).toString('base64');
        existing.last4 = cleanNumber.slice(-4);
        existing.brand = detectBrand(cleanNumber);
        existing.luhnOk = luhnValid(cleanNumber);
      }
      existing.updatedAt = Date.now();
      this.store.save();
      return existing.id;
    }

    const item = {
      id: crypto.randomUUID(),
      holder: cleanHolder,
      encrypted: safeStorage.encryptString(cleanNumber).toString('base64'),
      last4: cleanNumber.slice(-4),
      brand: detectBrand(cleanNumber),
      luhnOk: luhnValid(cleanNumber),
      expMonth: month,
      expYear: year,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.data.cards.push(item);
    this.store.save();
    return item.id;
  }

  // 自動入力の実行時だけ復号して返す(ドロップダウンでユーザーが選択した時)
  cardFill(id) {
    const card = this.store.data.cards.find((c) => c.id === id);
    if (!card) return null;
    try {
      return {
        number: safeStorage.decryptString(Buffer.from(card.encrypted, 'base64')),
        holder: card.holder,
        expMonth: card.expMonth,
        expYear: card.expYear,
      };
    } catch {
      // 別マシン/OSユーザーのデータは復号できない
      return null;
    }
  }

  removeCard(id) {
    const list = this.store.data.cards;
    const index = list.findIndex((c) => c.id === id);
    if (index === -1) return;
    list.splice(index, 1);
    this.store.save();
  }
}

module.exports = Autofill;
