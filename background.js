'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'validateLicense') {
    validateLicense(msg.key)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.action === 'deactivateLicense') {
    deactivateLicense(msg.key, msg.instanceId)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function getOrCreateInstanceId() {
  const data = await chrome.storage.local.get('instanceId');
  if (data.instanceId) return data.instanceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ instanceId: id });
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

  await chrome.storage.local.set({ licenseKey: key, isPro: true, instanceId });
  return { ok: true };
}

async function deactivateLicense(key, instanceId) {
  await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_id: instanceId }),
  }).catch(() => {});
  await chrome.storage.local.remove(['licenseKey', 'isPro']);
  return { ok: true };
}
