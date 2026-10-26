# Plan: opt-in automatic reports of missed nags

Status: not built. 1.8.0 detects a missed nag and asks the user to file a
GitHub issue by hand. This plan sends the same report automatically, only
for users who said yes.

## What gets sent

One small JSON POST per missed nag, built from the snapshot 1.8.0 already
takes, with less in it:

- extension version, rules version
- Firefox major version only (not the full user agent)
- YouTube interface language (`<html lang>`)
- page type: `watch`, `shorts` or `other`
- for each visible unhandled toast or dialog: tag names, class names, and
  link hosts (`support.google.com`), with all text cut to 200 characters
  and attribute values other than `class` and `href` host removed

Not sent: URL, video ID, IP (the Worker never stores it), account names,
any cookie or identifier. Nothing is sent for nags the add-on removed.

## Consent

Firefox 140+ has built-in data consent. Declare the category as optional so
installing never asks for it:

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": ["technicalAndInteraction"]
}
```

Ask at the moment it is relevant: the missed-nag notice gets a checkbox,
"Send reports like this automatically". Ticking it calls
`browser.permissions.request({ data_collection: ["technicalAndInteraction"],
origins: ["https://<worker-host>/*"] })` from that click, so Firefox shows
its own consent prompt. The Worker host is an `optional_permissions` origin
too, so updating to this version adds no install-time permission warning.

Firefox 115 to 139 (and Orion on iOS) ignore `data_collection_permissions`.
There the add-on keeps its own `autoReport` flag in storage, set only by
the same checkbox, and requests just the host permission.

Settings page gets an "Automatic reports" toggle that shows the current
state and revokes with `browser.permissions.remove(...)`.

## Worker

Cloudflare Worker on its own subdomain, e.g. `reports.nimblepanda.<tld>`:

- `POST /report`: validate shape and size (reject over 32 KB), rate limit
  per IP with the Workers rate-limiting binding (e.g. 10 per hour), never
  log or store the IP.
- Deduplicate on a hash of the sorted tag and class names, so one new
  variant hitting 5,000 users makes one record with a count, not 5,000.
- Store in D1: `variant_hash, first_seen, last_seen, count, sample_json,
  ext_versions, languages`. Delete rows older than 90 days with a cron
  trigger.
- On the first sighting of a hash, create a GitHub issue through the API
  with a fine-grained token (secret, issues:write on this repo only), so
  the existing GitHub notification email is the alert.
- CORS not needed: the request comes from the background page, not the
  YouTube tab, via a `runtime.sendMessage` from content.js.

## Store and policy changes

- PRIVACY.md: new "Automatic reports (optional)" section listing the fields
  above, where they go, the 90-day retention, and how to turn it off.
- AMO listing: the data-collection section must list technical data as
  optional. The privacy policy field on AMO must match PRIVACY.md.
- STORE-LISTING.md: one line saying reports are opt-in.

## Work estimate

- Extension: consent checkbox, settings toggle, sanitiser, background
  sender. About a day, mostly testing consent on Firefox 115 and 140+.
- Worker + D1 + GitHub issue creation: about half a day.

## Open decisions

1. Worker hostname and which Cloudflare account hosts it.
2. Whether the GitHub issue is public (this repo) or goes to a private repo
   or email instead. Report samples are sanitised but still come from
   users' screens.
