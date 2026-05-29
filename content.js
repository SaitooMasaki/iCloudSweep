'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  FREE_LIMIT: 100,
  PURCHASE_URL: 'https://saitoomasaki.lemonsqueezy.com/checkout/buy/28528f36-8e19-4add-97e9-bcf52fb8d395',
  DELAY_MS: 1000,
  PANEL_ID: 'is-panel',
};

// iCloud Photos DOM selectors — multiple fallbacks per action because Apple
// renames classes frequently. Selectors are tried in order; first match wins.
const SEL = {
  // "Select" toolbar button to enter selection mode
  enterSelect: [
    'button[aria-label="Select"]',
    'button[title="Select"]',
    '[data-testid="select-button"]',
    'button.select-button',
    'button[class*="SelectButton"]',
    'button[class*="select-button"]',
  ],

  // "Select All" button (visible only in selection mode)
  selectAll: [
    'button[aria-label="Select All"]',
    'button[title="Select All"]',
    '[data-testid="select-all-button"]',
    'button[class*="SelectAll"]',
    'button[class*="select-all"]',
  ],

  // Individual photo / asset tiles in the grid
  photoItems: [
    '[data-asset-guid]',
    '[data-photo-guid]',
    '[data-item-guid]',
    'figure[class*="photo"]',
    'figure[class*="asset"]',
    'figure[class*="Photo"]',
    'figure[class*="Asset"]',
    '[class*="PhotoTile"]',
    '[class*="AssetTile"]',
    '[class*="photo-tile"]',
    '[class*="asset-tile"]',
    '[class*="PhotoCell"]',
    '[class*="AssetCell"]',
    '[role="option"]',
    '[role="checkbox"]',
  ],

  // Selected items (to count how many are selected)
  selectedItems: [
    '[aria-selected="true"]',
    '[data-selected="true"]',
    '[class*="selected"] figure',
    'figure[class*="selected"]',
    'figure[class*="Selected"]',
    '[class*="is-selected"]',
  ],

  // Delete button (active after selecting photos)
  deleteButton: [
    'button[aria-label="Delete"]',
    'button[title="Delete"]',
    'button[aria-label="Move to Trash"]',
    'button[title="Move to Trash"]',
    'button[aria-label*="Delete"]',
    'button[class*="delete-button"]',
    'button[class*="DeleteButton"]',
    '[data-testid="delete-button"]',
    '[data-testid="trash-button"]',
  ],

  // Confirmation "Delete" / "Move to Trash" button inside dialog
  confirmButton: [
    '[role="dialog"] button.destructive',
    '[role="alertdialog"] button.destructive',
    '[role="dialog"] button[class*="destructive"]',
    '[role="alertdialog"] button[class*="destructive"]',
    '[role="dialog"] button[class*="Destructive"]',
    'button[class*="destructive"]',
  ],

  // "Cancel" or "Done" button to exit selection mode
  cancelSelect: [
    'button[aria-label="Cancel"]',
    'button[title="Cancel"]',
    'button[aria-label="Done"]',
    'button[title="Done"]',
    'button[class*="cancel-button"]',
    'button[class*="CancelButton"]',
  ],

  // Photo scroll container
  scrollContainer: [
    '[class*="scroll-container"]',
    '[class*="ScrollContainer"]',
    '[class*="photo-grid"]',
    '[class*="PhotoGrid"]',
    '[class*="asset-grid"]',
    '[class*="AssetGrid"]',
    '[class*="photo-list"]',
    '[role="list"]',
    '[role="grid"]',
  ],

  // Favorite / heart indicators — checked INSIDE each photo element
  favoriteMarkers: [
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
  ],
};

// ─── Runtime state ────────────────────────────────────────────────────────────
let running = false;
let paused = false;
let abortFlag = false;
let isPro = false;
let totalDeleted = 0;
let skipFavorites = false;
let errorCount = 0;
let noPhotosStreak = 0;
let pauseResolve = null;
let userClosed = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadStorage() {
  const data = await chrome.storage.local.get(['isPro', 'totalDeleted', 'skipFavorites']);
  isPro = !!data.isPro;
  // totalDeleted is cumulative and never resets
  totalDeleted = data.totalDeleted || 0;
  skipFavorites = !!data.skipFavorites;
}

async function saveTotalDeleted() {
  await chrome.storage.local.set({ totalDeleted });
}

async function saveSkipFavorites(val) {
  skipFavorites = val;
  await chrome.storage.local.set({ skipFavorites: val });
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && el.checkVisibility?.({ visibilityProperty: true }) !== false;
}

