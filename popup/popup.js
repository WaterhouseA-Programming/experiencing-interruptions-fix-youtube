const api = typeof browser !== 'undefined' ? browser : chrome;
const DONATE_URL = 'https://buymeacoffee.com/nimblepanda';
const REVIEW_URL =
  'https://addons.mozilla.org/en-GB/firefox/addon/youtube-interruptions-fix/reviews/';

const enabledEl = document.getElementById('enabled');

api.storage.local.get('enabled').then((s) => {
  enabledEl.checked = s.enabled !== false;
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
