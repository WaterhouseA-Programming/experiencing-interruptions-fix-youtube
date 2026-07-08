// Experiencing Interruptions Fix for YouTube — content script.
//
// Removes YouTube's ad-blocker enforcement popup ("You're using an ad blocker"
// / "experiencing interruptions"), unlocks the page, and resumes the paused
// video. uBlock Origin still does the actual ad blocking; this only clears the
// nag screen and the playback lock.
//
// Selectors come from two places, merged together:
//   - BUILT_IN_* below  (always available, even offline)
//   - remote rules cached in storage by background.js (so the fix can be
//     updated when YouTube changes its markup, without a new release)

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  // ---- built-in defaults --------------------------------------------------

  const BUILT_IN_POPUP = [
    'ytd-enforcement-message-view-model',
    'ytd-enforcement-message-view-model.style-scope',
    'ytd-popup-container tp-yt-paper-dialog',
  ];

  const BUILT_IN_BACKDROP = [
    'tp-yt-iron-overlay-backdrop',
    'tp-yt-iron-overlay-backdrop.opened',
  ];

  // ---- live settings ------------------------------------------------------

  let enabled = true;
  let popupSelectors = BUILT_IN_POPUP.slice();
  let backdropSelectors = BUILT_IN_BACKDROP.slice();

  function applySettings(s) {
    if (!s) return;
    if (typeof s.enabled === 'boolean') enabled = s.enabled;
    popupSelectors = dedupe(
      BUILT_IN_POPUP.concat(safeArray(s.remotePopupSelectors))
    );
    backdropSelectors = dedupe(
      BUILT_IN_BACKDROP.concat(safeArray(s.remoteBackdropSelectors))
    );
  }

  function safeArray(a) {
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  }
  function dedupe(a) {
    return Array.from(new Set(a));
  }

  // Load current settings, then react to any later changes.
  api.storage.local
    .get(['enabled', 'remotePopupSelectors', 'remoteBackdropSelectors'])
    .then(applySettings)
    .catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    for (const k of ['enabled', 'remotePopupSelectors', 'remoteBackdropSelectors']) {
      if (changes[k]) patch[k] = changes[k].newValue;
    }
    // Merge onto current picture.
    applySettings({
      enabled: patch.enabled !== undefined ? patch.enabled : enabled,
      remotePopupSelectors:
        patch.remotePopupSelectors !== undefined
          ? patch.remotePopupSelectors
          : dropBuiltIn(popupSelectors, BUILT_IN_POPUP),
      remoteBackdropSelectors:
        patch.remoteBackdropSelectors !== undefined
          ? patch.remoteBackdropSelectors
          : dropBuiltIn(backdropSelectors, BUILT_IN_BACKDROP),
    });
  });

  function dropBuiltIn(list, builtIn) {
    return list.filter((x) => !builtIn.includes(x));
  }

  // ---- popup removal ------------------------------------------------------

  function removeEnforcementPopups() {
    if (!enabled) return false;
    let removedSomething = false;

    // Take out the enforcement message and whatever dialog owns it.
    querySafe('ytd-enforcement-message-view-model').forEach((el) => {
      const dialog =
        el.closest('tp-yt-paper-dialog') ||
        el.closest('ytd-popup-container') ||
        el;
      dialog.remove();
      removedSomething = true;
    });

    // Any other configured popup containers.
    popupSelectors.forEach((sel) => {
      querySafe(sel).forEach((el) => {
        // A paper-dialog that contains the enforcement message, or an explicit
        // remote rule. We only remove dialogs, never the whole page.
        if (
          el.querySelector &&
          (el.matches('ytd-enforcement-message-view-model') ||
            el.querySelector('ytd-enforcement-message-view-model') ||
            sel !== 'ytd-popup-container tp-yt-paper-dialog')
        ) {
          el.remove();
          removedSomething = true;
        }
      });
    });

    // Remove the dark backdrop.
    backdropSelectors.forEach((sel) => {
      querySafe(sel).forEach((el) => {
        el.remove();
        removedSomething = true;
      });
    });

    if (removedSomething) {
      unlockPage();
      guardAgainstPause();
    }
    return removedSomething;
  }

  // querySelectorAll that never throws on a bad remote selector.
  function querySafe(sel) {
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch (_e) {
      return [];
    }
  }

  function unlockPage() {
    [document.documentElement, document.body].forEach((node) => {
      if (!node) return;
      node.removeAttribute('scroll-locked');
      node.style.setProperty('overflow', 'auto', 'important');
    });
  }

  function resumePlayback() {
    // Prefer the player API: it restores YouTube's own state, not just the
    // <video> element. The player's methods live in the page compartment, so
    // reach them through wrappedJSObject (Firefox Xray).
    const player = document.getElementById('movie_player');
    if (player) {
      try {
        const p = player.wrappedJSObject || player;
        if (typeof p.playVideo === 'function') {
          p.playVideo();
          return;
        }
      } catch (_e) {}
    }
    const video = document.querySelector('video.html5-main-video, video');
    if (video && video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  // YouTube pauses the video shortly AFTER showing the popup, so a single
  // play() right at removal loses the race. For a short window, retry and
  // counter any pause YouTube forces.
  let pauseGuardUntil = 0;

  function guardAgainstPause() {
    pauseGuardUntil = Date.now() + 2000;
    [0, 250, 750, 1500].forEach((ms) => setTimeout(resumePlayback, ms));
  }

  // Media 'pause' doesn't bubble but still capture-phases through document.
  document.addEventListener(
    'pause',
    (e) => {
      if (!enabled || Date.now() > pauseGuardUntil) return;
      if (e.target && e.target.tagName === 'VIDEO') resumePlayback();
    },
    true
  );

  // ---- observer -----------------------------------------------------------

  const kick = () => removeEnforcementPopups();

  const observer = new MutationObserver(kick);

  function startObserving() {
    if (!document.documentElement) {
      requestAnimationFrame(startObserving);
      return;
    }
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    kick();
  }

  startObserving();

  // Backstops: periodic sweep + SPA navigation events.
  setInterval(kick, 1000);
  window.addEventListener('yt-navigate-finish', kick, true);
  document.addEventListener('yt-navigate-finish', kick, true);
})();
