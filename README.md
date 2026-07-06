# Experiencing Interruptions Fix for YouTube

A Firefox extension that removes YouTube's ad-blocker enforcement popup
("You're using an ad blocker" / "experiencing interruptions"), unlocks the page,
and resumes the paused video so playback keeps working with ad blocking on.

It is a **companion to uBlock Origin**, not a replacement. uBO does the ad
blocking; this clears the nag screen and the playback lock that comes with it.

## Features

- Removes the enforcement popup and dark backdrop the moment they appear.
- Resumes the paused video automatically.
- **Dynamic rules:** downloads a small selector list from a URL you control, so
  when YouTube changes its markup you push a one-line fix to every installed
  copy instead of shipping a new release. Data only, never executed as code.
- **Options page** (in `about:addons`) and a **toolbar popup** with an on/off
  toggle and one-click donate.
- No tracking, no analytics. See [PRIVACY.md](PRIVACY.md).

## Files

```
manifest.json      extension manifest (Firefox MV2)
background.js      install donate tab, defaults, remote rules updater
content.js         removes popups + resumes playback
options/           settings page (about:addons)
popup/             toolbar popup (quick toggle + donate)
icons/icon.svg     icon
rules.json         the updatable rules file you HOST (not shipped in the .xpi)
build.ps1          packages an .xpi
```

## Try it locally (temporary, resets on restart)

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `manifest.json`
3. Open YouTube.

## Publish to the Firefox Add-ons store (AMO) — permanent install

This is the proper "permanent + marketplace" route. AMO signing is what makes an
extension installable permanently on normal Firefox.

1. Create a free developer account at https://addons.mozilla.org/developers/
2. Build the package: `powershell -ExecutionPolicy Bypass -File .\build.ps1`
   (produces `experiencing-interruptions-fix-<version>.xpi`).
   - Or use Mozilla's tool: `npm i -g web-ext` then `web-ext lint` and
     `web-ext build` (respects `.web-ext-ignore`).
3. Submit the `.xpi` on AMO as a **listed** add-on (public in the store) or
   **unlisted** (self-distributed; Mozilla still signs it).
4. AMO reviews it, signs it, and it becomes installable by anyone.

Listing needs: a short + long description, at least one screenshot, an icon,
and the privacy policy (paste [PRIVACY.md](PRIVACY.md)). Because the extension
fetches remote rules, disclose that in the review notes (it is data, not code).

## The dynamic rules system

`background.js` fetches the **Rules URL** every 6 hours (and on install/startup)
when auto-update is on. Default URL:

```
https://raw.githubusercontent.com/nimblepanda/experiencing-interruptions-fix-youtube/main/rules.json
```

To use it: create that GitHub repo (public), drop [rules.json](rules.json) at the
repo root, and you're set. When YouTube changes its popup, edit `rules.json`,
bump `version`, and commit — every install picks it up within 6 hours (or
instantly via **Update rules now** in settings). Change the URL in Options if you
want to host it somewhere else.

`rules.json` schema:

```json
{
  "version": 2,
  "popupSelectors":    ["css selector", "..."],
  "backdropSelectors": ["css selector", "..."]
}
```

Selectors are merged on top of the built-in defaults in `content.js`, so the
extension still works if the fetch fails or auto-update is off.

## Notes

- Keep uBlock Origin and its filter lists updated — that is still the primary
  defense. This is the backstop for when the popup slips through.
- Firefox only for now (uses MV2 + `browser.*` APIs).
