// Same-origin by default. If the Worker API is hosted on a different domain
// than the Pages frontend, set this to that origin (e.g. via a <meta> tag).
const API_BASE = '';

// Title tests compare titles against each other, so at least 2 variants are
// required. Thumbnail tests can just track a single thumbnail's performance.
const MIN_VARIANTS = { title: 2, thumbnail: 1 };

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function qs(id) {
  return document.getElementById(id);
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });
}

// Returns an error message string if the URL doesn't belong on the given
// link type, or null if it's valid. Only openinapp/creatorurls have a known,
// fixed link format; affiliate/other links vary by platform so we only
// require them to be a well-formed URL.
function validateLinkUrl(type, urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'Enter a valid URL.';
  }
  const host = parsed.hostname.toLowerCase();
  const isOpenInAppHost = (h) =>
    h === 'openinapp.co' || h.endsWith('.openinapp.co') || h === 'oia.bio' || h.endsWith('.oia.bio');
  if (type === 'openinapp') {
    if (!isOpenInAppHost(host)) {
      return 'OpenInApp links must be on openinapp.co or oia.bio.';
    }
  } else if (type === 'creatorurls') {
    if ((host !== 'creatorurls.com' && !host.endsWith('.creatorurls.com')) || !parsed.pathname.startsWith('/tns/s/')) {
      return 'CreatorURLs links must look like https://creatorurls.com/tns/s/...';
    }
  }
  return null;
}

function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = qs('confirm-modal');
    qs('confirm-modal-message').textContent = message;
    overlay.style.display = 'flex';

    const confirmBtn = qs('confirm-modal-confirm');
    const cancelBtn = qs('confirm-modal-cancel');

    function cleanup(result) {
      overlay.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// Set up once per page. Click the overlay (or press Escape) to close;
// clicking the image itself doesn't close it.
function initImageLightbox() {
  const overlay = qs('image-lightbox');
  if (!overlay) return;
  const img = qs('image-lightbox-img');

  function close() {
    overlay.style.display = 'none';
    img.src = '';
  }

  overlay.addEventListener('click', close);
  img.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') close();
  });

  window.openImageLightbox = (src, alt) => {
    img.src = src;
    img.alt = alt || '';
    overlay.style.display = 'flex';
  };
}

function statusBadge(status) {
  const span = document.createElement('span');
  span.className = `badge ${status}`;
  span.textContent = status;
  return span;
}

// Small inline icons so test-status badges are distinguishable by shape, not
// just color — useful once a thumbnail-test badge sits next to this one.
const TITLE_TEST_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

const THUMBNAIL_TEST_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2.5"/>' +
  '<path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>';

function iconBadge(className, label, iconMarkup, tooltip) {
  const span = document.createElement('span');
  span.className = `badge badge-icon ${className}`;
  if (tooltip) span.title = tooltip;
  const icon = document.createElement('span');
  icon.className = 'badge-icon-glyph';
  icon.innerHTML = iconMarkup;
  icon.setAttribute('aria-hidden', 'true');
  span.appendChild(icon);
  const text = document.createElement('span');
  text.textContent = label;
  span.appendChild(text);
  return span;
}

// Derives a badge for the most recently created test of the given type
// ('title' | 'thumbnail') for a video. A test with no end_date yet is treated
// as still running. Returns null if the video has no test of that type.
function testBadge(item, type) {
  const status = item[`${type}_test_status`];
  if (!status) return null;
  let state;
  let label;
  if (!item[`${type}_test_end_date`]) {
    state = 'progress';
    label = 'In Progress';
  } else if (status === 'conclusive') {
    state = 'conclusive';
    label = 'Conclusive';
  } else {
    state = 'inconclusive';
    label = 'Inconclusive';
  }
  const typeLabel = type === 'title' ? 'Title' : 'Thumbnail';
  const icon = type === 'title' ? TITLE_TEST_ICON : THUMBNAIL_TEST_ICON;
  const badge = iconBadge(`test-${state}`, label, icon);
  badge.setAttribute('aria-label', `${typeLabel} test: ${label}`);
  badge.tabIndex = 0;
  attachTestTooltip(badge, item.video_id, type, typeLabel, label);
  return badge;
}

// Hover/focus tooltip summarising the latest test of a type. Full test rows
// aren't in the list payload, so they're fetched lazily and cached per video.
const testDetailCache = new Map();
let testTooltipEl = null;
let testTooltipHideTimer = null;

function hideTestTooltip() {
  if (testTooltipEl) {
    testTooltipEl.style.display = 'none';
    testTooltipEl.dataset.owner = '';
  }
}

// Short delay so the cursor can cross the gap from badge to tooltip; the
// tooltip itself cancels the timer, which keeps it open for text selection.
function scheduleHideTestTooltip() {
  clearTimeout(testTooltipHideTimer);
  testTooltipHideTimer = setTimeout(hideTestTooltip, 150);
}

