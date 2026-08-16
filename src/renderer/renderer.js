const $ = (id) => document.getElementById(id);

const chromeEl = $('chrome');
const tabsEl = $('tabs');
const bookmarkBarEl = $('bookmark-bar');
const bookmarkHintEl = $('bookmark-hint');
const addressBar = $('address-bar');
const starBtn = $('star-btn');
const backBtn = $('back-btn');
const forwardBtn = $('forward-btn');
const reloadBtn = $('reload-btn');
const homeBtn = $('home-btn');
const zoomLabel = $('zoom-label');
const downloadsBtn = $('downloads-btn');
const findBar = $('find-bar');
const findInput = $('find-input');
const findCount = $('find-count');

let tabState = { tabs: [], activeTabId: null };
let bookmarks = [];
let mediaList = []; // タブバーの再生ボタン用(どのタブが再生/一時停止中か)

// 再生中は1秒おきに再生状態が届くが、タブバーが使うのは「どのタブが再生中か」だけ。
// 再生位置しか変わっていない更新で再描画すると、タブのエフェクトのアニメーションが
// 毎秒作り直されてちらつくため、タブバーに関係する部分が変わったときだけ描き直す
let mediaTabsKey = '';

window.roopie.onMediaState((next) => {
  mediaList = next || [];
  const key = mediaList.map((m) => `${m.tabId}:${m.playing ? 1 : 0}`).join(',');
  if (key === mediaTabsKey) return;
  mediaTabsKey = key;
  renderTabs();
});

// 音声エフェクトのアニメーション位相。タブ要素は再描画のたびに作り直されるため、
// 共通の時計から求めた負のanimation-delayを与えて、作り直しても続きから見えるようにする
// (各アニメーションの長さは60秒を割り切れる値にしてある)
function audioEffectDelay() {
  return `-${(((performance.now() / 1000) % 60)).toFixed(3)}s`;
}

// ---- タブの見た目のエフェクト ----
// 「アクティブ」「メディア再生中」「タブグループ」の3系統。設定は独立していて、
// 条件に当てはまるぶんだけ .tab-fx を重ねる(CSSはこの要素だけを見る)。
// グループのエフェクトだけは**グループそのもの(1段目のチップ)**に出す。中身のタブは
// グループに入っていても普通のタブと同じ見た目にし、所属はチップと2段目の地の色で示す。
// グループの色は設定が空ならそのグループ自身の色に従う(グループごとに違って見える)
let tabEffectSettings = {
  active: { effect: 'none', color: '', color2: '' },
  audio: { effect: 'breathe', color: '', color2: '' },
  group: { effect: 'underline', color: '', color2: '' },
};

function createTabFx(kind, effect, color, color2, fallbackColor) {
  const fx = document.createElement('span');
  fx.className = 'tab-fx';
  fx.dataset.kind = kind;
  fx.dataset.effect = effect;
  fx.style.setProperty('--fx-1', color || fallbackColor);
  fx.style.setProperty('--fx-2', color2 || 'color-mix(in srgb, var(--fx-1) 45%, #ffffff)');
  return fx;
}

function applyTabEffects(tabEl, tab) {
  const layers = [];
  // 重ねる順(先=下)。アクティブ、その上に再生中
  if (tab.id === tabState.activeTabId && tabEffectSettings.active.effect !== 'none') {
    const { effect, color, color2 } = tabEffectSettings.active;
    layers.push(createTabFx('active', effect, color, color2, 'var(--accent)'));
  }
  if (tab.isAudible && !tab.isMuted && tabEffectSettings.audio.effect !== 'none') {
    const { effect, color, color2 } = tabEffectSettings.audio;
    layers.push(createTabFx('audio', effect, color, color2, 'var(--accent)'));
  }
  attachTabFx(tabEl, layers);
}

// グループのエフェクトはチップ(グループそのもの)に出す。色の既定はそのグループ自身の色
function applyGroupChipEffects(chipEl) {
  const { effect, color, color2 } = tabEffectSettings.group;
  if (effect === 'none') return;
  // チップには data-color からグループ色(--group-color)が入っている
  attachTabFx(chipEl, [createTabFx('group', effect, color, color2, 'var(--group-color, var(--group-grey))')]);
}

function attachTabFx(el, layers) {
  if (!layers.length) return;
  // アニメーションの位相は3系統で共通(タブ/チップ側に置いて .tab-fx から参照する)
  el.style.setProperty('--fx-delay', audioEffectDelay());
  // ニャンキャットは中身の配置も変える(どの系統で選ばれていても効くように印を付ける)
  if (layers.some((fx) => fx.dataset.effect === 'nyan')) el.classList.add('fx-nyan');
  for (const layer of layers) el.appendChild(layer);
}

// ---- タブ ----
window.roopie.onTabsState((state) => {
  tabState = state;
  renderTabs();
  renderToolbar();
  syncExtensionActionsTab();
});

let scrolledActiveTabId = null; // 最後に「見える位置へ寄せた」タブ
// 前回の描画時に並んでいたタブID。ここに無いIDが現れたら「新しく開いたタブ」= 見える位置へ送る
let knownTabIds = new Set();

// ---- ✕の連打対策 ----
// タブが縮んでいる状態で1枚閉じると残りが少しずつ広がり、✕がカーソルの下から逃げる。
// 閉じた瞬間の幅で固定し、1秒間ひとつも閉じられなかったら解放して本来の幅に戻す。
// 固定は閉じたタブが並んでいる段(1段目 or 2段目)だけに掛ける。
// 縦タブは1枚閉じても幅が変わらない(高さも固定)ので何もしない
let tabWidthLockTimer = null;
let lockedContainer = null;

function unlockTabWidths() {
  if (!lockedContainer) return;
  lockedContainer.classList.remove('width-locked');
  lockedContainer.style.removeProperty('--tab-lock-w');
  lockedContainer = null;
}

function lockTabWidths(sampleTabEl) {
  if (isVerticalTabs()) return;
  const container = sampleTabEl.parentElement; // #tabs か #group-tabs
  const width = sampleTabEl.getBoundingClientRect().width;
  if (container && width) {
    if (lockedContainer && lockedContainer !== container) unlockTabWidths();
    container.style.setProperty('--tab-lock-w', `${width}px`);
    container.classList.add('width-locked');
    lockedContainer = container;
  }
  clearTimeout(tabWidthLockTimer);
  tabWidthLockTimer = setTimeout(unlockTabWidths, 1000);
}

// ---- タブグループ(二段タブバー) ----
// 1段目(#tabs)はグループに入っていないタブと、グループ1つにつき1枚のチップ。
// 2段目(#group-row)は「選択中のタブが属するグループ」の中身。グループ外のタブを
// 選んでいる間は2段目を出さない。縦タブでは2段目の代わりにレールの中で折りたたみ表示する。
const groupRowEl = $('group-row');
const groupTabsEl = $('group-tabs');
let renamingGroupId = null; // インライン改名中のグループ
let renamingDraft = ''; // 改名中の入力内容(再描画をまたいで保つ)
let renamingCaret = null; // 同じくカーソル位置([開始, 終了]。null=開いた直後で全選択)
// 再描画で入力欄ごと作り直す間だけ立てる。この間の blur は「編集をやめた」ではないので確定しない
// (タブの読み込み・メディア状態・設定の変更でも renderTabs は走るため、
//  これが無いと入力中に勝手に確定してしまう)
let rebuildingTabs = false;

function groupsOf() {
  return tabState.groups ?? [];
}

function activeGroupId() {
  return tabState.tabs.find((t) => t.id === tabState.activeTabId)?.groupId ?? null;
}

function tabsOfGroup(groupId) {
  return tabState.tabs.filter((t) => t.groupId === groupId);
}

function startGroupRename(groupId) {
  renamingGroupId = groupId;
  renamingDraft = groupsOf().find((g) => g.id === groupId)?.name ?? '';
  renamingCaret = null; // 開いた直後は全選択(そのまま打てば置き換わる)
  renderTabs();
}

function commitGroupRename(save) {
  if (renamingGroupId == null) return;
  const groupId = renamingGroupId;
  const name = renamingDraft;
  renamingGroupId = null;
  renamingDraft = '';
  renamingCaret = null;
  if (save && name.trim()) window.roopie.renameTabGroup(groupId, name.trim());
  else renderTabs();
}

window.roopie.onTabGroupRenameRequest((groupId) => startGroupRename(groupId));

