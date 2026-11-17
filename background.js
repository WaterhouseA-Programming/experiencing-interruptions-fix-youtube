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
  remotePruneAdKeys: true,
  remoteRulesVersion: 0,
  // Options: page-hooks.js (data layer) on/off, for ruling the add-on out.
  dataLayer: true,
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

  // content.js waits a week from this before asking for a review. Existing
  // users get it on their first update, so they wait a week too.
  const { installedAt } = await api.storage.local.get('installedAt');
  if (!installedAt) await api.storage.local.set({ installedAt: Date.now() });

  refreshBadge();
  diagAppend(details.reason, {
    from: details.previousVersion || undefined,
  });

  if (details.reason === 'install') {
    // Open a friendly welcome page (not the payment link directly).
    api.tabs.create({ url: api.runtime.getURL('welcome/welcome.html') });
  }

  scheduleUpdates();
  // Try an immediate refresh so first run has fresh rules.
  updateRules().catch(() => {});
});

// content.js reports a YouTube video stuck with no media data (usually a
// second ad blocker fighting uBlock Origin). Badge that tab's toolbar icon;
// the popup reads the badge back and shows the explanation.
// A tab-specific value overrides the optional global count badge; null
// hands the tab back to the global one when the stall clears.
api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'stall' || !sender.tab) return;
  const tabId = sender.tab.id;
  api.browserAction.setBadgeText({ tabId, text: msg.stalled ? '!' : null });
  api.browserAction.setBadgeBackgroundColor({
    tabId,
    color: msg.stalled ? '#d97706' : null,
  });
  if (msg.stalled) api.storage.local.set({ lastFailureAt: Date.now() });
});

// ---- diagnostic log -------------------------------------------------------
//
// A local ring buffer of what the add-on did and saw: nags removed and how,
// video load times, stalls, missed nags, rules updates and hook errors. It
// never leaves the device; the toolbar popup copies it as text for the user
// to paste wherever they are getting help. No URLs or video IDs go in it.

const DIAG_KEY = 'diagLog';
const DIAG_MAX = 400;
let diagQueue = Promise.resolve();

function cleanDiagData(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(d)) {
    if (n >= 16 || !/^[\w-]{1,32}$/.test(k)) continue;
    const v = d[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = Math.round(v * 10) / 10;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 2000);
    else continue;
    n++;
  }
  return out;
}

function diagAppend(e, d) {
  if (typeof e !== 'string' || !/^[\w-]{1,40}$/.test(e)) return diagQueue;
  const entry = { t: Date.now(), e, d: cleanDiagData(d) };
  diagQueue = diagQueue
    .then(async () => {
      const s = await api.storage.local.get(DIAG_KEY);
      const list = Array.isArray(s[DIAG_KEY]) ? s[DIAG_KEY] : [];
      list.push(entry);
      if (list.length > DIAG_MAX) list.splice(0, list.length - DIAG_MAX);
      await api.storage.local.set({ [DIAG_KEY]: list });
    })
    .catch(() => {});
  return diagQueue;
}

function pad(n, w) {
  return String(n).padStart(w || 2, '0');
}

function stamp(t) {
  const d = new Date(t);
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' +
    pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3)
  );
}

