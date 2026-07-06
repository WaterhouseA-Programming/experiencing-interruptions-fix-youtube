// YouTube Anti-Adblock Fix
// Removes the "experiencing interruptions" / ad-blocker enforcement popup that
// YouTube shows when it detects uBlock Origin, then un-pauses the video.
//
// uBO still does the actual ad blocking. This script only neutralises the nag
// screen and the playback lock that comes with it.

(function () {
  'use strict';

  // ---- config -------------------------------------------------------------

  // Elements that make up the enforcement / "interruptions" popup.
  const POPUP_SELECTORS = [
    'ytd-enforcement-message-view-model',
    'ytd-enforcement-message-view-model.style-scope',
    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
    'ytd-popup-container tp-yt-paper-dialog',
  ];

  // The dark backdrop rendered behind the popup.
  const BACKDROP_SELECTORS = [
    'tp-yt-iron-overlay-backdrop',
    'tp-yt-iron-overlay-backdrop.opened',
  ];

  // ---- popup removal ------------------------------------------------------

  function removeEnforcementPopups() {
    let removedSomething = false;

    document
      .querySelectorAll('ytd-enforcement-message-view-model')
      .forEach((el) => {
        // Climb to the owning dialog so we take the whole thing out.
        const dialog =
          el.closest('tp-yt-paper-dialog') ||
          el.closest('ytd-popup-container') ||
          el;
        dialog.remove();
        removedSomething = true;
      });

    BACKDROP_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.remove();
        removedSomething = true;
      });
    });

    // YouTube locks page scroll and dims the page while the popup is up.
    if (removedSomething) {
      unlockPage();
      resumePlayback();
    }

    return removedSomething;
  }

  function unlockPage() {
    const html = document.documentElement;
    const body = document.body;
    [html, body].forEach((node) => {
      if (!node) return;
      node.style.removeProperty('overflow');
      node.removeAttribute('scroll-locked');
      node.style.setProperty('overflow', 'auto', 'important');
    });
  }

  // ---- playback recovery --------------------------------------------------

  function resumePlayback() {
    const video = document.querySelector('video.html5-main-video, video');
    if (!video) return;

    // The popup pauses the player; nudge it back to life.
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  // ---- observer -----------------------------------------------------------

  // Run once immediately in case the popup is already in the DOM.
  const kick = () => removeEnforcementPopups();

  const observer = new MutationObserver(() => {
    kick();
  });

  function startObserving() {
    if (!document.documentElement) {
      // document_start can fire before <html> exists.
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

  // Safety net: some builds re-inject the popup on a timer, so sweep
  // periodically as well. Cheap querySelector, no visible cost.
  setInterval(kick, 1000);

  // Re-check on YouTube's SPA navigations.
  window.addEventListener('yt-navigate-finish', kick, true);
  document.addEventListener('yt-navigate-finish', kick, true);
})();