function tryFind(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    } catch (_) {}
  }
  return null;
}

function tryFindAll(selectors) {
  for (const sel of selectors) {
    try {
      const els = [...document.querySelectorAll(sel)].filter(isVisible);
      if (els.length > 0) return els;
    } catch (_) {}
  }
  return [];
}

// Find buttons by text content / aria-label / title
function findButtonByText(texts) {
  const candidates = [...document.querySelectorAll('button, [role="button"]')];
  const terms = Array.isArray(texts) ? texts : [texts];
  for (const term of terms) {
    const t = term.toLowerCase();
    const btn = candidates.find(el => {
      if (!isVisible(el)) return false;
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const text = (el.textContent?.trim() || '').toLowerCase();
      return label === t || title === t || text === t || label.includes(t) || title.includes(t);
    });
    if (btn) return btn;
  }
  return null;
}

// Find confirm button inside an open dialog
function findConfirmInDialog() {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  if (!dialog) return null;

  const btns = [...dialog.querySelectorAll('button')].filter(isVisible);
  // Prefer a button with "delete" / "move" / "ok" text or destructive styling
  const priority = btns.find(b => {
    const text = (b.textContent?.trim() || '').toLowerCase();
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    return text === 'delete' || text === 'move to trash' || text === 'remove'
      || label === 'delete' || label === 'move to trash';
  });
  if (priority) return priority;

  // Fallback: destructive class
  const destructive = btns.find(b =>
    /destructive|danger|primary/i.test(b.className)
  );
  if (destructive) return destructive;

  // Last resort: last button in dialog (usually the confirm action)
  return btns[btns.length - 1] || null;
}

// ─── iCloud Photos interaction ────────────────────────────────────────────────
function isInSelectionMode() {
  const cancel = tryFind(SEL.cancelSelect) || findButtonByText(['Cancel', 'Done']);
  if (cancel) return true;
  const selectAll = tryFind(SEL.selectAll) || findButtonByText(['Select All', 'Select all']);
  return !!selectAll;
}

async function enterSelectionMode() {
  if (isInSelectionMode()) return true;

  let btn = tryFind(SEL.enterSelect);
  if (!btn) btn = findButtonByText(['Select', 'Select Photos', 'Select Items']);
  if (!btn) return false;

  btn.click();
  await sleep(400);
  return true;
}

async function exitSelectionMode() {
  const btn = tryFind(SEL.cancelSelect) || findButtonByText(['Cancel', 'Done']);
  if (btn) {
    btn.click();
    await sleep(300);
  }
}

async function selectAllVisible() {
  let btn = tryFind(SEL.selectAll);
  if (!btn) btn = findButtonByText(['Select All', 'Select all']);
  if (btn) {
    btn.click();
    await sleep(500);
    return true;
  }

  // Fallback: Cmd+A (macOS) or Ctrl+A
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'a', code: 'KeyA', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await sleep(500);
  return true;
}

function countSelected() {
  for (const sel of SEL.selectedItems) {
    try {
      const n = document.querySelectorAll(sel).length;
      if (n > 0) return n;
    } catch (_) {}
  }
  // No selection indicators found — return 0 rather than falling back to total
  // photo count, which would give a false positive when all favorites were deselected.
  return 0;
}

async function clickDeleteButton() {
  let btn = tryFind(SEL.deleteButton);
  if (!btn) btn = findButtonByText(['Delete', 'Move to Trash', 'Move to Recently Deleted']);
  if (!btn) return false;
  btn.click();
  return true;
}

async function confirmDeletion() {
  await sleep(600);

  // Retry a couple of times — dialog may animate in
  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = findConfirmInDialog()
      || findButtonByText(['Delete', 'Move to Trash', 'Move to Recently Deleted', 'Remove']);
    if (btn) {
      btn.click();
      await sleep(500);
      return true;
    }
    await sleep(400);
  }
  return false;
}

// ─── Favorites helpers ────────────────────────────────────────────────────────

