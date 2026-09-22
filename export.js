/* Shared workbook builder. Loaded in the LinkedIn page (content script) and in the popup. */
(function (root) {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const COLUMNS = [
    { key: 'index', label: '#', width: 5 },
    { key: 'name', label: 'Name', width: 26 },
    { key: 'matched', label: 'Target company', width: 22 },
    { key: 'maybe', label: 'Possible match (check)', width: 20 },
    { key: 'appliedOn', label: 'Applied on', width: 13, type: 'date' },
    { key: 'title', label: 'Title', width: 34 },
    { key: 'company', label: 'Company', width: 22 },
    { key: 'location', label: 'Location', width: 26 },
    { key: 'mustMet', label: 'Must-have met', width: 10, type: 'number' },
    { key: 'mustTotal', label: 'Must-have total', width: 10, type: 'number' },
    { key: 'prefMet', label: 'Preferred met', width: 10, type: 'number' },
    { key: 'prefTotal', label: 'Preferred total', width: 10, type: 'number' },
    { key: 'qualifications', label: 'Qualifications (as shown)', width: 24 },
    { key: 'email', label: 'Email', width: 30 },
    { key: 'phone', label: 'Phone', width: 18 },
    { key: 'profileUrl', label: 'Profile link', width: 40, type: 'link' },
    { key: 'matchContext', label: 'Where it matched', width: 55 },
    { key: 'experience', label: 'Work history (from profile)', width: 80 },
    { key: 'profileStatus', label: 'Profile read', width: 26 },
    { key: 'details', label: 'Full details (profile, experience, answers)', width: 80 },
    { key: 'scanStatus', label: 'Detail scan status', width: 24 }
  ];

  // Excel serial number for a US style m/d/yyyy date, or null.
  function toExcelDate(text) {
    const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const utc = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function slug(text) {
    return String(text || 'job')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'job';
  }

  function fileName(data) {
    const d = data.exportedAt ? new Date(data.exportedAt) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `linkedin-applicants_${slug(data.jobTitle)}_${stamp}.xlsx`;
  }

  function makeSheet(XLSX, records) {
    const aoa = [COLUMNS.map((c) => c.label)];
    for (const r of records) {
      aoa.push(COLUMNS.map((c) => {
        const v = r[c.key];
        if (v === undefined || v === null) return '';
        if (c.type === 'number' && v !== '' && !isNaN(Number(v))) return Number(v);
        if (typeof v === 'string' && v.length > 32000) return v.slice(0, 32000);
        return v;
      }));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    records.forEach((r, i) => {
      COLUMNS.forEach((c, colIdx) => {
        const ref = XLSX.utils.encode_cell({ r: i + 1, c: colIdx });
        const cell = ws[ref];
        if (!cell) return;
        if (c.type === 'date') {
          const serial = toExcelDate(r[c.key]);
          if (serial !== null) ws[ref] = { t: 'n', v: serial, z: 'dd-mmm-yyyy' };
        }
        if (c.type === 'link' && r[c.key]) cell.l = { Target: r[c.key] };
      });
    });
    ws['!cols'] = COLUMNS.map((c) => ({ wch: c.width }));
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(records.length, 1), c: COLUMNS.length - 1 } })
    };
    return ws;
  }

  function buildBase64(data) {
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error('Excel library did not load.');
    const records = data.records || [];
    const hits = records
      .filter((r) => r.matched || r.maybe)
      .sort((a, b) => (b.matched ? 1 : 0) - (a.matched ? 1 : 0));

    const withEmail = records.filter((r) => r.email).length;
    const withPhone = records.filter((r) => r.phone).length;
    const info = XLSX.utils.aoa_to_sheet([
      ['Job', data.jobTitle || ''],
      ['Page', data.pageUrl || ''],
      ['Exported at', data.exportedAt ? new Date(data.exportedAt).toLocaleString() : ''],
      ['Applicants exported', records.length],
      ['Contact details scanned', data.deep ? 'Yes' : 'No'],
      ['Applicants with email', withEmail],
      ['Applicants with phone', withPhone],
      ['Matched a target company', records.filter((r) => r.matched).length],
      ['Possible match, needs a check', records.filter((r) => !r.matched && r.maybe).length],
      ['Target companies used', (data.targets || []).join(', ')],
      ['Note', 'Only applicants visible under the filter that was active on the page (for example Top fit) are included.'],
      ['Profiles opened', records.filter((r) => r.profileStatus && r.profileStatus.indexOf('read') > -1).length],
      ['Note', 'Company matching reads each applicant\'s LinkedIn profile work history, plus anything shown in the applicant detail view.']
    ]);
    info['!cols'] = [{ wch: 30 }, { wch: 90 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheet(XLSX, hits), 'Shortlist');
    XLSX.utils.book_append_sheet(wb, makeSheet(XLSX, records), 'All applicants');
    XLSX.utils.book_append_sheet(wb, info, 'Export info');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  }

  function toDataUrl(data) {
    return `data:${XLSX_MIME};base64,${buildBase64(data)}`;
  }

  root.ApplicantExport = { COLUMNS, buildBase64, toDataUrl, fileName };
})(typeof self !== 'undefined' ? self : this);
