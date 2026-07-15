# Changelog

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
