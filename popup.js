const $ = (id) => document.getElementById(id);

function say(text, warn) {
  $('msg').textContent = text;
  $('msg').className = warn ? 'msg warn' : 'msg';
}

async function showLast() {
  const { lax_last: last } = await chrome.storage.local.get('lax_last');
  const has = last && last.records && last.records.length;
  $('last').hidden = !has;
  $('dl').hidden = !has;
  $('clear').hidden = !has;
  if (!has) return;
  const withEmail = last.records.filter((r) => r.email).length;
  $('lastTitle').textContent = last.jobTitle || 'LinkedIn job';
  $('lastMeta').textContent = `${last.records.length} applicants, ${withEmail} with email, ${new Date(last.exportedAt).toLocaleString()}`;
}

$('open').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'LAX_OPEN' });
    if (res && res.ok) window.close();
  } catch (e) {
    say('This tab is not a LinkedIn page, or it was open before the extension was installed. Open LinkedIn and refresh the page.', true);
  }
});

$('dl').addEventListener('click', async () => {
  const { lax_last: last } = await chrome.storage.local.get('lax_last');
  if (!last) return;
  try {
    await chrome.downloads.download({
      url: ApplicantExport.toDataUrl(last),
      filename: ApplicantExport.fileName(last),
      conflictAction: 'uniquify'
    });
    say('Saved to Downloads.');
  } catch (e) {
    say(`Could not save the file: ${e.message}`, true);
  }
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('lax_last');
  say('Saved export cleared.');
  showLast();
});

showLast();
