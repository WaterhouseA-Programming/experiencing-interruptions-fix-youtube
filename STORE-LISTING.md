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

## Version notes (paste into the "Release notes" field)

Use these for the 1.1.1 upload:

> 1.1.1 - Added the data collection declaration now required by AMO (this add-on
> collects no user data). No functional change from 1.1.0.
>
> The add-on removes YouTube's ad-blocker enforcement popup ("You're using an ad
> blocker" / "experiencing interruptions") and resumes the paused video, so
> playback keeps working alongside uBlock Origin. Settings are in the toolbar
> popup and in about:addons.

## Notes to Reviewer (paste into the "Notes to reviewer" field)

> No account or login is required to test this add-on.
>
> How to test:
> 1. Install uBlock Origin (this add-on is a companion to it; without an ad
>    blocker YouTube will not show the popup this add-on targets).
> 2. Open any video on https://www.youtube.com (desktop site).
> 3. If YouTube shows the ad-blocker / "experiencing interruptions" popup, this
>    add-on removes it and the dark overlay, unlocks the page, and resumes the
>    paused video. With no popup present it does nothing visible.
> 4. Settings: click the toolbar icon, or about:addons > this add-on >
>    Preferences. There is an on/off toggle and a manual "Update rules now".
>
> Network / data: when "Auto-update fix rules" is on (default), the background
> script does a plain GET of a JSON file (default host: raw.githubusercontent.com)
> containing a list of CSS selector strings. Those strings are only passed to
> querySelectorAll in content.js; no remote code is fetched or evaluated and
> nothing is inserted as HTML. No user data is sent. Auto-update can be turned
> off in settings, after which the add-on makes no network requests at all.
>
> Scope: built for desktop YouTube (youtube.com). It does not target the mobile
> site (m.youtube.com), which uses different markup.

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