function fetchTestDetail(videoId) {
  if (!testDetailCache.has(videoId)) {
    const p = fetch(`/api/content/${encodeURIComponent(videoId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .catch((err) => {
        testDetailCache.delete(videoId);
        throw err;
      });
    testDetailCache.set(videoId, p);
  }
  return testDetailCache.get(videoId);
}

function buildTestTooltipBody(el, content, type, typeLabel, label) {
  el.textContent = '';
  const head = document.createElement('div');
  head.className = 'test-tooltip-head';
  head.textContent = `${typeLabel} test · ${label}`;
  el.appendChild(head);

  const tests = (content.tests || []).filter((t) => t.test_type === type);
  const test = tests[tests.length - 1]; // tests are ordered by created_at
  if (!test) {
    el.appendChild(document.createTextNode('No details available.'));
    return;
  }
  const dates = formatDateRange(test.start_date, test.end_date);
  if (dates) {
    const d = document.createElement('div');
    d.className = 'test-tooltip-dates';
    d.textContent = dates;
    el.appendChild(d);
  }
  if (test.notes) {
    const n = document.createElement('div');
    n.className = 'test-tooltip-notes';
    n.textContent = test.notes;
    el.appendChild(n);
  }
  for (const v of test.variants || []) {
    const row = document.createElement('div');
    row.className = 'test-tooltip-variant';
    if (type === 'thumbnail') {
      const img = document.createElement('img');
      img.src = v.value;
      img.alt = '';
      row.appendChild(img);
    } else {
      const t = document.createElement('span');
      t.textContent = v.value;
      row.appendChild(t);
    }
    const share = document.createElement('span');
    share.className = 'share';
    share.textContent =
      v.watch_time_share !== null && v.watch_time_share !== undefined ? `${v.watch_time_share}%` : '—';
    row.appendChild(share);
    el.appendChild(row);
  }
}

function attachTestTooltip(badge, videoId, type, typeLabel, label) {
  const show = () => {
    if (!testTooltipEl) {
      testTooltipEl = document.createElement('div');
      testTooltipEl.className = 'test-tooltip';
      testTooltipEl.setAttribute('role', 'tooltip');
      testTooltipEl.addEventListener('mouseenter', () => clearTimeout(testTooltipHideTimer));
      testTooltipEl.addEventListener('mouseleave', scheduleHideTestTooltip);
      document.body.appendChild(testTooltipEl);
    }
    clearTimeout(testTooltipHideTimer);
    const el = testTooltipEl;
    el.dataset.owner = `${videoId}:${type}`;
    el.textContent = 'Loading…';
    el.style.display = 'block';
    const place = () => {
      const r = badge.getBoundingClientRect();
      // At least as wide as the badge so every part of it sits directly above
      // the popup, even while it only says "Loading…".
      el.style.minWidth = `${r.width}px`;
      const w = el.offsetWidth;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 6 + el.offsetHeight <= window.innerHeight;
      el.style.left = `${left}px`;
      el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 6 - el.offsetHeight)}px`;
    };
    place();
    fetchTestDetail(videoId)
      .then((content) => {
        if (el.dataset.owner !== `${videoId}:${type}`) return;
        buildTestTooltipBody(el, content, type, typeLabel, label);
        place();
      })
      .catch(() => {
        if (el.dataset.owner !== `${videoId}:${type}`) return;
        el.textContent = 'Could not load test details.';
        place();
      });
  };
  badge.addEventListener('mouseenter', show);
  badge.addEventListener('mouseleave', scheduleHideTestTooltip);
  badge.addEventListener('focus', show);
  badge.addEventListener('blur', scheduleHideTestTooltip);
}

// Test column: one badge per test type that has been run on the video, or a
// single "None" badge if neither has.
function testBadges(item) {
  const wrap = document.createElement('div');
  wrap.className = 'test-badges';
  const badges = ['title', 'thumbnail'].map((t) => testBadge(item, t)).filter(Boolean);
  if (badges.length === 0) {
    wrap.appendChild(iconBadge('test-none', 'None', '', 'No tests run'));
  } else {
    badges.forEach((b) => wrap.appendChild(b));
  }
  return wrap;
}

function formatDate(value) {
  if (!value) return '';
  // Plain "YYYY-MM-DD" values (from <input type="date">) have no time
  // component, so `new Date(value)` parses them as UTC midnight — converting
  // that to local time for display can roll it back a day in timezones
  // behind UTC. Parse the components directly as a local date instead.
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateRange(start, end) {
  if (!start && !end) return 'Dates not recorded';
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start || end);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Thumbnails are stored as base64 directly in a D1 TEXT column, which has a
// hard per-value size limit (SQLITE_TOOBIG if exceeded). A raw phone/camera
// image easily blows past that, so downscale to a reasonable thumbnail size
// and re-encode as JPEG before it's ever base64-encoded.
function compressImageToDataUrl(file, maxWidth = 640, maxHeight = 360, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read image file'));
    };
    img.src = objectUrl;
  });
}