function fmtData(d) {
  return Object.keys(d || {})
    .map((k) => {
      const v = d[k];
      const s = String(v);
      return k + '=' + (/[\s"]/.test(s) ? JSON.stringify(s) : s);
    })
    .join(' ');
}

async function buildDiagText() {
  await diagQueue;
  const s = await api.storage.local.get(null);
  const log = Array.isArray(s[DIAG_KEY]) ? s[DIAG_KEY] : [];
  let browserLine = navigator.userAgent;
  try {
    const b = await api.runtime.getBrowserInfo();
    const p = await api.runtime.getPlatformInfo();
    browserLine = b.name + ' ' + b.version + ' (' + p.os + ')';
  } catch (_e) {}
  let privateLine = '?';
  try {
    privateLine = (await api.extension.isAllowedIncognitoAccess())
      ? 'allowed'
      : 'not allowed';
  } catch (_e) {}
  const onOff = (v) => (v === false ? 'off' : 'on');
  const loads = log
    .filter((x) => x.e === 'load' && typeof x.d.ms === 'number')
    .map((x) => x.d.ms)
    .sort((a, b) => a - b);
  const median = loads.length ? loads[Math.floor(loads.length / 2)] : 0;
  const lines = [
    'Experiencing Interruptions Fix diagnostic log',
    'Generated: ' + stamp(Date.now()),
    'Extension: ' + api.runtime.getManifest().version +
      ' | ' + browserLine + ' | private windows: ' + privateLine,
    'Fix: ' + onOff(s.enabled) + ' | data layer: ' + onOff(s.dataLayer) +
      ' | auto-update: ' + onOff(s.autoUpdate),
    'Rules: v' + (s.remoteRulesVersion || 0) +
      ' | updated ' + (s.lastUpdated || 'never') +
      ' | last error: ' + (s.lastUpdateError || 'none') +
      ' | pruneAdKeys ' + onOff(s.remotePruneAdKeys) +
      ' | minTimeoutMs ' + (Number(s.remoteMinTimeoutMs) || 0),
    'Counts: popups cleared ' + (Number(s.nagsRemoved) || 0) +
      ' | missed ' + (Number(s.missedNags) || 0),
    'Video loads logged: ' + loads.length +
      (loads.length
        ? ' | median ' + (median / 1000).toFixed(1) + 's' +
          ' | slowest ' + (loads[loads.length - 1] / 1000).toFixed(1) + 's' +
          ' | over 10s: ' + loads.filter((m) => m >= 10000).length
        : ''),
    '',
    '--- events, oldest first (' + log.length + ' of max ' + DIAG_MAX + ') ---',
  ];
  for (const x of log) {
    lines.push(stamp(x.t) + '  ' + x.e + (x.d ? '  ' + fmtData(x.d) : ''));
  }
  return lines.join('\n');
}

api.runtime.onStartup?.addListener(() => {
  // Marks the start of this browser session: the review prompt is never
  // shown in the session the add-on was installed in.
  api.storage.local.set({ sessionStartedAt: Date.now() });
  scheduleUpdates();
  updateRules().catch(() => {});
  refreshBadge();
});

// ---- popups-cleared count and review prompt --------------------------------
//
// content.js sends 'nag-cleared' once per confirmed removal (already
// de-duplicated per tab). The count lives here so tabs and frames never race
// each other's read-then-write. The count and review state stay on this
// device; nothing is sent anywhere.

const REVIEW_MIN_AGE_MS = 7 * 24 * 3600 * 1000;
const REVIEW_SNOOZE_MS = 14 * 24 * 3600 * 1000;
const REVIEW_AFTER_FAILURE_MS = 7 * 24 * 3600 * 1000;
const REVIEW_FIRST_AT = 5; // first ask at 5 popups cleared
const REVIEW_LATER_STEP = 20; // after "Later", wait for 20 more as well

let countQueue = Promise.resolve();

function onNagCleared() {
  const run = countQueue.then(async () => {
    const now = Date.now();
    const s = await api.storage.local.get([
      'nagsRemoved',
      'installedAt',
      'sessionStartedAt',
      'lastFailureAt',
      'reviewPromptOff',
      'reviewSnoozeUntil',
      'reviewNextAt',
      'reviewPending',
    ]);
    const count = (Number(s.nagsRemoved) || 0) + 1;
    const update = { nagsRemoved: count };
    const askReview =
      s.reviewPromptOff !== true &&
      s.reviewPending !== true &&
      !!s.installedAt &&
      now - s.installedAt >= REVIEW_MIN_AGE_MS &&
      // First session: installed after this browser session began (or no
      // restart seen yet since this version arrived).
      !!s.sessionStartedAt &&
      s.installedAt < s.sessionStartedAt &&
      now - (Number(s.lastFailureAt) || 0) >= REVIEW_AFTER_FAILURE_MS &&
      count >= Math.max(REVIEW_FIRST_AT, Number(s.reviewNextAt) || 0) &&
      now >= (Number(s.reviewSnoozeUntil) || 0);
    if (askReview) {
      // Ignoring the prompt counts as "Later": the snooze starts now, and the
      // toolbar popup keeps offering it until it is answered or expires.
      update.reviewPending = true;
      update.reviewSnoozeUntil = now + REVIEW_SNOOZE_MS;
      update.reviewNextAt = count + REVIEW_LATER_STEP;
    }
    await api.storage.local.set(update);
    return { count, askReview };
  });
  countQueue = run.catch(() => {});
  return run;
}

// answer: 'review' or 'never' stop it for good; 'later' waits 14 days and
// another REVIEW_LATER_STEP popups.
async function onReviewAnswer(answer) {
  if (answer === 'review' || answer === 'never') {
    await api.storage.local.set({ reviewPromptOff: true, reviewPending: false });
    return;
  }
  const { nagsRemoved } = await api.storage.local.get('nagsRemoved');
  await api.storage.local.set({
    reviewPending: false,
    reviewSnoozeUntil: Date.now() + REVIEW_SNOOZE_MS,
    reviewNextAt: (Number(nagsRemoved) || 0) + REVIEW_LATER_STEP,
  });
}

api.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'nag-cleared') return onNagCleared();
  if (msg.type === 'review-answer') return onReviewAnswer(msg.answer);
  if (msg.type === 'diag') {
    diagAppend(msg.e, msg.d);
    return;
  }
  if (msg.type === 'get-diag') return buildDiagText().then((text) => ({ text }));
  if (msg.type === 'clear-diag') {
    diagQueue = diagQueue.then(() => api.storage.local.set({ [DIAG_KEY]: [] }));
    return diagQueue.then(() => ({ ok: true }));
  }
});

