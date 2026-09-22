/*
 * Applicant Exporter for LinkedIn Hiring
 * Reads the applicant list on your own job post and exports it to Excel.
 *
 * LinkedIn's class names change often, so this script avoids them. It finds rows by the
 * "Applied on:" text, maps text to columns by the position of the table headers
 * (Name, Title, Company, Location, Qualifications), and finds the applicant detail view by
 * looking for new content that mentions the applicant's name after a click.
 */
(() => {
  if (window.__laxLoaded) return;
  window.__laxLoaded = true;

  const TAG = '[Applicant Exporter]';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.4);

  const APPLIED_COUNT_RE = /Applied\s*(?:on)?\s*:/gi;
  const APPLIED_LINE_RE = /^Applied\s*(?:on)?\s*:?\s*(.*)$/i;
  const HEADER_LABELS = ['Name', 'Title', 'Company', 'Location', 'Qualifications'];
  const NOISE_RE = /^(verified|verification badge|view|save|saved|more|open|menu|resume|view resume|\u2022|\u00b7|[123](st|nd|rd)|\d+th)$/i;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d[\d\s.-]{7,16}\d/g;

  const DEFAULT_TARGETS = [
    'Graphy, Spayee',
    'Classplus, Class plus',
    'Thinkific',
    'TagMango, Tag Mango',
    'Teachable',
    'Kajabi',
    'Edmingle',
    'EduGorilla, Edu Gorilla',
    'Superprofile, Super profile',
    'Topmate, Top mate',
    '?Wise, Wise.live, WiseLive, Wise Live',
    'LearnWorlds, Learn Worlds',
    'TrainerCentral, Trainer Central, ?Zoho',
    'Cosmofeed, Cosmo feed',
    'Podia',
    'Teachmint, Teach mint',
    'Testpress, Test press',
    'Nas.io, Nas io, Nas Academy'
  ].join('\n');

  // One company per line. First item is the name that lands in Excel, the rest are aliases.
  // An alias starting with ? is a loose match: it lands in "Possible match" instead of the shortlist.
  function parseTargets(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) continue;
      const name = parts[0].replace(/^\?/, '');
      const strong = [];
      const weak = [];
      parts.forEach((p, i) => {
        if (p.startsWith('?')) weak.push(p.slice(1).trim());
        else if (i > 0 || !parts[0].startsWith('?')) strong.push(p);
      });
      out.push({ name, strong: strong.map(aliasRe), weak: weak.map(aliasRe) });
    }
    return out;
  }

  function aliasRe(alias) {
    const esc = alias.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    return new RegExp(`(?:^|[^a-z0-9])${esc}(?![a-z0-9])`, 'i');
  }

  function snippet(text, index) {
    const from = Math.max(0, index - 45);
    const cut = text.slice(from, index + 60).replace(/\s*\n\s*/g, ' / ').trim();
    return `${from > 0 ? '...' : ''}${cut}...`;
  }

  function matchTargets(rec, targets) {
    const text = [rec.experience, rec.company, rec.title, rec.details].filter(Boolean).join('\n');
    const matched = [];
    const maybe = [];
    const notes = [];
    for (const t of targets) {
      let hit = null;
      for (const re of t.strong) { hit = re.exec(text); if (hit) break; }
      if (hit) {
        matched.push(t.name);
        notes.push(`${t.name}: ${snippet(text, hit.index)}`);
        continue;
      }
      for (const re of t.weak) { hit = re.exec(text); if (hit) break; }
      if (hit) {
        maybe.push(t.name);
        notes.push(`${t.name}?: ${snippet(text, hit.index)}`);
      }
    }
    rec.matched = matched.join(', ');
    rec.maybe = maybe.join(', ');
    rec.matchContext = notes.slice(0, 3).join('  |  ');
    return !!matched.length;
  }

  const state = {
    running: false,
    stopRequested: false,
    records: [],
    seen: new Set(),
    deep: false,
    profiles: false,
    onlyMatches: false,
    checked: 0,
    targets: [],
    targetNames: [],
    matchCount: 0,
    jobTitle: '',
    pageUrl: '',
    exportedAt: null,
    lastPersist: 0
  };

  let ui = null; // panel API, created lazily

  /* ---------- helpers ---------- */

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }

  function clean(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  function countApplied(el) {
    const m = (el.textContent || '').match(APPLIED_COUNT_RE);
    return m ? m.length : 0;
  }

  function inDialog(el) {
    return !!el.closest('[role="dialog"], [aria-modal="true"]');
  }

  async function waitFor(fn, timeout = 8000, every = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (state.stopRequested) return null;
      try {
        const v = fn();
        if (v) return v;
      } catch (e) { /* keep waiting */ }
      await sleep(every);
    }
    return null;
  }

  function realClick(el) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + Math.min(r.width / 2, 20), clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  /* ---------- list reading ---------- */

  // Highest ancestor that holds exactly one "Applied on:" and is still row sized.
  function climbToRow(el) {
    let cur = el;
    let row = null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (countApplied(cur) !== 1) break;
      if (cur.getBoundingClientRect().height > 420) break;
      row = cur;
      cur = cur.parentElement;
    }
    return row;
  }

  function findRows() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/Applied\s*(?:on)?\s*:/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    const rows = [];
    while (walker.nextNode()) {
      const p = walker.currentNode.parentElement;
      if (!p || inDialog(p) || !isVisible(p)) continue;
      const row = climbToRow(p);
      if (row && !rows.includes(row)) rows.push(row);
    }
    const qualified = rows.filter((r) => /must-have|preferred/i.test(r.textContent));
    const list = qualified.length ? qualified : rows;
    list.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return list;
  }

  function findHeaderColumns() {
    const cands = {};
    HEADER_LABELS.forEach((l) => (cands[l] = []));
    for (const el of document.body.querySelectorAll('*')) {
      if (el.childElementCount > 3) continue;
      const t = ownText(el) || (el.childElementCount === 0 ? (el.textContent || '').trim() : '');
      if (!cands[t]) continue;
      if (!isVisible(el) || inDialog(el)) continue;
      cands[t].push(el.getBoundingClientRect());
    }
    for (const q of cands.Qualifications) {
      const picked = [{ label: 'Qualifications', left: q.left }];
      let ok = true;
      for (const label of HEADER_LABELS) {
        if (label === 'Qualifications') continue;
        const hit = cands[label].find((r) => Math.abs(r.top - q.top) < 20);
        if (!hit) { ok = false; break; }
        picked.push({ label, left: hit.left });
      }
      if (ok) return picked.sort((a, b) => a.left - b.left);
    }
    return null;
  }

  function columnFor(x, cols) {
    let label = cols[0].label;
    for (const c of cols) if (x >= c.left - 12) label = c.label;
    return label;
  }

  function textPieces(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (w.nextNode()) {
      const n = w.currentNode;
      const text = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const p = n.parentElement;
      if (!p || p.closest('svg, script, style, noscript')) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) continue; // visually hidden helper text
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      out.push({ text, left: r.left, el: p, inButton: !!p.closest('button, [role="button"]') });
    }
    return out;
  }

  function parseNameCell(texts) {
    const name = [];
    let appliedOn = '';
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const m = t.match(APPLIED_LINE_RE);
      if (m) {
        if (m[1]) appliedOn = m[1];
        else if (texts[i + 1]) { appliedOn = texts[i + 1]; i++; }
        continue;
      }
      if (NOISE_RE.test(t)) continue;
      if (!appliedOn) name.push(t);
    }
    return { name: name.join(' ').trim(), appliedOn: appliedOn.trim() };
  }

  function parseQualifications(text) {
    const out = { qualifications: text.trim(), mustMet: '', mustTotal: '', prefMet: '', prefTotal: '' };
    const must = text.match(/(\d+)\s*\/\s*(\d+)\s*Must-?have/i);
    const pref = text.match(/(\d+)\s*\/\s*(\d+)\s*Preferred/i);
    if (must) { out.mustMet = must[1]; out.mustTotal = must[2]; }
    if (pref) { out.prefMet = pref[1]; out.prefTotal = pref[2]; }
    return out;
  }

  function profileLink(row) {
    const hrefs = [...row.querySelectorAll('a[href]')].map((a) => a.href);
    return hrefs.find((h) => /\/in\//i.test(h)) || hrefs.find((h) => /\/(talent|hiring|recruiter)\//i.test(h)) || '';
  }

  function readRow(row, cols) {
    const rec = { name: '', appliedOn: '', title: '', company: '', location: '', qualifications: '', mustMet: '', mustTotal: '', prefMet: '', prefTotal: '', email: '', phone: '', profileUrl: '', details: '', scanStatus: '', matched: '', maybe: '', matchContext: '', experience: '', profileStatus: '' };
    const pieces = textPieces(row);
    const isQual = (t) => /must-?have|preferred|^\d+\s*\/\s*\d+$/i.test(t);

    if (cols) {
      const bucket = {};
      HEADER_LABELS.forEach((l) => (bucket[l] = []));
      for (const p of pieces) bucket[columnFor(p.left, cols)].push(p);
      Object.assign(rec, parseNameCell(bucket.Name.map((p) => p.text)));
      const join = (arr) => arr.filter((p) => !p.inButton && !NOISE_RE.test(p.text)).map((p) => p.text).join(' ').trim();
      rec.title = join(bucket.Title);
      rec.company = join(bucket.Company);
      rec.location = join(bucket.Location);
      Object.assign(rec, parseQualifications(bucket.Qualifications.map((p) => p.text).filter(isQual).join(' ')));
    } else {
      // Fallback when headers are not on screen: read lines in order.
      const lines = pieces.map((p) => p.text).filter((t) => !NOISE_RE.test(t));
      const idx = lines.findIndex((t) => APPLIED_LINE_RE.test(t));
      Object.assign(rec, parseNameCell(lines.slice(0, idx + 2)));
      let rest = lines.slice(idx + 1);
      if (rest[0] && rest[0] === rec.appliedOn) rest = rest.slice(1);
      const quals = rest.filter(isQual);
      const other = rest.filter((t) => !isQual(t));
      Object.assign(rec, parseQualifications(quals.join(' ')));
      if (other.length >= 3) {
        rec.location = other[other.length - 1];
        rec.company = other[other.length - 2];
        rec.title = other.slice(0, -2).join(' ');
      } else if (other.length === 2) {
        rec.title = other[0];
        rec.location = other[1];
      } else if (other.length === 1) {
        rec.location = other[0];
      }
    }
    rec.profileUrl = profileLink(row);
    rec._pieces = pieces;
    return rec;
  }

  /* ---------- detail view (email, phone, full profile) ---------- */

  function nameNodes(name) {
    const first = name.split(' ')[0];
    if (!first) return [];
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.includes(name) || n.nodeValue.trim() === first ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  function findDetailRoot(ctx) {
    const { row, rec, baselineNodes, rowTextBefore } = ctx;

    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter((d) => isVisible(d) && d.textContent.includes(rec.name.split(' ')[0]));
    if (dialogs.length) return { el: dialogs[dialogs.length - 1], mode: 'dialog' };

    let anchorRow = row;
    if (!row.isConnected) anchorRow = findRows().find((r) => r.textContent.includes(rec.name)) || null;
    const rowAlive = !!anchorRow;
    const navigated = location.href !== ctx.startUrl;
    let best = null;
    for (const n of nameNodes(rec.name)) {
      if (baselineNodes.has(n)) continue;
      const p = n.parentElement;
      if (!p || (rowAlive && anchorRow.contains(p)) || !isVisible(p)) continue;
      let top = p;
      if (rowAlive) {
        while (top.parentElement && top.parentElement !== document.body && !top.parentElement.contains(anchorRow)) top = top.parentElement;
      } else {
        top = p.closest('main, [role="main"]') || document.body;
      }
      const len = (top.textContent || '').length;
      const mode = rowAlive ? 'panel' : navigated ? 'page' : 'main';
      if (len > 250 && (!best || len > best.len)) best = { el: top, len, mode };
    }
    if (best) return best;

    // Detail expanded inside the row itself.
    if (rowAlive && anchorRow.textContent.length > Math.max(400, rowTextBefore * 2)) return { el: anchorRow, mode: 'inline' };
    return null;
  }

  function contactsIn(text) {
    const emails = new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()));
    const phones = new Set();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const digits = (s) => s.replace(/\D/g, '');
    const okPhone = (s) => {
      const d = digits(s).length;
      return d >= 10 && d <= 15 && !/^(19|20)\d{2}\D+(19|20)\d{2}/.test(s.trim());
    };
    lines.forEach((line, i) => {
      if (/\b(phone|mobile|contact number|cell)\b/i.test(line)) {
        const cand = (line.match(PHONE_RE) || []).concat(lines[i + 1] ? lines[i + 1].match(PHONE_RE) || [] : []);
        cand.filter(okPhone).forEach((p) => phones.add(p.trim()));
      }
    });
    if (!phones.size) {
      lines.forEach((line) => {
        if (line.length > 40) return;
        (line.match(PHONE_RE) || []).forEach((p) => {
          if (okPhone(p) && line.replace(p, '').replace(/[^A-Za-z0-9]/g, '').length < 6) phones.add(p.trim());
        });
      });
    }
    return { emails, phones };
  }

  function extractContacts(root, baseline) {
    const emails = new Set();
    const phones = new Set();
    root.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const v = decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]).trim().toLowerCase();
      if (v) emails.add(v);
    });
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const v = a.getAttribute('href').slice(4).trim();
      if (v) phones.add(v);
    });
    const found = contactsIn(root.innerText || '');
    found.emails.forEach((e) => emails.add(e));
    if (!phones.size) found.phones.forEach((p) => phones.add(p));
    return {
      email: [...emails].filter((e) => !baseline.emails.has(e)).join(', '),
      phone: [...phones].filter((p) => !baseline.phones.has(p)).join(', ')
    };
  }

  async function revealContactInfo(root) {
    const btns = [...root.querySelectorAll('button, [role="button"]')].filter(isVisible);
    for (const b of btns) {
      const label = `${b.getAttribute('aria-label') || ''} ${b.innerText || ''}`.trim();
      if (/(show|view|see|reveal)\s+(contact|email|phone)|^contact info/i.test(label)) {
        realClick(b);
        await sleep(900);
      }
    }
  }

  function clickTargets(row, rec) {
    const targets = [];
    const pieces = rec._pieces || [];
    const namePiece = pieces.find((p) => rec.name.startsWith(p.text) || p.text === rec.name);
    if (namePiece) {
      const btn = namePiece.el.closest('button, [role="button"]');
      const a = namePiece.el.closest('a[href]');
      if (btn && row.contains(btn)) targets.push(btn);
      const href = a ? (a.getAttribute('href') || a.href || '') : '';
      if (a && a.target !== '_blank' && !/\/in\//i.test(href)) targets.push(a);
      if (!a) targets.push(namePiece.el);
    }
    // Neutral text in the row. The click bubbles to the row's own handler.
    const neutral = pieces.find((p) => p.text === rec.location || p.text === rec.title);
    if (neutral && !neutral.el.closest('a[target="_blank"], button')) targets.push(neutral.el);
    return [...new Set(targets)];
  }

  async function closeDetail(detail, startUrl) {
    if (!detail) return;
    if (detail.mode === 'page') {
      history.back();
      await waitFor(() => findRows().length > 0, 12000);
      await sleep(800);
      return;
    }
    const scope = detail.el;
    const closeBtn = [...scope.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .find((b) => /^(close|dismiss|hide)\b/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
    if (closeBtn) {
      realClick(closeBtn);
    } else if (detail.mode === 'dialog') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    await sleep(700);
    if (location.href !== startUrl && !findRows().length) {
      history.back();
      await waitFor(() => findRows().length > 0, 12000);
    }
  }

  async function scanDetails(row, rec) {
    const startUrl = location.href;
    const bodyText = document.body.innerText || '';
    const baseline = contactsIn(bodyText);
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => baseline.emails.add(decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]).trim().toLowerCase()));
    const ctx = { row, rec, startUrl, baselineNodes: new Set(nameNodes(rec.name)), rowTextBefore: row.textContent.length };

    let detail = null;
    for (const target of clickTargets(row, rec)) {
      if (state.stopRequested) return;
      target.scrollIntoView({ block: 'center' });
      await sleep(400);
      realClick(target);
      detail = await waitFor(() => findDetailRoot(ctx), 7000);
      if (detail) break;
    }
    if (!detail) {
      rec.scanStatus = 'Detail view did not open';
      log('No detail view for', rec.name);
      return;
    }

    await sleep(1400); // let lazy sections load
    await revealContactInfo(detail.el);
    const fresh = findDetailRoot(ctx) || detail;
    const contacts = extractContacts(fresh.el, baseline);
    rec.email = contacts.email;
    rec.phone = contacts.phone;
    rec.details = clean(fresh.el.innerText).slice(0, 32000);
    rec.scanStatus = rec.email || rec.phone ? 'OK' : 'Opened, no contact shown';
    if (!rec.profileUrl) {
      const a = [...fresh.el.querySelectorAll('a[href*="/in/"]')][0];
      if (a) rec.profileUrl = a.href;
    }
    log('Scanned', rec.name, detail.mode, rec.email, rec.phone);
    await closeDetail(fresh, startUrl);
  }

  /* ---------- reading a profile page ---------- */

  const BLOCKED_PATH = /\/(authwall|checkpoint|login|uas|signup)\b/i;

  function textOf(el) {
    const t = (el.innerText || '').trim();
    return t || (el.textContent || '').replace(/\s*\n\s*/g, '\n').trim();
  }

  function profileText() {
    if (/\/details\/experience/i.test(location.pathname)) {
      const main = document.querySelector('main') || document.body;
      return { text: textOf(main), status: 'Full work history read' };
    }
    const anchor = document.getElementById('experience');
    if (anchor) {
      const sec = anchor.closest('section') || anchor.parentElement;
      const t = sec ? textOf(sec) : '';
      if (t.length > 40) return { text: t, status: 'Experience section read' };
    }
    const main = document.querySelector('main') || document.body;
    let t = textOf(main);
    const cut = t.search(/\n\s*(People also viewed|More profiles for you|People you may know|Explore Premium|Others named)/i);
    if (cut > 200) t = t.slice(0, cut);
    return { text: t, status: 'Whole profile read, check the match' };
  }

  async function scrapeProfile() {
    if (BLOCKED_PATH.test(location.pathname)) return { ok: false, status: 'LinkedIn asked to sign in' };
    const ready = await waitFor(() => {
      const main = document.querySelector('main') || document.body;
      return textOf(main).length > 120 ? main : null;
    }, 20000, 500);
    if (!ready) {
      const t = textOf(document.body).slice(0, 400);
      if (/sign in|join linkedin|log in to continue/i.test(t)) return { ok: false, status: 'LinkedIn asked to sign in' };
      return { ok: false, status: 'Profile did not load' };
    }
    // Nudge lazy sections into the DOM.
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);
    window.scrollTo(0, 0);
    await sleep(400);
    if (BLOCKED_PATH.test(location.pathname)) return { ok: false, status: 'LinkedIn asked to sign in' };
    const found = profileText();
    if (!found.text || found.text.length < 40) return { ok: false, status: 'Profile has no readable work history' };
    return { ok: true, text: found.text.slice(0, 20000), status: found.status };
  }

  async function scanProfile(rec) {
    const url = /linkedin\.com\/in\/|\/in\//i.test(rec.profileUrl) ? rec.profileUrl : '';
    if (!url) { rec.profileStatus = 'No profile link on this applicant'; return; }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'LAX_PROFILE', url });
      if (res && res.ok) {
        rec.experience = res.text;
        rec.profileStatus = res.status;
      } else {
        rec.profileStatus = (res && res.status) || 'Could not read the profile';
      }
    } catch (e) {
      rec.profileStatus = `Could not read the profile: ${e.message}`;
    }
    log('Profile', rec.name, rec.profileStatus);
  }

  /* ---------- scrolling and pages ---------- */

  function scrollerFor(el) {
    let cur = el && el.parentElement;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight + 20) return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function atBottom(sc) {
    return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8;
  }

  function scrollDown(sc) {
    const step = Math.max(300, sc.clientHeight * 0.8);
    if (sc === document.scrollingElement || sc === document.documentElement) window.scrollBy(0, step);
    else sc.scrollBy(0, step);
  }

  function findNextControl(lastRow) {
    const exact = /^(next|next page|load more|show more|show more results|show more applicants|show more candidates|see more applicants|see more candidates|view more applicants|view more candidates)$/i;
    const lastBottom = lastRow ? lastRow.getBoundingClientRect().bottom : -Infinity;
    return [...document.querySelectorAll('button, a[role="button"], [role="button"]')].find((b) => {
      if (!isVisible(b) || inDialog(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      if (lastRow && lastRow.contains(b)) return false;
      const aria = (b.getAttribute('aria-label') || '').trim();
      const text = (b.innerText || '').trim();
      if (!(exact.test(text) || exact.test(aria))) return false;
      return b.getBoundingClientRect().top >= lastBottom - 5; // must sit below the list, not inside a detail view
    });
  }

  /* ---------- run ---------- */

  function snapshot() {
    return {
      records: state.records,
      jobTitle: state.jobTitle,
      pageUrl: state.pageUrl,
      exportedAt: state.exportedAt || Date.now(),
      deep: state.deep,
      targets: state.targetNames
    };
  }

  function persist(force) {
    if (!force && Date.now() - state.lastPersist < 3000) return;
    state.lastPersist = Date.now();
    try {
      chrome.storage.local.set({ lax_last: snapshot() });
    } catch (e) {
      log('Could not save progress', e);
    }
  }

  function guessJobTitle() {
    const t = document.title.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/^\(\d+\)\s*/, '').trim();
    return t || 'LinkedIn job';
  }

  async function run(opts) {
    if (state.running) return;
    Object.assign(state, {
      running: true,
      stopRequested: false,
      records: [],
      seen: new Set(),
      deep: !!opts.deep,
      profiles: !!opts.profiles,
      onlyMatches: !!opts.onlyMatches,
      checked: 0,
      targets: parseTargets(opts.targetsText),
      matchCount: 0,
      jobTitle: guessJobTitle(),
      pageUrl: location.href,
      exportedAt: Date.now()
    });
    state.targetNames = state.targets.map((t) => t.name);
    const limit = opts.limit > 0 ? opts.limit : Infinity;
    const pauseMs = Math.max(2, opts.pauseSec || 3) * 1000;
    ui.setRunning(true);
    ui.status('Reading the applicant list');

    let rows = findRows();
    if (!rows.length) {
      ui.status('No applicants found on this page. Open a job\u2019s applicant list and try again.', 'warn');
      state.running = false;
      ui.setRunning(false);
      return;
    }
    const sc0 = scrollerFor(rows[0]);
    if (sc0 === document.scrollingElement) window.scrollTo(0, 0); else sc0.scrollTo(0, 0);
    await sleep(800);

    let idle = 0;
    let pageClicks = 0;
    try {
      while (!state.stopRequested && state.checked < limit) {
        const cols = findHeaderColumns();
        rows = findRows();
        const fresh = [];
        for (const row of rows) {
          const rec = readRow(row, cols);
          if (!rec.name) continue;
          const key = `${rec.name}|${rec.appliedOn}`;
          if (!state.seen.has(key)) fresh.push({ row, rec, key });
        }

        if (fresh.length) {
          idle = 0;
          for (const { row, rec, key } of fresh) {
            if (state.stopRequested || state.checked >= limit) break;
            if (!row.isConnected) break; // list re-rendered, read it again
            state.seen.add(key);
            if (state.deep) {
              ui.status(`Opening ${rec.name}`);
              await scanDetails(row, rec);
            }
            delete rec._pieces;
            if (state.profiles) {
              ui.status(`Reading the profile of ${rec.name}`);
              await scanProfile(rec);
            }
            const isMatch = matchTargets(rec, state.targets);
            state.checked++;
            if (isMatch) state.matchCount++;
            if (!state.onlyMatches || rec.matched || rec.maybe) {
              rec.index = state.records.length + 1;
              state.records.push(rec);
              ui.addRecord(rec);
            } else {
              ui.skipped(rec);
            }
            persist(false);
            if (state.deep || state.profiles) {
              await sleep(jitter(pauseMs));
              if (!row.isConnected) break;
            }
          }
          continue;
        }

        const last = rows[rows.length - 1];
        const sc = scrollerFor(last || document.body);
        if (!atBottom(sc)) {
          scrollDown(sc);
          ui.status('Scrolling for more applicants');
          await sleep(1200);
          continue;
        }

        const next = findNextControl(last);
        if (next && pageClicks < 500 && idle < 3) {
          pageClicks++;
          ui.status('Loading the next set of applicants');
          realClick(next);
          await sleep(jitter(2500));
          idle++;
          continue;
        }

        idle++;
        if (idle >= 3) break;
        await sleep(1500); // give lazy loading a moment
      }
    } catch (e) {
      log('Stopped on error', e);
      ui.status(`Stopped: ${e.message}. Your progress is kept.`, 'warn');
    }

    state.running = false;
    persist(true);
    ui.setRunning(false);
    const stopped = state.stopRequested ? 'Stopped. ' : '';
    const hits = state.targets.length ? `, ${state.matchCount} at target companies` : '';
    ui.status(`${stopped}${state.checked} applicants checked${hits}. Download the Excel file.`, 'done');
  }

  async function download() {
    if (!state.records.length) return;
    const data = snapshot();
    const filename = window.ApplicantExport.fileName(data);
    let dataUrl;
    try {
      dataUrl = window.ApplicantExport.toDataUrl(data);
    } catch (e) {
      ui.status(`Could not build the file: ${e.message}`, 'warn');
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'LAX_DOWNLOAD', dataUrl, filename });
      if (res && res.ok) {
        ui.status(`Saved ${filename} to Downloads.`, 'done');
        return;
      }
      throw new Error(res ? res.error : 'no response');
    } catch (e) {
      log('Background download failed, using page download', e);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      ui.status(`Saved ${filename}.`, 'done');
    }
  }

  /* ---------- panel UI ---------- */

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      font: 13px/1.45 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; color: #17323A; }
    .launch { display: flex; align-items: center; gap: 8px; border: 1px solid #1E7145; background: #fff;
      color: #1E7145; font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1; padding: 10px 14px; border-radius: 6px; cursor: pointer;
      box-shadow: 0 6px 18px rgba(23, 50, 58, .16); }
    .launch:hover { background: #EEF6F1; }
    .grid-ico { width: 16px; height: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
      background: #1E7145; border: 1px solid #1E7145; }
    .grid-ico i { background: #fff; }
    .grid-ico i:nth-child(-n+3) { background: #1E7145; }
    .panel { width: 340px; background: #fff; border: 1px solid #C9D6CE; border-radius: 8px; overflow: hidden;
      box-shadow: 0 12px 32px rgba(23, 50, 58, .22); }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px;
      background: #1E7145; color: #fff; }
    header h2 { margin: 0; font-size: 14px; font-weight: 600; }
    header button { background: none; border: 0; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
    header button:hover { background: rgba(255,255,255,.15); }
    .body { padding: 12px 14px 14px; }
    .hint { margin: 0 0 10px; color: #5E6E6A; font-size: 12px; }
    label.check { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; cursor: pointer; }
    label.check input { margin-top: 3px; accent-color: #1E7145; }
    label.check small { display: block; color: #5E6E6A; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .row2 label { font-size: 12px; color: #5E6E6A; }
    .row2 input { width: 100%; margin-top: 3px; padding: 6px 8px; border: 1px solid #C9D6CE; border-radius: 4px;
      font: inherit; color: #17323A; }
    .actions { display: flex; gap: 8px; }
    .btn { flex: 1; padding: 9px 10px; border-radius: 5px; font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; border: 1px solid #1E7145; }
    .btn.primary { background: #1E7145; color: #fff; }
    .btn.primary:hover { background: #185C38; }
    .btn.ghost { background: #fff; color: #1E7145; }
    .btn.ghost:hover { background: #EEF6F1; }
    .btn.stop { background: #fff; color: #9A3B12; border-color: #9A3B12; }
    .btn:disabled { opacity: .45; cursor: default; }
    .btn:focus-visible, input:focus-visible, header button:focus-visible, .launch:focus-visible { outline: 2px solid #F2A900; outline-offset: 2px; }
    details.tg { margin: 0 0 12px; border: 1px solid #D9E2DC; border-radius: 4px; }
    details.tg summary { cursor: pointer; padding: 7px 10px; font-size: 12px; color: #17323A; }
    details.tg summary::marker { color: #5E6E6A; }
    details.tg .inner { padding: 0 10px 10px; }
    details.tg textarea { width: 100%; height: 118px; padding: 6px 8px; border: 1px solid #C9D6CE; border-radius: 4px;
      font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.5; color: #17323A; resize: vertical; }
    details.tg p { margin: 6px 0 0; font-size: 11px; color: #5E6E6A; }
    .hit { color: #1E7145; font-weight: 600; }
    .sheet { margin: 12px 0 10px; border: 1px solid #D9E2DC; font-size: 12px; }
    .sheet .hd, .sheet .ln { display: grid; grid-template-columns: 34px 16px 1fr 1fr; }
    .sheet .hd { background: #F1F5F2; color: #5E6E6A; }
    .sheet span { padding: 4px 6px; border-right: 1px solid #D9E2DC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sheet span:last-child { border-right: 0; }
    .sheet .ln { border-top: 1px solid #D9E2DC; }
    .sheet .ln span:first-child, .sheet .hd span:first-child { background: #F1F5F2; color: #5E6E6A; text-align: right; }
    .sheet .ln.new { animation: flash 900ms ease-out; }
    .sheet .ln.skip span { color: #9AA8A4; }
    .sheet .empty { padding: 10px 6px; color: #5E6E6A; border-top: 1px solid #D9E2DC; }
    .muted { color: #9AA8A4; }
    @keyframes flash { from { background: #FFF3C4; } to { background: transparent; } }
    @media (prefers-reduced-motion: reduce) { .sheet .ln.new { animation: none; } }
    .count { display: flex; justify-content: space-between; font-size: 12px; color: #5E6E6A; }
    .count b { color: #17323A; font-size: 20px; font-weight: 600; margin-right: 4px; }
    .status { margin-top: 8px; font-size: 12px; min-height: 17px; }
    .status.warn { color: #9A3B12; }
    .status.done { color: #1E7145; }
  `;

  function createPanel() {
    const host = document.createElement('div');
    host.id = 'lax-exporter-host';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap">
        <button class="launch" type="button"><span class="grid-ico">${'<i></i>'.repeat(9)}</span>Export applicants</button>
        <section class="panel" hidden aria-label="Applicant Exporter">
          <header>
            <h2>Export applicants to Excel</h2>
            <button class="close" type="button" aria-label="Minimize">&minus;</button>
          </header>
          <div class="body">
            <p class="hint">Checks everyone under the filter that is active now. Switch from Top fit to all applicants first if you want the full list.</p>
            <label class="check"><input type="checkbox" class="profiles" checked>
              <span>Open each LinkedIn profile and read work history<small>The only reliable way to see past employers.</small></span></label>
            <label class="check"><input type="checkbox" class="deep" checked>
              <span>Also collect email and phone<small>Opens the applicant view, which is usually where the profile link is.</small></span></label>
            <label class="check"><input type="checkbox" class="onlymatch" checked>
              <span>Export only people who worked at a target company</span></label>
            <div class="row2">
              <label>Max applicants<input type="number" class="limit" min="1" placeholder="All"></label>
              <label>Pause between (sec)<input type="number" class="pause" min="2" value="5"></label>
            </div>
            <details class="tg">
              <summary>Target companies <span class="tgn"></span></summary>
              <div class="inner">
                <textarea class="targets" spellcheck="false"></textarea>
                <p>One company per line. Aliases after commas. Put ? before a loose alias, such as ?Zoho, to send it to "Possible match" instead of the shortlist.</p>
              </div>
            </details>
            <div class="actions">
              <button class="btn primary start" type="button">Start export</button>
              <button class="btn ghost dl" type="button" disabled>Download Excel</button>
            </div>
            <div class="sheet" aria-live="polite">
              <div class="hd"><span></span><span></span><span>Name</span><span>Worked at</span></div>
              <div class="rows"><div class="empty">Captured applicants appear here.</div></div>
            </div>
            <div class="count"><span><b class="n">0</b>shortlisted</span><span class="contacts">0 checked</span></div>
            <div class="status" role="status"></div>
          </div>
        </section>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (s) => shadow.querySelector(s);
    const launch = $('.launch');
    const panel = $('.panel');
    const startBtn = $('.start');
    const dlBtn = $('.dl');
    const rowsBox = $('.rows');
    let contactCount = 0;

    const targetsBox = $('.targets');
    const countTargets = () => {
      const n = targetsBox.value.split('\n').filter((l) => l.trim()).length;
      $('.tgn').textContent = n ? `(${n})` : '(none)';
    };
    targetsBox.value = DEFAULT_TARGETS;
    countTargets();
    try {
      Promise.resolve(chrome.storage.local.get('lax_targets')).then((r) => {
        if (r && typeof r.lax_targets === 'string') targetsBox.value = r.lax_targets;
        countTargets();
      }).catch(() => {});
    } catch (e) { log('Could not read the saved company list', e); }
    targetsBox.addEventListener('input', countTargets);
    targetsBox.addEventListener('change', () => {
      try { Promise.resolve(chrome.storage.local.set({ lax_targets: targetsBox.value })).catch(() => {}); }
      catch (e) { log('Could not save the company list', e); }
    });

    const open = () => { launch.hidden = true; panel.hidden = false; };
    const close = () => { panel.hidden = true; launch.hidden = false; };
    launch.addEventListener('click', open);
    $('.close').addEventListener('click', close);

    startBtn.addEventListener('click', () => {
      if (state.running) {
        state.stopRequested = true;
        api.status('Stopping after the current applicant');
        return;
      }
      rowsBox.innerHTML = '<div class="empty">Captured applicants appear here.</div>';
      contactCount = 0;
      $('.n').textContent = '0';
      $('.contacts').textContent = '';
      run({
        deep: $('.deep').checked,
        limit: parseInt($('.limit').value, 10) || 0,
        pauseSec: parseFloat($('.pause').value) || 5,
        profiles: $('.profiles').checked,
        onlyMatches: $('.onlymatch').checked,
        targetsText: targetsBox.value
      });
    });
    dlBtn.addEventListener('click', download);

    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const api = {
      host,
      open,
      setRunning(on) {
        startBtn.textContent = on ? 'Stop' : 'Start export';
        startBtn.classList.toggle('stop', on);
        startBtn.classList.toggle('primary', !on);
        shadow.querySelectorAll('.deep, .profiles, .onlymatch, .limit, .pause, .targets').forEach((i) => (i.disabled = on));
        dlBtn.disabled = on || !state.records.length;
      },
      status(msg, kind) {
        const s = $('.status');
        s.textContent = msg;
        s.className = `status ${kind || ''}`;
      },
      addRecord(rec) {
        const empty = rowsBox.querySelector('.empty');
        if (empty) empty.remove();
        const ln = document.createElement('div');
        ln.className = 'ln new';
        let last = '<span class="muted">no match</span>';
        if (rec.matched) last = `<span class="hit">${esc(rec.matched)}</span>`;
        else if (rec.maybe) last = `${esc(rec.maybe)}?`;
        else if (!state.targets.length) last = rec.email ? esc(rec.email) : '<span class="muted">none</span>';
        const mark = rec.matched ? '<span class="hit">\u2713</span>' : '';
        ln.innerHTML = `<span>${state.checked}</span><span>${mark}</span><span>${esc(rec.name)}</span><span>${last}</span>`;
        rowsBox.prepend(ln);
        while (rowsBox.children.length > 4) rowsBox.lastChild.remove();
        if (rec.email || rec.phone) contactCount++;
        api.counts();
      },
      skipped(rec) {
        const empty = rowsBox.querySelector('.empty');
        if (empty) empty.remove();
        const ln = document.createElement('div');
        ln.className = 'ln skip';
        ln.innerHTML = `<span>${state.checked}</span><span></span><span>${esc(rec.name)}</span><span>no match</span>`;
        rowsBox.prepend(ln);
        while (rowsBox.children.length > 4) rowsBox.lastChild.remove();
        api.counts();
      },
      counts() {
        $('.n').textContent = String(state.records.length);
        $('.contacts').textContent = `${state.checked} checked`;
      }
    };
    return api;
  }

  function ensurePanel() {
    if (!ui || !ui.host.isConnected) ui = createPanel();
    return ui;
  }

  // Show the launcher on hiring pages. Elsewhere it opens from the toolbar icon.
  const HIRING_PATH = /\/(hiring|talent)\/|applicant/i;
  let openedManually = false;
  function maybeShowLauncher() {
    if (HIRING_PATH.test(location.pathname + location.search)) ensurePanel();
    else if (ui && !state.running && !openedManually) { ui.host.remove(); ui = null; }
  }
  maybeShowLauncher();
  setInterval(maybeShowLauncher, 2500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'LAX_SCRAPE_PROFILE') {
      scrapeProfile().then(sendResponse).catch((e) => sendResponse({ ok: false, status: e.message }));
      return true;
    }
    if (msg && msg.type === 'LAX_OPEN') {
      openedManually = true;
      ensurePanel().open();
      sendResponse({ ok: true, rows: findRows().length });
    }
    return false;
  });

  // Exposed for testing in DevTools.
  window.__laxDebug = { findRows, findHeaderColumns, readRow, findDetailRoot, contactsIn, state };
})();
