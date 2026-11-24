'use strict';
// LinkedOut backend. Requires Node >= 22.13 (fetch, scrypt).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { eq, and, gt, lt, desc } = require('drizzle-orm');

// ---- config ----
let ENVSTAT = 'environment variables provided by runtime';
for (const envPath of [path.join(__dirname, '.env.development.local'), path.join(__dirname, '.env')]) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    ENVSTAT = 'loaded from ' + envPath;
    for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}
const E = process.env, PORT = +E.PORT || 3000, BASE = (E.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, ''), VERCEL_RUNTIME = E.VERCEL === '1', SECURE = VERCEL_RUNTIME || BASE.startsWith('https');
const { db, pool, users, jobs, applications, sessions, resets } = require('./db');
const STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Interview Scheduled', 'Rejected'], MODES = ['Video call', 'Phone call', 'In person'], TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const PV = {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', tok: 'https://oauth2.googleapis.com/token', info: 'https://openidconnect.googleapis.com/v1/userinfo', id: E.GOOGLE_CLIENT_ID, sec: E.GOOGLE_CLIENT_SECRET },
  linkedin: { auth: 'https://www.linkedin.com/oauth/v2/authorization', tok: 'https://www.linkedin.com/oauth/v2/accessToken', info: 'https://api.linkedin.com/v2/userinfo', id: E.LINKEDIN_CLIENT_ID, sec: E.LINKEDIN_CLIENT_SECRET },
};

// ---- persistent database ----
const first = async (table, condition) => (await db.select().from(table).where(condition).limit(1))[0] || null;

async function initializeDatabase() {
  await db.delete(sessions).where(lt(sessions.expires, Date.now()));
  await db.delete(resets).where(lt(resets.expires, Date.now()));
  if (E.SEED_JOBS === '0') return;

  for (const [index, [company, website, title, location, salary, experience, qualification, skills, description]] of SEED.entries()) {
    let recruiter = await first(users, and(eq(users.provider, 'seed'), eq(users.company, company)));
    if (!recruiter) {
      [recruiter] = await db.insert(users).values({
        role: 'recruiter', full_name: company + ' Talent Acquisition',
        email: 'jobs@' + company.toLowerCase().replace(/[^a-z]/g, '') + '.seed',
        provider: 'seed', company, website, created: Date.now(),
      }).returning();
    }
    await db.update(users).set({ website }).where(eq(users.id, recruiter.id));
    await db.update(jobs).set({ website }).where(eq(jobs.recruiter_id, recruiter.id));
    const existing = await first(jobs, and(eq(jobs.recruiter_id, recruiter.id), eq(jobs.title, title)));
    if (!existing) {
      await db.insert(jobs).values({
        recruiter_id: recruiter.id, company, title, location, salary,
        type: 'Full-time', skills, description, created: Date.now() - index * 1000, experience, qualification, website,
      });
    }
  }
}

