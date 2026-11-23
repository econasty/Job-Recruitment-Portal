/* Candidate portal */
(function () {
  const ROLE = 'candidate';
  let me = null, jobs = [], apps = [];

  const openAuthTab = setupTabs($('#auth'));
  const openPortalTab = setupTabs($('#portal'));
  setupSocial(ROLE);

  async function show(resetTab) {
    me = await loadMe(ROLE);
    $('#auth').hidden = !!me;
    $('#portal').hidden = !me;
    $('#logoutBtn').hidden = !me;
    if (me) {
      await refresh();
      renderAll();
      if (resetTab) openPortalTab('jobs');
    } else {
      openAuthTab('login');
    }
  }

  async function refresh() {
    const [j, a] = await Promise.all([api('/jobs'), api('/applications')]);
    jobs = j.jobs || [];
    apps = a.applications || [];
  }

  function renderAll() {
    $('#welcome').textContent = 'Welcome back, ' + me.fullName;
    renderStats();
    renderJobs();
    renderApps();
    fillProfile();
  }

  /* ---------- Stats ---------- */
  function renderStats() {
    $('#statApplied').textContent = apps.length;
    $('#statShortlisted').textContent = apps.filter(a => a.status === 'Shortlisted').length;
    $('#statInterviews').textContent = apps.filter(a => a.status === 'Interview Scheduled').length;
  }

  /* ---------- Jobs ---------- */
  function applyBtn(j) {
    return apps.some(a => a.jobId === j.id)
      ? '<button class="btn btn-outline btn-small" disabled>Applied</button>'
      : '<button class="btn btn-small" data-apply="' + esc(j.id) + '">Apply</button>';
  }

  function renderJobs() {
    const q = $('#jobSearch').value.trim().toLowerCase();
    const list = jobs.filter(j =>
      !q || [j.title, j.company, j.location, j.skills].join(' ').toLowerCase().includes(q));
    $('#jobList').innerHTML = list.length ? list.map(j => jobCard(j, applyBtn(j))).join('')
      : '<p class="empty">No jobs found. Jobs posted by recruiters will show up here.</p>';
  }

  $('#jobSearch').addEventListener('input', renderJobs);

  /* Works for both the job cards and the "View more" popup */
  document.addEventListener('click', async e => {
    const more = e.target.dataset.more;
    if (more) {
      const j = jobs.find(x => String(x.id) === more);
      if (j) showJob(j, applyBtn(j));
      return;
    }
    const id = e.target.dataset.apply;
    if (!id) return;
    e.target.disabled = true;
    const r = await api('/applications', { method: 'POST', body: { jobId: Number(id) } });
    if (r.error) { e.target.disabled = false; return toast(r.error, 'error'); }
    toast('Application sent!');
    closeJobModal();
    await refresh();
    renderStats(); renderJobs(); renderApps();
  });

  /* ---------- Applications ---------- */
  function renderApps() {
    $('#appRows').innerHTML = apps.length ? apps.map(a => `<tr>
        <td>${esc(a.company)}</td>
        <td>${esc(a.title)}</td>
        <td>${esc(fmtDate(a.date))}</td>
        <td class="${statusClass(a.status)}">${esc(a.status)}</td>
        <td>${meetingHTML(a.meeting)}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="empty">You have not applied to any jobs yet.</td></tr>';
  }

  /* ---------- Profile ---------- */
  function fillProfile() {
    const f = $('#profileForm');
    ['fullName', 'email', 'phone', 'location', 'education', 'skills', 'summary']
      .forEach(n => { f.elements[n].value = me[n] || ''; });
    f.elements.password.value = '';
    f.elements.resume.value = '';
    $('#currentResume').innerHTML = me.resumeName
      ? 'Current resume: <b>' + esc(me.resumeName) + '</b> ' +
        '<button type="button" class="btn btn-outline btn-small" id="viewMyResume">View</button>'
      : '<b>No resume uploaded yet.</b> Upload one below to be able to apply for jobs.';
  }

  $('#currentResume').addEventListener('click', e => {
    if (e.target.id === 'viewMyResume') viewResume(me.id);
  });

  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    const pw = f.elements.password.value;
    if (pw && pw.length < 8) return toast('New password must be at least 8 characters.', 'error');

    const body = { fullName: v('fullName'), phone: v('phone'), location: v('location'),
                   education: v('education'), skills: v('skills'), summary: v('summary') };
    if (pw) body.password = pw;
    const file = f.elements.resume.files[0];
    if (file) {
      const err = validateResume(file);
      if (err) return toast(err, 'error');
      body.resume = { name: file.name, data: await readFile(file) };
    }
    const r = await api('/me', { method: 'PUT', body });
    if (r.error) return toast(r.error, 'error');
    me = r.user; renderAll(); toast('Profile updated.');
  });

  /* ---------- Create profile ---------- */
  $('#registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    const file = f.elements.resume.files[0];
    if (!file) return toast('Please upload your resume. It is required.', 'error');
    const err = validateResume(file);
    if (err) return toast(err, 'error');

    const r = await api('/auth/signup', { method: 'POST', body: {
      role: ROLE, fullName: v('fullName'), email: v('email'), password: f.elements.password.value,
      phone: v('phone'), location: v('location'), education: v('education'),
      skills: v('skills'), summary: v('summary'),
      resume: { name: file.name, data: await readFile(file) }
    } });
    if (r.error) return toast(r.error, 'error');
    f.reset();
    await show(true);
    toast('Profile created. Welcome to LinkedOut!');
  });

  /* ---------- Login / logout ---------- */
  handleLogin(ROLE, $('#loginForm'), () => show(true));
  $('#logoutBtn').addEventListener('click', async e => { e.preventDefault(); await logout(); show(); });

  show(true);
})();
