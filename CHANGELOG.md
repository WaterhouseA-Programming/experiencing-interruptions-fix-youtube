# Changelog

## 1.6.0

- Turned the anti-stall setTimeout squasher off by default (built-in default,
  stored default and remote `minTimeoutMs` are all now 0). Zeroing every long
  timer before playback also fired YouTube's stall-watchdog and retry-backoff
  timers instantly, which showed up as videos that never start or a player
  that reloads its frame over and over. The remote rule can still turn it
  back on. Remote rules v6 pushes the 0 to existing installs immediately.
- The overlay backdrop is now only removed when an enforcement popup was
  removed in the same sweep. Previously any backdrop (Share, Save to
  playlist, Report dialogs) was stripped and then `playVideo()` was forced,
  restarting videos the user had paused.
- Minimum Firefox raised to 140 (desktop) and 142 (Android), the first
  versions that support the `data_collection_permissions` manifest key.
  Clears the AMO validator warnings.

## 1.5.1

- No functional change. Version bump only — 1.5.0 was already uploaded to AMO
  (self-distribution channel), so submitting to the listed channel required a
  new version number.

## 1.5.0

- Fixed a runaway-timer risk in 1.3.1's anti-stall squasher. It zeroed every
  delay >= 10 s with no bound, so any YouTube timer that reschedules itself
  (heartbeats, watch-time pings, idle checks) would re-arm at 0 ms forever: a
  busy loop burning CPU and flooding YouTube with requests. The squasher is now
  bounded two ways — it only runs before playback starts, since the stall it
  targets is a startup stall, and it is capped at 32 squashes per navigation.
  Both reset on SPA navigation.
- Ad-inventory field names are now remotely updatable via a new `adKeys` rule.
  `adPlacements` / `adSlots` / `playerAds` were hardcoded, and every prune is
  gated on those names appearing, so a rename by YouTube would have silently
  disabled the whole prevention layer until a new release shipped.
- The popup sweep in `content.js` now coalesces to at most one pass per frame
  instead of one per mutation batch. Each pass runs several whole-document
  `querySelectorAll` calls and YouTube's DOM churns constantly. The 1 s
  interval still backstops background tabs, where rAF is throttled.
- Rules now keep updating while the fix is toggled off, so re-enabling it no
  longer runs on rules up to 6 hours stale, and a failed fetch retries after
  5/15/60 minutes instead of waiting for the next 6-hour alarm.
- New icon: the old green slash covered the play button and read as "disabled"
  at toolbar size. Now a play button with a green check badge.

## 1.4.0

- Added a "Leave a review" link to the toolbar popup. It opens the add-on's
  AMO reviews page in a new tab. No change to how the fix works.

## 1.3.1

- Anti-stall: added a `setTimeout` hook in `page-hooks.js` that zeroes only
  long delays (>= 10 s by default) on YouTube. While YouTube throttles an
  ad-blocked SABR stream it schedules ~10 s timers (the "timeout 10000" console
  spam) that gate playback from starting; firing them immediately lets the
  video start sooner. Short UI timers are untouched.
  - Threshold is remotely tunable via a new data-only `minTimeoutMs` rule; set
    it to `0` to disable the squasher for everyone without a release.
  - Experimental: it does not defeat SABR throttling itself, it only removes
    the artificial wait, so mileage varies with what YouTube is doing.

## 1.3.0

- Handle YouTube's new toast-style enforcement. The nag moved out of the old
  modal (`ytd-enforcement-message-view-model` in a `tp-yt-paper-dialog`) and is
  now a generic `yt-notification-action-renderer` toast ("Experiencing
  interruptions?") with no distinguishing attribute, so none of the old
  selectors matched it.
  - `content.js` now recognises the toast by its visible text and removes only
    matching notifications, leaving ordinary YouTube toasts ("Added to queue",
    etc.) alone, then resumes playback.
  - Remote `rules.json` gains a data-only `popupText` field (validated
    substrings, lowercased and compared with `String.includes`, never executed)
    so new nag wording can be pushed without a release.
  - `rules.json` v3 also lists the bare `yt-notification-action-renderer`
    selector so installed 1.2.x copies (which have no text matching) clear the
    nag via their existing remote-selector path.
- Note: this removes the enforcement toast and resumes playback. It does not
  change YouTube's server-side SABR stream throttling, which is uBlock Origin /
  filter-list territory.

## 1.2.1

- No functional change. Version bump only — 1.2.0 was already uploaded to AMO
  (listed channel), so unlisted self-signing required a new version number.

## 1.2.0

- Added a prevention layer (`page-hooks.js`) that works the way Brave and
  uBlock Origin scriptlets do, instead of only cleaning up after the popup:
  - Prunes `adPlacements` / `adSlots` / `playerAds` and enforcement-popup
    actions out of YouTube's JSON responses (hooks on the page's `JSON.parse`
    and `Response.prototype.json`) before YouTube's own code sees them, so the
    popup never fires and playback is never paused.
  - Pins `yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModel`
    to `false` so the enforcement dialog is not allowed to open.
  - Uses Firefox's `wrappedJSObject` / `exportFunction` (Xray) so hooks are in
    place at `document_start`, before any YouTube script runs. Every hook is
    fail-safe: on any error, behavior falls back to 1.1.x DOM cleanup.
- Fixed the resume race: YouTube pauses the video shortly *after* showing the
  popup, so the old single `video.play()` often lost. Resuming now uses the
  player API (`movie_player.playVideo()`), retries over 1.5 s, and counters
  any forced pause within a 2 s guard window.
- Remote `rules.json` gains `jsonPopupKeys` (data-only JSON key names,
  validated) so new enforcement renderer names can be pushed without a
  release.

## 1.1.1

- Declared data collection as "none" in the manifest
  (`data_collection_permissions`), now required by addons.mozilla.org. The
  add-on collects no user data. No functional change from 1.1.0.

## 1.1.0

- Renamed to "Experiencing Interruptions Fix for YouTube".
- Added a welcome page shown once on install, with a support link and
  nimblepanda.co.uk contact. Settings are not on this page; they live in the
  extension.
- Added an options page (about:addons) and a toolbar popup with an on/off
  toggle and one-click support button.
- Added dynamic rules: the extension fetches a hostable rules.json so the fix
  can be updated when YouTube changes its markup, without a new release. Rules
  are data-only CSS selectors, never executed as code.
- Added PNG icons (48/96/128), MIT license, privacy policy, and store-listing
  copy.

## 1.0.0

- First version: removes the YouTube ad-blocker enforcement popup and resumes
  playback. Companion to uBlock Origin.