// linked=このグループの中身が2段目に出ている(チップの下端を2段目とつなげる)
function createGroupChip(group, linked = false) {
  const el = document.createElement('div');
  const isActive = group.id === activeGroupId();
  el.className = 'tab-group-chip' + (isActive ? ' active' : '') + (linked ? ' linked' : '');
  el.dataset.groupId = String(group.id);
  el.dataset.color = group.color;
  el.title = group.name;

  const dot = document.createElement('span');
  dot.className = 'group-dot';
  el.appendChild(dot);

  if (group.id === renamingGroupId) {
    const input = document.createElement('input');
    input.className = 'group-name-input';
    input.value = renamingDraft;
    const remember = () => {
      renamingDraft = input.value;
      renamingCaret = [input.selectionStart, input.selectionEnd];
    };
    input.addEventListener('input', remember);
    input.addEventListener('keyup', remember); // 文字を打たないカーソル移動も覚える
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commitGroupRename(true);
      else if (e.key === 'Escape') commitGroupRename(false);
    });
    input.addEventListener('blur', () => {
      if (rebuildingTabs) return; // 再描画で作り直しているだけ(編集は続いている)
      commitGroupRename(true);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(input);
    // 描画が終わってからフォーカスする(この要素はまだ文書に入っていない)。
    // 再描画をまたいだときは元のカーソル位置に戻す(全選択し直すと次の1文字で全部消える)
    requestAnimationFrame(() => {
      if (renamingGroupId !== group.id || !input.isConnected) return;
      input.focus();
      if (renamingCaret) input.setSelectionRange(renamingCaret[0], renamingCaret[1]);
      else input.select();
    });
  } else {
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;
    el.appendChild(name);
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(tabsOfGroup(group.id).length);
    el.appendChild(count);
  }

  // 見た目のエフェクト(タブグループの系統はここに出る)
  applyGroupChipEffects(el);

  el.addEventListener('click', () => window.roopie.selectTabGroup(group.id));
  el.addEventListener('dblclick', () => startGroupRename(group.id));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.roopie.tabGroupContextMenu(group.id);
  });
  return el;
}

function renderTabs() {
  // FLIP: 再描画前の位置を覚えておき、並び替えなどで動いたタブを滑らかにスライドさせる
  const prevRects = new Map();
  for (const el of [...tabsEl.children, ...groupTabsEl.children]) {
    if (el.dataset.id) prevRects.set(el.dataset.id, el.getBoundingClientRect());
  }
  // 作り直しの間に飛ぶ blur を「編集をやめた」と誤解しないようにする(改名の入力欄)
  rebuildingTabs = true;
  tabsEl.textContent = '';
  groupTabsEl.textContent = '';

  const groups = groupsOf();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const currentGroupId = activeGroupId();
  const vertical = isVerticalTabs();
  // 2段目を出すのは「グループの中のタブを選んでいる」ときだけ(縦タブでは段を使わない)
  const showGroupRow = !vertical && currentGroupId != null && groupById.has(currentGroupId);
  groupRowEl.classList.toggle('hidden', !showGroupRow);
  groupRowEl.dataset.color = groupById.get(currentGroupId)?.color ?? '';
  const emittedGroups = new Set();

  for (const [index, tab] of tabState.tabs.entries()) {
    const groupId = tab.groupId ?? null;
    if (groupId != null && groupById.has(groupId)) {
      // グループの中身は1段目に出さない。最初のメンバーの位置にチップを1枚だけ置く
      if (!emittedGroups.has(groupId)) {
        emittedGroups.add(groupId);
        tabsEl.appendChild(createGroupChip(groupById.get(groupId), showGroupRow && groupId === currentGroupId));
        // 縦タブは2段目が無いので、選択中のグループだけレールの中で展開する
        if (vertical && groupId === currentGroupId) {
          for (const member of tabsOfGroup(groupId)) {
            const memberEl = createTabEl(member, tabState.tabs.indexOf(member), true);
            memberEl.dataset.color = groupById.get(groupId).color; // 左端の色帯に使う
            tabsEl.appendChild(memberEl);
          }
        }
      }
      if (showGroupRow && groupId === currentGroupId) {
        groupTabsEl.appendChild(createTabEl(tab, index));
      }
      continue;
    }
    tabsEl.appendChild(createTabEl(tab, index));
  }

  rebuildingTabs = false;
  finishRenderTabs(prevRects);
}

// タブ1枚ぶんの要素。inGroupList=縦タブでグループの中身として字下げして出すもの
function createTabEl(tab, index, inGroupList = false) {
  {
    const tabEl = document.createElement('div');
    tabEl.className =
      'tab' + (tab.id === tabState.activeTabId ? ' active' : '') + (inGroupList ? ' in-group-list' : '');
    tabEl.title = tab.title;
    tabEl.draggable = true;
    tabEl.dataset.id = String(tab.id);
    tabEl.dataset.index = String(index);
    // 画面分割中は、並んでいる2枚のタブに同じ強調表示を付けてペアだと分かるようにする
    if (tabState.splitTabId && (tab.id === tabState.activeTabId || tab.id === tabState.splitTabId)) {
      tabEl.classList.add('split');
    }
    // 音を鳴らしているタブ(ミュート中は鳴っていないので付けない)
    if (tab.isAudible && !tab.isMuted) tabEl.classList.add('audible');
    // 見た目のエフェクト(アクティブ/メディア再生中/タブグループの3系統を重ねる)
    applyTabEffects(tabEl, tab);
    attachTabDrag(tabEl, tab);
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.roopie.tabContextMenu(tab.id);
    });

    if (tab.isLoading) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      tabEl.appendChild(spinner);
    } else if (tab.favicon) {
      const icon = document.createElement('img');
      icon.className = 'favicon';
      icon.src = tab.favicon;
      tabEl.appendChild(icon);
    } else {
      // faviconがないタブは頭文字で代替
      const letter = document.createElement('span');
      letter.className = 'favicon-letter';
      letter.textContent = (tab.title[0] || '·').toUpperCase();
      tabEl.appendChild(letter);
    }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    tabEl.appendChild(title);

    const mediaEntry = mediaList.find((m) => m.tabId === tab.id);
    if (mediaEntry) {
      const playBtn = document.createElement('button');
      playBtn.className = 'play-btn';
      playBtn.title = mediaEntry.playing ? 'クリックで一時停止' : 'クリックで再生';
      playBtn.innerHTML = mediaEntry.playing
        ? '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopie.mediaToggle(tab.id);
      });
      tabEl.appendChild(playBtn);
    }

    if (tab.isAudible || tab.isMuted) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'audio-btn' + (tab.isMuted ? ' muted' : '');
      audioBtn.title = tab.isMuted ? 'ミュート中(クリックで解除)' : 'クリックでミュート';
      audioBtn.innerHTML = tab.isMuted
        ? '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
        : '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.roopie.toggleMuteTab(tab.id);
      });
      tabEl.appendChild(audioBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'タブを閉じる (Ctrl+W)';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      lockTabWidths(tabEl);
      window.roopie.closeTab(tab.id);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => window.roopie.switchTab(tab.id));
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.roopie.closeTab(tab.id); // 中クリックで閉じる
    });

    return tabEl;
  }
}

// 描画後の共通処理(ドラッグ中の見た目の維持・自動スクロール・FLIP)
function finishRenderTabs(prevRects) {
  // ドラッグ中に再描画が走った場合(読み込み状態の変化など)でも、畳み表示と挿入プレビューを維持する
  if (draggingId !== null) {
    for (const el of allTabEls()) {
      if (el.dataset.id === String(draggingId)) el.classList.add('dragging', 'drag-collapsed');
    }
    if (dropSlot._index !== null) showDropSlot(dropSlot._index);
  }

  // タブが増えてタブバーがスクロールしているとき、選び直したタブは見える位置へ寄せる。
  // 「アクティブが変わったとき」だけに限る = 毎回やると、
  // 別のタブを探して手でスクロールしている最中に引き戻してしまう
  if (tabState.activeTabId !== scrolledActiveTabId) {
    scrolledActiveTabId = tabState.activeTabId;
    for (const el of allTabEls()) {
      if (el.dataset.id === String(tabState.activeTabId)) ensureTabVisible(el);
    }
  }

  // 新しく増えたタブ(裏で開いたものも)は、その1枚が見える位置までスクロールする。
  // 最初の描画とセッション復元(一度に何枚も増える)は動かさない
  const ids = new Set(tabState.tabs.map((t) => String(t.id)));
  const fresh = [...ids].filter((id) => !knownTabIds.has(id));
  if (knownTabIds.size && fresh.length === 1) {
    const el = allTabEls().find((e) => e.dataset.id === fresh[0]);
    if (el) ensureTabVisible(el, true);
  }
  knownTabIds = ids;

  updateTabOverflow();

  for (const el of [...tabsEl.children, ...groupTabsEl.children]) {
    // ドロップ直後のタブはスロットのあった位置にそのまま現れる(FLIPで滑らせない)
    if (el.dataset.id === justDroppedId) continue;
    const prev = prevRects.get(el.dataset.id);
    if (!prev) continue;
    const rect = el.getBoundingClientRect();
    const dx = prev.left - rect.left;
    const dy = prev.top - rect.top;
    if (dx || dy) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
    }
  }
  justDroppedId = null;
}

