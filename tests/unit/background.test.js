/**
 * Unit tests — background.js のライセンス認証ロジック
 *
 * jest-webextension-mock が chrome.* API を提供。
 * fetch は tests/unit/setup.js でモック済み。
 *
 * テスト対象:
 *   T-PRO-01  ライセンス認証（成功 — activate）
 *   T-PRO-02  ライセンス認証（activate 失敗 → validate フォールバック成功）
 *   T-PRO-03  ライセンス認証（失敗）
 *   T-PRO-04  ライセンス解除
 *   T-PRO-05  instanceId の生成・再利用
 */

// chrome.storage.local の in-memory モックと beforeEach/afterEach を登録
require('./setup');

// ─── テスト対象ロジックの再実装 ──────────────────────────────────────────────
// background.js は自己実行スクリプトのため、ロジックをここで抽出してテスト

const storageGet = (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve));
const storageSet = (obj)  => new Promise(resolve => chrome.storage.local.set(obj, resolve));

async function getOrCreateInstanceId() {
  const data = await storageGet('instanceId');
  if (data.instanceId) return data.instanceId;
  const id = 'test-uuid-' + Math.random().toString(36).slice(2);
  await storageSet({ instanceId: id });
  return id;
}

async function validateLicense(key) {
  const instanceId = await getOrCreateInstanceId();

  let res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_name: `iCloudSweep-${instanceId}` }),
  });
  let data = await res.json();

  if (!data.activated) {
    res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    data = await res.json();
    if (!data.valid) {
      return { ok: false, error: data.error || 'Invalid or expired license key.' };
    }
  }

  await storageSet({ licenseKey: key, isPro: true, instanceId });
  return { ok: true };
}

async function deactivateLicense(key, instanceId) {
  await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_id: instanceId }),
  }).catch(() => {});
  await new Promise(resolve => chrome.storage.local.remove(['licenseKey', 'isPro'], resolve));
  return { ok: true };
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function mockFetchJson(data, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

// ─── T-PRO-01: ライセンス認証（activate 成功） ───────────────────────────────

describe('validateLicense — activate 成功 (T-PRO-01)', () => {
  it('{ ok: true } を返す', async () => {
    global.fetch = mockFetchJson({ activated: true, license_key: { status: 'active' } });

    const result = await validateLicense('VALID-KEY-1234');

    expect(result).toEqual({ ok: true });
  });

  it('isPro=true を Storage に保存する', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('VALID-KEY-5678');

    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBe(true);
    expect(stored.licenseKey).toBe('VALID-KEY-5678');
  });

  it('instanceId を Storage に保存する', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('VALID-KEY-ABCD');

    const stored = await storageGet('instanceId');
    expect(stored.instanceId).toBeTruthy();
  });

  it('instance_name に "iCloudSweep-" プレフィックスを含む', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('VALID-KEY');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.lemonsqueezy.com/v1/licenses/activate',
      expect.objectContaining({
        body: expect.stringContaining('iCloudSweep-'),
      })
    );
  });
});

// ─── T-PRO-02: activate 失敗 → validate フォールバック ───────────────────────

describe('validateLicense — validate フォールバック (T-PRO-02)', () => {
  it('activate が失敗しても validate が成功すれば Pro になる', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ activated: false, error: 'already activated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

    const result = await validateLicense('ALREADY-ACTIVATED');

    expect(result).toEqual({ ok: true });
    const stored = await storageGet('isPro');
    expect(stored.isPro).toBe(true);
  });

  it('validate が 2 回目に呼ばれる', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ activated: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

    await validateLicense('KEY');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.lemonsqueezy.com/v1/licenses/validate',
      expect.anything()
    );
  });
});

// ─── T-PRO-03: ライセンス認証（失敗） ────────────────────────────────────────

describe('validateLicense — 失敗 (T-PRO-03)', () => {
  it('activate も validate も失敗すれば { ok: false } を返す', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ activated: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ valid: false, error: 'License not found.' }),
      });

    const result = await validateLicense('INVALID-KEY');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('isPro を Storage に保存しない', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ activated: false, valid: false, error: 'not found' }),
    });

    await validateLicense('INVALID-KEY');

    const stored = await storageGet('isPro');
    expect(stored.isPro).toBeUndefined();
  });

  it('API エラーメッセージをそのまま返す', async () => {
    const errMsg = 'This license has been disabled.';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ activated: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ valid: false, error: errMsg }),
      });

    const result = await validateLicense('DISABLED-KEY');

    expect(result.error).toBe(errMsg);
  });

  it('ネットワークエラーは例外として伝播する', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    await expect(validateLicense('KEY')).rejects.toThrow('Network error');
  });
});

// ─── T-PRO-04: ライセンス解除 ────────────────────────────────────────────────

describe('deactivateLicense (T-PRO-04)', () => {
  it('Storage から isPro と licenseKey を削除する', async () => {
    await storageSet({ isPro: true, licenseKey: 'SOME-KEY', instanceId: 'inst-123' });
    global.fetch = mockFetchJson({});

    await deactivateLicense('SOME-KEY', 'inst-123');

    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBeUndefined();
    expect(stored.licenseKey).toBeUndefined();
  });

  it('LemonSqueezy deactivate エンドポイントを呼ぶ', async () => {
    global.fetch = mockFetchJson({});

    await deactivateLicense('MY-KEY', 'my-instance');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.lemonsqueezy.com/v1/licenses/deactivate',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('deactivate リクエストに key と instanceId が含まれる', async () => {
    global.fetch = mockFetchJson({});

    await deactivateLicense('TARGET-KEY', 'inst-xyz');

    const call = global.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.license_key).toBe('TARGET-KEY');
    expect(body.instance_id).toBe('inst-xyz');
  });

  it('deactivate API が失敗しても Storage は削除し { ok: true } を返す', async () => {
    await storageSet({ isPro: true, licenseKey: 'KEY' });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await deactivateLicense('KEY', 'inst');

    expect(result).toEqual({ ok: true });
    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBeUndefined();
  });
});

// ─── T-PRO-05: instanceId の生成・再利用 ─────────────────────────────────────

describe('getOrCreateInstanceId (T-PRO-05)', () => {
  it('初回は新しい ID を生成して Storage に保存する', async () => {
    const id = await getOrCreateInstanceId();

    expect(id).toBeTruthy();
    const stored = await storageGet('instanceId');
    expect(stored.instanceId).toBe(id);
  });

  it('2 回目の呼び出しで同じ ID を返す（新規生成しない）', async () => {
    const id1 = await getOrCreateInstanceId();
    const id2 = await getOrCreateInstanceId();

    expect(id1).toBe(id2);
  });

  it('既存の instanceId が Storage にある場合はそれを返す', async () => {
    await storageSet({ instanceId: 'preset-id-9999' });

    const id = await getOrCreateInstanceId();

    expect(id).toBe('preset-id-9999');
  });

  it('複数回の validateLicense でも instanceId は同一', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('KEY-A');
    const { instanceId: id1 } = await storageGet('instanceId');

    global.fetch = mockFetchJson({ activated: true });
    await validateLicense('KEY-B');
    const { instanceId: id2 } = await storageGet('instanceId');

    expect(id1).toBe(id2);
  });
});
