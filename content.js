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

  // Text shown by the newer toast-style enforcement ("Experiencing
  // interruptions?"). YouTube now renders the nag as a generic
  // yt-notification-action-renderer with no distinguishing attribute, so it is
  // recognised by its visible text instead of a tag/class. Matched
  // case-insensitively as a substring of the element's textContent.
  const BUILT_IN_TEXT = [
    'experiencing interruptions',
    'ad blockers are not allowed',
    'using an ad blocker',
    'allow ads',
    // "Experiencing interruptions?" in other interface languages. Only ever
    // compared against notification toasts, never the whole page.
    'interruptions', // fr
    'interrupciones', // es
    'unterbrechungen', // de
    'interrupções', // pt
    'interruzioni', // it
    'onderbrekingen', // nl
    'przerwy', // pl
    'kesinti', // tr
    'перебои', // ru
    'перебої', // uk
    '中断', // ja / zh
    '중단', // ko
  ];

  // ---- live settings ------------------------------------------------------

  let enabled = true;
  let popupSelectors = BUILT_IN_POPUP.slice();
  let backdropSelectors = BUILT_IN_BACKDROP.slice();
  let textPhrases = BUILT_IN_TEXT.slice();

  function applySettings(s) {
    if (!s) return;
    if (typeof s.enabled === 'boolean') enabled = s.enabled;
    popupSelectors = dedupe(
      BUILT_IN_POPUP.concat(safeArray(s.remotePopupSelectors))
    );
    backdropSelectors = dedupe(
      BUILT_IN_BACKDROP.concat(safeArray(s.remoteBackdropSelectors))
    );
    textPhrases = dedupe(
      BUILT_IN_TEXT.concat(
        safeArray(s.remotePopupText).map((t) => t.toLowerCase())
      )
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
    .get([
      'enabled',
      'remotePopupSelectors',
      'remoteBackdropSelectors',
      'remotePopupText',
    ])
    .then(applySettings)
    .catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    for (const k of [
      'enabled',
      'remotePopupSelectors',
      'remoteBackdropSelectors',
      'remotePopupText',
    ]) {
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
      remotePopupText:
        patch.remotePopupText !== undefined
          ? patch.remotePopupText
          : dropBuiltIn(textPhrases, BUILT_IN_TEXT),
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
        // Never blanket-remove a generic notification toast: only if it carries
        // the enforcement text. (A remote rule may list the bare renderer so
        // older versions without text matching still clear the nag.)
        if (isNotificationRenderer(el) && !hasEnforcementText(el)) return;
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

    // Toast-style nag: a generic notification renderer with no distinguishing
    // attribute, recognised by its visible text. Remove only matches so
    // ordinary YouTube toasts ("Added to queue", etc.) are left alone.
    if (removeToastNags()) removedSomething = true;

    // Remove the dark backdrop, but only alongside an enforcement popup.
    // Backdrops also sit behind ordinary dialogs (Share, Save to playlist,
    // Report); stripping those and then forcing playVideo() restarted paused
    // videos and broke YouTube's overlay manager.
    if (!removedSomething) return false;
    backdropSelectors.forEach((sel) => {
      querySafe(sel).forEach((el) => el.remove());
    });

    unlockPage();
    guardAgainstPause();
    return true;
  }

  function isNotificationRenderer(el) {
    return !!(el && el.matches && el.matches('yt-notification-action-renderer'));
  }

  function hasEnforcementText(el) {
    if (hasSupportLink(el)) return true;
    const t = ((el && el.textContent) || '').toLowerCase();
    if (!t) return false;
    return textPhrases.some((p) => p && t.includes(p));
  }

  // The nag's "Find out why" button links to YouTube's help centre, which
  // ordinary toasts ("Saved to Watch later" / "Change") never do. This
  // catches the toast in any interface language, where the text match fails.
  function hasSupportLink(el) {
    if (!isNotificationRenderer(el)) return false;
    try {
      return !!el.querySelector('a[href*="support.google.com"]');
    } catch (_e) {
      return false;
    }
  }

  function removeToastNags() {
    let removed = false;
    querySafe('yt-notification-action-renderer').forEach((el) => {
      if (hasEnforcementText(el)) {
        el.remove();
        removed = true;
      }
    });
    return removed;
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

  const kick = () => {
    // Deferred: the review section's state below isn't initialised yet when
    // the first sweep runs during startup.
    if (removeEnforcementPopups()) setTimeout(onNagRemoved, 0);
  };

  // YouTube's DOM churns constantly and each sweep runs several
  // whole-document querySelectorAll calls, so coalesce to at most one sweep
  // per frame instead of one per mutation batch. Behaviour is unchanged: the
  // popup cannot be seen before the next paint anyway. rAF is throttled in
  // background tabs, which the 1 s interval below backstops.
  let sweepScheduled = false;

  function scheduleKick() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    requestAnimationFrame(() => {
      sweepScheduled = false;
      kick();
    });
  }

  const observer = new MutationObserver(scheduleKick);

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

  // ---- stall detection ----------------------------------------------------
  //
  // Running a second ad blocker (Ghostery, AdBlock Plus, ...) alongside
  // uBlock Origin leaves YouTube's player buffering forever with no media
  // data at all. Nothing here can fix that, but flagging it turns a
  // mysterious "this extension broke YouTube" into an actionable hint: the
  // background page badges the toolbar icon and the popup explains.
  //
  // A stall is a visible watch/shorts page whose video has had no current
  // frame (readyState < HAVE_CURRENT_DATA) for STALL_MS. A video the user
  // paused after it loaded keeps readyState >= 2, so it never counts.

  const STALL_MS = 15000;
  let stallSince = 0;
  let stallReported = false;

  function reportStall(stalled) {
    if (stalled === stallReported) return;
    stallReported = stalled;
    try {
      api.runtime.sendMessage({ type: 'stall', stalled }).catch(() => {});
    } catch (_e) {}
    if (stalled) showStallNotice();
    else hideStallNotice();
  }

  // The toolbar badge alone went unseen: Firefox tucks new add-ons into the
  // extensions menu, so the "!" is hidden for most users. Say it on the page,
  // once per video, with a way to opt out for good.
  let stallNoticeOff = false;
  let stallNoticeDismissed = false;
  let stallNoticeHost = null;

  api.storage.local
    .get('stallNoticeOff')
    .then((s) => {
      stallNoticeOff = s.stallNoticeOff === true;
    })
    .catch(() => {});

  function showStallNotice() {
    if (stallNoticeOff || stallNoticeDismissed || stallNoticeHost) return;
    if (!document.body) return;
    const host = document.createElement('eif-stall-notice');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        .box {
          position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
          z-index: 2147483647; width: min(520px, calc(100vw - 32px));
          box-sizing: border-box; padding: 14px 16px; border-radius: 12px;
          background: #1f1f1f; color: #f1f1f1;
          border: 1px solid #d97706; box-shadow: 0 8px 28px rgba(0,0,0,.45);
          font: 14px/1.45 Roboto, Arial, sans-serif;
        }
        .title { font-weight: 700; font-size: 15px; margin: 0 0 6px; color: #fbbf24; }
        p { margin: 0 0 8px; }
        .who { color: #aaa; font-size: 12px; }
        .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        button {
          font: inherit; font-weight: 600; border-radius: 18px; cursor: pointer;
          padding: 6px 14px; border: 1px solid #555; background: transparent;
          color: inherit;
        }
        .primary { background: #f1f1f1; color: #0f0f0f; border-color: #f1f1f1; }`;
    const box = el('div', 'box');
    box.setAttribute('role', 'alert');
    box.append(
      el('p', 'title', 'Video not loading?'),
      el('p', '', 'This is almost always caused by running a second ad blocker ' +
        '(Ghostery, AdBlock Plus, AdGuard, Brave Shields) alongside uBlock ' +
        'Origin. They fight over YouTube and the video never starts.'),
      el('p', '', 'Fix: pause the other blocker on youtube.com, keep uBlock ' +
        'Origin, then reload.'),
      el('p', 'who', 'From Experiencing Interruptions Fix. This add-on does ' +
        'not block video. To check, turn it off from its toolbar icon and reload.')
    );
    const row = el('div', 'row');
    row.append(
      button('primary', 'reload', 'Reload'),
      button('', 'dismiss', 'Dismiss'),
      button('', 'never', "Don't show again")
    );
    box.append(row);
    root.append(style, box);
    root.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'reload') location.reload();
      if (act === 'never') {
        stallNoticeOff = true;
        api.storage.local.set({ stallNoticeOff: true }).catch(() => {});
      }
      stallNoticeDismissed = true;
      hideStallNotice();
    });
    document.body.appendChild(host);
    stallNoticeHost = host;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function button(cls, act, text) {
    const b = el('button', cls, text);
    b.setAttribute('data-act', act);
    return b;
  }

  function hideStallNotice() {
    if (stallNoticeHost) stallNoticeHost.remove();
    stallNoticeHost = null;
  }

  function checkStall() {
    const video = document.querySelector('video.html5-main-video, video');
    const loading =
      !!video &&
      document.visibilityState === 'visible' &&
      /^\/(watch|shorts\/)/.test(location.pathname) &&
      video.readyState < 2 &&
      !video.ended;
    if (!loading) {
      stallSince = 0;
      reportStall(false);
      return;
    }
    if (!stallSince) stallSince = Date.now();
    if (Date.now() - stallSince >= STALL_MS) reportStall(true);
  }

  // ---- review card --------------------------------------------------------
  //
  // Ask for a review only from people it is working for: a week after
  // install, once it has removed a few nags, right after removing one. A
  // small corner card, shown at most once per REVIEW_SNOOZE_MS, never again
  // after "Leave a review" or "Never".

  const REVIEW_URL =
    'https://addons.mozilla.org/firefox/addon/youtube-interruptions-fix/reviews/';
  const REVIEW_MIN_AGE_MS = 7 * 24 * 3600 * 1000;
  const REVIEW_MIN_NAGS = 3;
  const REVIEW_SNOOZE_MS = 14 * 24 * 3600 * 1000;
  // YouTube re-renders the nag a few times; count one removal per burst.
  const NAG_COUNT_GAP_MS = 10000;
  let lastNagCountedAt = 0;
  let reviewHost = null;

  function onNagRemoved() {
    if (window !== window.top) return;
    const now = Date.now();
    if (now - lastNagCountedAt < NAG_COUNT_GAP_MS) return;
    lastNagCountedAt = now;
    api.storage.local
      .get(['nagsRemoved', 'installedAt', 'reviewPromptOff', 'reviewSnoozeUntil'])
      .then((s) => {
        const nags = (Number(s.nagsRemoved) || 0) + 1;
        api.storage.local.set({ nagsRemoved: nags }).catch(() => {});
        if (
          s.reviewPromptOff === true ||
          !s.installedAt ||
          now - s.installedAt < REVIEW_MIN_AGE_MS ||
          nags < REVIEW_MIN_NAGS ||
          now < (Number(s.reviewSnoozeUntil) || 0)
        ) {
          return;
        }
        // Ignoring the card counts as "Not now".
        api.storage.local
          .set({ reviewSnoozeUntil: now + REVIEW_SNOOZE_MS })
          .catch(() => {});
        showReviewCard();
      })
      .catch(() => {});
  }

  function showReviewCard() {
    if (reviewHost || stallNoticeHost || !document.body) return;
    const host = document.createElement('eif-review-card');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        .box {
          position: fixed; bottom: 24px; left: 24px; z-index: 2147483647;
          width: min(300px, calc(100vw - 48px)); box-sizing: border-box;
          padding: 12px 14px; border-radius: 12px;
          background: #1f1f1f; color: #f1f1f1; border: 1px solid #3a3a3a;
          box-shadow: 0 6px 20px rgba(0,0,0,.35);
          font: 13px/1.4 Roboto, Arial, sans-serif;
        }
        p { margin: 0 0 10px; }
        .row { display: flex; flex-wrap: wrap; gap: 6px; }
        button {
          font: inherit; font-weight: 500; border-radius: 16px; cursor: pointer;
          padding: 5px 12px; border: 1px solid #555; background: transparent;
          color: inherit;
        }
        .primary { background: #f1f1f1; color: #0f0f0f; border-color: #f1f1f1; }`;
    const box = el('div', 'box');
    box.setAttribute('role', 'status');
    box.append(
      el('p', '', 'Experiencing Interruptions Fix just cleared another ' +
        'YouTube nag. If it has been useful, a quick review helps others find it.')
    );
    const row = el('div', 'row');
    row.append(
      button('primary', 'review', 'Leave a review'),
      button('', 'later', 'Not now'),
      button('', 'never', 'Never')
    );
    box.append(row);
    root.append(style, box);
    root.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'review') window.open(REVIEW_URL, '_blank', 'noopener');
      if (act === 'review' || act === 'never') {
        api.storage.local.set({ reviewPromptOff: true }).catch(() => {});
      }
      hideReviewCard();
    });
    document.body.appendChild(host);
    reviewHost = host;
  }

  function hideReviewCard() {
    if (reviewHost) reviewHost.remove();
    reviewHost = null;
  }

  // ---- nag report ---------------------------------------------------------
  //
  // Some users still see the nag, presumably a variant YouTube A/B tests that
  // none of the selectors or phrases match. The popup's "Report" button asks
  // for a snapshot of whatever dialogs and toasts are on screen so the user
  // can paste it into a GitHub issue. Built only on that click, never sent
  // anywhere by the extension itself.

  const REPORT_SELECTORS = [
    'ytd-enforcement-message-view-model',
    'yt-notification-action-renderer',
    'tp-yt-paper-toast',
    'tp-yt-paper-dialog',
    'tp-yt-iron-overlay-backdrop',
    '[role="dialog"]',
    '[role="alertdialog"]',
  ];
  const REPORT_ELEMENT_MAX = 6000;
  const REPORT_ELEMENTS_MAX = 12;

  function isVisible(node) {
    if (!node.getClientRects().length) return false;
    const cs = getComputedStyle(node);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // Icon path data is most of a YouTube element's markup and tells us nothing.
  function compactHtml(node) {
    const html = node.outerHTML
      .replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')
      .replace(/\s+/g, ' ');
    return html.length > REPORT_ELEMENT_MAX
      ? html.slice(0, REPORT_ELEMENT_MAX) + ' …[truncated]'
      : html;
  }

  function buildReport() {
    const seen = new Set();
    const elements = [];
    for (const sel of REPORT_SELECTORS) {
      for (const node of querySafe(sel)) {
        if (elements.length >= REPORT_ELEMENTS_MAX) break;
        if (seen.has(node) || !isVisible(node)) continue;
        // Skip nodes already inside a captured one.
        if (elements.some((e) => e.node.contains(node))) continue;
        seen.add(node);
        elements.push({ node, sel });
      }
    }
    const video = document.querySelector('video.html5-main-video, video');
    const page = /^\/watch/.test(location.pathname)
      ? 'watch'
      : /^\/shorts\//.test(location.pathname)
      ? 'shorts'
      : 'other';
    const lines = [
      'Extension: ' + api.runtime.getManifest().version +
        (enabled ? '' : ' (fix turned OFF)'),
      'Browser: ' + navigator.userAgent,
      'Private window: ' + (api.extension.inIncognitoContext ? 'yes' : 'no'),
      'YouTube language: ' + (document.documentElement.lang || '?'),
      'Page: ' + page,
      'Video: ' +
        (video
          ? (video.paused ? 'paused' : 'playing') + ', readyState ' + video.readyState
          : 'none'),
      'Scroll locked: ' +
        (document.documentElement.hasAttribute('scroll-locked') ||
        (document.body && document.body.hasAttribute('scroll-locked'))
          ? 'yes'
          : 'no'),
      'On-screen dialogs/toasts: ' + elements.length,
    ];
    elements.forEach((e, i) => {
      lines.push('', '--- ' + (i + 1) + ' (' + e.sel + ') ---', compactHtml(e.node));
    });
    return lines.join('\n');
  }

  if (window === window.top) {
    api.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'build-report') return;
      return api.storage.local
        .get('remoteRulesVersion')
        .then(
          (s) => s,
          () => ({})
        )
        .then((s) => ({
          report:
            'Rules version: ' + (s.remoteRulesVersion || 'built-in') + '\n' +
            buildReport(),
        }));
    });

    setInterval(checkStall, 1000);
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        stallSince = 0;
        stallNoticeDismissed = false;
        reportStall(false);
      },
      true
    );
  }
})();
