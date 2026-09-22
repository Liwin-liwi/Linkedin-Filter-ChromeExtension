// Opens applicant profiles in a background tab, reads the work history, closes the tab.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askTab(tabId, msg, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (e) { /* the page is still loading, try again */ }
    await sleep(800);
  }
  return { ok: false, status: 'Profile page did not load in time' };
}

async function readProfile(url) {
  const base = url.split('?')[0].replace(/\/+$/, '');
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: `${base}/details/experience/`, active: false });
    let res = await askTab(tab.id, { type: 'LAX_SCRAPE_PROFILE' }, 35000);
    if (!res.ok || !res.text || res.text.length < 40) {
      // Fall back to the main profile page and its Experience section.
      await chrome.tabs.update(tab.id, { url: base });
      await sleep(2000);
      res = await askTab(tab.id, { type: 'LAX_SCRAPE_PROFILE' }, 35000);
    }
    return res;
  } catch (e) {
    return { ok: false, status: `Could not open the profile: ${e.message}` };
  } finally {
    if (tab && tab.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'LAX_DOWNLOAD') {
    chrome.downloads.download(
      { url: msg.dataUrl, filename: msg.filename, saveAs: false, conflictAction: 'uniquify' },
      (id) => {
        if (chrome.runtime.lastError || id === undefined) {
          sendResponse({ ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Download failed' });
        } else {
          sendResponse({ ok: true, id });
        }
      }
    );
    return true;
  }
  if (msg && msg.type === 'LAX_PROFILE') {
    readProfile(msg.url).then(sendResponse);
    return true;
  }
  return false;
});