// Sample listings from well-known companies (indicative, for demonstration). Disable with SEED_JOBS=0 in .env.
const SEED = [
  ['Infosys', 'https://www.infosys.com/careers/', 'Systems Engineer', 'Bengaluru, Pune, Hyderabad', '₹3.6 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/M.E./M.Tech/MCA/M.Sc in CS, IT or related, 60%+ throughout', 'Java, Python, SQL, Problem solving', 'Work with delivery teams to build, test and support enterprise software for global clients, with structured training in your first months.'],
  ['Infosys', 'https://www.infosys.com/careers/', 'Specialist Programmer', 'Bengaluru', '₹9 – 11 LPA', '0 – 2 years', 'B.E./B.Tech in CS, IT or ECE; strong coding fundamentals', 'Data Structures, Algorithms, Java, C++', 'For candidates with strong problem-solving skills. Design and build complex software components and solve hard engineering problems for clients.'],
  ['TCS', 'https://www.tcs.com/careers/india', 'Assistant System Engineer', 'Mumbai, Chennai, Kolkata, Pune', '₹3.4 – 3.6 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/MCA/M.Sc, 60%+ in 10th, 12th and graduation', 'Programming basics, SQL, Communication', 'Join an IT services project team, learn on the job and contribute to application development and maintenance for enterprise customers.'],
  ['TCS', 'https://www.tcs.com/careers/india', 'Digital Developer', 'Hyderabad, Pune, Chennai', '₹7 LPA', '0 – 2 years', 'B.E./B.Tech/M.Tech in CS, IT or ECE', 'Java, Spring Boot, React, Cloud basics', 'Build modern digital products using cloud and web technologies as part of a product-focused delivery team.'],
  ['Wipro', 'https://careers.wipro.com', 'Project Engineer', 'Bengaluru, Hyderabad, Pune', '₹3.5 – 6.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech in CS, IT, ECE or EEE, 60%+ throughout', 'Programming, Databases, Testing, Communication', 'Support application development, testing and maintenance for Wipro clients while following a structured onboarding programme.'],
  ['Wipro', 'https://careers.wipro.com', 'Cloud Engineer (Azure)', 'Chennai, Bengaluru', '₹8 – 14 LPA', '3 – 5 years', 'B.E./B.Tech in CS or IT; Azure certification preferred', 'Azure, Terraform, Kubernetes, CI/CD', 'Design and operate cloud infrastructure, automate deployments and improve reliability for enterprise workloads.'],
  ['Microsoft', 'https://careers.microsoft.com', 'Software Engineer', 'Hyderabad, Bengaluru', '₹30 – 50 LPA', '0 – 3 years', "Bachelor's or Master's in Computer Science or equivalent practical experience", 'C#, TypeScript, Azure, Algorithms', 'Design, build and ship features for products used by millions. Work in a team that values code quality, testing and collaboration.'],
  ['Microsoft', 'https://careers.microsoft.com', 'Program Manager', 'Hyderabad', '₹35 – 55 LPA', '4 – 7 years', "Bachelor's degree in Engineering, CS or a related field; MBA is a plus", 'Product thinking, Stakeholder management, Data analysis', 'Own the roadmap and delivery of a product area, working with engineering and design to define what gets built and why.'],
  ['Google', 'https://www.google.com/about/careers/applications/', 'Software Engineer, Early Career', 'Bengaluru, Hyderabad', '₹35 – 55 LPA', '0 – 2 years', "Bachelor's degree in CS or related field, or equivalent experience", 'Data Structures, Algorithms, Python, C++', 'Develop software across the stack, from large-scale backend systems to user-facing features, in a collaborative engineering team.'],
  ['Amazon', 'https://www.amazon.jobs', 'Software Development Engineer I', 'Bengaluru, Chennai', '₹28 – 45 LPA', '0 – 2 years', "Bachelor's degree in CS, Engineering or related field", 'Java, Data Structures, System design basics, AWS', 'Design and build scalable services, own components end to end and raise the bar on operational excellence.'],
  ['Accenture', 'https://www.accenture.com/in-en/careers', 'Associate Software Engineer', 'Bengaluru, Pune, Mumbai', '₹4.5 – 6.5 LPA', '0 – 1 years (freshers)', 'Any graduate degree with strong aptitude; B.E./B.Tech preferred', 'Programming basics, Cloud basics, Communication', 'Join a client project team to develop, test and deploy applications while building skills through Accenture learning programmes.'],
  ['Cognizant', 'https://careers.cognizant.com', 'Programmer Analyst Trainee', 'Chennai, Pune, Kolkata', '₹4 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/MCA/M.Sc in CS, IT or related, 60%+', 'Java, SQL, Web basics, Logical reasoning', 'Learn and contribute to application development and support for Cognizant clients after an initial training period.'],
  ['HCLTech', 'https://www.hcltech.com/careers', 'Graduate Engineer Trainee', 'Noida, Chennai', '₹3.5 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech in CS, IT, ECE or EEE', 'C/C++, Java, Networking basics', 'Start in a technology delivery team, rotate through training and take on real engineering tasks as you progress.'],
  ['Tech Mahindra', 'https://careers.techmahindra.com', 'Software Engineer', 'Pune, Hyderabad', '₹3.5 – 5.5 LPA', '0 – 2 years', 'B.E./B.Tech/MCA in any relevant stream', 'Java, Python, Testing, Telecom basics', 'Build and support software for telecom and enterprise customers with mentoring from experienced engineers.'],
  ['Zoho', 'https://www.zoho.com/careers/', 'Member Technical Staff', 'Chennai', '₹6 – 10 LPA', '0 – 2 years', 'Any degree; skills and problem solving matter more than marks', 'Java, JavaScript, Problem solving, Databases', 'Work on Zoho products from design to release, writing production code and owning features.'],
  ['Flipkart', 'https://www.flipkartcareers.com', 'Data Analyst', 'Bengaluru', '₹12 – 20 LPA', '2 – 4 years', "Bachelor's in Engineering, Statistics, Maths or a related field", 'SQL, Python, Tableau, A/B testing', 'Turn marketplace data into insights that guide product, supply and growth decisions for a large e-commerce platform.'],
];