function allTabEls() {
  return [...tabsEl.querySelectorAll('.tab'), ...groupTabsEl.querySelectorAll('.tab')];
}

// ---- タブバーのスクロール(はみ出しの見せ方) ----
//
// タブが増えるとタブバーは横(縦タブでは縦)にスクロールする。ここでは
//   ① あふれている側の端をフェードさせて「続きがある」と分からせる
//   ② アクティブなタブは端に張り付かせて隠れないようにする(CSSのsticky)
//   ③ 選び直したタブ・新しく増えたタブを見える位置まで送る
// を扱う。①②の判定にはタブの**本来の位置**が要るので、張り付きを一時的に解いて測る。

// 段の中でのタブの位置(スクロール座標系。張り付きの影響を除いた本来の位置)
function rawTabBounds(container, el, vertical) {
  container.classList.add('measure-raw');
  const containerRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  container.classList.remove('measure-raw');
  const start = vertical
    ? rect.top - containerRect.top + container.scrollTop
    : rect.left - containerRect.left + container.scrollLeft;
  return { start, end: start + (vertical ? rect.height : rect.width) };
}

// その段(1段目 / 2段目)の見え方をまとめて返す
function tabScrollInfo(container) {
  const vertical = isVerticalTabs() && container === tabsEl;
  const view = vertical ? container.clientHeight : container.clientWidth;
  const total = vertical ? container.scrollHeight : container.scrollWidth;
  const pos = vertical ? container.scrollTop : container.scrollLeft;
  const overflowing = total - view > 1;
  const active = container.querySelector(':scope > .tab.active, :scope > .tab-group-chip.active');
  let pinned = false;
  if (overflowing && active) {
    const { start, end } = rawTabBounds(container, active, vertical);
    // 本来の位置が見えている範囲から外れている = 端に張り付いて表示されている
    pinned = start < pos - 1 || end > pos + view + 1;
  }
  return {
    vertical,
    view,
    total,
    pos,
    overflowing,
    active,
    pinned,
    atStart: pos <= 1,
    atEnd: pos + view >= total - 1,
  };
}

function updateTabOverflow() {
  for (const container of [tabsEl, groupTabsEl]) {
    const info = tabScrollInfo(container);
    // 張り付いているタブがある側は透かさない(張り付いたタブ自身が薄くなってしまう)
    const pinnedStart = info.pinned && !info.atStart;
    const pinnedEnd = info.pinned && !info.atEnd;
    container.classList.toggle('fade-start', info.overflowing && !info.atStart && !pinnedStart);
    container.classList.toggle('fade-end', info.overflowing && !info.atEnd && !pinnedEnd);
    for (const el of container.children) el.classList.remove('pinned');
    if (info.pinned) info.active.classList.add('pinned');
    // 送りボタンは1段目(横タブ)だけ。フェードは薄くなるだけで気づきにくいので、
    // 「押せば続きが見られる」ことを矢印でも示す。
    // **あふれている間はボタンの場所を空けたままにする**(hidden=場所ごと消す /
    // off=場所は残して見せない)。押せる側が変わるたびにタブの幅が変わると、
    // 直前に「ここまで送る」と決めた位置がずれて端のタブが少し隠れてしまう
    if (container === tabsEl) {
      for (const btn of [tabsScrollLeftBtn, tabsScrollRightBtn]) {
        btn.classList.toggle('hidden', !info.overflowing);
      }
      tabsScrollLeftBtn.classList.toggle('off', info.atStart);
      tabsScrollRightBtn.classList.toggle('off', info.atEnd);
    }
  }
}

// 送りボタン: 1画面ぶんに近い量を送る(端まで行けばそのボタンは消える)
const tabsScrollLeftBtn = $('tabs-scroll-left');
const tabsScrollRightBtn = $('tabs-scroll-right');
function scrollTabsBy(direction) {
  const step = Math.max(120, Math.round(tabsEl.clientWidth * 0.8)) * direction;
  tabsEl.scrollBy({ left: step, behavior: 'smooth' });
}
tabsScrollLeftBtn.addEventListener('click', () => scrollTabsBy(-1));
tabsScrollRightBtn.addEventListener('click', () => scrollTabsBy(1));

// そのタブが見える位置までスクロールする(足りない分だけ動かす)。
// scrollIntoView は使わない: 張り付いているタブは「見えている」と判定されて動かないため
function ensureTabVisible(el, smooth = false) {
  const container = el.parentElement;
  if (container !== tabsEl && container !== groupTabsEl) return;
  const info = tabScrollInfo(container);
  const { start, end } = rawTabBounds(container, el, info.vertical);
  // 張り付いているタブの下に隠れないよう、**張り付いている側だけ**1枚ぶん余裕を空ける
  let padStart = 0;
  let padEnd = 0;
  if (info.pinned && info.active && info.active !== el) {
    const active = rawTabBounds(container, info.active, info.vertical);
    const size = active.end - active.start;
    if (active.start < info.pos) padStart = size;
    if (active.end > info.pos + info.view) padEnd = size;
  }
  let next = info.pos;
  if (start - padStart < info.pos) next = Math.max(0, start - padStart);
  else if (end + padEnd > info.pos + info.view) next = end + padEnd - info.view;
  if (Math.abs(next - info.pos) < 1) return;
  const behavior = smooth ? 'smooth' : 'auto';
  container.scrollTo(info.vertical ? { top: next, behavior } : { left: next, behavior });
}

// 手でスクロールしたときもフェードと張り付きの状態を追う
for (const container of [tabsEl, groupTabsEl]) {
  container.addEventListener('scroll', () => updateTabOverflow(), { passive: true });
}
window.addEventListener('resize', () => updateTabOverflow());

// ---- タブのドラッグ(並べ替え & ドロップ挿入検索の共通UX) ----
// 並べ替えでも、ページから選択テキストをドラッグしてきた検索でも、同じ「挿入スロット」を出す。
// スロットは実体のある隙間で、ドラッグ中はカーソル位置にリアルタイムで追従し、タブの間に差し込める。
let draggingId = null;
let justDroppedId = null; // ドロップ直後、確定位置へFLIPで滑らせないタブID(スロット位置にそのまま出す)
let chipJoinEl = null; // ドラッグ中、チップに直接重ねて「このグループへ参加」をハイライトしている要素(null=無し)
let newGroupTargetEl = null; // ドラッグ中、他のタブに重ねて「新しいグループを作る」をハイライトしている要素(null=無し)

const tabBarEl = $('tab-bar');

// 挿入位置プレビュー用のスロット(隙間)。要素は1つを使い回す
const dropSlot = document.createElement('div');
dropSlot.className = 'tab-drop-slot';
dropSlot._index = null; // スロットが差し込まれているタブインデックス(null=非表示)

function isVerticalTabs() {
  return document.body.classList.contains('vertical-tabs');
}

// ---- タブバーのホイールスクロール ----
// 縦タブ(overflow-y)はブラウザ既定の縦スクロールがそのまま効くので何もしない。
// 横タブは overflow-x なので、縦ホイールは既定では効かない。ここで横へ流す。
tabsEl.addEventListener(
  'wheel',
  (e) => {
    if (isVerticalTabs()) return;
    if (tabsEl.scrollWidth <= tabsEl.clientWidth) return; // あふれていなければ素通し
    // 横方向の指定があればそちらを優先(トラックパッドの横スワイプ)
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!raw) return;
    // deltaMode: 0=px, 1=行, 2=ページ。行/ページ指定のマウスでも同じ距離感になるよう換算する
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? tabsEl.clientWidth : 1;
    tabsEl.scrollLeft += raw * scale;
    e.preventDefault();
  },
  { passive: false }
);

// ドラッグ中に狙っている段(1段目=#tabs / 2段目=#group-tabs)。
// スロットの表示も挿入先の計算も、この段の中だけで行う
let dropContainer = tabsEl;

