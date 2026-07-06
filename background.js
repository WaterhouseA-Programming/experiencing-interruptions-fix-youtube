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

const DONATE_URL = 'https://buymeacoffee.com/nimblepanda';

// Where updated rules are fetched from. Users can change this in Options.
const DEFAULT_RULES_URL =
  'https://raw.githubusercontent.com/nimblepanda/experiencing-interruptions-fix-youtube/main/rules.json';

const DEFAULT_SETTINGS = {
  enabled: true,
  autoUpdate: true,
  rulesUrl: DEFAULT_RULES_URL,
  // Cached remote rules (empty until first successful fetch).
  remotePopupSelectors: [],
  remoteBackdropSelectors: [],
  remoteRulesVersion: 0,
  lastUpdated: null,
  lastUpdateError: null,
};

const UPDATE_ALARM = 'ei-fix-rules-update';
const UPDATE_PERIOD_MINUTES = 360; // every 6 hours

// ---- lifecycle ------------------------------------------------------------

api.runtime.onInstalled.addListener(async (details) => {
  const stored = await api.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  // Fill in any missing keys with defaults (safe across upgrades).
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  await api.storage.local.set(merged);

  if (details.reason === 'install') {
    api.tabs.create({ url: DONATE_URL });
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
  if (alarm.name === UPDATE_ALARM) updateRules().catch(() => {});
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

async function updateRules() {
  const { enabled, autoUpdate, rulesUrl } = await api.storage.local.get([
    'enabled',
    'autoUpdate',
    'rulesUrl',
  ]);

  if (enabled === false || autoUpdate === false) return { skipped: true };

  const url = rulesUrl || DEFAULT_RULES_URL;

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const popup = sanitizeSelectorList(data.popupSelectors);
    const backdrop = sanitizeSelectorList(data.backdropSelectors);
    const version = Number(data.version) || 0;

    await api.storage.local.set({
      remotePopupSelectors: popup,
      remoteBackdropSelectors: backdrop,
      remoteRulesVersion: version,
      lastUpdated: new Date().toISOString(),
      lastUpdateError: null,
    });

    return { version, popupCount: popup.length, backdropCount: backdrop.length };
  } catch (err) {
    await api.storage.local.set({ lastUpdateError: String(err) });
    throw err;
  }
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
