// Experiencing Interruptions Fix for YouTube — page-context prevention layer.
//
// content.js removes the enforcement popup after it appears; this file stops
// it from ever appearing, the same way Brave's ad-block engine and uBlock
// Origin's scriptlets do:
//
//   1. YouTube's JSON responses are pruned before YouTube's own code parses
//      them: the ad-slot fields whose failed playback triggers detection
//      (adPlacements / adSlots / playerAds) and any openPopupAction carrying
//      an enforcement renderer are deleted. With no popup action in the
//      response, YouTube neither shows the dialog nor pauses the video.
//   2. yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModel is
//      pinned to false, so even a popup that slips through is not allowed to
//      open.
//
// Firefox-only mechanics: content scripts see the page through Xray wrappers
// and can patch page globals synchronously at document_start via
// window.wrappedJSObject + exportFunction — before any YouTube script runs.
// This is the same injection technique uBlock Origin uses on Firefox.
//
// SECURITY NOTE: remote rules only ever contribute plain JSON *key names*
// (validated against /^[\w-]{1,100}$/). They are compared against object keys
// and never evaluated, never inserted as HTML. Every hook is wrapped so any
// failure falls back to YouTube's untouched behavior plus the DOM cleanup in
// content.js.

(function () {
  'use strict';

  // Xray APIs exist only in Firefox content scripts; bail out elsewhere.
  if (
    typeof window.wrappedJSObject === 'undefined' ||
    typeof exportFunction !== 'function'
  ) {
    return;
  }

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const page = window.wrappedJSObject;

  // ---- live settings --------------------------------------------------------

  let enabled = true;

  // JSON keys that identify an enforcement popup payload.
  const BUILT_IN_POPUP_KEYS = [
    'adBlockMessageViewModel',
    'enforcementMessageViewModel',
    'fancyDismissibleDialogRenderer',
  ];
  let popupKeys = BUILT_IN_POPUP_KEYS.slice();

  // Ad-slot fields whose presence lets YouTube schedule ads; when an ad
  // blocker then stops the ad loading, detection fires. Pruned so, from the
  // player's perspective, no ad inventory exists (Brave's json-prune rule).
  // Remotely extensible via the "adKeys" rule: textNeedsPruning gates every
  // prune on these names appearing, so a rename by YouTube would otherwise
  // silently disable this whole layer until a new release shipped.
  const BUILT_IN_AD_KEYS = ['adPlacements', 'adSlots', 'playerAds'];
  let adKeys = BUILT_IN_AD_KEYS.slice();

  // Anti-stall: while YouTube throttles an ad-blocked SABR stream it schedules
  // long setTimeout delays (~10 s, seen as "timeout 10000" in the console) that
  // gate playback from starting. Zeroing only these long timers lets playback
  // proceed and leaves normal short UI timers alone. Tunable/killable via the
  // remote rule "minTimeoutMs"; 0 (or negative) disables squashing entirely.
  const DEFAULT_MIN_TIMEOUT = 10000;
  let minTimeout = DEFAULT_MIN_TIMEOUT;

  function applyMinTimeout(v) {
    if (typeof v === 'number' && isFinite(v)) minTimeout = v;
  }

  // Merge validated remote key names onto the built-ins. Key names only, and a
  // bad/missing remote list just leaves the built-ins in place.
  function mergeKeys(builtIn, extra) {
    if (!Array.isArray(extra)) return builtIn.slice();
    const clean = extra.filter(
      (k) => typeof k === 'string' && /^[\w-]{1,100}$/.test(k)
    );
    return Array.from(new Set(builtIn.concat(clean)));
  }

  api.storage.local
    .get([
      'enabled',
      'remoteJsonPopupKeys',
      'remoteAdKeys',
      'remoteMinTimeoutMs',
    ])
    .then((s) => {
      if (s && typeof s.enabled === 'boolean') enabled = s.enabled;
      popupKeys = mergeKeys(BUILT_IN_POPUP_KEYS, s && s.remoteJsonPopupKeys);
      adKeys = mergeKeys(BUILT_IN_AD_KEYS, s && s.remoteAdKeys);
      if (s) applyMinTimeout(s.remoteMinTimeoutMs);
    })
    .catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.remoteJsonPopupKeys) {
      popupKeys = mergeKeys(
        BUILT_IN_POPUP_KEYS,
        changes.remoteJsonPopupKeys.newValue
      );
    }
    if (changes.remoteAdKeys) {
      adKeys = mergeKeys(BUILT_IN_AD_KEYS, changes.remoteAdKeys.newValue);
    }
    if (changes.remoteMinTimeoutMs) {
      applyMinTimeout(changes.remoteMinTimeoutMs.newValue);
    }
  });

  // ---- pruning ----------------------------------------------------------------

  // Cheap string gate so the deep walk only runs on responses that can
  // actually contain something to remove.
  function textNeedsPruning(text) {
    if (!enabled || typeof text !== 'string' || text.length < 20) return false;
    for (const k of adKeys) {
      if (text.includes('"' + k + '"')) return true;
    }
    for (const k of popupKeys) {
      if (text.includes('"' + k + '"')) return true;
    }
    return false;
  }

  function prune(obj) {
    if (!enabled || !obj || typeof obj !== 'object') return obj;
    try {
      stripAdKeys(obj);
      if (obj.playerResponse && typeof obj.playerResponse === 'object') {
        stripAdKeys(obj.playerResponse);
      }
      stripPopupActions(obj, 0);
    } catch (_e) {
      // Never break the page: worst case is an unpruned response, which the
      // DOM cleanup in content.js still handles.
    }
    return obj;
  }

  function stripAdKeys(o) {
    for (const k of adKeys) {
      try {
        delete o[k];
      } catch (_e) {}
    }
  }

  // Walk the response (bounded) and delete any openPopupAction whose popup is
  // an enforcement renderer. Deleting the action is enough: YouTube then has
  // nothing to open and does not pause the video.
  function stripPopupActions(node, depth) {
    if (depth > 15 || !node || typeof node !== 'object') return;
    let keys;
    try {
      keys = Object.keys(node);
    } catch (_e) {
      return;
    }
    if (keys.length > 5000) return;
    for (const key of keys) {
      let value;
      try {
        value = node[key];
      } catch (_e) {
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (key === 'openPopupAction' && isEnforcementPopup(value)) {
        try {
          delete node[key];
        } catch (_e) {}
        continue;
      }
      stripPopupActions(value, depth + 1);
    }
  }

  function isEnforcementPopup(action) {
    let popup;
    try {
      popup = action.popup;
    } catch (_e) {
      return false;
    }
    if (!popup || typeof popup !== 'object') return false;
    return popupKeys.some((k) => {
      try {
        return k in popup;
      } catch (_e) {
        return false;
      }
    });
  }

  // ---- hook: JSON.parse -------------------------------------------------------

  const origParse = page.JSON.parse;

  try {
    page.JSON.parse = exportFunction(function (text, reviver) {
      const result =
        reviver === undefined ? origParse(text) : origParse(text, reviver);
      if (textNeedsPruning(text)) prune(result);
      return result;
    }, window);
  } catch (_e) {}

  // ---- hook: Response.prototype.json -------------------------------------------
  //
  // YouTube's fetch path parses via response.json(), which uses the native
  // parser and would bypass the JSON.parse hook. Reimplemented as
  // text() + parse so the same pruning applies.

  try {
    const RespProto = page.Response.prototype;
    const origText = RespProto.text;
    RespProto.json = exportFunction(function () {
      return origText.call(this).then(
        exportFunction(function (t) {
          const obj = origParse(t);
          if (textNeedsPruning(t)) prune(obj);
          return obj;
        }, window)
      );
    }, window);
  } catch (_e) {}

  // ---- hook: setTimeout (anti-stall) ------------------------------------------
  //
  // Zero only long delays (>= minTimeout) so the ~10 s playback-gating timers
  // YouTube schedules while throttling an ad-blocked stream fire immediately.
  // Short timers pass through untouched, so ordinary UI timing is unaffected.
  //
  // The squasher MUST stay bounded. YouTube schedules self-rescheduling long
  // timers (heartbeats, watch-time pings, idle checks) shaped like
  // `function ping() { ...; setTimeout(ping, 30000); }`. Zeroing those with no
  // limit re-arms them at 0 ms forever: a busy loop that burns CPU and floods
  // YouTube with requests. Two independent bounds prevent that:
  //   1. Only squash before playback starts — the stall we care about is a
  //      startup stall, so once the video rolls there is nothing to fix.
  //   2. Never squash more than SQUASH_BUDGET times per navigation, so even if
  //      playback never starts the loop cannot run away.

  const SQUASH_BUDGET = 32;
  let squashesLeft = SQUASH_BUDGET;
  let playbackLatched = false;

  // Latches once the video is genuinely rolling: the startup stall is over and
  // we stop touching timers for the rest of this navigation. Only consulted
  // when a timer is already long enough to squash, so the query stays rare.
  function playbackRunning() {
    if (playbackLatched) return true;
    try {
      const v = document.querySelector('video');
      if (v && !v.paused && v.currentTime > 0 && v.readyState >= 3) {
        playbackLatched = true;
      }
    } catch (_e) {}
    return playbackLatched;
  }

  function shouldSquash(delay) {
    if (!enabled || minTimeout <= 0) return false;
    if (typeof delay !== 'number' || delay < minTimeout) return false;
    if (squashesLeft <= 0) return false;
    if (playbackRunning()) return false;
    squashesLeft--;
    return true;
  }

  // An SPA navigation is a new video, so a new startup stall gets a new budget.
  function resetSquashBudget() {
    squashesLeft = SQUASH_BUDGET;
    playbackLatched = false;
  }
  window.addEventListener('yt-navigate-finish', resetSquashBudget, true);

  try {
    const origSetTimeout = page.setTimeout;
    page.setTimeout = exportFunction(function (fn, delay) {
      const d = shouldSquash(delay) ? 0 : delay;
      if (arguments.length <= 2) return origSetTimeout(fn, d);
      // Preserve any extra timer arguments YouTube may pass through.
      const rest = Array.prototype.slice.call(arguments, 2);
      return origSetTimeout(fn, d, ...rest);
    }, window);
  } catch (_e) {}

  // ---- pin the popup config -----------------------------------------------------
  //
  // yt.config_ appears during app boot and can be rebuilt on SPA navigation,
  // so keep re-pinning cheaply instead of setting it once.

  function pinPopupConfig() {
    if (!enabled) return;
    try {
      const cfg = page.yt && page.yt.config_;
      const popups =
        cfg && cfg.openPopupConfig && cfg.openPopupConfig.supportedPopups;
      if (popups && popups.adBlockMessageViewModel !== false) {
        popups.adBlockMessageViewModel = false;
      }
    } catch (_e) {}
  }

  pinPopupConfig();
  setInterval(pinPopupConfig, 1000);
})();