// スロットの基準となる並び。並べ替え中はつまみ上げた自分を除く。
// 1段目にはグループのチップも混ざる(チップの前後には落とせる=グループの外側へ入る)
function slotTargets(container = dropContainer) {
  return [...container.querySelectorAll('.tab, .tab-group-chip')].filter(
    (el) => el.dataset.id !== String(draggingId)
  );
}

// カーソル位置から、その段の中での挿入先(0..件数)を求める。縦タブ時はY座標で判定
function computeSlotIndex(e, container = dropContainer) {
  // 2段目は横に並ぶ(縦タブのときは2段目そのものを使わない)
  const vertical = isVerticalTabs() && container === tabsEl;
  const pos = vertical ? e.clientY : e.clientX;
  const tabs = slotTargets(container);
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    const mid = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
    if (pos < mid) return i;
  }
  return tabs.length;
}

// 段の中での挿入位置を、メインプロセスが扱う「タブ全体の並びでの位置」に直す。
// 1段目にはグループのチップが混ざり、2段目はグループの中身だけなので、
// 見えている位置をそのまま渡すとまったく別の場所に入ってしまう
function flatDropIndex(slotIndex, container = dropContainer) {
  const remaining = tabState.tabs.filter((t) => String(t.id) !== String(draggingId));
  const flatIndexOfTab = (id) => remaining.findIndex((t) => t.id === id);
  const target = slotTargets(container)[slotIndex];
  if (target) {
    if (target.dataset.groupId) {
      // グループのチップ = そのグループの先頭タブの位置
      const groupId = Number(target.dataset.groupId);
      const first = remaining.find((t) => t.groupId === groupId);
      return first ? flatIndexOfTab(first.id) : remaining.length;
    }
    return Math.max(0, flatIndexOfTab(Number(target.dataset.id)));
  }
  // 末尾に落とした場合。2段目ならそのグループの最後のタブの次
  if (container === groupTabsEl) {
    const groupId = activeGroupId();
    const members = remaining.filter((t) => t.groupId === groupId);
    if (members.length) return flatIndexOfTab(members[members.length - 1].id) + 1;
  }
  return remaining.length;
}

function showDropSlot(index, container = dropContainer) {
  if (dropSlot._index === index && dropSlot._container === container && dropSlot.isConnected) return;
  dropSlot._index = index;
  dropSlot._container = container;
  container.insertBefore(dropSlot, slotTargets(container)[index] || null);
  // 挿入直後に .open を付けてwidth/heightのtransitionで隙間を開く
  requestAnimationFrame(() => dropSlot.classList.add('open'));
}

function hideDropSlot() {
  dropSlot._index = null;
  dropSlot.classList.remove('open');
  dropSlot.remove();
}

// 1段目でチップそのものに重ねている間だけ、隙間への挿入プレビューの代わりにチップを光らせる
// (=「隣に置く」ではなく「このグループに入れる」だと分かるように)
function setChipJoin(el) {
  if (chipJoinEl === el) return;
  clearChipJoin();
  chipJoinEl = el;
  el?.classList.add('drag-over-chip');
}

function clearChipJoin() {
  chipJoinEl?.classList.remove('drag-over-chip');
  chipJoinEl = null;
}

// タブ本体の中央付近に重ねている間は、隙間への挿入の代わりに「このタブと新しいグループを作る」を光らせる。
// 左右の端はこれまで通り並べ替えの挿入判定に譲る(そうしないと普通の並べ替えができなくなる)
const NEW_GROUP_ZONE = 0.3; // 端からこの割合の範囲は並べ替え、残りの中央部分がグループ作成の対象

function newGroupZoneHit(el, e) {
  const r = el.getBoundingClientRect();
  const vertical = isVerticalTabs();
  const size = vertical ? r.height : r.width;
  const pos = vertical ? e.clientY - r.top : e.clientX - r.left;
  const margin = size * NEW_GROUP_ZONE;
  return pos > margin && pos < size - margin;
}

function setNewGroupTarget(el) {
  if (newGroupTargetEl === el) return;
  clearNewGroupTarget();
  newGroupTargetEl = el;
  el?.classList.add('drag-over-newgroup');
}

function clearNewGroupTarget() {
  newGroupTargetEl?.classList.remove('drag-over-newgroup');
  newGroupTargetEl = null;
}

// ---- ドラッグ中、端に寄せたときの自動スクロール ----
// タブバーがスクロールしていると、画面外のタブの間へは落とせない。カーソルを端に寄せている間だけ
// 少しずつ流す。dragoverは静止すると飛んでこないので、最後のカーソル位置を覚えてrAFで回す
const EDGE_ZONE = 56; // 端から何pxで効き始めるか
const EDGE_MAX_SPEED = 16; // 1フレームあたりの最大スクロール量(端に寄せるほど速い)
const edgePointer = { x: 0, y: 0 };
let edgeScrollRaf = null;

function edgeScrollStep() {
  edgeScrollRaf = requestAnimationFrame(edgeScrollStep);
  const el = dropContainer;
  const vertical = isVerticalTabs() && el === tabsEl;
  const room = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (room <= 0) return;
  const rect = el.getBoundingClientRect();
  const pos = vertical ? edgePointer.y : edgePointer.x;
  const from = vertical ? rect.top : rect.left;
  const to = vertical ? rect.bottom : rect.right;
  // 端に近いほど速く。手前側は負、奥側は正
  let speed = 0;
  if (pos < from + EDGE_ZONE) speed = -EDGE_MAX_SPEED * Math.min(1, (from + EDGE_ZONE - pos) / EDGE_ZONE);
  else if (pos > to - EDGE_ZONE) speed = EDGE_MAX_SPEED * Math.min(1, (pos - (to - EDGE_ZONE)) / EDGE_ZONE);
  if (!speed) return;
  const before = vertical ? el.scrollTop : el.scrollLeft;
  if (vertical) el.scrollTop = before + speed;
  else el.scrollLeft = before + speed;
  const moved = (vertical ? el.scrollTop : el.scrollLeft) !== before;
  // 流れた分だけタブがカーソルの下を通るので、挿入位置のプレビューも追従させる
  if (moved) showDropSlot(computeSlotIndex({ clientX: edgePointer.x, clientY: edgePointer.y }));
}

function startEdgeScroll(e) {
  edgePointer.x = e.clientX;
  edgePointer.y = e.clientY;
  if (edgeScrollRaf === null) edgeScrollRaf = requestAnimationFrame(edgeScrollStep);
}

function stopEdgeScroll() {
  if (edgeScrollRaf !== null) cancelAnimationFrame(edgeScrollRaf);
  edgeScrollRaf = null;
}

function cleanupDrag() {
  stopEdgeScroll();
  hideDropSlot();
  clearChipJoin();
  clearNewGroupTarget();
  tabBarEl.classList.remove('drag-search', 'dnd-armed');
  groupRowEl.classList.remove('drag-over');
  for (const el of document.querySelectorAll('.tab.dragging, .tab.drag-collapsed')) {
    el.classList.remove('dragging', 'drag-collapsed');
  }
  draggingId = null;
  dropContainer = tabsEl;
}

function attachTabDrag(tabEl, tab) {
  tabEl.addEventListener('dragstart', (e) => {
    draggingId = tab.id;
    e.dataTransfer.effectAllowed = 'move';
    // FirefoxやChromiumでdragを成立させるにはデータが必要。
    // ページ領域のドロップゾーン(オーバーレイ)はこのIDを読んで分割対象を決める
    e.dataTransfer.setData('text/plain', String(tab.id));
    // 別ウィンドウのタブバーへドロップされたとき、どのウィンドウのどのタブかを伝える
    // (draggingId はレンダラーごとのローカル変数のため、ウィンドウをまたぐと相手側からは見えない)
    e.dataTransfer.setData('application/x-roopie-tab', JSON.stringify({ tabId: tab.id, windowId: tabState.windowId }));
    // つまみ上げたタブは畳んで隙間を消す。ドラッグ画像を撮り終える次フレームで畳む
    requestAnimationFrame(() => tabEl.classList.add('dragging', 'drag-collapsed'));
    // ページ領域にドロップゾーンを出す(分割 or 切り離しの受け皿)
    window.roopie.tabDragStart(tab.id);
  });

  tabEl.addEventListener('dragend', (e) => {
    // 分割 or 切り離しの確定はメイン側が行う(ページ領域のドロップゾーンからの分割と競合しないよう、
    // メインで少し遅延させて判定する)。ドロップ位置はメイン側がカーソル位置を取り直して使うので、
    // ここからは「タブバー内の並べ替えとして処理済みか」だけを渡す
    // (dragendのclientX/Yは素早いドラッグやウィンドウ外へのドロップだと実際の位置とずれる)
    const reordered = e.dataTransfer.dropEffect === 'move';
    cleanupDrag();
    window.roopie.tabDragEnd(tab.id, { reordered });
  });
}

