# Changelog

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
