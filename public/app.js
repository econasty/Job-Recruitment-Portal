/* LinkedOut shared helpers. All data lives on the server (SQLite) and is accessed through /api. */

async function api(path, opt = {}) {
  try {
    const r = await fetch('/api' + path, {
      method: opt.method || 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || 'Something went wrong.' };
  } catch (e) {
    return { error: "Can't reach the server. Make sure it is running (node server.js)." };
  }
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Escape user text before putting it in HTML */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Session ---------- */
async function loadMe(role) {
  const r = await api('/me');
  return r.user && r.user.role === role ? r.user : null;
}
async function logout() { await api('/auth/logout', { method: 'POST' }); }

/* Shared login form handler */
function handleLogin(role, form, done) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await api('/auth/login', { method: 'POST', body: {
      email: form.elements.email.value.trim(), password: form.elements.password.value, role } });
    if (r.error) return toast(r.error, 'error');
    form.reset();
    done();
  });
}

/* Google / LinkedIn buttons, forgot-password link, and messages coming back from the server */
function setupSocial(role) {
  $$('[data-provider]').forEach(b => b.addEventListener('click', async () => {
    const p = b.dataset.provider, c = await api('/config');
    if (!c[p]) return toast((p === 'google' ? 'Google' : 'LinkedIn') + ' sign-in is not configured on the server yet.', 'error');
    location.href = '/auth/' + p + '?role=' + role;
  }));
  const fg = $('#forgot');
  if (fg) fg.addEventListener('click', async e => {
    e.preventDefault();
    const email = prompt('Enter your account email and we will send a reset link:');
    if (!email) return;
    const r = await api('/auth/forgot', { method: 'POST', body: { email } });
    toast(r.message || r.error, r.error ? 'error' : '');
  });
  const err = new URLSearchParams(location.search).get('auth_error');
  if (err) { history.replaceState(null, '', location.pathname); setTimeout(() => toast(err, 'error'), 300); }
}

/* ---------- Tabs ---------- */
function setupTabs(container, onChange) {
  const tabs = $$('.tab', container);
  const panels = $$('[data-panel]', container);
  function open(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => { p.hidden = p.dataset.panel !== name; });
    if (onChange) onChange(name);
  }
  tabs.forEach(t => t.addEventListener('click', () => open(t.dataset.tab)));
  return open;
}

/* ---------- Toast message ---------- */
function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

