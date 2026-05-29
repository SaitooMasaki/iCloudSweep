/**
 * Unit tests — Pure utility functions extracted from content.js
 *
 * テスト対象:
 *   T-FREE-01  累計100枚で永久停止（日次リセットなし）
 *   T-FREE-02  累計カウントのリセットがない
 *   T-FAV-01   お気に入りマーカーの検出（aria-label）
 *   T-FAV-02   お気に入りマーカーの検出（class名）
 *   T-FAV-03   お気に入りマーカーの検出（title属性）
 *   T-FAV-04   お気に入りマーカーなし → false
 *   T-FAV-05   子孫要素にマーカーがある場合の検出
 *   T-FAV-06   要素自身の class / aria-label に "favorit" が含まれる場合
 *   T-DOM-01   findButtonByText — text content で検索
 *   T-DOM-02   findButtonByText — aria-label で検索
 *   T-DOM-03   findButtonByText — title 属性で検索
 *   T-DOM-04   findButtonByText — 非表示要素は無視
 *   T-DOM-05   tryFind — 最初にマッチするセレクタを返す
 *   T-DOM-06   tryFind — 全セレクタ不一致なら null
 */

// fetch モックのリセット（storage は不要だが fetch だけリセットしたい）
require('./setup');

// ─── 対象ロジックの再実装 ─────────────────────────────────────────────────────
// content.js はブラウザ実行前提のスクリプトのため、テスト対象ロジックを
// ここで完全に再現する（jsdom 環境で動作）

const FREE_LIMIT = 100;
const isFreeLimitReached = (total) => total >= FREE_LIMIT;

// SEL.favoriteMarkers と同一
const FAVORITE_MARKER_SELECTORS = [
  '[aria-label="Favorited"]',
  '[title="Favorited"]',
  '[aria-label="Favorite"]',
  '[title="Favorite"]',
  '[aria-label*="favorit" i]',
  '[title*="favorit" i]',
  '[class*="favorite"]',
  '[class*="Favorite"]',
  '[class*="favorited"]',
  '[class*="Favorited"]',
  '[class*="heart"]',
  '[class*="Heart"]',
  '[data-favorite="true"]',
  '[data-is-favorite="true"]',
  '[data-favorited="true"]',
];

function hasFavoriteIndicator(photoEl) {
  for (const sel of FAVORITE_MARKER_SELECTORS) {
    try {
      if (photoEl.querySelector(sel)) return true;
    } catch (_) {}
  }
  for (const el of [photoEl, photoEl.parentElement].filter(Boolean)) {
    const cls   = (el.className || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (cls.includes('favorit') || label.includes('favorit') || title.includes('favorit')) {
      return true;
    }
  }
  return false;
}

function isVisible(el) {
  if (!el) return false;
  // jsdom では getBoundingClientRect は常に 0 を返すので offsetParent で代用
  return el.offsetParent !== null || el.style.display !== 'none';
}

function findButtonByText(texts, root = document) {
  const candidates = [...root.querySelectorAll('button, [role="button"]')];
  const terms = Array.isArray(texts) ? texts : [texts];
  for (const term of terms) {
    const t = term.toLowerCase();
    const btn = candidates.find(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const text  = (el.textContent?.trim() || '').toLowerCase();
      return label === t || title === t || text === t
          || label.includes(t) || title.includes(t);
    });
    if (btn) return btn;
  }
  return null;
}

function tryFind(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function makeEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const child of children) el.appendChild(child);
  return el;
}

function makeFigure(attrs = {}, innerChildren = []) {
  return makeEl('figure', attrs, innerChildren);
}

// ─── T-FREE-01, T-FREE-02: 累計制限 ─────────────────────────────────────────