// Optional count on the toolbar icon, off by default (Settings).
function badgeText(n) {
  if (n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.floor(n / 100) / 10) + 'k';
  return Math.floor(n / 1000) + 'k';
}

async function refreshBadge() {
  try {
    const { nagsRemoved, showCountBadge } = await api.storage.local.get([
      'nagsRemoved',
      'showCountBadge',
    ]);
    const on = showCountBadge === true;
    api.browserAction.setBadgeText({
      text: on ? badgeText(Number(nagsRemoved) || 0) : '',
    });
    if (on) api.browserAction.setBadgeBackgroundColor({ color: '#606060' });
  } catch (_e) {}
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.nagsRemoved || changes.showCountBadge) refreshBadge();
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
    // Remote kill switch for the ad-field pruning layer (default on).
    const pruneAdKeys = data.pruneAdKeys !== false;
    const version = Number(data.version) || 0;

    await api.storage.local.set({
      remotePopupSelectors: popup,
      remoteBackdropSelectors: backdrop,
      remoteJsonPopupKeys: jsonKeys,
      remoteAdKeys: adKeys,
      remotePopupText: text,
      remoteMinTimeoutMs: minTimeoutMs,
      remotePruneAdKeys: pruneAdKeys,
      remoteRulesVersion: version,
      lastUpdated: new Date().toISOString(),
      lastUpdateError: null,
      rulesRetryStep: 0,
    });
    api.alarms.clear(RETRY_ALARM);
    diagAppend('rules-ok', { v: version });

    return { version, popupCount: popup.length, backdropCount: backdrop.length };
  } catch (err) {
    await api.storage.local.set({ lastUpdateError: String(err) });
    diagAppend('rules-fail', { err: String(err) });
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
