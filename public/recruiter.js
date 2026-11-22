/* Recruiter portal */
(function () {
  const ROLE = 'recruiter';
  let me = null, jobs = [], apps = [];
  let meetingFor = null;

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
    const [j, a] = await Promise.all([api('/jobs/mine'), api('/recruiter/applications')]);
    jobs = j.jobs || [];
    apps = a.applications || [];
  }

  function renderAll() {
    $('#welcome').textContent = 'Welcome back, ' + me.fullName + ' (' + me.company + ')';
    renderJobs();
    renderApplicants();
    renderStats();
    fillProfile();
  }

  function renderStats() {
    $('#statJobs').textContent = jobs.length;
    $('#statApplicants').textContent = apps.length;
    $('#statMeetings').textContent = apps.filter(a => a.meeting).length;
  }

  /* ---------- Jobs ---------- */
  $('#jobForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    const r = await api('/jobs', { method: 'POST', body: {
      title: v('jobTitle'), location: v('location'), salary: v('salary'),
      type: f.elements.jobType.value, skills: v('skills'), description: v('description') } });
    if (r.error) return toast(r.error, 'error');
    f.reset();
    await refresh(); renderJobs(); renderStats(); renderApplicants();
    toast('Job posted.');
  });

  function renderJobs() {
    $('#jobList').innerHTML = jobs.length ? jobs.map(j => {
      const n = apps.filter(a => a.jobId === j.id).length;
      return `
      <div class="box job">
        <div class="job-top">
          <h3>${esc(j.title)}</h3>
          <span class="badge">${esc(j.type || 'Full-time')}</span>
        </div>
        <p>${esc(j.location)}${j.salary ? ' &middot; ' + esc(j.salary) : ''}</p>
        ${chips(j.skills)}
        ${j.description ? '<p class="desc">' + esc(j.description) + '</p>' : ''}
        <p><b>${n}</b> applicant${n === 1 ? '' : 's'}</p>
        <div class="actions">
          <button class="btn btn-outline btn-small" data-view="${esc(j.id)}">View applicants</button>
          <button class="btn btn-danger btn-small" data-delete="${esc(j.id)}">Delete</button>
        </div>
      </div>`;
    }).join('') : '<p class="empty">You have not posted any jobs yet.</p>';
  }

  $('#jobList').addEventListener('click', async e => {
    if (e.target.dataset.view) {
      openPortalTab('applicants');
      $('#jobFilter').value = e.target.dataset.view;
      renderApplicants();
    }
    const id = e.target.dataset.delete;
    if (id && confirm('Delete this job and all its applications?')) {
      const r = await api('/jobs/' + id, { method: 'DELETE' });
      if (r.error) return toast(r.error, 'error');
      await refresh(); renderAll();
      toast('Job deleted.');
    }
  });

  /* ---------- Applicants ---------- */
  function renderApplicants() {
    const sel = $('#jobFilter');
    const keep = sel.value;
    sel.innerHTML = '<option value="">All jobs</option>' +
      jobs.map(j => '<option value="' + esc(j.id) + '">' + esc(j.title) + '</option>').join('');
    sel.value = jobs.some(j => String(j.id) === keep) ? keep : '';

    const list = apps.filter(a => !sel.value || String(a.jobId) === sel.value);

    $('#applicantRows').innerHTML = list.length ? list.map(a => {
      const c = a.candidate;
      return `<tr>
        <td>
          <b>${esc(c.fullName)}</b><br>
          <small>${esc(c.email)}${c.phone ? ' &middot; ' + esc(c.phone) : ''}</small><br>
          <small class="muted">${esc([c.education, c.location].filter(Boolean).join(' · '))}</small>
          ${chips(c.skills)}
        </td>
        <td>${esc(a.jobTitle)}</td>
        <td>${esc(fmtDate(a.date))}</td>
        <td>
          <select class="status-select ${statusClass(a.status)}" data-status="${esc(a.id)}">
            ${STATUSES.map(s => '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>').join('')}
          </select>
          <div class="meeting-info">${a.meeting ? meetingHTML(a.meeting) : ''}</div>
        </td>
        <td>
          <div class="actions">
            ${c.hasResume ? '<button class="btn btn-outline btn-small" data-resume="' + esc(c.id) + '">View Resume</button>' : '<span class="muted">No resume</span>'}
            <button class="btn btn-small" data-meet="${esc(a.id)}">${a.meeting ? 'Reschedule' : 'Schedule Meeting'}</button>
          </div>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">No applicants yet.</td></tr>';
  }

  $('#jobFilter').addEventListener('change', renderApplicants);

  $('#applicantRows').addEventListener('change', async e => {
    const id = e.target.dataset.status;
    if (!id) return;
    const r = await api('/applications/' + id, { method: 'PATCH', body: { status: e.target.value } });
    if (r.error) toast(r.error, 'error'); else toast('Status updated.');
    await refresh(); renderApplicants(); renderStats();
  });

  $('#applicantRows').addEventListener('click', e => {
    if (e.target.dataset.resume) viewResume(e.target.dataset.resume);
    if (e.target.dataset.meet) openMeeting(Number(e.target.dataset.meet));
  });

  /* ---------- Schedule meeting ---------- */
  function openMeeting(appId) {
    const a = apps.find(x => x.id === appId);
    if (!a) return;
    const f = $('#meetingForm');
    const m = a.meeting || {};
    meetingFor = appId;
    $('#meetingTitle').textContent = 'Schedule meeting with ' + a.candidate.fullName;
    f.elements.date.min = todayStr();
    f.elements.date.value = m.date || '';
    f.elements.time.value = m.time || '';
    f.elements.mode.value = m.mode || 'Video call';
    f.elements.link.value = m.link || '';
    f.elements.notes.value = m.notes || '';
    $('#meetingModal').hidden = false;
  }
  function closeMeeting() { $('#meetingModal').hidden = true; meetingFor = null; }

  $('#meetingForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    if (!meetingFor) return closeMeeting();
    const r = await api('/applications/' + meetingFor + '/meeting', { method: 'PUT', body: {
      date: v('date'), time: v('time'), mode: f.elements.mode.value, link: v('link'), notes: v('notes') } });
    if (r.error) return toast(r.error, 'error');
    closeMeeting();
    await refresh(); renderApplicants(); renderStats();
    toast('Meeting scheduled. The candidate can see it in their dashboard.');
  });
  $('#meetingCancel').addEventListener('click', closeMeeting);
  $('#meetingModal').addEventListener('click', e => { if (e.target.id === 'meetingModal') closeMeeting(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMeeting(); });

  /* ---------- Profile ---------- */
  function fillProfile() {
    const f = $('#profileForm');
    ['fullName', 'email', 'phone', 'company', 'designation', 'about']
      .forEach(n => { f.elements[n].value = me[n] || ''; });
    f.elements.password.value = '';
  }

  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    const pw = f.elements.password.value;
    if (pw && pw.length < 8) return toast('New password must be at least 8 characters.', 'error');
    const body = { fullName: v('fullName'), phone: v('phone'), company: v('company'),
                   designation: v('designation'), about: v('about') };
    if (pw) body.password = pw;
    const r = await api('/me', { method: 'PUT', body });
    if (r.error) return toast(r.error, 'error');
    me = r.user;
    await refresh(); renderAll(); toast('Profile updated.');
  });

  /* ---------- Create profile ---------- */
  $('#registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim();
    const r = await api('/auth/signup', { method: 'POST', body: {
      role: ROLE, fullName: v('fullName'), email: v('email'), password: f.elements.password.value,
      phone: v('phone'), company: v('company'), designation: v('designation'), about: v('about') } });
    if (r.error) return toast(r.error, 'error');
    f.reset();
    await show(true);
    toast('Profile created. You can post your first job now.');
  });

  /* ---------- Login / logout ---------- */
  handleLogin(ROLE, $('#loginForm'), () => show(true));
  $('#logoutBtn').addEventListener('click', async e => { e.preventDefault(); await logout(); show(); });

  show(true);
})();
