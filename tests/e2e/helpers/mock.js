/**
 * E2E テスト用ヘルパー
 *
 * - iCloud Photos ページを mock-icloud.html でインターセプト
 * - LemonSqueezy ライセンス API のスタブ
 * - chrome.storage.local の読み書きユーティリティ
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MOCK_HTML_PATH = path.join(__dirname, '../fixtures/mock-icloud.html');
const MOCK_HTML      = fs.readFileSync(MOCK_HTML_PATH, 'utf-8');

// ─── iCloud Photos ページのモック ─────────────────────────────────────────────

/**
 * 写真オブジェクトを生成する
 * @param {string} id
 * @param {{ favorited?: boolean, label?: string }} opts
 */
function mockPhoto(id, opts = {}) {
  return {
    id,
    label:     opts.label ?? `Photo ${id}`,
    favorited: opts.favorited ?? false,
  };
}

/**
 * icloud.com/photos へのナビゲーションをインターセプトし、
 * mock-icloud.html を返す。
 *
 * Apple SSO (/idmsa.apple.com) へのリダイレクトも遮断するため、
 * context.route() ではなく page.route() を使用する。
 * page.route() はページが閉じると自動的に解除され、テスト間の干渉を防ぐ。
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {Array}   options.photos   - 写真リスト（mockPhoto() で生成）
 */
async function setupICloudMocks(page, options = {}) {
  const {
    photos = [
      mockPhoto('photo-1'),
      mockPhoto('photo-2'),
      mockPhoto('photo-3', { favorited: true }),
      mockPhoto('photo-4'),
      mockPhoto('photo-5'),
    ],
  } = options;

  // window.MOCK_PHOTOS を <script> タグで </head> 直前に注入する（堅牢な注入方法）
  const photosScript = `<script>window.MOCK_PHOTOS = ${JSON.stringify(photos)};</script>`;
  const html = MOCK_HTML.replace('</head>', `${photosScript}\n</head>`);

  // Playwright では後から登録されたルートが優先度が高くなる（LIFO 順）。
  // https://*.icloud.com/** は www.icloud.com/photos/ にも一致するため、
  // 汎用ルートを先に登録し、具体的なルートを後に登録することで優先させる。

  // Apple SSO へのリダイレクトを遮断して iCloud Photos に戻す
  await page.route('https://idmsa.apple.com/**', route =>
    route.fulfill({
      status: 302,
      headers: { location: 'https://www.icloud.com/photos/' },
      body: '',
    })
  );

  // その他の Apple / iCloud サブドメインへのリクエストをブロック（汎用ルートを先に登録）
  await page.route('https://*.apple.com/**', route =>
    route.fulfill({ status: 200, body: '' })
  );
  await page.route('https://*.icloud.com/**', route =>
    route.fulfill({ status: 200, body: '' })
  );

  // iCloud Photos ページへのリクエストはモック HTML で応答する（最後に登録＝最高優先度）
  // ※ launchPersistentContext 環境では resourceType() が 'other' になるケースがあるため
  //    種別フィルタなしで全リクエストにモック HTML を返す
  await page.route(/https:\/\/www\.icloud\.com\/photos/, route => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });
}

// ─── LemonSqueezy ライセンス API のスタブ ────────────────────────────────────

/**
 * LemonSqueezy ライセンス API をスタブする
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ valid?: boolean }} opts
 */
async function setupLicenseMocks(context, { valid = true } = {}) {
  await context.route('**/api.lemonsqueezy.com/v1/licenses/activate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        valid
          ? { activated: true, license_key: { status: 'active' } }
          : { activated: false, error: 'License not found.' }
      ),
    })
  );

  await context.route('**/api.lemonsqueezy.com/v1/licenses/validate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        valid ? { valid: true } : { valid: false, error: 'Invalid license key.' }
      ),
    })
  );

  await context.route('**/api.lemonsqueezy.com/v1/licenses/deactivate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );
}

// ─── chrome.storage.local ユーティリティ ────────────────────────────────────

/** Extension Service Worker を通じて storage に値をセットする */
async function setExtensionStorage(context, data) {
  const workers = context.serviceWorkers();
  let worker = workers[0];
  if (!worker) {
    worker = await context
      .waitForEvent('serviceworker', { timeout: 5_000 })
      .catch(() => null);
  }
  if (worker) {
    await worker.evaluate(d => chrome.storage.local.set(d), data);
  }
}

/** Extension Service Worker を通じて storage の値を取得する */
async function getExtensionStorage(context, keys) {
  const workers = context.serviceWorkers();
  let worker = workers[0];
  if (!worker) {
    worker = await context
      .waitForEvent('serviceworker', { timeout: 5_000 })
      .catch(() => null);
  }
  if (!worker) return null;
  return worker.evaluate(
    k => new Promise(resolve => chrome.storage.local.get(k, resolve)),
    keys
  );
}

module.exports = {
  mockPhoto,
  setupICloudMocks,
  setupLicenseMocks,
  setExtensionStorage,
  getExtensionStorage,
};
