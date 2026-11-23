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
  const isTop = window === window.top;

  // ---- diagnostic log -----------------------------------------------------
  //
  // Events go to background.js, which keeps the last few hundred on this
  // device for the toolbar popup's "Copy diagnostic log". The same event with
  // the same details is sent at most once per 15 s, since YouTube re-renders
  // things many times. Never a URL or video ID.

  const diagSeen = new Map();

  function diag(e, d) {
    const data = Object.assign({}, d || {});
    if (!isTop) data.frame = 'sub';
    const key = e + JSON.stringify(data);
    const now = Date.now();
    if (now - (diagSeen.get(key) || 0) < 15000) return;
    diagSeen.set(key, now);
    if (diagSeen.size > 200) diagSeen.clear();
    try {
      api.runtime.sendMessage({ type: 'diag', e, d: data }).catch(() => {});
    } catch (_e) {}
  }

  // page-hooks.js logs through this (content-script global, not the page's).
  window.eifDiag = diag;

  function pageType() {
    const p = location.pathname;
    if (/^\/watch/.test(p)) return 'watch';
    if (/^\/shorts\//.test(p)) return 'shorts';
    if (/^\/embed\//.test(p)) return 'embed';
    return 'other';
  }

  // ---- the main player ----------------------------------------------------
  //
  // Always the watch/shorts player's own <video>. A bare 'video' selector can
  // pick up the hover-preview player YouTube keeps in the page after the
  // home feed, which sits at readyState 0 and caused false stall notices.

  function moviePlayer() {
    return document.getElementById('movie_player');
  }

  function mainVideo() {
    const p = moviePlayer();
    if (p) {
      const v =
        p.querySelector('video.html5-main-video') || p.querySelector('video');
      if (v) return v;
    }
    // Shorts and embeds can use a different container.
    return document.querySelector(
      '#shorts-player video, ytd-player video.html5-main-video, .html5-video-player video'
    );
  }

  function isMainVideo(node) {
    return !!node && node.tagName === 'VIDEO' && node === mainVideo();
  }

  // YouTube's player API: -1 unstarted, 0 ended, 1 playing, 2 paused,
  // 3 buffering, 5 cued. null when the API isn't there.
  function playerState() {
    const p = moviePlayer();
    if (!p) return null;
    try {
      const w = p.wrappedJSObject || p;
      if (typeof w.getPlayerState === 'function') {
        const s = Number(w.getPlayerState());
        return isFinite(s) ? s : null;
      }
    } catch (_e) {}
    return null;
  }

  function visibleIn(root, sel) {
    if (!root) return false;
    try {
      const n = root.querySelector(sel);
      return !!(n && n.getClientRects().length && getComputedStyle(n).display !== 'none');
    } catch (_e) {
      return false;
    }
  }

  // ---- built-in defaults --------------------------------------------------

  const BUILT_IN_POPUP = [
    'ytd-enforcement-message-view-model',
    'ytd-enforcement-message-view-model.style-scope',
    // The same message in YouTube's newer component framework (no "d").
    'yt-enforcement-message-view-model',
    'ytd-popup-container tp-yt-paper-dialog',
  ];

  // YouTube is moving toasts to "snackbars" (its web_toast_to_snackbar_migration
  // experiment): the nag then renders as a snackbar-view-model inside
  // snackbar-container, with no yt-notification-action-renderer at all.
  const SNACKBAR_SELECTOR = 'snackbar-view-model';
  const SNACKBAR_HIDDEN_ATTR = 'data-eif-hidden';

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

  const ENFORCEMENT_TAGS =
    'ytd-enforcement-message-view-model, yt-enforcement-message-view-model';

  // How the last sweep removed something, for the diagnostic log.
  let lastRemovalHow = '';

  function removeEnforcementPopups() {
    if (!enabled) return false;
    let removedSomething = false;
    lastRemovalHow = '';

    // Take out the enforcement message and whatever dialog owns it (either
    // framework's element: removing only the newer one left its dialog open).
    querySafe(ENFORCEMENT_TAGS).forEach((el) => {
      const dialog =
        el.closest('tp-yt-paper-dialog') ||
        el.closest('ytd-popup-container') ||
        el;
      dialog.remove();
      removedSomething = true;
      lastRemovalHow = 'dialog';
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
          (el.matches(ENFORCEMENT_TAGS) ||
            el.querySelector(ENFORCEMENT_TAGS) ||
            sel !== 'ytd-popup-container tp-yt-paper-dialog')
        ) {
          el.remove();
          removedSomething = true;
          if (!lastRemovalHow) lastRemovalHow = 'selector:' + sel;
        }
      });
    });

    // Toast-style nag: a generic notification renderer with no distinguishing
    // attribute, recognised by its visible text. Remove only matches so
    // ordinary YouTube toasts ("Added to queue", etc.) are left alone.
    if (removeToastNags()) {
      removedSomething = true;
      if (!lastRemovalHow) lastRemovalHow = 'toast';
    }
    if (hideSnackbarNags()) {
      removedSomething = true;
      if (!lastRemovalHow) lastRemovalHow = 'snackbar';
    }
    syncGhostHosts();

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
    if (!isNotificationRenderer(el) && !isSnackbar(el)) return false;
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
        markGhostHost(el);
        el.remove();
        removed = true;
      }
    });
    return removed;
  }

  function isSnackbar(el) {
    return !!(el && el.matches && el.matches(SNACKBAR_SELECTOR));
  }

  // Snackbars are drawn by YouTube's reactive framework, which keeps hold of
  // its nodes and may reuse them, so a nag snackbar is hidden rather than
  // removed, and un-hidden as soon as it no longer carries the nag (so a
  // reused node can show "Saved to Watch later" later). Returns true only
  // when a nag was newly hidden: a snackbar that stays hidden must not
  // re-trigger the playback guard on every sweep.
  function hideSnackbarNags() {
    let hidden = false;
    querySafe(SNACKBAR_SELECTOR).forEach((el) => {
      const marked = el.hasAttribute(SNACKBAR_HIDDEN_ATTR);
      if (hasEnforcementText(el)) {
        markGhostHost(el);
        if (marked) return;
        el.setAttribute(SNACKBAR_HIDDEN_ATTR, '');
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        hidden = true;
      } else if (marked) {
        el.removeAttribute(SNACKBAR_HIDDEN_ATTR);
        el.style.removeProperty('display');
        el.style.removeProperty('pointer-events');
      }
    });
    return hidden;
  }

  // ---- ghost toast hosts --------------------------------------------------
  //
  // Removing the nag's renderer (or hiding its snackbar) left the container
  // it sat in on screen: tp-yt-paper-toast stays "opened" and snackbar-
  // container keeps its fixed box at the bottom left. Both are invisible but
  // still take clicks, so the player's play and volume controls under them
  // stopped working. A host that held a nag is now closed and made
  // click-through until YouTube puts something else in it.

  const GHOST_HOSTS = 'tp-yt-paper-toast, snackbar-container';
  const GHOST_ATTR = 'data-eif-ghost';

  function markGhostHost(el) {
    const host = el.closest && el.closest(GHOST_HOSTS);
    if (host) host.setAttribute(GHOST_ATTR, '');
  }

  // Does the host show anything other than the (removed or hidden) nag?
  function hostHasOtherContent(host) {
    if (host.matches('snackbar-container')) {
      return Array.from(host.querySelectorAll(SNACKBAR_SELECTOR)).some(
        (s) => !s.hasAttribute(SNACKBAR_HIDDEN_ATTR)
      );
    }
    const t = (host.textContent || '').trim().toLowerCase();
    if (!t) return false;
    return !textPhrases.some((p) => p && t.includes(p));
  }

  function syncGhostHosts() {
    querySafe('[' + GHOST_ATTR + ']').forEach((host) => {
      if (hostHasOtherContent(host)) {
        host.removeAttribute(GHOST_ATTR);
        host.style.removeProperty('display');
        host.style.removeProperty('pointer-events');
        return;
      }
      if (host.style.getPropertyValue('pointer-events') === 'none') return;
      host.style.setProperty('pointer-events', 'none', 'important');
      if (host.matches('tp-yt-paper-toast')) {
        // Close it through Polymer so YouTube's own state agrees, then hide
        // it; YouTube clears the inline display when it opens the next toast.
        try {
          const w = host.wrappedJSObject || host;
          if (typeof w.close === 'function') w.close();
        } catch (_e) {}
        host.style.setProperty('display', 'none', 'important');
      }
    });
  }

  // querySelectorAll that never throws on a bad remote selector.
  function querySafe(sel) {
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch (_e) {
      return [];
    }
  }

  // Lift the scroll lock the popup left. Until 1.10.0 this forced
  // overflow:auto !important on the page for the rest of the session, which
  // could break fullscreen and theater layout; now it only clears the lock.
  function unlockPage() {
    [document.documentElement, document.body].forEach((node) => {
      if (!node) return;
      node.removeAttribute('scroll-locked');
      if (node.style.overflow === 'hidden') node.style.removeProperty('overflow');
    });
  }

  // ---- user intent ----------------------------------------------------------
  //
  // A pause within USER_PAUSE_MS of a click, tap or key press is the user's.
  // The add-on never restarts a video the user paused.

  const USER_PAUSE_MS = 1500;
  let lastUserInputAt = 0;
  let userPaused = false;

  function noteUserInput(e) {
    if (e.isTrusted) lastUserInputAt = Date.now();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((t) =>
    document.addEventListener(t, noteUserInput, true)
  );

  // Media keys and the OS media overlay don't fire page input events;
  // page-hooks.js records when YouTube's media-session handler ran.
  function userJustActed() {
    const last = Math.max(lastUserInputAt, window.eifMediaKeyAt || 0);
    return Date.now() - last < USER_PAUSE_MS;
  }

  function resumePlayback() {
    if (userPaused) return;
    const video = mainVideo();
    // Already playing (or nothing to play): calling playVideo() again can
    // restart YouTube's state machine for no reason.
    if (video && !video.paused) return;
    // Prefer the player API: it restores YouTube's own state, not just the
    // <video> element. The player's methods live in the page compartment, so
    // reach them through wrappedJSObject (Firefox Xray).
    const player = moviePlayer();
    if (player) {
      try {
        const p = player.wrappedJSObject || player;
        if (typeof p.playVideo === 'function') {
          p.playVideo();
          return;
        }
      } catch (_e) {}
    }
    if (video && video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  // YouTube pauses the video shortly AFTER showing the popup, so a single
  // play() right at removal loses the race. For a short window, retry and
  // counter any pause YouTube forces. If the user had already paused the
  // video, it stays paused.
  let pauseGuardUntil = 0;

  function guardAgainstPause() {
    const video = mainVideo();
    if (!video || userPaused) return;
    pauseGuardUntil = Date.now() + 2000;
    [0, 250, 750, 1500].forEach((ms) => setTimeout(resumePlayback, ms));
  }

  // Media 'pause' doesn't bubble but still capture-phases through document.
  document.addEventListener(
    'pause',
    (e) => {
      if (!isMainVideo(e.target)) return;
      if (userJustActed()) {
        userPaused = true;
        pauseGuardUntil = 0;
        return;
      }
      if (!enabled || Date.now() > pauseGuardUntil) return;
      resumePlayback();
    },
    true
  );
  document.addEventListener(
    'play',
    (e) => {
      if (isMainVideo(e.target)) userPaused = false;
    },
    true
  );

  // ---- media overlay title ------------------------------------------------
  //
  // YouTube can leave the media-session title of an earlier video, an ad or a
  // hover preview in place, so the Windows media overlay names a video that
  // isn't playing. While the main video plays, make the title match it.

  function syncMediaTitle() {
    if (!enabled || pageType() !== 'watch') return;
    const video = mainVideo();
    const player = moviePlayer();
    if (!video || video.paused || !player) return;
    if (player.classList.contains('ad-showing')) return;
    try {
      const ms = navigator.mediaSession;
      if (!ms || typeof MediaMetadata !== 'function') return;
      const p = player.wrappedJSObject || player;
      if (typeof p.getVideoData !== 'function') return;
      const data = p.getVideoData();
      const title = data && typeof data.title === 'string' ? data.title : '';
      if (!title) return;
      const cur = ms.metadata;
      if (cur && cur.title === title) return;
      const id = typeof data.video_id === 'string' ? data.video_id : '';
      ms.metadata = new MediaMetadata({
        title,
        artist: typeof data.author === 'string' ? data.author : '',
        artwork: /^[\w-]{11}$/.test(id)
          ? [
              {
                src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
                sizes: '480x360',
                type: 'image/jpeg',
              },
            ]
          : [],
      });
      diag('media-title-fixed', {});
    } catch (_e) {}
  }

  document.addEventListener(
    'playing',
    (e) => {
      if (isMainVideo(e.target)) setTimeout(syncMediaTitle, 1000);
    },
    true
  );
  setInterval(syncMediaTitle, 5000);

  // ---- observer -----------------------------------------------------------

  const kick = () => {
    // Deferred: the review section's state below isn't initialised yet when
    // the first sweep runs during startup.
    if (removeEnforcementPopups()) {
      const how = lastRemovalHow || 'dom';
      setTimeout(() => onNagRemoved(how), 0);
    }
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
  // A new video starts with no user pause on record.
  window.addEventListener(
    'yt-navigate-start',
    () => {
      userPaused = false;
    },
    true
  );

  // ---- stall detection ----------------------------------------------------
  //
  // Running a second ad blocker (Ghostery, AdBlock Plus, ...) alongside
  // uBlock Origin leaves YouTube's player buffering forever with no media
  // data at all. Nothing here can fix that, but flagging it turns a
  // mysterious "this extension broke YouTube" into an actionable hint: the
  // background page badges the toolbar icon and the popup explains.
  //
  // A stall is a visible watch/shorts page whose MAIN video has been asked
  // to play (not paused) yet has had no current frame (readyState <
  // HAVE_CURRENT_DATA) for STALL_MS. Not counted: a video waiting for a
  // click (autoplay off or blocked: it stays paused), a cued video, a player
  // error ("Video unavailable"), an upcoming premiere or live stream (the
  // offline slate), and the hover-preview player.
  //
  // YouTube itself also holds back playback for some ad-block users for
  // several seconds, so the threshold is well above that delay.

  const STALL_MS = 25000;
  let stallSince = 0;
  let stallReported = false;
  let stallStartedAt = 0;

  function stallDetails() {
    const v = mainVideo();
    return {
      page: pageType(),
      state: playerState(),
      ready: v ? v.readyState : -1,
      net: v ? v.networkState : -1,
      ad: !!(moviePlayer() && moviePlayer().classList.contains('ad-showing')),
    };
  }

  function reportStall(stalled) {
    if (stalled === stallReported) return;
    stallReported = stalled;
    if (stalled) {
      stallStartedAt = stallSince || Date.now();
      diag('stall', stallDetails());
    } else if (stallStartedAt) {
      diag('stall-end', { secs: (Date.now() - stallStartedAt) / 1000 });
      stallStartedAt = 0;
    }
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
      el('p', 'title', 'Video still not loading?'),
      el('p', '', 'A reload usually fixes it. YouTube sometimes holds back ' +
        'playback for people using an ad blocker, and the wait can be long.'),
      el('p', '', 'If it happens a lot: a second ad blocker (Ghostery, ' +
        'AdBlock Plus, AdGuard, Brave Shields) running alongside uBlock ' +
        'Origin can stop videos loading at all. Pausing it on youtube.com ' +
        'helps. Updating uBlock Origin\'s filter lists can help too.'),
      el('p', 'who', 'From Experiencing Interruptions Fix. To rule this ' +
        'add-on out, turn it off from its toolbar icon and reload. Its ' +
        'toolbar menu can copy a diagnostic log.')
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
    const video = mainVideo();
    const player = moviePlayer();
    const state = playerState();
    const loading =
      enabled &&
      !!video &&
      document.visibilityState === 'visible' &&
      /^\/(watch|shorts\/)/.test(location.pathname) &&
      video.readyState < 2 &&
      !video.paused &&
      !video.ended &&
      !video.error &&
      state !== 0 &&
      state !== 2 &&
      state !== 5 &&
      !visibleIn(player, '.ytp-error') &&
      !visibleIn(player, '.ytp-offline-slate');
    if (!loading) {
      stallSince = 0;
      reportStall(false);
      return;
    }
    if (!stallSince) stallSince = Date.now();
    if (Date.now() - stallSince >= STALL_MS) reportStall(true);
  }

  // ---- video load timing (diagnostic log) -----------------------------------
  //
  // Time from the start of a navigation to the main video's first frame, plus
  // how much time page-hooks.js spent pruning YouTube's data on the way. This
  // is what tells "YouTube is slow" apart from "the add-on is slow".

  let loadStart = 0;
  let loadKind = '';
  let loadPending = false;

  function startLoadTimer(kind, at) {
    loadStart = at;
    loadKind = kind;
    loadPending = /^\/(watch|shorts\/)/.test(location.pathname);
  }

  function onFirstFrame(e) {
    if (!loadPending || !isMainVideo(e.target)) return;
    loadPending = false;
    const ms = Date.now() - loadStart;
    if (ms < 0 || ms > 180000) return;
    const s = window.eifPruneStats || {};
    const player = moviePlayer();
    diag('load', {
      ms,
      page: pageType(),
      kind: loadKind,
      hidden: document.visibilityState !== 'visible',
      ad: !!(player && player.classList.contains('ad-showing')),
      prunes: s.prunes || 0,
      walks: s.walks || 0,
      pruneMs: s.pruneMs || 0,
    });
  }

  function resetPruneStats() {
    const s = window.eifPruneStats;
    if (s) {
      s.prunes = 0;
      s.walks = 0;
      s.pruneMs = 0;
    }
  }

  // ---- popups-cleared count and review card --------------------------------
  //
  // Every confirmed removal (a nag taken off the page here, or deleted from
  // YouTube's data by page-hooks.js before it could show) is reported to the
  // background page, which keeps the "popups cleared" count and decides
  // whether to ask for a review. Asking happens only right after a removal,
  // a week after install, never in the first browser session or soon after
  // the add-on failed, at count milestones, at most once per 14 days. The
  // same prompt is shown in the toolbar popup until it is answered.

  const REVIEW_URL =
    'https://addons.mozilla.org/firefox/addon/youtube-interruptions-fix/reviews/';
  // YouTube re-renders the nag a few times and can send it in more than one
  // response: count one removal per burst, and one per video.
  const NAG_COUNT_GAP_MS = 30000;
  const NAG_SAME_PAGE_MS = 5 * 60 * 1000;
  let lastNagCountedAt = 0;
  let lastNagCountedPage = '';
  let reviewHost = null;

  function pageKey() {
    const v = new URLSearchParams(location.search).get('v');
    return location.pathname + (v ? '?v=' + v : '');
  }

  function onNagRemoved(how) {
    diag('nag', { how: typeof how === 'string' ? how : 'dom', page: pageType() });
    if (window !== window.top) return;
    const now = Date.now();
    const key = pageKey();
    if (now - lastNagCountedAt < NAG_COUNT_GAP_MS) return;
    if (key === lastNagCountedPage && now - lastNagCountedAt < NAG_SAME_PAGE_MS) {
      return;
    }
    lastNagCountedAt = now;
    lastNagCountedPage = key;
    let sent;
    try {
      sent = api.runtime.sendMessage({ type: 'nag-cleared' });
    } catch (_e) {
      return;
    }
    Promise.resolve(sent)
      .then((res) => {
        if (!res || !res.askReview) return;
        // Never on top of a problem notice: the add-on just failed there.
        if (stallNoticeHost || missedNagHost || missedNagShownThisPage) return;
        showReviewCard(res.count);
      })
      .catch(() => {});
  }

  // page-hooks.js calls this when it deletes a nag from YouTube's data.
  window.eifNagBlocked = onNagRemoved;

  function answerReview(answer) {
    try {
      api.runtime.sendMessage({ type: 'review-answer', answer }).catch(() => {});
    } catch (_e) {}
  }

  function showReviewCard(count) {
    if (reviewHost || stallNoticeHost || missedNagHost || !document.body) return;
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
      el('p', '', 'Experiencing Interruptions Fix has cleared ' + count +
        ' YouTube popups for you. If it helps, a quick rating helps other ' +
        'people find it.')
    );
    const row = el('div', 'row');
    row.append(
      button('primary', 'review', 'Rate it'),
      button('', 'later', 'Later'),
      button('', 'never', "Don't ask again")
    );
    box.append(row);
    root.append(style, box);
    root.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'review') window.open(REVIEW_URL, '_blank', 'noopener');
      answerReview(act);
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
    'yt-enforcement-message-view-model',
    'yt-notification-action-renderer',
    // Container first: a snackbar inside it is then skipped as a duplicate.
    'snackbar-container',
    'snackbar-view-model',
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
    const video = mainVideo();
    const page = pageType();
    const lines = [
      'Extension: ' + api.runtime.getManifest().version +
        (enabled ? '' : ' (fix turned OFF)'),
      'Browser: ' + navigator.userAgent,
      'Private window: ' + (api.extension.inIncognitoContext ? 'yes' : 'no'),
      'YouTube language: ' + (document.documentElement.lang || '?'),
      'Page: ' + page,
      'Video: ' +
        (video
          ? (video.paused ? 'paused' : 'playing') + ', readyState ' +
            video.readyState + ', player state ' + playerState()
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

  function fullReport() {
    return api.storage.local
      .get('remoteRulesVersion')
      .then(
        (s) => s,
        () => ({})
      )
      .then(
        (s) =>
          'Rules version: ' + (s.remoteRulesVersion || 'built-in') + '\n' +
          buildReport()
      );
  }

  // ---- missed-nag detection -----------------------------------------------
  //
  // The selectors and phrases only catch nags we have seen. A new variant
  // still gives itself away: the video pauses with no click or key press
  // while a toast or dialog the sweep left alone is on screen. Then resume
  // the video and offer, on the page, to report what got through, since
  // affected users rarely find the toolbar popup's Report button.

  const OVERLAY_WAIT_MS = 3000;
  const ISSUE_URL =
    'https://github.com/WaterhouseA-Programming/experiencing-interruptions-fix-youtube/issues/new';
  // GitHub rejects very long URLs; longer reports go via the clipboard.
  const ISSUE_URL_MAX = 7000;
  const UNHANDLED_SELECTORS = [
    'yt-notification-action-renderer',
    'snackbar-view-model',
    'tp-yt-paper-dialog',
    '[role="dialog"]',
    '[role="alertdialog"]',
  ];

  let missedNagChecking = false;
  let missedNagShownThisPage = false;
  let missedNagOff = false;
  let missedNagHost = null;

  api.storage.local
    .get('missedNagNoticeOff')
    .then((s) => {
      missedNagOff = s.missedNagNoticeOff === true;
    })
    .catch(() => {});

  // Overlays the sweep did not remove. "Continue watching?" is YouTube's own
  // idle check: it pauses on purpose and is left alone.
  function findUnhandledOverlay() {
    for (const sel of UNHANDLED_SELECTORS) {
      for (const node of querySafe(sel)) {
        if (!isVisible(node)) continue;
        if (node.querySelector && node.querySelector('yt-confirm-dialog-renderer')) {
          continue;
        }
        if (node.closest && node.closest('eif-stall-notice, eif-review-card, eif-missed-nag')) {
          continue;
        }
        return node;
      }
    }
    return null;
  }

  function onVideoPause(e) {
    if (!enabled || missedNagChecking || missedNagShownThisPage) return;
    const video = e.target;
    // Main player only: hover previews pause on their own all the time.
    if (!isMainVideo(video) || video.ended) return;
    if (!/^\/(watch|shorts\/)/.test(location.pathname)) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastUserInputAt < USER_PAUSE_MS) return;
    // The nag can land just before or just after the pause.
    missedNagChecking = true;
    const started = Date.now();
    (function check() {
      if (!video.paused || Date.now() - lastUserInputAt < USER_PAUSE_MS) {
        missedNagChecking = false;
        return;
      }
      const overlay = findUnhandledOverlay();
      if (overlay) {
        missedNagChecking = false;
        onMissedNag(overlay);
        return;
      }
      if (Date.now() - started < OVERLAY_WAIT_MS) setTimeout(check, 250);
      else missedNagChecking = false;
    })();
  }

  function onMissedNag(overlay) {
    missedNagShownThisPage = true;
    let html = '';
    try {
      html = compactHtml(overlay).slice(0, 1500);
    } catch (_e) {}
    diag('missed-nag', {
      page: pageType(),
      tag: overlay && overlay.tagName ? overlay.tagName.toLowerCase() : '?',
      html,
    });
    // Snapshot now: the overlay may be gone by the time the user clicks.
    const reportPromise = fullReport().catch(() => '');
    guardAgainstPause();
    api.storage.local
      .get('missedNags')
      .then((s) =>
        api.storage.local.set({
          missedNags: (Number(s.missedNags) || 0) + 1,
          // Holds back the review prompt for a while (see background.js).
          lastFailureAt: Date.now(),
        })
      )
      .catch(() => {});
    if (!missedNagOff) reportPromise.then(showMissedNagNotice);
  }

  function showMissedNagNotice(report) {
    if (missedNagHost || !document.body) return;
    hideReviewCard();
    const host = document.createElement('eif-missed-nag');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        .box {
          position: fixed; bottom: 24px; left: 24px; z-index: 2147483647;
          width: min(340px, calc(100vw - 48px)); box-sizing: border-box;
          padding: 12px 14px; border-radius: 12px;
          background: #1f1f1f; color: #f1f1f1; border: 1px solid #d97706;
          box-shadow: 0 6px 20px rgba(0,0,0,.35);
          font: 13px/1.4 Roboto, Arial, sans-serif;
        }
        .title { font-weight: 700; color: #fbbf24; margin: 0 0 4px; }
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
    const msg = el('p', '', 'YouTube paused the video behind a popup ' +
      'Experiencing Interruptions Fix did not recognise, so it resumed it. ' +
      'Reporting the popup lets it be handled for everyone.');
    box.append(el('p', 'title', 'A new YouTube popup got through'), msg);
    const row = el('div', 'row');
    row.append(
      button('primary', 'report', 'Report on GitHub'),
      button('', 'copy', 'Copy report'),
      button('', 'dismiss', 'Dismiss'),
      button('', 'never', "Don't show again")
    );
    box.append(row);
    root.append(style, box);
    root.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'copy') {
        navigator.clipboard.writeText(report).then(
          () => {
            msg.textContent = 'Report copied. Paste it wherever you are ' +
              'getting help. It is also kept in the diagnostic log in the ' +
              'add-on\'s toolbar menu.';
          },
          () => {
            msg.textContent = 'Could not copy. Use "Copy diagnostic log" ' +
              'in the add-on\'s toolbar menu instead.';
          }
        );
        return;
      }
      if (act === 'report') {
        openIssue(report).then((note) => {
          if (note) msg.textContent = note;
          else hideMissedNagNotice();
        });
        return;
      }
      if (act === 'never') {
        missedNagOff = true;
        api.storage.local.set({ missedNagNoticeOff: true }).catch(() => {});
      }
      hideMissedNagNotice();
    });
    document.body.appendChild(host);
    missedNagHost = host;
  }

  function hideMissedNagNotice() {
    if (missedNagHost) missedNagHost.remove();
    missedNagHost = null;
  }

  // Short reports go straight into the issue body; long ones are copied for
  // pasting. Resolves to a message to show if the report could not go either
  // way, or '' once the issue page is open.
  function openIssue(report) {
    const head =
      'A YouTube popup got through (detected automatically by the add-on).\n\n';
    const inline = head + '```\n' + report + '\n```\n';
    const url = (body) =>
      ISSUE_URL +
      '?title=' + encodeURIComponent('Popup not removed (auto-detected)') +
      '&body=' + encodeURIComponent(body);
    if (url(inline).length <= ISSUE_URL_MAX) {
      window.open(url(inline), '_blank', 'noopener');
      return Promise.resolve('');
    }
    return navigator.clipboard.writeText(report).then(
      () => {
        window.open(
          url(head + 'Paste the report the add-on copied to your clipboard ' +
            'below. Check it first: it is the markup of the popups on screen.' +
            '\n\n```\n\n```\n'),
          '_blank',
          'noopener'
        );
        return '';
      },
      () =>
        'Could not copy the report. Use "Popup still showing? Report it" ' +
        'in the add-on\'s toolbar menu instead.'
    );
  }

  if (window === window.top) {
    api.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'build-report') return;
      return fullReport().then((report) => ({ report }));
    });

    document.addEventListener('pause', onVideoPause, true);

    startLoadTimer('initial', Math.round(performance.timeOrigin));
    document.addEventListener('loadeddata', onFirstFrame, true);
    document.addEventListener('playing', onFirstFrame, true);
    window.addEventListener(
      'yt-navigate-start',
      () => {
        resetPruneStats();
        startLoadTimer('spa', Date.now());
      },
      true
    );
    // A navigation can land on a page whose video was already loading.
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        if (!/^\/(watch|shorts\/)/.test(location.pathname)) loadPending = false;
        else if (!loadPending && !loadStart) startLoadTimer('spa', Date.now());
      },
      true
    );
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        missedNagShownThisPage = false;
        hideMissedNagNotice();
      },
      true
    );

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
