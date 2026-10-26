const api = typeof browser !== 'undefined' ? browser : chrome;
const DONATE_URL = 'https://buymeacoffee.com/nimblepanda';
const REVIEW_URL =
  'https://addons.mozilla.org/en-GB/firefox/addon/youtube-interruptions-fix/reviews/';
const ISSUE_URL =
  'https://github.com/WaterhouseA-Programming/experiencing-interruptions-fix-youtube/issues/new';

const enabledEl = document.getElementById('enabled');

api.storage.local.get('enabled').then((s) => {
  enabledEl.checked = s.enabled !== false;
});

// The background page badges a tab '!' when content.js sees its video stuck
// with no media data; explain it here.
api.tabs
  .query({ active: true, currentWindow: true })
  .then(([tab]) =>
    tab ? api.browserAction.getBadgeText({ tabId: tab.id }) : ''
  )
  .then((text) => {
    if (text === '!') document.getElementById('stall').hidden = false;
  })
  .catch(() => {});

// Firefox runs add-ons in private windows only when the user allows it per
// add-on, so a nag there looks like the fix failing.
api.extension
  .isAllowedIncognitoAccess()
  .then((allowed) => {
    if (!allowed) document.getElementById('private').hidden = false;
  })
  .catch(() => {});

// Ask the active YouTube tab for a snapshot of its on-screen dialogs and
// toasts, copy it, and open a GitHub issue for the user to paste it into.
// Nothing is sent by the extension: the user sees and posts the text.
const reportMsg = document.getElementById('report-msg');
const reportText = document.getElementById('report-text');

function say(text) {
  reportMsg.textContent = text;
  reportMsg.hidden = false;
}

let pendingIssueUrl = null;

document.getElementById('report').addEventListener('click', async () => {
  if (pendingIssueUrl) {
    api.tabs.create({ url: pendingIssueUrl });
    window.close();
    return;
  }
  let report;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const res = await api.tabs.sendMessage(
      tab.id,
      { type: 'build-report' },
      { frameId: 0 }
    );
    report = res && res.report;
  } catch (_e) {}
  if (!report) {
    say(
      'Open the YouTube tab where the popup is showing, then click Report ' +
        'again while it is still on screen.'
    );
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(report);
    copied = true;
  } catch (_e) {}
  const body =
    'The "Experiencing interruptions" popup was not removed.\n\n' +
    'Paste the report the add-on copied to your clipboard below. Check it ' +
    'first: it is the markup of the popups on screen and should not contain ' +
    'anything personal.\n\n```\n\n```\n';
  const url =
    ISSUE_URL +
    '?title=' + encodeURIComponent('Popup not removed') +
    '&body=' + encodeURIComponent(body);
  if (copied) {
    api.tabs.create({ url });
    window.close();
    return;
  }
  // Clipboard refused. Opening a tab would close this popup and lose the
  // text, so show it for copying by hand and let the user open the issue.
  say('Copy this report, then click Report again to open the GitHub issue.');
  reportText.value = report;
  reportText.hidden = false;
  reportText.select();
  pendingIssueUrl = url;
});

enabledEl.addEventListener('change', () =>
  api.storage.local.set({ enabled: enabledEl.checked })
);

document.getElementById('donate').addEventListener('click', () => {
  api.tabs.create({ url: DONATE_URL });
  window.close();
});

document.getElementById('review').addEventListener('click', () => {
  api.tabs.create({ url: REVIEW_URL });
  window.close();
});

document.getElementById('options').addEventListener('click', () => {
  api.runtime.openOptionsPage();
  window.close();
});
