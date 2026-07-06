# AMO Store Listing — copy & assets

Paste-ready text for the addons.mozilla.org listing, plus the screenshot
shot-list. Written to avoid store-policy pitfalls (no "removes ads" claims: this
clears the enforcement popup, uBlock Origin does the blocking).

## Name

Experiencing Interruptions Fix for YouTube

## Summary (max 250 chars)

Getting "experiencing interruptions" or an ad-blocker popup on YouTube while
using uBlock Origin? This clears the popup and resumes your video so playback
keeps working. A companion to uBlock Origin, not a replacement.

## Description

Do your YouTube videos stall on a "You're using an ad blocker" or "experiencing
interruptions" message when uBlock Origin is on? This small add-on removes that
popup and its dark overlay, then resumes the paused video, so playback keeps
working with ad blocking enabled.

What it does:
- Clears the enforcement popup the moment it appears.
- Unlocks the page and resumes the paused video automatically.
- Stays current: it downloads a tiny list of rules so it keeps working when
  YouTube changes its popup, no reinstall needed. The rules are plain data and
  are never run as code.
- Settings live in the toolbar icon and in about:addons: an on/off toggle and a
  manual "update rules" button.

This is a companion to uBlock Origin. uBlock does the ad blocking; this add-on
only clears the nag screen and the playback lock that comes with it. Keep uBlock
Origin and its filter lists updated for the best result.

No tracking, no analytics, no account. Made by one person. Free.

## Categories / tags

Category: Privacy & Security (or Other). Tags: youtube, ublock, adblock,
playback, popup.

## Privacy policy

Paste the contents of PRIVACY.md.

## Review notes (for the AMO reviewer)

The background script fetches a JSON file (default: raw.githubusercontent.com)
containing CSS selector strings. These are only passed to querySelectorAll in
content.js. No remote code is fetched or evaluated, and nothing is inserted as
HTML. Auto-update can be turned off by the user, after which no network requests
are made.

## Screenshots to capture (from the real add-on in Firefox)

Take these at 1280x800, save as PNG. AMO shows the first as the primary.

1. The fix working on YouTube: a normally-playing video with uBlock Origin's
   icon visible. (Optional before/after pair if you can trigger the popup.)
2. The toolbar popup: click the add-on icon, capture the small panel with the
   on/off toggle and "Buy me a coffee" button.
3. The settings page: about:addons > the add-on > Preferences.
4. The welcome page: welcome/welcome.html (shown once on install).

The welcome, popup, and settings pages are plain HTML in this repo, so you can
also open them directly in a browser to screenshot.
