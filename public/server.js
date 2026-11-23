'use strict';
// LinkedOut backend, zero npm dependencies. Requires Node >= 22.13 (built-in node:sqlite, fetch, scrypt).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---- config (.env) ----
let ENVSTAT = 'NOT FOUND (looked for ' + path.join(__dirname, '.env') + ')';
try { const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); ENVSTAT = 'loaded from ' + path.join(__dirname, '.env'); for (const l of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const E = process.env, PORT = +E.PORT || 3000, BASE = (E.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, ''), SECURE = BASE.startsWith('https');
const STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Interview Scheduled', 'Rejected'], MODES = ['Video call', 'Phone call', 'In person'], TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const PV = {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', tok: 'https://oauth2.googleapis.com/token', info: 'https://openidconnect.googleapis.com/v1/userinfo', id: E.GOOGLE_CLIENT_ID, sec: E.GOOGLE_CLIENT_SECRET },
  linkedin: { auth: 'https://www.linkedin.com/oauth/v2/authorization', tok: 'https://www.linkedin.com/oauth/v2/accessToken', info: 'https://api.linkedin.com/v2/userinfo', id: E.LINKEDIN_CLIENT_ID, sec: E.LINKEDIN_CLIENT_SECRET },
};

// ---- database ----
const db = new DatabaseSync(path.resolve(__dirname, E.DB_FILE || 'linkedout.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('candidate','recruiter')), full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass TEXT, provider TEXT, provider_id TEXT, avatar TEXT,
  phone TEXT, location TEXT, education TEXT, skills TEXT, summary TEXT, company TEXT, designation TEXT, about TEXT, resume_name TEXT, resume_data TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company TEXT NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL, salary TEXT, type TEXT, skills TEXT, description TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'Applied', meeting TEXT, created INTEGER NOT NULL, UNIQUE(job_id,candidate_id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_app_job ON applications(job_id); CREATE INDEX IF NOT EXISTS ix_app_cand ON applications(candidate_id); CREATE INDEX IF NOT EXISTS ix_job_rec ON jobs(recruiter_id);`);
const q = (sql) => db.prepare(sql);
q('DELETE FROM sessions WHERE expires<?').run(Date.now()); q('DELETE FROM resets WHERE expires<?').run(Date.now());
const addCol = (t, c) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`); };
addCol('jobs', 'experience'); addCol('jobs', 'qualification'); addCol('jobs', 'website'); addCol('users', 'website');

// Sample listings from well-known companies (indicative, for demonstration). Disable with SEED_JOBS=0 in .env.
const SEED = [
  ['Infosys', 'https://www.infosys.com', 'Systems Engineer', 'Bengaluru, Pune, Hyderabad', '₹3.6 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/M.E./M.Tech/MCA/M.Sc in CS, IT or related, 60%+ throughout', 'Java, Python, SQL, Problem solving', 'Work with delivery teams to build, test and support enterprise software for global clients, with structured training in your first months.'],
  ['Infosys', 'https://www.infosys.com', 'Specialist Programmer', 'Bengaluru', '₹9 – 11 LPA', '0 – 2 years', 'B.E./B.Tech in CS, IT or ECE; strong coding fundamentals', 'Data Structures, Algorithms, Java, C++', 'For candidates with strong problem-solving skills. Design and build complex software components and solve hard engineering problems for clients.'],
  ['TCS', 'https://www.tcs.com', 'Assistant System Engineer', 'Mumbai, Chennai, Kolkata, Pune', '₹3.4 – 3.6 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/MCA/M.Sc, 60%+ in 10th, 12th and graduation', 'Programming basics, SQL, Communication', 'Join an IT services project team, learn on the job and contribute to application development and maintenance for enterprise customers.'],
  ['TCS', 'https://www.tcs.com', 'Digital Developer', 'Hyderabad, Pune, Chennai', '₹7 LPA', '0 – 2 years', 'B.E./B.Tech/M.Tech in CS, IT or ECE', 'Java, Spring Boot, React, Cloud basics', 'Build modern digital products using cloud and web technologies as part of a product-focused delivery team.'],
  ['Wipro', 'https://www.wipro.com', 'Project Engineer', 'Bengaluru, Hyderabad, Pune', '₹3.5 – 6.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech in CS, IT, ECE or EEE, 60%+ throughout', 'Programming, Databases, Testing, Communication', 'Support application development, testing and maintenance for Wipro clients while following a structured onboarding programme.'],
  ['Wipro', 'https://www.wipro.com', 'Cloud Engineer (Azure)', 'Chennai, Bengaluru', '₹8 – 14 LPA', '3 – 5 years', 'B.E./B.Tech in CS or IT; Azure certification preferred', 'Azure, Terraform, Kubernetes, CI/CD', 'Design and operate cloud infrastructure, automate deployments and improve reliability for enterprise workloads.'],
  ['Microsoft', 'https://www.microsoft.com', 'Software Engineer', 'Hyderabad, Bengaluru', '₹30 – 50 LPA', '0 – 3 years', "Bachelor's or Master's in Computer Science or equivalent practical experience", 'C#, TypeScript, Azure, Algorithms', 'Design, build and ship features for products used by millions. Work in a team that values code quality, testing and collaboration.'],
  ['Microsoft', 'https://www.microsoft.com', 'Program Manager', 'Hyderabad', '₹35 – 55 LPA', '4 – 7 years', "Bachelor's degree in Engineering, CS or a related field; MBA is a plus", 'Product thinking, Stakeholder management, Data analysis', 'Own the roadmap and delivery of a product area, working with engineering and design to define what gets built and why.'],
  ['Google', 'https://www.google.com', 'Software Engineer, Early Career', 'Bengaluru, Hyderabad', '₹35 – 55 LPA', '0 – 2 years', "Bachelor's degree in CS or related field, or equivalent experience", 'Data Structures, Algorithms, Python, C++', 'Develop software across the stack, from large-scale backend systems to user-facing features, in a collaborative engineering team.'],
  ['Amazon', 'https://www.amazon.in', 'Software Development Engineer I', 'Bengaluru, Chennai', '₹28 – 45 LPA', '0 – 2 years', "Bachelor's degree in CS, Engineering or related field", 'Java, Data Structures, System design basics, AWS', 'Design and build scalable services, own components end to end and raise the bar on operational excellence.'],
  ['Accenture', 'https://www.accenture.com', 'Associate Software Engineer', 'Bengaluru, Pune, Mumbai', '₹4.5 – 6.5 LPA', '0 – 1 years (freshers)', 'Any graduate degree with strong aptitude; B.E./B.Tech preferred', 'Programming basics, Cloud basics, Communication', 'Join a client project team to develop, test and deploy applications while building skills through Accenture learning programmes.'],
  ['Cognizant', 'https://www.cognizant.com', 'Programmer Analyst Trainee', 'Chennai, Pune, Kolkata', '₹4 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech/MCA/M.Sc in CS, IT or related, 60%+', 'Java, SQL, Web basics, Logical reasoning', 'Learn and contribute to application development and support for Cognizant clients after an initial training period.'],
  ['HCLTech', 'https://www.hcltech.com', 'Graduate Engineer Trainee', 'Noida, Chennai', '₹3.5 – 4.5 LPA', '0 – 1 years (freshers)', 'B.E./B.Tech in CS, IT, ECE or EEE', 'C/C++, Java, Networking basics', 'Start in a technology delivery team, rotate through training and take on real engineering tasks as you progress.'],
  ['Tech Mahindra', 'https://www.techmahindra.com', 'Software Engineer', 'Pune, Hyderabad', '₹3.5 – 5.5 LPA', '0 – 2 years', 'B.E./B.Tech/MCA in any relevant stream', 'Java, Python, Testing, Telecom basics', 'Build and support software for telecom and enterprise customers with mentoring from experienced engineers.'],
  ['Zoho', 'https://www.zoho.com', 'Member Technical Staff', 'Chennai', '₹6 – 10 LPA', '0 – 2 years', 'Any degree; skills and problem solving matter more than marks', 'Java, JavaScript, Problem solving, Databases', 'Work on Zoho products from design to release, writing production code and owning features.'],
  ['Flipkart', 'https://www.flipkart.com', 'Data Analyst', 'Bengaluru', '₹12 – 20 LPA', '2 – 4 years', "Bachelor's in Engineering, Statistics, Maths or a related field", 'SQL, Python, Tableau, A/B testing', 'Turn marketplace data into insights that guide product, supply and growth decisions for a large e-commerce platform.'],
];
if (E.SEED_JOBS !== '0') {
  SEED.forEach((s, i) => {
    let u = q("SELECT id FROM users WHERE provider='seed' AND company=?").get(s[0]);
    if (!u) u = { id: Number(q('INSERT INTO users(role,full_name,email,provider,company,website,created) VALUES(?,?,?,?,?,?,?)').run('recruiter', s[0] + ' Talent Acquisition', 'jobs@' + s[0].toLowerCase().replace(/[^a-z]/g, '') + '.seed', 'seed', s[0], s[1], Date.now()).lastInsertRowid) };
    if (!q('SELECT 1 FROM jobs WHERE recruiter_id=? AND title=?').get(u.id, s[2])) q('INSERT INTO jobs(recruiter_id,company,title,location,salary,type,skills,description,created,experience,qualification,website) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(u.id, s[0], s[2], s[3], s[4], 'Full-time', s[7], s[8], Date.now() - i * 1000, s[5], s[6], s[1]);
  });
}

// ---- helpers ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex'), rnd = () => crypto.randomBytes(32).toString('hex');
const hash = (p) => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(p, s, 64).toString('hex'); };
const verify = (p, h) => { if (!h) return false; const [s, k] = h.split(':'), d = crypto.scryptSync(p, Buffer.from(s, 'hex'), 64); return crypto.timingSafeEqual(d, Buffer.from(k, 'hex')); };
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...hdr }); res.end(JSON.stringify(obj)); };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const ck = (n, v, age) => `${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${SECURE ? '; Secure' : ''}`;
const readBody = (req, max = 3.5e6) => new Promise((ok, no) => { let n = 0; const b = []; req.on('data', (c) => { n += c.length; if (n > max) { no(new Error('Payload too large')); req.destroy(); } else b.push(c); }); req.on('end', () => { try { ok(b.length ? JSON.parse(Buffer.concat(b)) : {}); } catch { no(new Error('Invalid JSON')); } }); });
const hits = new Map(); const limited = (ip) => { const n = Date.now(), h = (hits.get(ip) || []).filter((t) => n - t < 6e5); h.push(n); hits.set(ip, h); return h.length > 15; };
const session = (res, uid, extra = []) => { const t = rnd(); q('INSERT INTO sessions VALUES(?,?,?)').run(sha(t), uid, Date.now() + 30 * 864e5); res.setHeader('Set-Cookie', [ck('lo_sid', t, 30 * 86400), ...extra]); };
const current = (req) => { const t = cookies(req).lo_sid; if (!t) return null; return q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(sha(t), Date.now()) || null; };
const isEmail = (e) => typeof e === 'string' && e.length < 255 && /^\S+@\S+\.\S+$/.test(e), isPass = (p) => typeof p === 'string' && p.length >= 8 && p.length < 200;
const cl = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const prof = (u) => ({ id: u.id, role: u.role, fullName: u.full_name, email: u.email, phone: u.phone || '', location: u.location || '', education: u.education || '', skills: u.skills || '', summary: u.summary || '', company: u.company || '', website: u.website || '', designation: u.designation || '', about: u.about || '', resumeName: u.resume_name || '', avatar: u.avatar || '', social: u.provider || '' });
const resumeErr = (r) => { if (!r || typeof r.name !== 'string' || typeof r.data !== 'string') return 'Please upload your resume.'; if (!/\.(pdf|doc|docx)$/i.test(r.name)) return 'Resume must be a PDF, DOC or DOCX file.'; if (!/^data:[\w.+\-\/]{1,100};base64,[A-Za-z0-9+\/=]+$/.test(r.data.length > 300 ? r.data.slice(0, 300) + 'AAAA' : r.data)) return 'Invalid resume file.'; if (r.data.length > 2.1e6) return 'Resume must be smaller than 1.5 MB.'; return ''; };
const siteUrl = (v) => { v = cl(v, 200); if (!v) return ''; if (!/^https?:\/\//i.test(v)) v = 'https://' + v; try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; } };
const meeting = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---- API ----
async function api(req, res, url) {
  const p = url.pathname, m = req.method, ip = (E.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  if (m !== 'GET') { // CSRF hardening: JSON only + same-origin
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
    const web = role === 'recruiter' ? siteUrl(b.website) : ''; if (web === null) return send(res, 400, { error: 'Enter a valid website, e.g. https://company.com' });
    if (q('SELECT 1 FROM users WHERE email=?').get(email)) return send(res, 409, { error: 'An account with this email already exists.' });
    const id = Number(q('INSERT INTO users(role,full_name,email,pass,phone,location,education,skills,summary,company,designation,about,resume_name,resume_data,created,website) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(role, name, email, hash(b.password), cl(b.phone, 30), cl(b.location, 80), cl(b.education, 150), cl(b.skills, 300), cl(b.summary, 2000), company, cl(b.designation, 80), cl(b.about, 2000), rn, rd, Date.now(), web || null).lastInsertRowid);
    session(res, id); return send(res, 201, { user: prof(q('SELECT * FROM users WHERE id=?').get(id)) });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const b = await readBody(req), u = q('SELECT * FROM users WHERE email=?').get(cl(b.email, 255).toLowerCase());
    if (!u || !verify(String(b.password || ''), u.pass)) return send(res, 401, { error: u && !u.pass ? (u.provider === 'seed' ? 'Wrong email or password.' : `This account uses ${u.provider} sign-in.`) : 'Wrong email or password.' });
    if (b.role && b.role !== u.role) return send(res, 403, { error: `This email is registered as a ${u.role}. Please use the ${u.role} portal.` });
    session(res, u.id); return send(res, 200, { user: prof(u) });
  }
  if (p === '/api/auth/logout' && m === 'POST') { const t = cookies(req).lo_sid; if (t) q('DELETE FROM sessions WHERE token=?').run(sha(t)); return send(res, 200, { ok: true }, { 'Set-Cookie': ck('lo_sid', '', 0) }); }
  if (p === '/api/auth/forgot' && m === 'POST') {
    const b = await readBody(req), u = q('SELECT * FROM users WHERE email=?').get(cl(b.email, 255).toLowerCase());
    if (u && u.pass) { const t = rnd(); q('INSERT INTO resets VALUES(?,?,?)').run(sha(t), u.id, Date.now() + 36e5); console.log(`\n[password reset] ${u.email}: ${BASE}/reset?token=${t}\n(Wire an email provider here to send this link.)\n`); }
    return send(res, 200, { message: 'If an account exists for that email, a reset link has been sent.' });
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    const b = await readBody(req), r = q('SELECT * FROM resets WHERE token=? AND expires>?').get(sha(String(b.token || '')), Date.now());
    if (!r || !isPass(b.password)) return send(res, 400, { error: 'Invalid or expired link, or password too short.' });
    q('UPDATE users SET pass=? WHERE id=?').run(hash(b.password), r.user_id); q('DELETE FROM resets WHERE user_id=?').run(r.user_id); q('DELETE FROM sessions WHERE user_id=?').run(r.user_id);
    return send(res, 200, { ok: true });
  }

  const me = current(req);
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: me ? prof(me) : null });
  if (!me) return send(res, 401, { error: 'Please log in.' });
  const need = (role) => { if (me.role === role) return true; send(res, 403, { error: `${role[0].toUpperCase() + role.slice(1)}s only.` }); return false; };

  if (p === '/api/me' && m === 'PUT') {
    const b = await readBody(req), name = cl(b.fullName, 80); if (name.length < 2) return send(res, 400, { error: 'Enter your full name.' });
    if (b.password && !isPass(b.password)) return send(res, 400, { error: 'New password must be at least 8 characters.' });
    let rn = me.resume_name, rd = me.resume_data;
    if (me.role === 'candidate' && b.resume) { const e = resumeErr(b.resume); if (e) return send(res, 400, { error: e }); rn = cl(b.resume.name, 120); rd = b.resume.data; }
    let company = me.company, website = me.website; if (me.role === 'recruiter') { company = cl(b.company, 100); if (company.length < 2) return send(res, 400, { error: 'Enter your company name.' }); website = siteUrl(b.website); if (website === null) return send(res, 400, { error: 'Enter a valid website, e.g. https://company.com' }); }
    q('UPDATE users SET full_name=?,phone=?,location=?,education=?,skills=?,summary=?,company=?,designation=?,about=?,resume_name=?,resume_data=?,website=? WHERE id=?')
      .run(name, cl(b.phone, 30), cl(b.location, 80), cl(b.education, 150), cl(b.skills, 300), cl(b.summary, 2000), company, cl(b.designation, 80), cl(b.about, 2000), rn, rd, website || null, me.id);
    if (me.role === 'recruiter') q('UPDATE jobs SET company=?, website=? WHERE recruiter_id=?').run(company, website || null, me.id);
    if (b.password) q('UPDATE users SET pass=? WHERE id=?').run(hash(b.password), me.id);
    return send(res, 200, { user: prof(q('SELECT * FROM users WHERE id=?').get(me.id)) });
  }

  // jobs
  const jobOut = (j) => ({ id: j.id, company: j.company, title: j.title, location: j.location, salary: j.salary || '', type: j.type || 'Full-time', skills: j.skills || '', description: j.description || '', experience: j.experience || '', qualification: j.qualification || '', website: j.website || '', sample: j.prov === 'seed', date: new Date(j.created).toISOString() });
  if (p === '/api/jobs' && m === 'GET') return send(res, 200, { jobs: q('SELECT j.*, u.provider prov FROM jobs j JOIN users u ON u.id=j.recruiter_id ORDER BY j.created DESC LIMIT 500').all().map(jobOut) });
  if (p === '/api/jobs/mine' && m === 'GET') { if (!need('recruiter')) return; return send(res, 200, { jobs: q('SELECT j.*, u.provider prov FROM jobs j JOIN users u ON u.id=j.recruiter_id WHERE j.recruiter_id=? ORDER BY j.created DESC').all(me.id).map(jobOut) }); }
  if (p === '/api/jobs' && m === 'POST') {
    if (!need('recruiter')) return; const b = await readBody(req), t = cl(b.title, 120), l = cl(b.location, 100);
    if (!t || !l) return send(res, 400, { error: 'Job title and location are required.' });
    q('INSERT INTO jobs(recruiter_id,company,title,location,salary,type,skills,description,created,experience,qualification,website) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(me.id, me.company || me.full_name, t, l, cl(b.salary, 60), TYPES.includes(b.type) ? b.type : 'Full-time', cl(b.skills, 300), cl(b.description, 3000), Date.now(), cl(b.experience, 80), cl(b.qualification, 200), me.website || null);
    return send(res, 201, { ok: true });
  }
  let x = p.match(/^\/api\/jobs\/(\d+)$/);
  if (x && m === 'DELETE') { if (!need('recruiter')) return; const r = q('DELETE FROM jobs WHERE id=? AND recruiter_id=?').run(+x[1], me.id); return r.changes ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Job not found.' }); }

  // applications
  if (p === '/api/applications' && m === 'GET') {
    if (!need('candidate')) return;
    return send(res, 200, { applications: q('SELECT a.*,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? ORDER BY a.created DESC').all(me.id).map((a) => ({ id: a.id, jobId: a.job_id, status: a.status, date: new Date(a.created).toISOString(), meeting: meeting(a.meeting), title: a.title, company: a.company })) });
  }
  if (p === '/api/applications' && m === 'POST') {
    if (!need('candidate')) return; const b = await readBody(req);
    if (!me.resume_data) return send(res, 400, { error: 'Upload your resume in My Profile before applying.' });
    if (!q('SELECT 1 FROM jobs WHERE id=?').get(+b.jobId || 0)) return send(res, 404, { error: 'This job no longer exists.' });
    try { q('INSERT INTO applications(job_id,candidate_id,status,created) VALUES(?,?,?,?)').run(+b.jobId, me.id, 'Applied', Date.now()); } catch { return send(res, 409, { error: 'You already applied to this job.' }); }
    return send(res, 201, { ok: true });
  }
  if (p === '/api/recruiter/applications' && m === 'GET') {
    if (!need('recruiter')) return;
    return send(res, 200, { applications: q('SELECT a.*,j.title,u.id cid,u.full_name,u.email,u.phone,u.education,u.location,u.skills,u.summary,(u.resume_data IS NOT NULL) hasr FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=a.candidate_id WHERE j.recruiter_id=? ORDER BY a.created DESC').all(me.id)
      .map((a) => ({ id: a.id, jobId: a.job_id, jobTitle: a.title, status: a.status, date: new Date(a.created).toISOString(), meeting: meeting(a.meeting), candidate: { id: a.cid, fullName: a.full_name, email: a.email, phone: a.phone || '', education: a.education || '', location: a.location || '', skills: a.skills || '', summary: a.summary || '', hasResume: !!a.hasr } })) });
  }
  x = p.match(/^\/api\/applications\/(\d+)(\/meeting)?$/);
  if (x && (m === 'PATCH' || m === 'PUT')) {
    if (!need('recruiter')) return;
    const a = q('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND j.recruiter_id=?').get(+x[1], me.id); if (!a) return send(res, 404, { error: 'Application not found.' });
    const b = await readBody(req);
    if (!x[2]) { if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status.' }); q('UPDATE applications SET status=? WHERE id=?').run(b.status, a.id); return send(res, 200, { ok: true }); }
    const mt = { date: cl(b.date, 10), time: cl(b.time, 5), mode: MODES.includes(b.mode) ? b.mode : 'Video call', link: cl(b.link, 300), notes: cl(b.notes, 500) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mt.date) || !/^\d{1,2}:\d{2}$/.test(mt.time)) return send(res, 400, { error: 'Pick a valid date and time.' });
    q('UPDATE applications SET meeting=?, status=? WHERE id=?').run(JSON.stringify(mt), 'Interview Scheduled', a.id); return send(res, 200, { ok: true });
  }
  x = p.match(/^\/api\/resume\/(\d+)$/);
  if (x && m === 'GET') { // own resume, or a candidate who applied to one of this recruiter's jobs
    const cid = +x[1], ok = me.id === cid || (me.role === 'recruiter' && q('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? AND j.recruiter_id=?').get(cid, me.id));
    if (!ok) return send(res, 403, { error: 'Not allowed.' });
    const u = q('SELECT resume_name,resume_data FROM users WHERE id=?').get(cid); return u && u.resume_data ? send(res, 200, { name: u.resume_name, data: u.resume_data }) : send(res, 404, { error: 'No resume uploaded.' });
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
    let u = q('SELECT * FROM users WHERE provider=? AND provider_id=?').get(pv, String(i.sub)) || q('SELECT * FROM users WHERE email=?').get(email), msg = '';
    if (!u) { const name = cl(i.name || email.split('@')[0], 80); const id = Number(q('INSERT INTO users(role,full_name,email,provider,provider_id,avatar,company,created) VALUES(?,?,?,?,?,?,?,?)').run(want, name, email, pv, String(i.sub), i.picture || null, want === 'recruiter' ? name : null, Date.now()).lastInsertRowid); u = q('SELECT * FROM users WHERE id=?').get(id); }
    else { if (!u.provider) q('UPDATE users SET provider=?, provider_id=?, avatar=COALESCE(avatar,?) WHERE id=?').run(pv, String(i.sub), i.picture || null, u.id); if (u.role !== want) msg = `This email is registered as a ${u.role}.`; }
    session(res, u.id, [ck('lo_st', '', 0), ck('lo_role', '', 0)]); home(u.role, msg);
  } catch (e) { console.error('[oauth]', e.message); home(want, 'Sign-in failed. Please try again.'); }
}

// ---- static files + server ----
const PUB = path.join(__dirname, 'public'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const RESET_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Reset password</title><body style="font-family:system-ui;background:#17171a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><form id=f style="width:min(360px,90vw);display:grid;gap:12px"><h2>Choose a new password</h2><input id=p type=password minlength=8 placeholder="New password (8+ chars)" style="padding:12px;border-radius:10px;border:1px solid #555;background:#232327;color:#fff"><button style="padding:12px;border-radius:10px;border:0;background:#8b5cf6;color:#fff;font-weight:700">Update password</button><p id=m></p></form><script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(location.search).get('token'),password:p.value})}),j=await r.json();m.textContent=r.ok?'Password updated. Redirecting...':j.error;if(r.ok)setTimeout(()=>location='/',1500)}</script>`;

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
  } catch (e) { console.error(e); if (!res.headersSent) send(res, e.message === 'Payload too large' ? 413 : 400, { error: e.message === 'Payload too large' || e.message === 'Invalid JSON' ? e.message : 'Server error' }); }
}).listen(PORT, () => { console.log('.env: ' + ENVSTAT); console.log(`LinkedOut running at ${BASE}  (Google: ${PV.google.id ? 'on' : 'off'}, LinkedIn: ${PV.linkedin.id ? 'on' : 'off'})`); });