// Returns true if the given photo tile element contains a favorite indicator.
function hasFavoriteIndicator(photoEl) {
  // 1. Check child elements for known favorite markers
  for (const sel of SEL.favoriteMarkers) {
    try {
      if (photoEl.querySelector(sel)) return true;
    } catch (_) {}
  }

  // 2. Check the element itself and its immediate parent
  for (const el of [photoEl, photoEl.parentElement].filter(Boolean)) {
    const cls = (el.className || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (cls.includes('favorit') || label.includes('favorit') || title.includes('favorit')) {
      return true;
    }
  }

  return false;
}

// After "Select All", deselect any photo that is marked as a favorite.
// Returns the number of photos deselected.
async function deselectFavorites() {
  // Collect the current selection — try SEL.selectedItems first, fall back to all photo items
  let pool = [];
  for (const sel of SEL.selectedItems) {
    try {
      const items = [...document.querySelectorAll(sel)].filter(isVisible);
      if (items.length > 0) { pool = items; break; }
    } catch (_) {}
  }
  if (pool.length === 0) pool = tryFindAll(SEL.photoItems);

  let deselectedCount = 0;
  for (const photo of pool) {
    if (hasFavoriteIndicator(photo)) {
      // Click once to deselect
      photo.click();
      await sleep(40);
      deselectedCount++;
    }
  }
  return deselectedCount;
}

function scrollToLoadMore() {
  // Try to scroll the photos container
  const container = tryFind(SEL.scrollContainer);
  if (container) {
    container.scrollTop += container.clientHeight;
  }
  // Also scroll the window
  window.scrollBy(0, window.innerHeight);
  document.documentElement.scrollTop += window.innerHeight;
}

async function waitForPhotosToLoad() {
  const maxWait = 8_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (tryFindAll(SEL.photoItems).length > 0) return true;
    await sleep(600);
  }
  return false;
}

// ─── Deletion engine ──────────────────────────────────────────────────────────
async function tryDeleteBatch() {
  if (!location.href.includes('icloud.com/photos')) {
    return { count: 0, error: 'Not on iCloud Photos page' };
  }

  // Enter selection mode
  if (!await enterSelectionMode()) {
    return { count: 0, error: 'Cannot enter selection mode — "Select" button not found' };
  }
  await sleep(400);

  // Check if there are photos
  const photos = tryFindAll(SEL.photoItems);
  if (photos.length === 0) {
    await exitSelectionMode();
    return { count: 0, error: null }; // no photos found; caller will retry/scroll
  }

  // Select all
  await selectAllVisible();
  await sleep(300);

  // Deselect favorites if the option is enabled
  let skippedFav = 0;
  if (skipFavorites) {
    skippedFav = await deselectFavorites();
    if (skippedFav > 0) {
      setStatus(`Skipped ${skippedFav} favorite(s). Deleting the rest…`);
      await sleep(200);
    }
  }

  const selected = countSelected();
  if (selected === 0) {
    await exitSelectionMode();
    // If everything was favorites, that's not an error — just move on
    if (skippedFav > 0) return { count: 0, skippedAll: true, error: null };
    return { count: 0, error: 'Could not select photos' };
  }

  // Delete
  if (!await clickDeleteButton()) {
    await exitSelectionMode();
    return { count: 0, error: 'Delete button not found after selecting photos' };
  }

  // Confirm dialog
  await confirmDeletion();

  // Wait for iCloud to process (1000ms as per spec)
  await sleep(CFG.DELAY_MS);

  return { count: selected };
}

async function runDeletion() {
  running = true;
  paused = false;
  abortFlag = false;
  errorCount = 0;
  noPhotosStreak = 0;
  $('#is-not-working')?.style && ($('#is-not-working').style.display = 'none');
  updateUI();

  setStatus('Waiting for iCloud Photos to load...');
  await waitForPhotosToLoad();

  while (!abortFlag) {
    // Pause check
    if (paused) {
      setStatus('Paused');
      updateUI();
      await new Promise(r => { pauseResolve = r; });
      setStatus('Resuming...');
      updateUI();
    }

    // Free limit check
    if (!isPro && totalDeleted >= CFG.FREE_LIMIT) {
      showLimitReached();
      break;
    }

    setStatus('Selecting photos...');

    let result;
    try {
      result = await tryDeleteBatch();
    } catch (e) {
      result = { count: 0, error: e.message };
    }

    if (result.error) {
      errorCount++;
      if (errorCount >= 3) {
        setStatus('⚠ Extension is not working. iCloud Photos UI may have changed. Please wait for an update.');
        showNotWorkingError();
        break;
      }
      setStatus(`Retrying… (${result.error})`);
      await sleep(2_000);
      continue;
    }

    if (result.count === 0) {
      noPhotosStreak++;
      if (noPhotosStreak >= 3) {
        const doneMsg = totalDeleted > 0
          ? `All done! ${totalDeleted} photo(s) moved to Recently Deleted.`
          : 'No deletable photos found (all may be Favorites, or library is empty).';
        setStatus(doneMsg);
        break;
      }
      setStatus('Scrolling to load more photos…');
      scrollToLoadMore();
      await sleep(2_000);
      continue;
    }

    errorCount = 0;
    noPhotosStreak = 0;
    totalDeleted += result.count;
    await saveTotalDeleted();
    updateProgress();
    setStatus(`${totalDeleted} photo(s) moved to Recently Deleted…`);
  }

  running = false;
  updateUI();
}