// ---- helpers ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex'), rnd = () => crypto.randomBytes(32).toString('hex');
const hash = (p) => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(p, s, 64).toString('hex'); };
const verify = (p, h) => { if (!h) return false; const [s, k] = h.split(':'), d = crypto.scryptSync(p, Buffer.from(s, 'hex'), 64); return crypto.timingSafeEqual(d, Buffer.from(k, 'hex')); };
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...hdr }); res.end(JSON.stringify(obj)); };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const ck = (n, v, age) => `${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=${VERCEL_RUNTIME ? 'None' : 'Lax'}; Max-Age=${age}${SECURE ? '; Secure' : ''}`;
const readBody = (req, max = 3.5e6) => new Promise((ok, no) => { let n = 0; const b = []; req.on('data', (c) => { n += c.length; if (n > max) { no(new Error('Payload too large')); req.destroy(); } else b.push(c); }); req.on('end', () => { try { ok(b.length ? JSON.parse(Buffer.concat(b)) : {}); } catch { no(new Error('Invalid JSON')); } }); });
const hits = new Map(); const limited = (ip) => { const n = Date.now(), h = (hits.get(ip) || []).filter((t) => n - t < 6e5); h.push(n); hits.set(ip, h); return h.length > 15; };
const session = async (res, uid, extra = []) => {
  const t = rnd();
  await db.insert(sessions).values({ token: sha(t), user_id: uid, expires: Date.now() + 30 * 864e5 });
  res.setHeader('Set-Cookie', [ck('lo_sid', t, 30 * 86400), ...extra]);
};
const current = async (req) => {
  const t = cookies(req).lo_sid;
  if (!t) return null;
  const rows = await db.select({
    id: users.id, role: users.role, full_name: users.full_name, email: users.email, pass: users.pass,
    provider: users.provider, provider_id: users.provider_id, avatar: users.avatar, phone: users.phone,
    location: users.location, education: users.education, skills: users.skills, summary: users.summary,
    company: users.company, designation: users.designation, about: users.about,
    resume_name: users.resume_name, resume_data: users.resume_data, created: users.created, website: users.website,
  }).from(sessions).innerJoin(users, eq(sessions.user_id, users.id))
    .where(and(eq(sessions.token, sha(t)), gt(sessions.expires, Date.now()))).limit(1);
  return rows[0] || null;
};
const isEmail = (e) => typeof e === 'string' && e.length < 255 && /^\S+@\S+\.\S+$/.test(e), isPass = (p) => typeof p === 'string' && p.length >= 8 && p.length < 200;
const cl = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const prof = (u) => ({ id: u.id, role: u.role, fullName: u.full_name, email: u.email, phone: u.phone || '', location: u.location || '', education: u.education || '', skills: u.skills || '', summary: u.summary || '', company: u.company || '', website: u.website || '', designation: u.designation || '', about: u.about || '', resumeName: u.resume_name || '', avatar: u.avatar || '', social: u.provider || '' });
const resumeErr = (r) => { if (!r || typeof r.name !== 'string' || typeof r.data !== 'string') return 'Please upload your resume.'; if (!/\.(pdf|doc|docx)$/i.test(r.name)) return 'Resume must be a PDF, DOC or DOCX file.'; if (!/^data:[\w.+\-\/]{1,100};base64,[A-Za-z0-9+\/=]+$/.test(r.data.length > 300 ? r.data.slice(0, 300) + 'AAAA' : r.data)) return 'Invalid resume file.'; if (r.data.length > 2.1e6) return 'Resume must be smaller than 1.5 MB.'; return ''; };
const siteUrl = (v) => { v = cl(v, 200); if (!v) return ''; if (!/^https?:\/\//i.test(v)) v = 'https://' + v; try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; } };
const meeting = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---- API ----
async function api(req, res, url) {
  const p = url.pathname, m = req.method, ip = (E.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  if (m !== 'GET') {
    if (!(req.headers['content-type'] || '').includes('json')) return send(res, 415, { error: 'JSON required' });
    if (req.headers.origin && req.headers.origin !== new URL(BASE).origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Bad origin' });
  }
  if (p === '/api/config') return send(res, 200, { google: !!(PV.google.id && PV.google.sec), linkedin: !!(PV.linkedin.id && PV.linkedin.sec) });

  if (p === '/api/auth/signup' && m === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const b = await readBody(req), role = b.role === 'recruiter' ? 'recruiter' : 'candidate', email = cl(b.email, 255).toLowerCase(), name = cl(b.fullName, 80);
    if (name.length < 2) return send(res, 400, { error: 'Enter your full name.' });
    if (!isEmail(email)) return send(res, 400, { error: 'Enter a valid email.' });
    if (!isPass(b.password)) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    let rn = null, rd = null, company = null;
    if (role === 'candidate') { const e = resumeErr(b.resume); if (e) return send(res, 400, { error: e }); rn = cl(b.resume.name, 120); rd = b.resume.data; }
    else { company = cl(b.company, 100); if (company.length < 2) return send(res, 400, { error: 'Enter your company name.' }); }
    const web = role === 'recruiter' ? siteUrl(b.website) : '';
    if (web === null) return send(res, 400, { error: 'Enter a valid link, e.g. https://company.com/careers' });
    if (await first(users, eq(users.email, email))) return send(res, 409, { error: 'An account with this email already exists.' });
    let inserted;
    try {
      [inserted] = await db.insert(users).values({
        role, full_name: name, email, pass: hash(b.password), phone: cl(b.phone, 30), location: cl(b.location, 80),
        education: cl(b.education, 150), skills: cl(b.skills, 300), summary: cl(b.summary, 2000), company,
        designation: cl(b.designation, 80), about: cl(b.about, 2000), resume_name: rn, resume_data: rd,
        created: Date.now(), website: web || null,
      }).returning();
    } catch (error) {
      if (error.code === '23505') return send(res, 409, { error: 'An account with this email already exists.' });
      throw error;
    }
    await session(res, inserted.id);
    return send(res, 201, { user: prof(inserted) });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const b = await readBody(req), u = await first(users, eq(users.email, cl(b.email, 255).toLowerCase()));
    if (!u || !verify(String(b.password || ''), u.pass)) return send(res, 401, { error: u && !u.pass ? (u.provider === 'seed' ? 'Wrong email or password.' : `This account uses ${u.provider} sign-in.`) : 'Wrong email or password.' });
    if (b.role && b.role !== u.role) return send(res, 403, { error: `This email is registered as a ${u.role}. Please use the ${u.role} portal.` });
    await session(res, u.id);
    return send(res, 200, { user: prof(u) });
  }
  if (p === '/api/auth/logout' && m === 'POST') {
    const t = cookies(req).lo_sid;
    if (t) await db.delete(sessions).where(eq(sessions.token, sha(t)));
    return send(res, 200, { ok: true }, { 'Set-Cookie': ck('lo_sid', '', 0) });
  }
  if (p === '/api/auth/forgot' && m === 'POST') {
    const b = await readBody(req), u = await first(users, eq(users.email, cl(b.email, 255).toLowerCase()));
    if (u && u.pass) {
      const t = rnd();
      await db.insert(resets).values({ token: sha(t), user_id: u.id, expires: Date.now() + 36e5 });
      console.log(`\n[password reset] ${u.email}: ${BASE}/reset?token=${t}\n(Wire an email provider here to send this link.)\n`);
    }
    return send(res, 200, { message: 'If an account exists for that email, a reset link has been sent.' });
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    const b = await readBody(req), r = await first(resets, and(eq(resets.token, sha(String(b.token || ''))), gt(resets.expires, Date.now())));
    if (!r || !isPass(b.password)) return send(res, 400, { error: 'Invalid or expired link, or password too short.' });
    await db.update(users).set({ pass: hash(b.password) }).where(eq(users.id, r.user_id));
    await db.delete(resets).where(eq(resets.user_id, r.user_id));
    await db.delete(sessions).where(eq(sessions.user_id, r.user_id));
    return send(res, 200, { ok: true });
  }

  const me = await current(req);
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: me ? prof(me) : null });
  if (!me) return send(res, 401, { error: 'Please log in.' });
  const need = (role) => { if (me.role === role) return true; send(res, 403, { error: `${role[0].toUpperCase() + role.slice(1)}s only.` }); return false; };

  if (p === '/api/me' && m === 'PUT') {
    const b = await readBody(req), name = cl(b.fullName, 80);
    if (name.length < 2) return send(res, 400, { error: 'Enter your full name.' });
    if (b.password && !isPass(b.password)) return send(res, 400, { error: 'New password must be at least 8 characters.' });
    let rn = me.resume_name, rd = me.resume_data;
    if (me.role === 'candidate' && b.resume) { const e = resumeErr(b.resume); if (e) return send(res, 400, { error: e }); rn = cl(b.resume.name, 120); rd = b.resume.data; }
    let company = me.company, website = me.website;
    if (me.role === 'recruiter') {
      company = cl(b.company, 100);
      if (company.length < 2) return send(res, 400, { error: 'Enter your company name.' });
      website = siteUrl(b.website);
      if (website === null) return send(res, 400, { error: 'Enter a valid link, e.g. https://company.com/careers' });
    }
    await db.update(users).set({
      full_name: name, phone: cl(b.phone, 30), location: cl(b.location, 80), education: cl(b.education, 150),
      skills: cl(b.skills, 300), summary: cl(b.summary, 2000), company, designation: cl(b.designation, 80),
      about: cl(b.about, 2000), resume_name: rn, resume_data: rd, website: website || null,
    }).where(eq(users.id, me.id));
    if (me.role === 'recruiter') await db.update(jobs).set({ company, website: website || null }).where(eq(jobs.recruiter_id, me.id));
    if (b.password) await db.update(users).set({ pass: hash(b.password) }).where(eq(users.id, me.id));
    return send(res, 200, { user: prof(await first(users, eq(users.id, me.id))) });
  }

  const jobOut = (j) => ({ id: j.id, company: j.company, title: j.title, location: j.location, salary: j.salary || '', type: j.type || 'Full-time', skills: j.skills || '', description: j.description || '', experience: j.experience || '', qualification: j.qualification || '', website: j.website || '', sample: j.prov === 'seed', date: new Date(j.created).toISOString() });
  const joinedJobs = async (condition, limit) => {
    let query = db.select().from(jobs).innerJoin(users, eq(users.id, jobs.recruiter_id));
    if (condition) query = query.where(condition);
    query = query.orderBy(desc(jobs.created));
    if (limit) query = query.limit(limit);
    return (await query).map(({ jobs: job, users: recruiter }) => jobOut({ ...job, prov: recruiter.provider }));
  };
  if (p === '/api/jobs' && m === 'GET') return send(res, 200, { jobs: await joinedJobs(null, 500) });
  if (p === '/api/jobs/mine' && m === 'GET') { if (!need('recruiter')) return; return send(res, 200, { jobs: await joinedJobs(eq(jobs.recruiter_id, me.id)) }); }
  if (p === '/api/jobs' && m === 'POST') {
    if (!need('recruiter')) return;
    const b = await readBody(req), t = cl(b.title, 120), l = cl(b.location, 100);
    if (!t || !l) return send(res, 400, { error: 'Job title and location are required.' });
    await db.insert(jobs).values({
      recruiter_id: me.id, company: me.company || me.full_name, title: t, location: l,
      salary: cl(b.salary, 60), type: TYPES.includes(b.type) ? b.type : 'Full-time', skills: cl(b.skills, 300),
      description: cl(b.description, 3000), created: Date.now(), experience: cl(b.experience, 80),
      qualification: cl(b.qualification, 200), website: me.website || null,
    });
    return send(res, 201, { ok: true });
  }
  let x = p.match(/^\/api\/jobs\/(\d+)$/);
  if (x && m === 'DELETE') {
    if (!need('recruiter')) return;
    const deleted = await db.delete(jobs).where(and(eq(jobs.id, +x[1]), eq(jobs.recruiter_id, me.id))).returning({ id: jobs.id });
    return deleted.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Job not found.' });
  }

  if (p === '/api/applications' && m === 'GET') {
    if (!need('candidate')) return;
    const rows = await db.select().from(applications).innerJoin(jobs, eq(jobs.id, applications.job_id))
      .where(eq(applications.candidate_id, me.id)).orderBy(desc(applications.created));
    return send(res, 200, { applications: rows.map(({ applications: app, jobs: job }) => ({
      id: app.id, jobId: app.job_id, status: app.status, date: new Date(app.created).toISOString(),
      meeting: meeting(app.meeting), title: job.title, company: job.company,
    })) });
  }
  if (p === '/api/applications' && m === 'POST') {
    if (!need('candidate')) return;
    const b = await readBody(req), jobId = Number(b.jobId);
    if (!me.resume_data) return send(res, 400, { error: 'Upload your resume in My Profile before applying.' });
    if (!Number.isInteger(jobId) || !await first(jobs, eq(jobs.id, jobId))) return send(res, 404, { error: 'This job no longer exists.' });
    try {
      await db.insert(applications).values({ job_id: jobId, candidate_id: me.id, status: 'Applied', created: Date.now() });
    } catch (error) {
      if (error.code === '23505') return send(res, 409, { error: 'You already applied to this job.' });
      throw error;
    }
    return send(res, 201, { ok: true });
  }
  if (p === '/api/recruiter/applications' && m === 'GET') {
    if (!need('recruiter')) return;
    const rows = await db.select().from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.job_id))
      .innerJoin(users, eq(users.id, applications.candidate_id))
      .where(eq(jobs.recruiter_id, me.id)).orderBy(desc(applications.created));
    return send(res, 200, { applications: rows.map(({ applications: app, jobs: job, users: candidate }) => ({
      id: app.id, jobId: app.job_id, jobTitle: job.title, status: app.status,
      date: new Date(app.created).toISOString(), meeting: meeting(app.meeting),
      candidate: { id: candidate.id, fullName: candidate.full_name, email: candidate.email,
        phone: candidate.phone || '', education: candidate.education || '', location: candidate.location || '',
        skills: candidate.skills || '', summary: candidate.summary || '', hasResume: !!candidate.resume_data },
    })) });
  }
  x = p.match(/^\/api\/applications\/(\d+)(\/meeting)?$/);
  if (x && (m === 'PATCH' || m === 'PUT')) {
    if (!need('recruiter')) return;
    const rows = await db.select({ id: applications.id }).from(applications).innerJoin(jobs, eq(jobs.id, applications.job_id))
      .where(and(eq(applications.id, +x[1]), eq(jobs.recruiter_id, me.id))).limit(1);
    const app = rows[0];
    if (!app) return send(res, 404, { error: 'Application not found.' });
    const b = await readBody(req);
    if (!x[2]) {
      if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status.' });
      await db.update(applications).set({ status: b.status }).where(eq(applications.id, app.id));
      return send(res, 200, { ok: true });
    }
    const mt = { date: cl(b.date, 10), time: cl(b.time, 5), mode: MODES.includes(b.mode) ? b.mode : 'Video call', link: cl(b.link, 300), notes: cl(b.notes, 500) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mt.date) || !/^\d{1,2}:\d{2}$/.test(mt.time)) return send(res, 400, { error: 'Pick a valid date and time.' });
    await db.update(applications).set({ meeting: JSON.stringify(mt), status: 'Interview Scheduled' }).where(eq(applications.id, app.id));
    return send(res, 200, { ok: true });
  }
  x = p.match(/^\/api\/resume\/(\d+)$/);
  if (x && m === 'GET') {
    const cid = +x[1];
    let allowed = me.id === cid;
    if (!allowed && me.role === 'recruiter') {
      const rows = await db.select({ id: applications.id }).from(applications).innerJoin(jobs, eq(jobs.id, applications.job_id))
        .where(and(eq(applications.candidate_id, cid), eq(jobs.recruiter_id, me.id))).limit(1);
      allowed = rows.length > 0;
    }
    if (!allowed) return send(res, 403, { error: 'Not allowed.' });
    const u = await first(users, eq(users.id, cid));
    return u && u.resume_data ? send(res, 200, { name: u.resume_name, data: u.resume_data }) : send(res, 404, { error: 'No resume uploaded.' });
  }
  return send(res, 404, { error: 'Not found' });
}