// タブバー全体でドラッグを受ける。並べ替え(自タブ)=move、ページからの選択テキスト=copy。
// どちらも同じスロットで挿入先をプレビューし、既存タブの間に差し込める
function dragMode(e) {
  if (draggingId !== null) return 'reorder';
  // 自分のIDが無いのに専用MIMEがある = 別ウィンドウから来たタブそのもの
  if ([...e.dataTransfer.types].includes('application/x-roopie-tab')) return 'foreign-tab';
  if ([...e.dataTransfer.types].includes('text/plain')) return 'search';
  return null;
}

// タブバーの空き領域はウィンドウ移動用のドラッグ領域(-webkit-app-region: drag)なので、
// そのままだとその上でドロップイベントを一切拾えない(並べ替え・検索とも末尾への挿入が死ぬ)。
// ドラッグセッション中だけno-dragへ切り替える。タブバー自身のdragoverを待つと空き領域へ直接
// 進入したケースに間に合わないため、ページ側から上がってくる途中(ツールバー等)で先に検知する
document.addEventListener('dragover', (e) => {
  if ([...e.dataTransfer.types].includes('text/plain')) {
    tabBarEl.classList.add('dnd-armed');
  }
});
document.addEventListener('drop', () => {
  tabBarEl.classList.remove('dnd-armed');
  stopEdgeScroll();
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) {
    tabBarEl.classList.remove('dnd-armed'); // ウィンドウの外へ出た
    stopEdgeScroll();
  }
});

// 1段目(タブバー)と2段目(グループの中身)は同じ受け口を使う。
// どちらの段に落としたかで、そのタブがグループに入る/出るも決まる
function attachDropTarget(barEl, container) {
  barEl.addEventListener('dragover', (e) => {
    const mode = dragMode(e);
    if (!mode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = mode === 'search' ? 'copy' : 'move';
    dropContainer = container;

    // 1段目ではグループのチップも並んでいる。チップ本体の上に直接乗っている間は、
    // 隙間への挿入(=隣に置く)ではなく「このグループへ参加」の合図に切り替える
    const chipEl = mode !== 'search' && container === tabsEl ? e.target.closest('.tab-group-chip') : null;
    if (chipEl) {
      setChipJoin(chipEl);
      clearNewGroupTarget();
      hideDropSlot();
      barEl.classList.remove('drag-search', 'drag-over');
      startEdgeScroll(e);
      return;
    }
    clearChipJoin();

    // チップが無い1段目で、他のタブの中央付近に重ねている間は「このタブと新しいグループを作る」の合図にする。
    // (グループの中身であるタブへ重ねた場合は対象にしない。縦タブでは展開中のグループの中身が
    //  1段目に混ざって出るため、既存グループに入れる操作と紛れないように除く)
    const tabEl =
      mode !== 'search' && container === tabsEl ? e.target.closest('.tab:not(.in-group-list)') : null;
    const groupCandidate =
      tabEl && tabEl.dataset.id !== String(draggingId) && newGroupZoneHit(tabEl, e) ? tabEl : null;
    if (groupCandidate) {
      setNewGroupTarget(groupCandidate);
      hideDropSlot();
      barEl.classList.remove('drag-search', 'drag-over');
      startEdgeScroll(e);
      return;
    }
    clearNewGroupTarget();

    // 検索ドロップのときはバー全体もハイライトして「ここに落とせる」と分かるようにする
    barEl.classList.toggle(container === groupTabsEl ? 'drag-over' : 'drag-search', mode === 'search');
    showDropSlot(computeSlotIndex(e, container), container);
    startEdgeScroll(e); // 端に寄せている間はタブバーを流す
  });

  barEl.addEventListener('dragleave', (e) => {
    // 子要素間の移動でも発火するため、バーの外へ出た時だけ片付ける
    if (e.relatedTarget && barEl.contains(e.relatedTarget)) return;
    stopEdgeScroll();
    hideDropSlot();
    clearChipJoin();
    clearNewGroupTarget();
    barEl.classList.remove('drag-search', 'drag-over');
  });

  barEl.addEventListener('drop', (e) => {
    const mode = dragMode(e);
    if (!mode) return;
    e.preventDefault();

    // チップへの参加はスロット挿入と別処理(グループ側でメンバーを自動的に整列させるので、
    // 挿入位置の計算は不要でそのまま所属を付け替えるだけでよい)
    if (chipJoinEl) {
      const targetGroupId = Number(chipJoinEl.dataset.groupId);
      clearChipJoin();
      if (mode === 'reorder') {
        window.roopie.assignTabGroup(draggingId, targetGroupId);
      } else if (mode === 'foreign-tab') {
        const { tabId, windowId } = JSON.parse(e.dataTransfer.getData('application/x-roopie-tab'));
        // 最終的な位置はgatherGroup任せ(移動直後の一瞬だけ、チップの手前に来るようにしておく)
        const firstMember = tabState.tabs.find((t) => t.groupId === targetGroupId);
        const provisionalIndex = firstMember ? tabState.tabs.indexOf(firstMember) : tabState.tabs.length;
        window.roopie.moveTabFromWindow(windowId, tabId, provisionalIndex);
        window.roopie.assignTabGroup(tabId, targetGroupId);
      }
      barEl.classList.remove('drag-search', 'drag-over');
      return;
    }

    // タブ同士を重ねてのドロップ=新しいグループを2枚で作る(そのまま改名できるよう主側が続ける)
    if (newGroupTargetEl) {
      const targetTabId = Number(newGroupTargetEl.dataset.id);
      clearNewGroupTarget();
      if (mode === 'reorder') {
        window.roopie.createTabGroup([draggingId, targetTabId]);
      } else if (mode === 'foreign-tab') {
        const { tabId, windowId } = JSON.parse(e.dataTransfer.getData('application/x-roopie-tab'));
        const provisionalIndex = tabState.tabs.indexOf(tabState.tabs.find((t) => t.id === targetTabId));
        window.roopie.moveTabFromWindow(windowId, tabId, provisionalIndex < 0 ? tabState.tabs.length : provisionalIndex);
        window.roopie.createTabGroup([tabId, targetTabId]);
      }
      barEl.classList.remove('drag-search', 'drag-over');
      return;
    }

    const slot = dropSlot._index ?? computeSlotIndex(e, container);
    const index = flatDropIndex(slot, container);
    // 2段目に落とした=そのグループへ入れる。1段目に落とした=グループから外す
    // (1段目はグループの中身を出さないので、グループの内側を指す位置が無い)
    const targetGroupId = container === groupTabsEl ? activeGroupId() : null;
    if (mode === 'reorder') {
      // 残りの後始末(dragging解除・draggingId=null)は直後の dragend が行う
      justDroppedId = String(draggingId);
      window.roopie.moveTab(draggingId, index);
      window.roopie.assignTabGroup(draggingId, targetGroupId);
      hideDropSlot();
    } else if (mode === 'foreign-tab') {
      const { tabId, windowId } = JSON.parse(e.dataTransfer.getData('application/x-roopie-tab'));
      window.roopie.moveTabFromWindow(windowId, tabId, index);
      // 別ウィンドウから2段目に落としたときも、同じウィンドウ内の移動と同じくグループへ入れる
      // (プロファイルが違って作り直しになった場合はIDが変わるので何も起きない)
      if (targetGroupId != null) window.roopie.assignTabGroup(tabId, targetGroupId);
      hideDropSlot();
    } else {
      const text = e.dataTransfer.getData('text/plain');
      if (text.trim()) {
        window.roopie.searchInNewTab(text, index);
        // ドロップが受理されたと分かる短いフラッシュ
        barEl.animate(
          [{ boxShadow: 'inset 0 0 0 2px var(--accent)' }, { boxShadow: 'inset 0 0 0 2px transparent' }],
          { duration: 350, easing: 'ease-out' }
        );
      }
      cleanupDrag();
    }
    barEl.classList.remove('drag-search', 'drag-over');
  });
}

attachDropTarget(tabBarEl, tabsEl);
attachDropTarget(groupRowEl, groupTabsEl);

$('group-new-tab-btn').addEventListener('click', () => {
  const groupId = activeGroupId();
  if (groupId != null) window.roopie.newTabInGroup(groupId);
});

function activeTab() {
  return tabState.tabs.find((t) => t.id === tabState.activeTabId) || null;
}

function renderToolbar() {
  const tab = activeTab();
  backBtn.disabled = !tab?.canGoBack;
  forwardBtn.disabled = !tab?.canGoForward;

  starBtn.classList.toggle('bookmarked', !!tab?.isBookmarked);
  starBtn.disabled = !!tab?.isInternal;
  renderBookmarkHint();
  renderTranslateBtn(tab);

  // アドレスバーのアイコン: httpsなら鍵、それ以外は検索
  const isSecure = (tab?.url ?? '').startsWith('https://');
  document.getElementById('icon-lock').classList.toggle('hidden', !isSecure);
  document.getElementById('icon-search').classList.toggle('hidden', isSecure);

  // ズーム率(Chromiumのzoomレベルは1段階=1.2倍)
  const percent = Math.round(1.2 ** (tab?.zoomLevel ?? 0) * 100);
  zoomLabel.textContent = `${percent}%`;

  // 画面分割のコントロール(分割中だけ表示)
  const splitControls = $('split-controls');
  splitControls.classList.toggle('hidden', !tabState.splitTabId);
  $('icon-split-row').classList.toggle('hidden', tabState.splitDirection === 'column');
  $('icon-split-column').classList.toggle('hidden', tabState.splitDirection !== 'column');

  // 入力中はアドレスバーを上書きしない
  if (tab && document.activeElement !== addressBar) {
    addressBar.value = tab.url;
  }
}

// ---- ブックマークバー ----
window.roopie.onBookmarksState((items) => {
  bookmarks = items;
  renderBookmarkBar();
});

// 「Ctrl+D でブックマーク」の案内。前にも来たのにまだ入れていないページでだけ出す
// (メイン側が tab.bookmarkHint で判定し、ページをクリック/スクロールすると引っ込める)
function renderBookmarkHint() {
  bookmarkHintEl.classList.toggle('hidden', !activeTab()?.bookmarkHint);
}

function renderBookmarkBar() {
  // 案内(#bookmark-hint)はバーの中に常駐しているので、ブックマークだけ作り直す
  for (const el of bookmarkBarEl.querySelectorAll('.bookmark')) el.remove();
  for (const bookmark of bookmarks) {
    const el = document.createElement('div');
    el.className = 'bookmark';
    el.title = `${bookmark.title}\n${bookmark.url}`;

    if (bookmark.favicon) {
      const icon = document.createElement('img');
      icon.src = bookmark.favicon;
      el.appendChild(icon);
    }

    const label = document.createElement('span');
    label.textContent = bookmark.title;
    el.appendChild(label);

    el.addEventListener('click', () => window.roopie.navigate(bookmark.url));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.roopie.newTab(bookmark.url, true); // 中クリックで裏に新しいタブ
    });
    bookmarkBarEl.insertBefore(el, bookmarkHintEl);
  }
  reportChromeHeight();
}

