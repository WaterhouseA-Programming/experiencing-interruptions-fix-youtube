// Background (event) page.
//
// Responsibilities:
//   1. On first install, open the donation tab and seed default settings.
//   2. Periodically fetch a remote "rules" file so the fix can be updated when
//      YouTube changes its markup, WITHOUT shipping a new extension version.
//
// SECURITY NOTE: the remote file only ever supplies CSS selector *strings*.
// They are handed to querySelectorAll() in the content script and are never
// evaluated as code, never inserted as HTML. A compromised rules file can, at
// worst, remove the wrong DOM node. No remote code is ever executed.

const api = typeof browser !== 'undefined' ? browser : chrome;

// Where updated rules are fetched from. Users can change this in Options.
const DEFAULT_RULES_URL =
  'https://raw.githubusercontent.com/WaterhouseA-Programming/experiencing-interruptions-fix-youtube/main/rules.json';

const DEFAULT_SETTINGS = {
  enabled: true,
  autoUpdate: true,
  rulesUrl: DEFAULT_RULES_URL,
  // Cached remote rules (empty until first successful fetch).
  remotePopupSelectors: [],
  remoteBackdropSelectors: [],
  remoteJsonPopupKeys: [],
  remoteAdKeys: [],
  remotePopupText: [],
  remoteMinTimeoutMs: 0,
  remoteRulesVersion: 0,
  lastUpdated: null,
  lastUpdateError: null,
  rulesRetryStep: 0,
};

const UPDATE_ALARM = 'ei-fix-rules-update';
const RETRY_ALARM = 'ei-fix-rules-retry';
const UPDATE_PERIOD_MINUTES = 360; // every 6 hours
// A fetch that fails at alarm time (offline, GitHub blip) would otherwise wait
// the full 6 hours to try again. Back off instead of hammering.
const RETRY_STEPS_MINUTES = [5, 15, 60];

// ---- lifecycle ------------------------------------------------------------

api.runtime.onInstalled.addListener(async (details) => {
  const stored = await api.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  // Fill in any missing keys with defaults (safe across upgrades).
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  await api.storage.local.set(merged);

  if (details.reason === 'install') {
    // Open a friendly welcome page (not the payment link directly).
    api.tabs.create({ url: api.runtime.getURL('welcome/welcome.html') });
  }

  scheduleUpdates();
  // Try an immediate refresh so first run has fresh rules.
  updateRules().catch(() => {});
});

api.runtime.onStartup?.addListener(() => {
  scheduleUpdates();
  updateRules().catch(() => {});
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM || alarm.name === RETRY_ALARM) {
    updateRules().catch(() => {});
  }
});

// Let the Options page trigger a manual refresh.
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'update-rules-now') {
    updateRules()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }
});

// ---- rules updating -------------------------------------------------------

function scheduleUpdates() {
  api.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MINUTES });
}

// Escalating one-shot retry after a failed fetch. The step is kept in storage
// because the event page can unload between attempts.
async function scheduleRetry() {
  const { rulesRetryStep } = await api.storage.local.get('rulesRetryStep');
  const step = Number(rulesRetryStep) || 0;
  const delay =
    RETRY_STEPS_MINUTES[Math.min(step, RETRY_STEPS_MINUTES.length - 1)];
  await api.storage.local.set({ rulesRetryStep: step + 1 });
  api.alarms.create(RETRY_ALARM, { delayInMinutes: delay });
}

async function updateRules() {
  const { autoUpdate, rulesUrl } = await api.storage.local.get([
    'autoUpdate',
    'rulesUrl',
  ]);

  // Deliberately not gated on `enabled`: rules must stay fresh while the fix
  // is toggled off, otherwise re-enabling it runs on rules up to 6 hours stale.
  // The content script already ignores every rule while disabled.
  if (autoUpdate === false) return { skipped: true };

  const url = rulesUrl || DEFAULT_RULES_URL;

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const popup = sanitizeSelectorList(data.popupSelectors);
    const backdrop = sanitizeSelectorList(data.backdropSelectors);
    const jsonKeys = sanitizeKeyList(data.jsonPopupKeys);
    const adKeys = sanitizeKeyList(data.adKeys);
    const text = sanitizeTextList(data.popupText);
    const minTimeoutMs = sanitizeTimeout(data.minTimeoutMs);
    const version = Number(data.version) || 0;

    await api.storage.local.set({
      remotePopupSelectors: popup,
      remoteBackdropSelectors: backdrop,
      remoteJsonPopupKeys: jsonKeys,
      remoteAdKeys: adKeys,
      remotePopupText: text,
      remoteMinTimeoutMs: minTimeoutMs,
      remoteRulesVersion: version,
      lastUpdated: new Date().toISOString(),
      lastUpdateError: null,
      rulesRetryStep: 0,
    });
    api.alarms.clear(RETRY_ALARM);

    return { version, popupCount: popup.length, backdropCount: backdrop.length };
  } catch (err) {
    await api.storage.local.set({ lastUpdateError: String(err) });
    await scheduleRetry().catch(() => {});
    throw err;
  }
}

// Threshold (ms) for page-hooks.js's anti-stall setTimeout squasher: timers
// with a delay >= this value are zeroed. 0 disables it. Clamped to a sane
// range; falls back to the 10 s default if the remote value is missing/invalid.
function sanitizeTimeout(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n <= 600000) return n;
  return 0;
}

// Substrings used by content.js to recognise the toast-style enforcement nag
// by its visible text. Data only — lowercased and compared with
// String.includes; never executed and never inserted as HTML.
function sanitizeTextList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 200)
    .slice(0, 50);
}

// JSON key names used by page-hooks.js to recognise enforcement popup
// payloads. Key names only — compared against object keys, never executed.
function sanitizeKeyList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === 'string' && /^[\w-]{1,100}$/.test(s))
    .slice(0, 50);
}

// Only accept short, plausible CSS selector strings. This is defensive: it
// keeps junk out of storage and caps how much we'll ever inject.
function sanitizeSelectorList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 200)
    .slice(0, 100);
}
