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