// ─── Panel HTML ───────────────────────────────────────────────────────────────
function buildPanelHTML() {
  return `
<div id="${CFG.PANEL_ID}" class="is-panel">
  <div class="is-header">
    <div class="is-title">
      <svg class="is-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
      <span>iCloudSweep</span>
    </div>
    <div class="is-header-actions">
      <span id="is-badge" class="is-badge is-badge-free">FREE</span>
      <button id="is-minimize-btn" class="is-icon-btn" title="Minimize">–</button>
      <button id="is-close-btn" class="is-icon-btn" title="Close">✕</button>
    </div>
  </div>

  <div id="is-body">

    <!-- Info notices -->
    <div class="is-notice">
      <svg class="is-notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <div class="is-notice-text">
        Photos are moved to <strong>Recently Deleted</strong>, not permanently removed.<br>
        Keep this iCloud Photos tab open while deletion is running.
      </div>
    </div>

    <!-- Not-working error banner -->
    <div id="is-not-working" class="is-error-box" style="display:none">
      This extension is not currently working.<br>
      iCloud Photos UI may have changed.<br>
      Please wait for an update.
    </div>

    <!-- Progress section -->
    <div class="is-section">
      <div id="is-status-text" class="is-status-text">Ready — click Start to begin bulk deletion.</div>
      <div class="is-progress-track">
        <div id="is-progress-fill" class="is-progress-fill" style="width:0%"></div>
      </div>
      <div class="is-progress-meta">
        <span><strong id="is-done-count">0</strong> moved to trash</span>
        <span id="is-quota-info" class="is-muted">Free: <strong id="is-used-count">0</strong> / ${CFG.FREE_LIMIT}</span>
      </div>
    </div>

    <!-- Limit reached CTA -->
    <div id="is-limit-cta" class="is-section is-limit-cta" style="display:none">
      <div class="is-limit-text">
        Free limit (${CFG.FREE_LIMIT} photos total) reached.
      </div>
      <a href="${CFG.PURCHASE_URL}" target="_blank" rel="noopener" class="is-upgrade-btn">
        Upgrade to Pro — Unlimited →
      </a>
    </div>

    <!-- Options -->
    <div class="is-section">
      <label class="is-option-row" id="is-skip-fav-label">
        <span class="is-option-text">
          <svg class="is-heart" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          Skip Favorites
        </span>
        <div class="is-toggle">
          <input type="checkbox" id="is-skip-fav-check" class="is-toggle-input">
          <span class="is-toggle-track">
            <span class="is-toggle-thumb"></span>
          </span>
        </div>
      </label>
    </div>

    <!-- Action buttons -->
    <div class="is-actions">
      <button id="is-start-btn" class="is-btn is-btn-primary">Start</button>
      <button id="is-pause-btn" class="is-btn is-btn-secondary" style="display:none">Pause</button>
      <button id="is-stop-btn"  class="is-btn is-btn-danger"    style="display:none">Stop</button>
    </div>

    <!-- License key -->
    <div id="is-license-area" class="is-section is-license-area">
      <div class="is-field-label">Have a license key?</div>
      <div class="is-license-row">
        <input type="text" id="is-license-input" class="is-input is-license-input"
               placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
        <button id="is-activate-btn" class="is-btn is-btn-xs is-btn-accent">Activate</button>
      </div>
      <div id="is-license-msg" class="is-license-msg"></div>
    </div>

  </div>
</div>`;
}

// ─── Panel events ─────────────────────────────────────────────────────────────
function bindPanelEvents() {
  $('#is-close-btn').onclick = () => {
    userClosed = true;
    document.getElementById(CFG.PANEL_ID)?.remove();
  };

  let minimized = false;
  $('#is-minimize-btn').onclick = () => {
    minimized = !minimized;
    $('#is-body').style.display = minimized ? 'none' : '';
    $('#is-minimize-btn').textContent = minimized ? '□' : '–';
  };

  // Skip favorites toggle
  const skipFavCheck = $('#is-skip-fav-check');
  if (skipFavCheck) {
    skipFavCheck.checked = skipFavorites;
    skipFavCheck.addEventListener('change', () => saveSkipFavorites(skipFavCheck.checked));
  }

  $('#is-start-btn').onclick = onStart;
  $('#is-pause-btn').onclick = onPause;
  $('#is-stop-btn').onclick = onStop;
  $('#is-activate-btn').onclick = onActivate;
}