function addVariantRow(container, placeholder, inputType = 'text', initial = null) {
  const row = document.createElement('div');
  row.className = 'variant-row';
  // Single source of truth for the current image value (as a data URL).
  // Updated by both the paste handler and the file-picker fallback.
  row.dataset.currentValue = (initial && initial.value) || '';

  if (inputType === 'file') {
    const pasteBox = document.createElement('div');
    pasteBox.className = 'variant-paste-box';
    pasteBox.tabIndex = 0;
    pasteBox.setAttribute('role', 'button');

    const preview = document.createElement('img');
    preview.className = 'variant-preview';

    const placeholderText = document.createElement('span');
    placeholderText.className = 'variant-paste-placeholder';
    placeholderText.textContent = 'Click here, then paste (⌘V) an image';

    function showValue(dataUrl) {
      if (dataUrl) {
        preview.src = dataUrl;
        preview.style.display = '';
        placeholderText.style.display = 'none';
      } else {
        preview.style.display = 'none';
        placeholderText.style.display = '';
      }
    }
    showValue(row.dataset.currentValue);

    function setImage(file) {
      if (!file) return;
      compressImageToDataUrl(file).then((dataUrl) => {
        row.dataset.currentValue = dataUrl;
        showValue(dataUrl);
      });
    }

    pasteBox.addEventListener('paste', (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        setImage(item.getAsFile());
      }
    });

    pasteBox.appendChild(preview);
    pasteBox.appendChild(placeholderText);
    row.appendChild(pasteBox);

    // Hidden fallback for picking a file the old way, for anyone without
    // an image on their clipboard.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'variant-file-fallback';
    fileInput.addEventListener('change', () => setImage(fileInput.files[0]));

    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'small secondary';
    browseBtn.textContent = 'or choose a file';
    browseBtn.addEventListener('click', () => fileInput.click());

    row.appendChild(fileInput);
    row.appendChild(browseBtn);
  } else {
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = placeholder;
    valueInput.value = (initial && initial.value) || '';
    row.appendChild(valueInput);
  }

  const shareInput = document.createElement('input');
  shareInput.type = 'number';
  shareInput.min = '0';
  shareInput.max = '100';
  shareInput.step = '0.1';
  shareInput.placeholder = 'Watch time share %';
  if (initial && initial.watch_time_share !== null && initial.watch_time_share !== undefined) {
    shareInput.value = initial.watch_time_share;
  }
  row.appendChild(shareInput);

  container.appendChild(row);
}

function readVariantRows(container) {
  const rows = Array.from(container.querySelectorAll('.variant-row'));
  const variants = rows.map((row) => {
    const textInput = row.querySelector('input[type="text"]');
    const shareInput = row.querySelector('input[type="number"]');
    const value = textInput ? textInput.value.trim() : row.dataset.currentValue || '';
    return {
      value,
      watch_time_share: shareInput.value ? Number(shareInput.value) : null,
    };
  });
  return variants.filter((variant) => variant.value);
}

// Wires the shared nav-bar "Sync" button — it's present on every page since
// the nav is shared, so this lives here rather than in dashboard-only code.
// `onSynced(result, error)` runs after each attempt so a page can react (the
// dashboard refreshes its table and shows counts; other pages can no-op).
function initSyncButton(onSynced) {
  const syncButton = qs('sync-youtube');
  if (!syncButton) return;
  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing...';
    try {
      const result = await api('/api/sync/youtube', { method: 'POST' });
      if (onSynced) await onSynced(result, null);
    } catch (err) {
      if (onSynced) await onSynced(null, err);
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = 'Sync';
    }
  });
}

// Renders a small "i" glyph that shows `text` as a tooltip on hover/focus.
// Use next to a section header when the data there needs interpretation,
// not just display (e.g. what a CTR/watch-duration combination implies).
// Tooltip text is rendered via CSS (.info-tip::after, content: attr(data-tip)),
// not the native `title` attribute — title is slow to appear, inconsistent
// across browsers, and doesn't show at all on mobile/touch.
function infoTip(text) {
  const wrap = document.createElement('span');
  wrap.className = 'info-tip';
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', text);
  wrap.setAttribute('role', 'tooltip');
  wrap.dataset.tip = text;
  wrap.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="7" cy="7" r="6.5" stroke="currentColor"/>' +
    '<text x="7" y="11" text-anchor="middle" font-size="9" fill="currentColor">i</text></svg>';
  return wrap;
}