// ---- プロファイル(Edgeの「ワークスペース」風ピル。タブバー左端) ----
const workspaceBtn = $('workspace-btn');
const workspaceAvatar = $('workspace-avatar');
const workspaceName = $('workspace-name');

window.roopie.onProfilesState((state) => {
  const active = state.profiles.find((p) => p.id === state.activeId);
  if (!active) return;
  renderAvatar(workspaceAvatar, active);
  workspaceName.textContent = active.name;
  workspaceBtn.style.setProperty('--workspace-color', active.color);
  workspaceBtn.title = `プロファイル: ${active.name}(クリックで切り替え)`;
  // アクティブプロファイルがTorを使っているかを、ピルの🧅インジケーターで示す
  activeProfileTor = !!active.tor;
  updateTorIndicator();
  renderExtensionActions(active.partition);
});

// ---- Torインジケーター(ワークスペースピル内) ----
let activeProfileTor = false;
let torStatus = { status: 'disabled' };
const torIndicator = $('workspace-tor');

function updateTorIndicator() {
  if (!activeProfileTor) {
    torIndicator.classList.add('hidden');
    return;
  }
  torIndicator.classList.remove('hidden');
  torIndicator.classList.toggle('connecting', torStatus.status === 'starting');
  torIndicator.classList.toggle('error', torStatus.status === 'error');
  torIndicator.title =
    torStatus.status === 'ready'
      ? 'Torで接続中'
      : torStatus.status === 'starting'
        ? 'Torに接続しています…'
        : torStatus.status === 'error'
          ? `Torに接続できません: ${torStatus.error ?? ''}`
          : 'Tor(停止中)';
}

window.roopie.onTorStatus((status) => {
  torStatus = status;
  updateTorIndicator();
});

// 拡張機能アイコンをアクティブなプロファイルのセッションに向ける。
// <browser-action-list> はDOM接続時のpartitionでしか更新を購読しないため、
// partitionが変わったら要素ごと作り直す(シークレットでは拡張機能が無効なので出さない)
function renderExtensionActions(partition) {
  const area = $('extensions-area');
  if (isIncognito) {
    area.replaceChildren();
    return;
  }
  if (area.firstElementChild?.getAttribute('partition') === partition) return;
  const list = document.createElement('browser-action-list');
  // idは設定画面の一覧(#extensions-list)と必ず分ける。CSSは1本(app.css)を
  // ブラウザUIと内部ページで共有しているので、同じidだとあちら向けの余白まで当たる
  list.id = 'toolbar-extensions';
  list.setAttribute('alignment', 'top right');
  list.setAttribute('partition', partition);
  area.replaceChildren(list);
  // Edge風: ピン留めした拡張だけツールバーに出す。アイコンはshadowRoot(open)に
  // 非同期で生えるため、追加を監視して都度フィルタを適用する
  new MutationObserver(applyExtensionPinning).observe(list.shadowRoot, { childList: true });
  applyExtensionPinning();
  syncExtensionActionsTab();
}

// このウィンドウのアクティブタブを <browser-action-list> に明示する。
// 指定しないと「最後にフォーカスされたウィンドウのアクティブタブ」が使われるため、
// 複数ウィンドウを開いていると別ウィンドウのタブの状態(アイコン/バッジ)が映ってしまう
function syncExtensionActionsTab() {
  const list = document.getElementById('toolbar-extensions');
  if (!list) return;
  const active = tabState.tabs.find((t) => t.id === tabState.activeTabId);
  if (!Number.isFinite(active?.wcId)) return;
  if (list.getAttribute('tab') === String(active.wcId)) return;
  list.setAttribute('tab', String(active.wcId));
}

// ---- 拡張機能(Edge風: ピン留め+パズルボタンのメニュー) ----
let pinnedExtensions = [];
let extensionsCount = 0;
const extensionsMenuBtn = $('extensions-menu-btn');

// ツールバーの拡張アイコンをピン留め済みだけに絞る(それ以外はパズルメニューから使う)
function applyExtensionPinning() {
  const list = document.getElementById('toolbar-extensions');
  if (!list?.shadowRoot) return;
  for (const node of list.shadowRoot.querySelectorAll('.action')) {
    node.style.display = pinnedExtensions.includes(node.id) ? '' : 'none';
  }
}

// パズルボタンは拡張が1つ以上あるときだけ表示(シークレットでは拡張自体が無効)
function updateExtensionsMenuBtn() {
  extensionsMenuBtn.classList.toggle('hidden', isIncognito || extensionsCount === 0);
}

window.roopie.onExtensionsState((items) => {
  extensionsCount = items?.length ?? 0;
  updateExtensionsMenuBtn();
});

extensionsMenuBtn.addEventListener('click', () => {
  const rect = extensionsMenuBtn.getBoundingClientRect();
  window.roopie.openExtensionsMenu({
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
  });
});

// プロファイルのアイコン(文字/絵文字/画像)を1つの.avatar要素に反映する
function renderAvatar(el, profile) {
  el.textContent = '';
  el.classList.remove('emoji');
  el.style.background = '';
  const icon = profile.icon ?? { type: 'letter' };
  if (icon.type === 'image' && icon.value) {
    const img = document.createElement('img');
    img.src = icon.value;
    img.alt = '';
    el.appendChild(img);
  } else if (icon.type === 'emoji' && icon.value) {
    el.classList.add('emoji');
    el.textContent = icon.value;
  } else {
    el.style.background = profile.color;
    el.textContent = (profile.name[0] || '?').toUpperCase();
  }
}

// プルダウンはページの上に重なるオーバーレイViewに描画するため、
// ボタンの位置(ページ表示領域から見た座標)をメインプロセスへ渡す
workspaceBtn.addEventListener('click', () => {
  const rect = workspaceBtn.getBoundingClientRect();
  window.roopie.openProfileMenu({
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
  });
});