/* ---------- Resume files ---------- */
function validateResume(file) {
  if (!/\.(pdf|doc|docx)$/i.test(file.name)) return 'Resume must be a PDF, DOC or DOCX file.';
  if (file.size > 1.5 * 1024 * 1024) return 'Resume must be smaller than 1.5 MB.';
  return '';
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
async function viewResume(candidateId) {
  const r = await api('/resume/' + candidateId);
  if (r.error) return toast(r.error, 'error');
  openResume(r.data, r.name);
}
function openResume(dataUrl, name) {
  try {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || '';
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    if (mime === 'application/pdf') {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast('Could not open the resume file.', 'error');
  }
}

/* ---------- Formatting ---------- */
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T00:00' : d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Interview Scheduled', 'Rejected'];
function statusClass(s) {
  return { 'Applied': 'applied', 'Under Review': 'review', 'Shortlisted': 'shortlist',
           'Interview Scheduled': 'interview', 'Rejected': 'rejected' }[s] || 'applied';
}
function chips(str) {
  const list = String(str || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? '<div class="skills">' + list.map(s => '<span>' + esc(s) + '</span>').join('') + '</div>' : '';
}
function meetingHTML(m) {
  if (!m) return '<span class="muted">-</span>';
  const when = fmtDate(m.date) + (m.time ? ', ' + fmtTime(m.time) : '');
  let where = esc(m.mode || '');
  if (m.link) {
    where += ' &middot; ' + (/^https?:\/\//i.test(m.link)
      ? '<a href="' + esc(m.link) + '" target="_blank" rel="noopener">Join link</a>'
      : esc(m.link));
  }
  return '<b>' + esc(when) + '</b><br><small>' + where + '</small>' +
    (m.notes ? '<br><small class="muted">' + esc(m.notes) + '</small>' : '');
}

/* ---------- Job cards and detail popup ---------- */
/* Every company gets its own accent colour, derived from its name */
function jobColor(name) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return 'hsl(' + h + ', 75%, 68%)';
}
function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

/* Careers sites of well-known companies (where people see what the company does and what teams work on).
   Used when a job has no careers link saved. */
const KNOWN_SITES = {
  infosys: 'https://www.infosys.com/careers/',
  tcs: 'https://www.tcs.com/careers/india', tataconsultancyservices: 'https://www.tcs.com/careers/india',
  wipro: 'https://careers.wipro.com',
  microsoft: 'https://careers.microsoft.com',
  google: 'https://www.google.com/about/careers/applications/', alphabet: 'https://www.google.com/about/careers/applications/',
  amazon: 'https://www.amazon.jobs',
  accenture: 'https://www.accenture.com/in-en/careers',
  cognizant: 'https://careers.cognizant.com',
  hcltech: 'https://www.hcltech.com/careers', hcl: 'https://www.hcltech.com/careers', hcltechnologies: 'https://www.hcltech.com/careers',
  techmahindra: 'https://careers.techmahindra.com',
  zoho: 'https://www.zoho.com/careers/',
  flipkart: 'https://www.flipkartcareers.com',
  capgemini: 'https://www.capgemini.com/careers/', ibm: 'https://www.ibm.com/careers', oracle: 'https://careers.oracle.com',
  adobe: 'https://careers.adobe.com', meta: 'https://www.metacareers.com', apple: 'https://jobs.apple.com',
  netflix: 'https://jobs.netflix.com', swiggy: 'https://careers.swiggy.com', paytm: 'https://paytm.com/careers',
  intel: 'https://jobs.intel.com', salesforce: 'https://careers.salesforce.com', sap: 'https://jobs.sap.com',
  dell: 'https://jobs.dell.com', cisco: 'https://jobs.cisco.com', walmart: 'https://careers.walmart.com',
  goldmansachs: 'https://www.goldmansachs.com/careers/', jpmorgan: 'https://www.jpmorganchase.com/careers',
  jpmorganchase: 'https://www.jpmorganchase.com/careers', ltimindtree: 'https://www.ltimindtree.com/careers/',
  persistent: 'https://www.persistent.com/careers/', persistentsystems: 'https://www.persistent.com/careers/'
};
function companySite(j) {
  const own = safeUrl(j.website);
  if (own) return own;
  let k = String(j.company || '').toLowerCase().replace(/[^a-z0-9]/g, ''), prev;
  do { prev = k; k = k.replace(/(limited|ltd|pvtltd|pvt|privatelimited|inc|corp|corporation|llc|india)$/, ''); } while (k !== prev);
  return KNOWN_SITES[k] || '';
}
/* Company name as a link to the company's website (plain text if no website is known) */
function companyName(j, site) {
  return site
    ? '<a class="co-name" href="' + esc(site) + '" target="_blank" rel="noopener noreferrer" title="Explore careers at ' + esc(j.company) + '">' + esc(j.company) + '</a>'
    : esc(j.company);
}

/* Company name first, then the position, then the salary */
function jobCard(j, extra, note) {
  const site = companySite(j);
  return `
  <div class="box job job-card" style="--c:${jobColor(j.company)}">
    <div class="co-row">
      <span class="co-logo">${esc((j.company || '?').charAt(0).toUpperCase())}</span>
      <div class="co-text">
        <h3 class="co">${companyName(j, site)}</h3>
        <div class="co-sub">${esc(j.location)}${j.type ? ' &middot; ' + esc(j.type) : ''}</div>
      </div>
      ${site ? '<a class="co-link" href="' + esc(site) + '" target="_blank" rel="noopener noreferrer" title="Explore careers at ' + esc(j.company) + '">Careers &#8599;</a>' : ''}
    </div>
    <h4 class="role">${esc(j.title)}</h4>
    ${j.salary ? '<div class="salary">' + esc(j.salary) + '</div>' : ''}
    ${chips(String(j.skills || '').split(',').slice(0, 4).join(','))}
    ${note || ''}
    <div class="actions card-actions">
      <button class="btn btn-outline btn-small" data-more="${esc(j.id)}">View more</button>
      ${extra || ''}
    </div>
  </div>`;
}

function closeJobModal() { const m = $('#jobModal'); if (m) m.hidden = true; }

function showJob(j, actions) {
  let m = $('#jobModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'jobModal'; m.className = 'modal'; m.hidden = true;
    m.addEventListener('click', e => { if (e.target === m || e.target.dataset.close) closeJobModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeJobModal(); });
    document.body.appendChild(m);
  }
  const site = companySite(j);
  const item = (label, val, cls) => val
    ? '<div class="jm-item ' + (cls || '') + '"><span>' + label + '</span><b>' + esc(val) + '</b></div>' : '';
  const skills = String(j.skills || '').split(',').map(x => x.trim()).filter(Boolean);
  m.innerHTML = `
    <div class="job-modal" style="--c:${jobColor(j.company)}" role="dialog" aria-modal="true" aria-label="${esc(j.title)} at ${esc(j.company)}">
      <button type="button" class="jm-close" data-close="1" aria-label="Close">&times;</button>
      <div class="co-row">
        <span class="co-logo">${esc((j.company || '?').charAt(0).toUpperCase())}</span>
        <div class="co-text"><h3 class="co">${companyName(j, site)}</h3><div class="co-sub">${esc(j.type || '')}</div></div>
      </div>
      <h2 class="jm-role">${esc(j.title)}</h2>
      ${j.salary ? '<div class="salary">' + esc(j.salary) + '</div>' : ''}
      <div class="jm-grid">
        ${item('Location', j.location)}
        ${item('Salary', j.salary, 'sal')}
        ${item('Experience required', j.experience)}
        ${item('Qualification', j.qualification)}
        ${item('Job type', j.type)}
        ${item('Posted', fmtDate(j.date))}
      </div>
      ${skills.length ? '<h4 class="jm-h">Skills</h4><div class="skills">' + skills.map(x => '<span>' + esc(x) + '</span>').join('') + '</div>' : ''}
      ${j.description ? '<h4 class="jm-h">About the role</h4><p class="jm-desc">' + esc(j.description).replace(/\n/g, '<br>') + '</p>' : ''}
      ${j.sample ? '<p class="jm-note">This is an indicative sample listing for demonstration. Salary and requirements are approximate. Check the company\'s official careers site for live openings.</p>' : ''}
      <div class="actions jm-actions">
        ${actions || ''}
        ${site ? '<a class="btn btn-outline" href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">Explore careers at ' + esc(j.company) + ' &#8599;</a>' : ''}
      </div>
    </div>`;
  m.hidden = false;
}
