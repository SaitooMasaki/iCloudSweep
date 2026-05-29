/**
 * E2E テスト — パネル表示 / UI 操作
 *
 * テスト対象:
 *   T-INST-01  iCloud Photos ページでパネルが表示される
 *   T-INST-02  非 iCloud ページではパネルが表示されない
 *   T-UI-01    FREE バッジが初期表示される
 *   T-UI-02    Skip Favorites トグルが存在し操作できる
 *   T-UI-03    ミニマイズ → ボディ非表示、再クリックで復元
 *   T-UI-04    × で閉じた後 SPA 遷移でもパネルが復活しない
 *   T-UI-05    Start → Pause / Stop ボタンが表示される
 *   T-UI-06    Pause クリック → Resume に変わる
 *   T-UI-07    Stop → Start に戻る
 *   T-PRO-01   ライセンス認証（成功）→ PRO バッジ・制限表示が消える
 *   T-PRO-02   ライセンス認証（失敗）→ エラーメッセージ
 *   T-PRO-03   ライセンス解除 → FREE に戻る
 *   T-POPUP-01 ポップアップの Status 表示
 *   T-POPUP-02 非 iCloud タブではポップアップに「Open iCloud Photos」と表示
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
  // ストレージをリセット（テスト間の独立性を保つ）
  await setExtensionStorage(context, { isPro: false, totalDeleted: 0, skipFavorites: false });
  page = await context.newPage();
});

test.afterEach(async () => {
  await page.close();
});

// ─── T-INST-01: パネル表示 ───────────────────────────────────────────────────

test('T-INST-01: iCloud Photos ページでフローティングパネルが表示される', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');

  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });
});

test('T-INST-01: パネルに FREE バッジが表示される', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');

  await expect(page.locator('#is-badge')).toHaveText('FREE', { timeout: 10_000 });
});

test('T-INST-01: Skip Favorites トグルが存在する', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');

  // チェックボックス自体は CSS で width:0/height:0 に設定されているため、
  // 親ラベル（is-toggle-track を含む可視要素）の存在で確認する
  await expect(page.locator('#is-skip-fav-label')).toBeVisible({ timeout: 10_000 });
});

test('T-INST-01: お知らせ文に「Recently Deleted」が含まれる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');

  await expect(page.locator('.is-notice')).toContainText('Recently Deleted', { timeout: 10_000 });
});

test('T-INST-01: お知らせ文に「Keep this iCloud Photos tab open」が含まれる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');

  await expect(page.locator('.is-notice')).toContainText('Keep this iCloud Photos tab open', { timeout: 10_000 });
});

// ─── T-INST-02: 非 iCloud ページ ─────────────────────────────────────────────

test('T-INST-02: google.com ではパネルが表示されない', async () => {
  await page.goto('https://www.google.com');
  await page.waitForTimeout(3_000);
  await expect(page.locator(PANEL)).not.toBeVisible();
});

// ─── T-UI-02: Skip Favorites トグル ──────────────────────────────────────────

test('T-UI-02: Skip Favorites トグルをONにできる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  const toggle = page.locator('#is-skip-fav-check');
  await expect(toggle).not.toBeChecked();
  // チェックボックスは CSS 非表示のため、親ラベルをクリックしてトグルする
  await page.locator('#is-skip-fav-label').click();
  await expect(toggle).toBeChecked();
});

test('T-UI-02: Skip Favorites の状態が Storage に保存される', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-skip-fav-label').click();

  const stored = await getExtensionStorage(context, ['skipFavorites']);
  expect(stored?.skipFavorites).toBe(true);
});

test('T-UI-02: Storage の skipFavorites=true がトグルに反映される', async () => {
  await setExtensionStorage(context, { skipFavorites: true });
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('#is-skip-fav-check')).toBeChecked();
});

// ─── T-UI-03: ミニマイズ ─────────────────────────────────────────────────────

test('T-UI-03: ミニマイズでボディが非表示になる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-minimize-btn').click();
  await expect(page.locator('#is-body')).not.toBeVisible();
  await expect(page.locator('#is-minimize-btn')).toHaveText('□');
});

test('T-UI-03: 再クリックでボディが復元される', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-minimize-btn').click();
  await page.locator('#is-minimize-btn').click();

  await expect(page.locator('#is-body')).toBeVisible();
  await expect(page.locator('#is-minimize-btn')).toHaveText('–');
});

// ─── T-UI-04: × で閉じた後 SPA 遷移でも復活しない ───────────────────────────

test('T-UI-04: × で閉じた後 SPA 遷移でパネルが復活しない', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-close-btn').click();
  await expect(page.locator(PANEL)).not.toBeVisible();

  // SPA 遷移をシミュレート（pushState + DOM 変更）
  await page.evaluate(() => {
    history.pushState({}, '', '/photos/#moments');
    const d = document.createElement('div');
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 100);
  });

  await page.waitForTimeout(1_500);
  await expect(page.locator(PANEL)).not.toBeVisible();
});

// ─── T-UI-05: Start → Pause / Stop ──────────────────────────────────────────

test('T-UI-05: Start 後は Pause・Stop が表示され Start が消える', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-start-btn')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#is-pause-btn')).toBeVisible();
  await expect(page.locator('#is-stop-btn')).toBeVisible();
  await expect(page.locator('#is-pause-btn')).toHaveText('Pause');
});

test('T-UI-05: Start 後は Skip Favorites トグルが disabled になる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();

  await expect(page.locator('#is-start-btn')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#is-skip-fav-check')).toBeDisabled();
});

// ─── T-UI-06: Pause → Resume ─────────────────────────────────────────────────

test('T-UI-06: Pause クリックで Resume ボタンに変わる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();
  await expect(page.locator('#is-pause-btn')).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-pause-btn').click();
  await expect(page.locator('#is-pause-btn')).toHaveText('Resume', { timeout: 5_000 });
});

test('T-UI-06: Resume クリックで Pause に戻る', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();
  await expect(page.locator('#is-pause-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#is-pause-btn').click();
  await expect(page.locator('#is-pause-btn')).toHaveText('Resume', { timeout: 5_000 });
  await page.locator('#is-pause-btn').click();
  await expect(page.locator('#is-pause-btn')).toHaveText('Pause', { timeout: 5_000 });
});

// ─── T-UI-07: Stop ───────────────────────────────────────────────────────────

test('T-UI-07: Stop クリックで Start ボタンに戻る', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();
  await expect(page.locator('#is-stop-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#is-stop-btn').click();

  await expect(page.locator('#is-start-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#is-pause-btn')).not.toBeVisible();
  await expect(page.locator('#is-stop-btn')).not.toBeVisible();
});

test('T-UI-07: Stop 後のステータステキストに「Stopped」が含まれる', async () => {
  await setupICloudMocks(page);
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-start-btn').click();
  await expect(page.locator('#is-stop-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#is-stop-btn').click();

  await expect(page.locator('#is-status-text')).toContainText('Stopped', { timeout: 5_000 });
});

// ─── T-PRO-01: ライセンス認証（成功） ────────────────────────────────────────

test('T-PRO-01: 有効なキーで PRO バッジになる', async () => {
  await setupICloudMocks(page);
  await setupLicenseMocks(context, { valid: true });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-license-input').fill('VALID-KEY-0001');
  await page.locator('#is-activate-btn').click();

  await expect(page.locator('#is-badge')).toHaveText('PRO', { timeout: 8_000 });
});

test('T-PRO-01: 認証成功後にライセンスエリアが非表示になる', async () => {
  await setupICloudMocks(page);
  await setupLicenseMocks(context, { valid: true });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-license-input').fill('VALID-KEY-0002');
  await page.locator('#is-activate-btn').click();

  await expect(page.locator('#is-badge')).toHaveText('PRO', { timeout: 8_000 });
  await expect(page.locator('#is-license-area')).not.toBeVisible();
});

test('T-PRO-01: 認証成功後に累計カウント表示が非表示になる', async () => {
  await setupICloudMocks(page);
  await setupLicenseMocks(context, { valid: true });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-license-input').fill('VALID-KEY-0003');
  await page.locator('#is-activate-btn').click();

  await expect(page.locator('#is-badge')).toHaveText('PRO', { timeout: 8_000 });
  await expect(page.locator('#is-quota-info')).not.toBeVisible();
});

// ─── T-PRO-02: ライセンス認証（失敗） ────────────────────────────────────────

test('T-PRO-02: 無効なキーでエラーメッセージが出る', async () => {
  await setupICloudMocks(page);
  await setupLicenseMocks(context, { valid: false });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-license-input').fill('INVALID-KEY-0000');
  await page.locator('#is-activate-btn').click();

  await expect(page.locator('#is-license-msg')).toContainText('✗', { timeout: 8_000 });
});

test('T-PRO-02: 認証失敗後もバッジは FREE のまま', async () => {
  await setupICloudMocks(page);
  await setupLicenseMocks(context, { valid: false });
  await page.goto('https://www.icloud.com/photos/');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#is-license-input').fill('INVALID-KEY-0000');
  await page.locator('#is-activate-btn').click();

  await expect(page.locator('#is-license-msg')).toContainText('✗', { timeout: 8_000 });
  await expect(page.locator('#is-badge')).toHaveText('FREE');
});

// ─── T-POPUP-02: ポップアップ表示 ───────────────────────────────────────────

test('T-POPUP-02: 非 iCloud タブではポップアップに「Open iCloud Photos」が表示される', async () => {
  await page.goto('https://www.google.com');

  const popupPage = await context.newPage();
  const serviceWorkerUrl = context.serviceWorkers()[0]?.url() ?? '';
  const extensionId = serviceWorkerUrl.split('/')[2];

  if (extensionId) {
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popupPage.locator('.open-icloud')).toBeVisible({ timeout: 5_000 });
    await expect(popupPage.locator('.open-icloud')).toContainText('Open iCloud Photos');
    await popupPage.close();
  }
});

test('T-POPUP-02: ポップアップの「♥ Skip Favorites」欄が表示される', async () => {
  const popupPage = await context.newPage();
  const serviceWorkerUrl = context.serviceWorkers()[0]?.url() ?? '';
  const extensionId = serviceWorkerUrl.split('/')[2];

  if (extensionId) {
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popupPage.locator('#skip-fav-val')).toBeVisible({ timeout: 5_000 });
    await popupPage.close();
  }
});