$('settings-btn').addEventListener('click', () => window.roopie.newTab('roopie://settings'));

// QRコード: 現在のページURL・タイトル・ボタン位置をオーバーレイViewへ渡す
$('qr-btn').addEventListener('click', () => {
  const rect = $('qr-btn').getBoundingClientRect();
  const tab = activeTab();
  window.roopie.openQr({
    url: tab?.url ?? '',
    title: tab?.title ?? '',
    anchor: {
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom - chromeEl.offsetHeight),
    },
  });
});

// ---- ダウンロード ----
window.roopie.onDownloadsState((state) => {
  downloadsBtn.classList.toggle('active', state.hasActive);
});

// ---- 設定(ブックマークバーの表示切替・タブバーの位置・サイドパネルの位置) ----
let tabBarPosition = 'top';
let sidePanelPosition = 'right';

// タブの見た目のエフェクト(3系統)。実際の描画は applyTabEffects が .tab-fx を作って行うので、
// ここでは設定を控えるだけ(次の renderTabs から反映される)
function applyAudioTabEffect(settings) {
  tabEffectSettings = {
    active: {
      effect: settings.activeTabEffect || 'none',
      color: settings.activeTabEffectColor || '',
      color2: settings.activeTabEffectColor2 || '',
    },
    audio: {
      effect: settings.audioTabEffect || 'breathe',
      color: settings.audioTabEffectColor || '',
      color2: settings.audioTabEffectColor2 || '',
    },
    group: {
      effect: settings.groupTabEffect || 'underline',
      color: settings.groupTabEffectColor || '',
      color2: settings.groupTabEffectColor2 || '',
    },
  };
  renderTabs();
}

window.roopie.onSettings((settings) => {
  bookmarkBarEl.classList.toggle('hidden', !settings.showBookmarkBar);
  tabBarPosition = settings.tabBarPosition || 'top';
  // 縦横のレイアウト差はCSS(.vertical-tabs と #tab-bar-head)だけで完結する
  document.body.classList.toggle('vertical-tabs', tabBarPosition === 'left');
  $('tab-bar-position-btn').classList.toggle('active', tabBarPosition === 'left');
  sidePanelPosition = settings.sidePanelPosition === 'left' ? 'left' : 'right';
  applySidePanelButtonPosition();
  // タブの最小幅(ここまでしか縮めず、あふれた分は横スクロールで見せる)
  const tabMinWidth = Number(settings.tabMinWidth);
  document.documentElement.style.setProperty(
    '--tab-min-w',
    `${Number.isFinite(tabMinWidth) && tabMinWidth > 0 ? tabMinWidth : 140}px`
  );
  updateTabOverflow(); // 幅が変わればあふれ方も変わる
  applyToolbarItems(settings.toolbarItems);
  applyAudioTabEffect(settings);
  pinnedExtensions = Array.isArray(settings.pinnedExtensions) ? settings.pinnedExtensions : [];
  applyExtensionPinning();
  reportChromeHeight();
});

// ---- ツールバーのユーティリティ項目(表示/非表示・並び替え) ----
// メイン側で正規化済みの配列 [{id, visible}] を受け取り、DOMへ反映する
const TOOLBAR_EL_BY_ID = {
  downloads: 'downloads-btn',
  history: 'history-btn',
  qr: 'qr-btn',
  zoom: 'zoom-controls',
};

function applyToolbarItems(items) {
  if (!Array.isArray(items) || !items.length) return;
  const utility = $('toolbar-utility');
  // 表示/非表示。history-btnはシークレット時に .hidden(!important)で隠れるため、
  // 表示側は display='' に戻して .hidden 側に判断を委ねる
  for (const { id, visible } of items) {
    const el = document.getElementById(TOOLBAR_EL_BY_ID[id]);
    if (el) el.style.display = visible ? '' : 'none';
  }
  // 並び替え: configurable な要素だけを保存順に入れ替える。
  // サイドパネルボタン・分割コントロールなど非対象の要素は現在の位置を保つ
  const queue = items
    .map((it) => document.getElementById(TOOLBAR_EL_BY_ID[it.id]))
    .filter((el) => el && el.parentElement === utility);
  const configurable = new Set(queue);
  const newOrder = [];
  let q = 0;
  for (const child of utility.children) {
    newOrder.push(configurable.has(child) ? queue[q++] : child);
  }
  for (const el of newOrder) utility.appendChild(el);
}

// ユーティリティ群を右クリック → 表示/非表示の切り替えメニュー(ネイティブ)
$('toolbar-utility').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopie.toolbarContextMenu();
});

// ブックマークバーを右クリック → 表示/非表示の切り替えメニュー(ネイティブ)
bookmarkBarEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopie.bookmarkBarContextMenu();
});

$('tab-bar-position-btn').addEventListener('click', () => {
  window.roopie.setSetting('tabBarPosition', tabBarPosition === 'left' ? 'top' : 'left');
});

// on/offボタンは、サイドパネルが実際に開く側(現在の設定)のツールバーの端に置く
function applySidePanelButtonPosition() {
  const toolbar = $('toolbar');
  const btn = $('sidepanel-btn');
  if (sidePanelPosition === 'left') {
    toolbar.insertBefore(btn, toolbar.firstChild);
  } else {
    toolbar.appendChild(btn);
  }
}

// ---- テーマ ----
// カスタムCSSはadoptedStyleSheets経由で適用する(CSPのstyle-srcに妨げられない)
const customSheet = new CSSStyleSheet();

// 直近のテーマ。シークレットかどうかが後から届くので、そのとき当て直せるように持つ
let lastTheme = null;

function applyTheme(theme) {
  if (!theme) return;
  lastTheme = theme;
  document.documentElement.style.setProperty('--accent', theme.accent);
  // ウィンドウの外観(明暗・単色・半透明・グラデーション・liquidglass・パターン)
  const opts = { chrome: true, incognito: isIncognito };
  window.roopieWindowTheme.apply(theme, opts);
  window.__roopieLastWindowTheme = { theme, opts };
  try {
    customSheet.replaceSync(theme.customCss || '');
  } catch {
    // 不正なCSSは無視
  }
  document.adoptedStyleSheets = [customSheet];
}

window.roopie.onThemeState(applyTheme);
window.roopie.getTheme().then(applyTheme);

// ---- 集中モード(ツールバーを隠してページを広く使う) ----
window.roopie.onToggleCompact(() => {
  document.body.classList.toggle('compact');
  reportChromeHeight();
});

// ---- ページ側の全画面(YouTube等の全画面ボタン) ----
// タブバー・ツールバー・ブックマークバーをまとめて隠す。ページの領域はメイン側
// (tab-manager.js の layout)がウィンドウ一杯に広げる
window.roopie.onHtmlFullscreen((on) => {
  document.body.classList.toggle('html-fullscreen', !!on);
  reportChromeHeight();
});

// ---- ウィンドウ種別(シークレットかどうか) ----
let isIncognito = false;
window.roopie.onWindowInfo(({ incognito }) => {
  isIncognito = !!incognito;
  document.body.classList.toggle('incognito', !!incognito);
  // シークレットかどうかはテーマより後に届くことがある。外観を当て直す
  if (lastTheme) applyTheme(lastTheme);
  if (incognito) {
    $('extensions-area').replaceChildren();
    updateExtensionsMenuBtn();
    // シークレットでは履歴・パスワード関連のUIを出さない
    $('history-btn').classList.add('hidden');
    starBtn.title = 'このページをブックマーク (Ctrl+D)';
  }
});

// ---- パスワード保存の確認バー ----
const passwordBar = $('password-bar');
const passwordText = $('password-text');