// ---- OAuth (Google + LinkedIn, OpenID Connect authorization-code flow) ----
async function oauth(req, res, url) {
  const [, , pv, step] = url.pathname.split('/'), c = PV[pv], home = (r, msg) => { res.writeHead(302, { Location: `/${r === 'recruiter' ? 'recruiter' : 'candidate'}.html` + (msg ? '?auth_error=' + encodeURIComponent(msg) : '') }); res.end(); };
  const ckv = cookies(req), want = url.searchParams.get('role') === 'recruiter' || ckv.lo_role === 'recruiter' ? 'recruiter' : 'candidate';
  if (!c) return home(want, 'Unknown provider');
  if (!c.id || !c.sec) return home(want, `${pv} sign-in is not configured on the server.`);
  const redirect = `${BASE}/auth/${pv}/callback`;
  if (!step) {
    const st = rnd();
    res.writeHead(302, { 'Set-Cookie': [ck('lo_st', st, 600), ck('lo_role', want, 600)], Location: c.auth + '?' + new URLSearchParams({ client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: 'openid profile email', state: st }) }); return res.end();
  }
  try {
    if (url.searchParams.get('error')) return home(want, 'Sign-in was cancelled.');
    if (!ckv.lo_st || ckv.lo_st !== url.searchParams.get('state')) return home(want, 'Sign-in expired. Please try again.');
    const t = await (await fetch(c.tok, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect, client_id: c.id, client_secret: c.sec }) })).json();
    if (!t.access_token) return home(want, 'Could not complete sign-in.');
    const i = await (await fetch(c.info, { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
    const email = String(i.email || '').toLowerCase(); if (!email || i.email_verified === false) return home(want, 'Your account has no verified email.');
    let u = await first(users, and(eq(users.provider, pv), eq(users.provider_id, String(i.sub)))) || await first(users, eq(users.email, email)), msg = '';
    if (!u) {
      const name = cl(i.name || email.split('@')[0], 80);
      [u] = await db.insert(users).values({
        role: want, full_name: name, email, provider: pv, provider_id: String(i.sub),
        avatar: i.picture || null, company: want === 'recruiter' ? name : null, created: Date.now(),
      }).returning();
    } else {
      if (!u.provider) {
        await db.update(users).set({ provider: pv, provider_id: String(i.sub), avatar: u.avatar || i.picture || null }).where(eq(users.id, u.id));
        u = await first(users, eq(users.id, u.id));
      }
      if (u.role !== want) msg = `This email is registered as a ${u.role}.`;
    }
    await session(res, u.id, [ck('lo_st', '', 0), ck('lo_role', '', 0)]);
    home(u.role, msg);
  } catch (e) { console.error('[oauth]', e.message); home(want, 'Sign-in failed. Please try again.'); }
}

// ---- static files + server ----
const PUB = path.join(__dirname, 'public'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const RESET_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Reset password</title><body style="font-family:system-ui;background:#17171a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><form id=f style="width:min(360px,90vw);display:grid;gap:12px"><h2>Choose a new password</h2><input id=p type=password minlength=8 placeholder="New password (8+ chars)" style="padding:12px;border-radius:10px;border:1px solid #555;background:#232327;color:#fff"><button style="padding:12px;border-radius:10px;border:0;background:#8b5cf6;color:#fff;font-weight:700">Update password</button><p id=m></p></form><script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(location.search).get('token'),password:p.value})}),j=await r.json();m.textContent=r.ok?'Password updated. Redirecting...':j.error;if(r.ok)setTimeout(()=>location='/',1500)}</script>`;

async function start() {
  await initializeDatabase();
  http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    try {
      const url = new URL(req.url, BASE);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/auth/')) return await oauth(req, res, url);
      if (url.pathname === '/reset') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(RESET_PAGE); }
      const f = path.join(PUB, url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
      if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, e.message === 'Payload too large' ? 413 : 400, { error: e.message === 'Payload too large' || e.message === 'Invalid JSON' ? e.message : 'Server error' });
    }
  }).listen(PORT, () => {
    console.log('.env: ' + ENVSTAT);
    console.log(`LinkedOut running at ${BASE}  (Google: ${PV.google.id ? 'on' : 'off'}, LinkedIn: ${PV.linkedin.id ? 'on' : 'off'})`);
  });
}

start().catch(async (error) => {
  console.error('[startup]', error.message);
  await pool.end();
  process.exitCode = 1;
});
