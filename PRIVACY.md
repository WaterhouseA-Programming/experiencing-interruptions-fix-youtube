# Privacy Policy — Experiencing Interruptions Fix for YouTube

Last updated: 2026-10-26

This extension does not collect, store, or transmit any personal data. There is
no analytics, no tracking, and no account.

## What it does on your device

- Runs a content script on `youtube.com` / `youtube-nocookie.com` that removes
  the ad-blocker enforcement popup and resumes video playback.
- Stores your settings (enabled on/off, auto-update on/off, rules URL) locally
  in the browser using the `storage` permission. This never leaves your device.
- Stores the install date and a count of popups removed, locally, to decide
  when to show a one-time review request. These never leave your device.
- Stores a local count of popups it detected but could not remove. This
  never leaves your device.

## Problem reports

The toolbar popup's "Popup still showing? Report it" button builds a text
report only when you click it: the HTML of the dialogs and notifications
visible on the YouTube page, the extension, rules and browser versions, and
YouTube's interface language. It is copied to your clipboard and a GitHub
issue page is opened. The extension never sends the report itself; it is
shared only if you paste and post it.

## Network requests

When "Auto-update fix rules" is enabled (default), the extension periodically
downloads a small JSON file from the configured Rules URL
(default: `raw.githubusercontent.com`). This request contains no personal data,
no identifiers, and no browsing history: it is a plain GET of a static file. The
downloaded content is a list of CSS selector strings used only with
`querySelectorAll`; it is never executed as code.

You can turn auto-update off in the extension's settings, in which case the
extension makes no network requests at all.

## Contact

https://buymeacoffee.com/nimblepanda
