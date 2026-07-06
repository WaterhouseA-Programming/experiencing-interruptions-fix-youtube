const api = typeof browser !== 'undefined' ? browser : chrome;
const DONATE_URL = 'https://buymeacoffee.com/nimblepanda';

const els = {
  enabled: document.getElementById('enabled'),
  autoUpdate: document.getElementById('autoUpdate'),
  rulesUrl: document.getElementById('rulesUrl'),
  updateNow: document.getElementById('updateNow'),
  status: document.getElementById('status'),
  donate: document.getElementById('donate'),
  version: document.getElementById('version'),
};

async function load() {
  const s = await api.storage.local.get([
    'enabled',
    'autoUpdate',
    'rulesUrl',
    'lastUpdated',
    'lastUpdateError',
    'remoteRulesVersion',
  ]);
  els.enabled.checked = s.enabled !== false;
  els.autoUpdate.checked = s.autoUpdate !== false;
  els.rulesUrl.value = s.rulesUrl || '';
  renderStatus(s);

  const manifest = api.runtime.getManifest();
  els.version.textContent = `v${manifest.version}`;
}

function renderStatus(s) {
  if (s.lastUpdateError) {
    els.status.textContent = `Last update failed: ${s.lastUpdateError}`;
    return;
  }
  if (s.lastUpdated) {
    const when = new Date(s.lastUpdated).toLocaleString();
    const ver =
      s.remoteRulesVersion != null ? ` (rules v${s.remoteRulesVersion})` : '';
    els.status.textContent = `Updated ${when}${ver}`;
    return;
  }
  els.status.textContent = 'No update yet.';
}

// ---- wiring ---------------------------------------------------------------

els.enabled.addEventListener('change', () =>
  api.storage.local.set({ enabled: els.enabled.checked })
);
els.autoUpdate.addEventListener('change', () =>
  api.storage.local.set({ autoUpdate: els.autoUpdate.checked })
);

let urlTimer;
els.rulesUrl.addEventListener('input', () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(
    () => api.storage.local.set({ rulesUrl: els.rulesUrl.value.trim() }),
    400
  );
});

els.updateNow.addEventListener('click', async () => {
  els.status.textContent = 'Updating…';
  // Persist the current URL first so the fetch uses it.
  await api.storage.local.set({ rulesUrl: els.rulesUrl.value.trim() });
  try {
    const resp = await api.runtime.sendMessage({ type: 'update-rules-now' });
    if (resp && resp.ok) {
      const s = await api.storage.local.get(['lastUpdated', 'remoteRulesVersion']);
      renderStatus({ ...s, lastUpdateError: null });
    } else {
      els.status.textContent = `Update failed: ${resp ? resp.error : 'no response'}`;
    }
  } catch (e) {
    els.status.textContent = `Update failed: ${e}`;
  }
});

els.donate.addEventListener('click', () => api.tabs.create({ url: DONATE_URL }));

load();