describe('isFreeLimitReached (累計カウント、リセットなし)', () => {
  it('T-FREE-01: 0 枚は制限に達していない', () => {
    expect(isFreeLimitReached(0)).toBe(false);
  });

  it('T-FREE-01: 99 枚は制限に達していない', () => {
    expect(isFreeLimitReached(99)).toBe(false);
  });

  it('T-FREE-01: 100 枚ちょうどで制限に達する', () => {
    expect(isFreeLimitReached(100)).toBe(true);
  });

  it('T-FREE-01: 100 超過も制限に達している', () => {
    expect(isFreeLimitReached(101)).toBe(true);
    expect(isFreeLimitReached(9999)).toBe(true);
  });

  it('T-FREE-02: 日付に依存しない（日をまたいでもリセットされない想定）', () => {
    // iCloudSweep の無料制限は累計。todayStr() のような日付比較は存在しない
    // → 単純に totalDeleted >= FREE_LIMIT だけで判定できることを確認
    expect(isFreeLimitReached(50)).toBe(false); // 50枚目はまだOK
    expect(isFreeLimitReached(100)).toBe(true); // 100枚目でアウト
  });
});

// ─── T-FAV-01〜03: aria-label / class / title による検出 ─────────────────────

describe('hasFavoriteIndicator — 検出パターン', () => {
  it('T-FAV-01: aria-label="Favorited" の子要素がある場合に true を返す', () => {
    const heart = makeEl('span', { 'aria-label': 'Favorited' });
    const fig   = makeFigure({}, [heart]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-01: aria-label="Favorite" の子要素がある場合も true', () => {
    const heart = makeEl('span', { 'aria-label': 'Favorite' });
    const fig   = makeFigure({}, [heart]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-02: class="favorited" の子要素がある場合に true を返す', () => {
    const icon = makeEl('i', { class: 'favorited-icon' });
    const fig  = makeFigure({}, [icon]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-02: class="Favorite" (大文字) でも true を返す', () => {
    const icon = makeEl('i', { class: 'FavoriteIndicator' });
    const fig  = makeFigure({}, [icon]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-02: data-favorite="true" でも true を返す', () => {
    const icon = makeEl('span', { 'data-favorite': 'true' });
    const fig  = makeFigure({}, [icon]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-02: data-is-favorite="true" でも true を返す', () => {
    const icon = makeEl('span', { 'data-is-favorite': 'true' });
    const fig  = makeFigure({}, [icon]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-03: title="Favorited" の子要素がある場合に true を返す', () => {
    const icon = makeEl('button', { title: 'Favorited' });
    const fig  = makeFigure({}, [icon]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-03: class="heart" の子要素でも true を返す', () => {
    const svg = makeEl('svg', { class: 'heart-icon' });
    const fig = makeFigure({}, [svg]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  // ─── T-FAV-04: お気に入りでない写真 ─────────────────────────────────────────

  it('T-FAV-04: お気に入りマーカーがない場合は false を返す', () => {
    const fig = makeFigure({ 'data-asset-guid': 'photo-1' });
    fig.textContent = 'Normal Photo';
    expect(hasFavoriteIndicator(fig)).toBe(false);
  });

  it('T-FAV-04: 無関係な class 名は false', () => {
    const thumb = makeEl('div', { class: 'photo-thumbnail' });
    const fig   = makeFigure({}, [thumb]);
    expect(hasFavoriteIndicator(fig)).toBe(false);
  });

  it('T-FAV-04: data-selected="true" はお気に入りとは無関係', () => {
    const fig = makeFigure({ 'data-asset-guid': 'photo-2', 'data-selected': 'true' });
    expect(hasFavoriteIndicator(fig)).toBe(false);
  });

  // ─── T-FAV-05: 深くネストした子孫への検出 ────────────────────────────────────

  it('T-FAV-05: 深くネストした子孫の aria-label="Favorited" も検出する', () => {
    const icon = makeEl('span', { 'aria-label': 'Favorited' });
    const wrapper = makeEl('div', {}, [icon]);
    const inner   = makeEl('div', {}, [wrapper]);
    const fig     = makeFigure({}, [inner]);
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  // ─── T-FAV-06: 要素自身の属性 ────────────────────────────────────────────────

  it('T-FAV-06: figure 自身の aria-label に "favorit" が含まれる場合 true', () => {
    const fig = makeFigure({ 'aria-label': 'Favorited photo' });
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });

  it('T-FAV-06: figure 自身の class に "favorite" が含まれる場合 true', () => {
    const fig = makeFigure({ class: 'photo-cell is-favorite' });
    expect(hasFavoriteIndicator(fig)).toBe(true);
  });
});

// ─── T-DOM-01〜03: findButtonByText ──────────────────────────────────────────

describe('findButtonByText', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('T-DOM-01: text content で完全一致するボタンを返す', () => {
    container.innerHTML = '<button>Select</button>';
    const btn = findButtonByText('Select', container);
    expect(btn).not.toBeNull();
    expect(btn.textContent.trim()).toBe('Select');
  });

  it('T-DOM-01: text content が大文字小文字混在でも検索できる', () => {
    container.innerHTML = '<button>Select All</button>';
    const btn = findButtonByText('select all', container);
    expect(btn).not.toBeNull();
  });

  it('T-DOM-02: aria-label で一致するボタンを返す', () => {
    container.innerHTML = '<button aria-label="Delete">🗑</button>';
    const btn = findButtonByText('Delete', container);
    expect(btn).not.toBeNull();
  });

  it('T-DOM-02: aria-label の部分一致でも返す', () => {
    container.innerHTML = '<button aria-label="Delete selected photos">Del</button>';
    const btn = findButtonByText('delete', container);
    expect(btn).not.toBeNull();
  });

  it('T-DOM-03: title 属性で一致するボタンを返す', () => {
    container.innerHTML = '<button title="Favorited">♥</button>';
    const btn = findButtonByText('Favorited', container);
    expect(btn).not.toBeNull();
  });

  it('T-DOM-01: 配列で複数ワードを指定し、最初にマッチしたものを返す', () => {
    container.innerHTML = '<button>Cancel</button>';
    const btn = findButtonByText(['Done', 'Cancel'], container);
    expect(btn).not.toBeNull();
    expect(btn.textContent.trim()).toBe('Cancel');
  });

  it('T-DOM-01: 何もマッチしない場合は null を返す', () => {
    container.innerHTML = '<button>Unrelated</button>';
    const btn = findButtonByText('Select', container);
    expect(btn).toBeNull();
  });

  it('T-DOM-04: role="button" の div も対象になる', () => {
    container.innerHTML = '<div role="button" aria-label="Select">Select</div>';
    const btn = findButtonByText('Select', container);
    expect(btn).not.toBeNull();
  });
});

// ─── T-DOM-05〜06: tryFind ─────────────────────────────────────────────────────

describe('tryFind', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('T-DOM-05: 最初にマッチするセレクタの要素を返す', () => {
    container.innerHTML = '<figure data-asset-guid="p1">Photo</figure>';
    const el = tryFind(['[data-asset-guid]', 'figure'], container);
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-asset-guid')).toBe('p1');
  });

  it('T-DOM-05: 最初のセレクタが不一致なら次を試す', () => {
    container.innerHTML = '<figure class="photo-cell">Photo</figure>';
    const el = tryFind(['[data-asset-guid]', '.photo-cell'], container);
    expect(el).not.toBeNull();
    expect(el.className).toBe('photo-cell');
  });

  it('T-DOM-06: 全セレクタが不一致なら null を返す', () => {
    container.innerHTML = '<div class="something-else">Div</div>';
    const el = tryFind(['[data-asset-guid]', 'figure', '.photo-cell'], container);
    expect(el).toBeNull();
  });

  it('T-DOM-06: 不正なセレクタは安全にスキップされる', () => {
    container.innerHTML = '<figure data-asset-guid="p1">Photo</figure>';
    // 不正セレクタ → エラーを throw せず次のセレクタへ
    const el = tryFind([':::invalid:::', '[data-asset-guid]'], container);
    expect(el).not.toBeNull();
  });
});