window.roopie.onPasswordPrompt(({ origin, username, isUpdate }) => {
  const host = origin.replace(/^https?:\/\//, '');
  passwordText.textContent = isUpdate
    ? `${host} の「${username}」のパスワードを更新しますか?`
    : `${host} のパスワードを保存しますか?(${username})`;
  passwordBar.classList.remove('hidden');
  reportChromeHeight();
});

function closePasswordBar() {
  passwordBar.classList.add('hidden');
  reportChromeHeight();
}

$('password-save').addEventListener('click', () => {
  window.roopie.savePassword();
  closePasswordBar();
});
$('password-dismiss').addEventListener('click', () => {
  window.roopie.dismissPassword();
  closePasswordBar();
});
$('password-never').addEventListener('click', () => {
  window.roopie.neverSavePassword();
  closePasswordBar();
});

// ---- サイトの権限の確認(全画面表示。Edge風のドロップダウン) ----
// ポップアップ自体はオーバーレイ(roopie://menu)に描く。タブはネイティブViewなので、
// ここのDOMではページの上に重ねられないため。ツールバー側の仕事は、ぶら下げる先である
// アドレスバーのサイト情報アイコンの位置を測って渡すことだけ
window.roopie.onPermissionPrompt(({ host, items }) => {
  const rect = $('address-icon').getBoundingClientRect();
  window.roopie.openPermissionMenu({
    host,
    items,
    anchor: { left: Math.round(rect.left), right: Math.round(rect.right) },
  });
});

// ---- 翻訳(Edge風) ----
// アドレスバーの翻訳アイコンは、読めない言語のページ(提案中)と翻訳済みのページで出す。
// ドロップダウン本体はオーバーレイに描くので、ここではアンカーの位置を測って渡すだけ。
// 選択テキストの翻訳(右クリック)はページの言語に関係なく開くため、その間だけアイコンを出す
const translateBtn = $('translate-btn');
let translateForced = false;

function renderTranslateBtn(tab) {
  const state = tab?.translate?.state ?? 'none';
  const show = translateForced || (!!tab?.canTranslate && state !== 'none');
  translateBtn.classList.toggle('hidden', !show);
  translateBtn.classList.toggle('active', state === 'done' || state === 'translating');
  translateBtn.classList.toggle('busy', state === 'translating');
  translateBtn.title =
    state === 'done'
      ? 'このページは翻訳されました'
      : state === 'error'
        ? 'このページを翻訳できませんでした'
        : 'このページを翻訳 (Ctrl+Shift+Y)';
}

function openTranslateMenu(mode) {
  // 隠れている間は矩形が0になるので、測る前に出す(ドロップダウンを閉じるまで出したまま)
  translateForced = true;
  translateBtn.classList.remove('hidden');
  const rect = translateBtn.getBoundingClientRect();
  window.roopie.openTranslateMenu({
    mode,
    anchor: { left: Math.round(rect.left), right: Math.round(rect.right) },
  });
}

// メイン発(自動提案 / 選択テキストの翻訳)
window.roopie.onTranslatePrompt(({ mode }) => openTranslateMenu(mode));

translateBtn.addEventListener('click', () => openTranslateMenu('page'));

// ドロップダウンが閉じたらアイコンの表示条件を元に戻す
window.roopie.onOverlayClosed(() => {
  if (!translateForced) return;
  translateForced = false;
  renderTranslateBtn(activeTab());
});

// ---- 既定のブラウザ化のお願い ----
const defaultBrowserBar = $('default-browser-bar');
const defaultBrowserText = $('default-browser-text');
const defaultBrowserSet = $('default-browser-set');
const defaultBrowserDismiss = $('default-browser-dismiss');
let defaultBrowserTimer = null;

window.roopie.onDefaultBrowserPrompt(() => {
  defaultBrowserText.textContent = 'Roopieを既定のブラウザに設定しますか?';
  defaultBrowserSet.classList.remove('hidden');
  defaultBrowserDismiss.classList.remove('hidden');
  defaultBrowserBar.classList.remove('hidden');
  reportChromeHeight();
});

function closeDefaultBrowserBar() {
  clearTimeout(defaultBrowserTimer);
  defaultBrowserBar.classList.add('hidden');
  reportChromeHeight();
}

// 押しても閉じない。Windowsの設定に切り替わるので、戻ってきたときに「何をすればいいか」が残るようにする
defaultBrowserSet.addEventListener('click', () => {
  window.roopie.setAsDefaultBrowser();
  defaultBrowserText.textContent = 'Windowsの設定が開きます。「既定に設定する」を押すと切り替わります';
  defaultBrowserSet.classList.add('hidden');
});
defaultBrowserDismiss.addEventListener('click', () => {
  window.roopie.dismissDefaultBrowserPrompt();
  closeDefaultBrowserBar();
});

// 設定アプリから戻ってきて既定になっていたら、そのまま知らせて自分で消える
window.roopie.onDefaultBrowserState(({ isDefault }) => {
  if (!isDefault || defaultBrowserBar.classList.contains('hidden')) return;
  defaultBrowserText.textContent = 'Roopieが既定のブラウザになりました';
  defaultBrowserSet.classList.add('hidden');
  defaultBrowserDismiss.classList.add('hidden');
  defaultBrowserTimer = setTimeout(closeDefaultBrowserBar, 3000);
});

// ---- ページ内検索 ----
window.roopie.onOpenFind(() => {
  findBar.classList.remove('hidden');
  reportChromeHeight();
  findInput.focus();
  findInput.select();
  if (findInput.value) window.roopie.find(findInput.value);
});

window.roopie.onFindResult(({ activeMatchOrdinal, matches }) => {
  findCount.textContent = `${matches ? activeMatchOrdinal : 0}/${matches}`;
});

function closeFind() {
  findBar.classList.add('hidden');
  findCount.textContent = '0/0';
  window.roopie.stopFind();
  reportChromeHeight();
}

findInput.addEventListener('input', () => {
  if (findInput.value) window.roopie.find(findInput.value);
  else {
    window.roopie.stopFind();
    findCount.textContent = '0/0';
  }
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.roopie.find(findInput.value, { findNext: true, forward: !e.shiftKey });
  } else if (e.key === 'Escape') {
    closeFind();
  }
});

$('find-next').addEventListener('click', () =>
  window.roopie.find(findInput.value, { findNext: true, forward: true })
);
$('find-prev').addEventListener('click', () =>
  window.roopie.find(findInput.value, { findNext: true, forward: false })
);
$('find-close').addEventListener('click', closeFind);

// ---- ツールバー操作 ----
$('new-tab-btn').addEventListener('click', () => window.roopie.newTab());
backBtn.addEventListener('click', () => window.roopie.goBack());
forwardBtn.addEventListener('click', () => window.roopie.goForward());
reloadBtn.addEventListener('click', () => window.roopie.reload());
homeBtn.addEventListener('click', () => window.roopie.navigate('roopie://newtab'));
starBtn.addEventListener('click', () => window.roopie.toggleBookmark());
$('zoom-in-btn').addEventListener('click', () => window.roopie.zoom(1));
$('zoom-out-btn').addEventListener('click', () => window.roopie.zoom(-1));
zoomLabel.addEventListener('click', () => window.roopie.zoom(0));
// ズーム表示の上でホイールを回すと拡大縮小できる
$('zoom-controls').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    window.roopie.zoom(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);
// ダウンロード・履歴: クリックでEdge風のドロップダウンを開く(全件はそこから roopie://downloads /
// roopie://history へ)。ボタンの位置(ページ表示領域から見た座標)をメインプロセスへ渡す
downloadsBtn.addEventListener('click', () => {
  const rect = downloadsBtn.getBoundingClientRect();
  window.roopie.openDownloadsMenu({
    anchor: { right: Math.round(rect.right), bottom: Math.round(rect.bottom - chromeEl.offsetHeight) },
  });
});
$('split-direction-btn').addEventListener('click', () => window.roopie.toggleSplitDirection());
$('split-close-btn').addEventListener('click', () => window.roopie.closeSplit());
$('history-btn').addEventListener('click', () => {
  const rect = $('history-btn').getBoundingClientRect();
  window.roopie.openHistory({
    anchor: { right: Math.round(rect.right), bottom: Math.round(rect.bottom - chromeEl.offsetHeight) },
  });
});

// ---- サイドパネル ----
const sidepanelBtn = $('sidepanel-btn');
sidepanelBtn.addEventListener('click', () => window.roopie.toggleSidePanel());
// 右クリックで表示側(左/右)を選べるメニューを開く
sidepanelBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.roopie.sidePanelContextMenu();
});
// サイドバー(アイコンレール)は常時表示が既定のため、復帰用ボタンは非表示中だけツールバーに出す
window.roopie.onSidePanelState((state) => {
  sidepanelBtn.classList.toggle('hidden', state.open);
});

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && addressBar.value.trim()) {
    window.roopie.navigate(addressBar.value);
    addressBar.blur();
  } else if (e.key === 'Escape') {
    addressBar.value = activeTab()?.url ?? '';
    addressBar.blur();
  }
});
addressBar.addEventListener('focus', () => addressBar.select());

// ---- UI領域の高さをメインプロセスへ通知(ページ表示領域の計算に使う) ----
function reportChromeHeight() {
  window.roopie.setChromeHeight(chromeEl.offsetHeight);
}

new ResizeObserver(reportChromeHeight).observe(chromeEl);
reportChromeHeight();
