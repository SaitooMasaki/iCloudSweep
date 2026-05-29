'use strict';

const PURCHASE_URL = 'https://saitoomasaki.lemonsqueezy.com/checkout/buy/ICLOUD_PRODUCT_ID';
const FREE_LIMIT = 100;

async function loadState() {
  return chrome.storage.local.get(['isPro', 'totalDeleted', 'skipFavorites', 'licenseKey', 'instanceId']);
}

async function init() {
  const data = await loadState();
  const isPro = !!data.isPro;
  const totalDeleted = data.totalDeleted || 0;

  // Badge
  const badge = document.getElementById('plan-badge');
  badge.textContent = isPro ? 'PRO' : 'FREE';
  badge.className = `badge ${isPro ? 'badge-pro' : 'badge-free'}`;

  // Lifetime usage
  document.getElementById('quota-val').textContent = `${totalDeleted} / ${FREE_LIMIT}`;

  // Skip favorites state
  const skipFavEl = document.getElementById('skip-fav-val');
  if (skipFavEl) skipFavEl.textContent = data.skipFavorites ? 'ON' : 'OFF';

  // Status — query the active tab's content script
  getContentScriptStatus().then(status => {
    const el = document.getElementById('status-val');
    if (status) {
      el.textContent = status.running ? 'Running' : 'Idle';
      if (status.running) el.classList.add('running');
    } else {
      el.textContent = 'Open iCloud Photos';
    }
  });

  // Show/hide sections
  document.getElementById('free-section').style.display = isPro ? 'none' : '';
  document.getElementById('pro-section').style.display = isPro ? '' : 'none';
  document.getElementById('quota-row').style.display = isPro ? 'none' : '';

  // Buy link
  const buyLink = document.getElementById('buy-link');
  if (buyLink) buyLink.href = PURCHASE_URL;

  // License activation
  document.getElementById('activate-btn')?.addEventListener('click', onActivate);

  // Deactivation
  document.getElementById('deactivate-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('deactivate-btn');
    btn.disabled = true;
    btn.textContent = '...';
    await chrome.runtime.sendMessage({
      action: 'deactivateLicense',
      key: data.licenseKey,
      instanceId: data.instanceId,
    });
    location.reload();
  });
}

async function getContentScriptStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('icloud.com/photos')) return null;
    return await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }).catch(() => null);
  } catch {
    return null;
  }
}

async function onActivate() {
  const key = document.getElementById('license-input').value.trim();
  if (!key) return;

  const btn = document.getElementById('activate-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'validateLicense', key });
    if (result.ok) {
      showMsg('✓ Pro activated!', 'success');
      setTimeout(() => location.reload(), 1200);
    } else {
      showMsg(`✗ ${result.error || 'Invalid key'}`, 'error');
    }
  } catch {
    showMsg('✗ Could not connect. Try again.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Activate';
}

function showMsg(text, type) {
  const el = document.getElementById('license-msg');
  el.textContent = text;
  el.className = `msg-${type}`;
}

init();
