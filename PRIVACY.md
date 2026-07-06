# Privacy Policy — Experiencing Interruptions Fix for YouTube

Last updated: 2026-07-06

This extension does not collect, store, or transmit any personal data. There is
no analytics, no tracking, and no account.

## What it does on your device

- Runs a content script on `youtube.com` / `youtube-nocookie.com` that removes
  the ad-blocker enforcement popup and resumes video playback.
- Stores your settings (enabled on/off, auto-update on/off, rules URL) locally
  in the browser using the `storage` permission. This never leaves your device.

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