async function onStart() {
  if (running) return;
  $('#is-limit-cta').style.display = 'none';
  $('#is-not-working').style.display = 'none';
  runDeletion();
}

function onPause() {
  if (!running) return;
  if (paused) {
    paused = false;
    pauseResolve?.();
    pauseResolve = null;
  } else {
    paused = true;
  }
  updateUI();
}

function onStop() {
  abortFlag = true;
  paused = false;
  pauseResolve?.();
  pauseResolve = null;
  running = false;
  setStatus('Stopped.');
  updateUI();
}

async function onActivate() {
  const key = $('#is-license-input')?.value.trim();
  if (!key) return;

  const btn = $('#is-activate-btn');
  btn.disabled = true;
  btn.textContent = '...';
  $('#is-license-msg').textContent = '';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'validateLicense', key });
    if (result.ok) {
      isPro = true;
      showLicenseMsg('✓ Pro activated! All limits removed.', 'success');
      refreshUIForProStatus();
    } else {
      showLicenseMsg(`✗ ${result.error || 'Invalid key'}`, 'error');
    }
  } catch (e) {
    showLicenseMsg('✗ Could not connect. Try again.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Activate';
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(msg) {
  const el = $('#is-status-text');
  if (el) el.textContent = msg;
}

function updateProgress() {
  const dc = $('#is-done-count');
  if (dc) dc.textContent = totalDeleted;

  const uc = $('#is-used-count');
  if (uc) uc.textContent = totalDeleted;

  const fill = $('#is-progress-fill');
  if (fill) {
    const pct = isPro
      ? (totalDeleted > 0 ? 100 : 0)
      : Math.min((totalDeleted / CFG.FREE_LIMIT) * 100, 100);
    fill.style.width = `${pct.toFixed(1)}%`;
  }
}

function updateUI() {
  const startBtn = $('#is-start-btn');
  const pauseBtn = $('#is-pause-btn');
  const stopBtn  = $('#is-stop-btn');
  const skipFavCheck = $('#is-skip-fav-check');

  if (running) {
    startBtn && (startBtn.style.display = 'none');
    pauseBtn && (pauseBtn.style.display = '');
    stopBtn  && (stopBtn.style.display  = '');
    if (pauseBtn) pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    // Disable options while running
    if (skipFavCheck) skipFavCheck.disabled = true;
    const lbl = $('#is-skip-fav-label');
    if (lbl) lbl.style.opacity = '0.5';
  } else {
    startBtn && (startBtn.style.display = '');
    pauseBtn && (pauseBtn.style.display = 'none');
    stopBtn  && (stopBtn.style.display  = 'none');
    if (skipFavCheck) skipFavCheck.disabled = false;
    const lbl = $('#is-skip-fav-label');
    if (lbl) lbl.style.opacity = '';
  }

  updateProgress();
}

function refreshUIForProStatus() {
  const badge = $('#is-badge');
  if (badge) {
    badge.textContent = isPro ? 'PRO' : 'FREE';
    badge.className = `is-badge ${isPro ? 'is-badge-pro' : 'is-badge-free'}`;
  }

  const quotaInfo = $('#is-quota-info');
  if (quotaInfo) quotaInfo.style.display = isPro ? 'none' : '';

  const licArea = $('#is-license-area');
  if (licArea) licArea.style.display = isPro ? 'none' : '';
}

function showLimitReached() {
  const cta = $('#is-limit-cta');
  if (cta) cta.style.display = '';
  setStatus(`Free limit (${CFG.FREE_LIMIT} photos lifetime) reached.`);
}

function showNotWorkingError() {
  const el = $('#is-not-working');
  if (el) el.style.display = '';
}

function showLicenseMsg(text, type) {
  const el = $('#is-license-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `is-license-msg is-license-msg-${type}`;
}

// ─── Panel injection ──────────────────────────────────────────────────────────
function injectPanel() {
  if (document.getElementById(CFG.PANEL_ID)) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildPanelHTML();
  document.body.appendChild(tmp.firstElementChild);
  bindPanelEvents();
  refreshUIForProStatus();
  updateProgress();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (document.getElementById(CFG.PANEL_ID)) return;

  await loadStorage();
  injectPanel();

  // Re-inject panel after iCloud's SPA navigation (URL changes without full reload)
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (!userClosed && !document.getElementById(CFG.PANEL_ID)) {
        injectPanel();
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse({ running, paused, totalDeleted });
    return true;
  }
});

init();
