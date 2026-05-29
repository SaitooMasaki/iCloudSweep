/**
 * E2E テスト — 削除フロー
 *
 * mock-icloud.html が iCloud Photos の DOM をシミュレートする。
 * content.js の削除エンジンが正しく動作することを確認する。
 *
 * テスト対象:
 *   T-DEL-01  全写真を削除する（お気に入りなし）
 *   T-DEL-02  Skip Favorites OFF → お気に入りも削除される
 *   T-DEL-03  Skip Favorites ON  → お気に入りが残る
 *   T-DEL-04  全写真がお気に入りの場合、1枚も削除されない
 *   T-FREE-01 100枚で無料上限に達しアップグレード CTA が表示される
 *   T-FREE-02 Pro ユーザーは上限なく削除できる
 *   T-ERR-01  3回連続エラーで「not working」バナーが表示される
 *   T-CNT-01  削除数が Storage の totalDeleted に累計保存される
 *   T-CNT-02  totalDeleted はページ更新後も保持される
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const {
  setupICloudMocks,
  setupLicenseMocks,
  setExtensionStorage,
  getExtensionStorage,
  mockPhoto,
} = require('./helpers/mock');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const PANEL = '#is-panel';

// ─── Context fixture ──────────────────────────────────────────────────────────

let context;
let page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(async () => {
  await setExtensionStorage(context, { isPro: false, totalDeleted: 0, skipFavorites: false });
  page = await context.newPage();
});

test.afterEach(async () => {
  await page.close();
});

// ─── T-DEL-01: 全写真を削除（お気に入りなし） ────────────────────────────────

test('T-DEL-01: お気に入りなしの写真が全て削除される', async () => {
  await setupICloudMocks(page, {
    photos: [
      mockPhoto('p1'),
      mockPhoto('p2'),
      mockPhoto('p3'),
    ],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // 削除完了後に写真が全てなくなる
  await expect(page.locator('#photo-grid figure')).toHaveCount(0, { timeout: 15_000 });
});

test('T-DEL-01: 削除完了後にステータスに削除数が表示される', async () => {
  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-status-text')).toContainText('Recently Deleted', { timeout: 15_000 });
});

test('T-DEL-01: 削除カウンタ（#is-done-count）が増加する', async () => {
  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2'), mockPhoto('p3')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // カウンタが 0 より大きくなる
  await expect(async () => {
    const text = await page.locator('#is-done-count').textContent();
    expect(parseInt(text, 10)).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
});

// ─── T-DEL-02: Skip Favorites OFF → お気に入りも削除 ─────────────────────────

test('T-DEL-02: Skip Favorites OFF ではお気に入り写真も削除される', async () => {
  await setupICloudMocks(page, {
    photos: [
      mockPhoto('p1'),
      mockPhoto('p2', { favorited: true }),
      mockPhoto('p3'),
    ],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // Skip Favorites が OFF であることを確認
  await expect(page.locator('#is-skip-fav-check')).not.toBeChecked();

  await page.locator('#is-start-btn').click();

  // 全写真（お気に入り含む）が削除される
  await expect(page.locator('#photo-grid figure')).toHaveCount(0, { timeout: 15_000 });
});

// ─── T-DEL-03: Skip Favorites ON → お気に入りが残る ──────────────────────────

test('T-DEL-03: Skip Favorites ON ではお気に入り写真が削除されない', async () => {
  await setupICloudMocks(page, {
    photos: [
      mockPhoto('p1'),
      mockPhoto('p2', { favorited: true }),
      mockPhoto('p3'),
    ],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // Skip Favorites を ON にする（チェックボックスは CSS 非表示のためラベルをクリック）
  await page.locator('#is-skip-fav-label').click();
  await expect(page.locator('#is-skip-fav-check')).toBeChecked();

  await page.locator('#is-start-btn').click();

  // 非お気に入り写真が消え、お気に入りが1枚残る
  await expect(page.locator('#photo-grid figure')).toHaveCount(1, { timeout: 15_000 });
  // 残った写真がお気に入りマーク付き
  await expect(page.locator('#photo-grid figure [aria-label="Favorited"]')).toHaveCount(1);
});

test('T-DEL-03: Skip Favorites ON のステータスに「Skipped」が含まれる', async () => {
  await setupICloudMocks(page, {
    photos: [
      mockPhoto('p1'),
      mockPhoto('p2', { favorited: true }),
    ],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-skip-fav-label').click();
  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-status-text')).toContainText('Skipped', { timeout: 10_000 });
});

// ─── T-DEL-04: 全写真がお気に入りの場合 ─────────────────────────────────────

test('T-DEL-04: 全写真がお気に入りで Skip=ON の場合、1枚も削除されず終了する', async () => {
  await setupICloudMocks(page, {
    photos: [
      mockPhoto('p1', { favorited: true }),
      mockPhoto('p2', { favorited: true }),
    ],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-skip-fav-label').click();
  await page.locator('#is-start-btn').click();

  // 写真が全員残っている
  await expect(page.locator('#photo-grid figure')).toHaveCount(2, { timeout: 15_000 });

  // ステータスが「見つからない」旨を表示する
  await expect(page.locator('#is-status-text')).toContainText(
    /No deletable photos|All done|Favorites/i,
    { timeout: 15_000 }
  );
});

// ─── T-FREE-01: 100枚上限 ────────────────────────────────────────────────────

test('T-FREE-01: totalDeleted が FREE_LIMIT(100) に達したらアップグレード CTA が表示される', async () => {
  // 既に 99 枚削除済みとして Storage を設定
  await setExtensionStorage(context, { totalDeleted: 99, isPro: false });

  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // 1枚削除後に制限に到達 → CTA が表示される
  await expect(page.locator('#is-limit-cta')).toBeVisible({ timeout: 15_000 });
});

test('T-FREE-01: 既に 100 枚に達していたら Start 直後に CTA が表示される', async () => {
  await setExtensionStorage(context, { totalDeleted: 100, isPro: false });

  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-limit-cta')).toBeVisible({ timeout: 10_000 });
});

test('T-FREE-01: アップグレードリンクが PURCHASE_URL を指している', async () => {
  await setExtensionStorage(context, { totalDeleted: 100, isPro: false });

  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-limit-cta')).toBeVisible({ timeout: 10_000 });
  const link = page.locator('#is-limit-cta a.is-upgrade-btn');
  const href = await link.getAttribute('href');
  expect(href).toContain('lemonsqueezy.com');
});

// ─── T-FREE-02: Pro ユーザーは上限なし ──────────────────────────────────────

test('T-FREE-02: Pro ユーザーは 100 枚を超えても CTA が表示されない', async () => {
  await setExtensionStorage(context, { totalDeleted: 150, isPro: true });
  await setupLicenseMocks(context, { valid: true });

  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // 削除が完了するまで待つ
  await expect(page.locator('#photo-grid figure')).toHaveCount(0, { timeout: 15_000 });

  // CTA は表示されない
  await expect(page.locator('#is-limit-cta')).not.toBeVisible();
});

// ─── T-CNT-01: 累計カウント保存 ─────────────────────────────────────────────

test('T-CNT-01: 削除数が Storage の totalDeleted に累計保存される', async () => {
  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2'), mockPhoto('p3')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // 削除完了後、"All done! X photo(s) moved to Recently Deleted." が表示されるまで待つ。
  // 削除直後のステータスは瞬時に上書きされるため、ループが収束した最終メッセージを待つ。
  // "noPhotosStreak" が 3 回蓄積（各 2s sleep）+ 削除後 1s delay = 約 7s かかる。
  await expect(page.locator('#photo-grid figure')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#is-status-text')).toContainText('Recently Deleted', { timeout: 15_000 });

  const stored = await getExtensionStorage(context, ['totalDeleted']);
  expect(stored?.totalDeleted).toBeGreaterThan(0);
});

test('T-CNT-01: 既存の totalDeleted に今回分が加算される', async () => {
  // 事前: 50 枚削除済み
  await setExtensionStorage(context, { totalDeleted: 50, isPro: false });

  await setupICloudMocks(page, {
    photos: [mockPhoto('p1'), mockPhoto('p2')],
  });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#photo-grid figure')).toHaveCount(0, { timeout: 15_000 });
  // 最終ステータス "All done!" を待つ（ループ収束に約 7s 必要）
  await expect(page.locator('#is-status-text')).toContainText('Recently Deleted', { timeout: 15_000 });

  // 50 + (今回削除分) >= 51 になっているはず
  const stored = await getExtensionStorage(context, ['totalDeleted']);
  expect(stored?.totalDeleted).toBeGreaterThan(50);
});

// ─── T-CNT-02: リロード後も totalDeleted が保持される ────────────────────────

test('T-CNT-02: ページ更新後も totalDeleted が維持される', async () => {
  // 事前: 42 枚削除済みとして保存
  await setExtensionStorage(context, { totalDeleted: 42, isPro: false });

  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // #is-used-count に 42 が表示されていることを確認
  await expect(page.locator('#is-used-count')).toHaveText('42', { timeout: 5_000 });

  // ページをリロード
  await page.reload();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // リロード後も 42 のまま
  await expect(page.locator('#is-used-count')).toHaveText('42', { timeout: 5_000 });
});

// ─── T-ERR-01: 3回連続エラー → "not working" バナー ─────────────────────────

test('T-ERR-01: iCloud UI のセレクタが全て不一致の場合に「not working」バナーを表示する', async () => {
  // 空ページ（iCloud Photos の DOM 要素が一切ない）
  // page.route() を使用してテスト間の干渉を防ぐ
  // Apple SSO リダイレクトをブロック（汎用ルートを先に登録）
  await page.route('https://idmsa.apple.com/**', route =>
    route.fulfill({ status: 302, headers: { location: 'https://www.icloud.com/photos/' }, body: '' })
  );
  await page.route('https://*.apple.com/**', route =>
    route.fulfill({ status: 200, body: '' })
  );
  await page.route('https://*.icloud.com/**', route =>
    route.fulfill({ status: 200, body: '' })
  );
  // 具体的なルートを後に登録することで最高優先度とする
  await page.route(/https:\/\/www\.icloud\.com\/photos/, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      // Select ボタンも写真グリッドも存在しない最小限のHTML
      body: '<html><body><p>No iCloud Photos UI here.</p></body></html>',
    })
  );

  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  // 3 回のリトライ後に「not working」バナーが表示される
  await expect(page.locator('#is-not-working')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#is-not-working')).toContainText('not currently working');
});
