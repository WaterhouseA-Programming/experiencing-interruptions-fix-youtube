# YouTube Anti-Adblock Fix (Firefox)

A small companion extension for uBlock Origin. It removes YouTube's
"You're using an ad blocker" / "experiencing interruptions" enforcement popup,
unlocks the page, and resumes the paused video so playback keeps working with
ad blocking on.

uBlock Origin still does the ad blocking. This only kills the nag screen and the
playback lock that comes with it.

## Files

- `manifest.json` — extension manifest (Firefox MV2)
- `content.js` — the content script that removes popups and resumes playback
- `icon.svg` — toolbar/listing icon

## Install (temporary — easiest, resets on restart)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file in this folder
4. Open YouTube. Done.

Temporary add-ons are removed when you close Firefox. Good for testing.

## Install (permanent)

Regular Firefox release/beta requires extensions to be signed by Mozilla, so a
temporary load is the no-hassle route. For a permanent install pick one:

**Option A — Firefox Developer Edition, Nightly, or ESR**
1. Go to `about:config`, set `xpinstall.signatures.required` to `false`
2. Zip the *contents* of this folder (not the folder itself) into a `.xpi`:
   - The zip must have `manifest.json` at its root.
3. Go to `about:addons` → gear icon → **Install Add-on From File…** → pick the `.xpi`

**Option B — self-sign via AMO (works on any Firefox)**
1. Create a free account at https://addons.mozilla.org/developers/
2. Submit this as an **unlisted** add-on; Mozilla signs it and gives you a signed `.xpi`
3. Install that `.xpi` on any Firefox.

### Making the .xpi (PowerShell)

From inside this folder:

```powershell
Compress-Archive -Path .\manifest.json,.\content.js,.\icon.svg -DestinationPath ..\yt-adblock-fix.zip -Force
Rename-Item ..\yt-adblock-fix.zip yt-adblock-fix.xpi
```

## Notes

- Keep uBlock Origin and its filter lists updated — that is still the primary
  defense. This extension is a backstop for when the popup slips through.
- YouTube changes its popup markup often. If the nag returns, the selectors in
  `content.js` (`ytd-enforcement-message-view-model`, `tp-yt-iron-overlay-backdrop`)
  may need updating.
- Personal use only.
