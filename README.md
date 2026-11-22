# LinkedOut (your frontend + a real backend)

Your pages, styling and flows are unchanged. The browser-storage demo has been replaced by a server with a database.
**No npm install needed**: the server uses only Node built-ins.

## Folder layout
```
linkedout-v2/
  server.js
  package.json
  .env            <- you create this (copy .env.example)
  public/
    index.html    <- COPY YOUR OWN index.html HERE
    logo.png      <- COPY YOUR OWN logo.png HERE
    candidate.html  candidate.js
    recruiter.html  recruiter.js
    dashboard.html  app.js  style.css
```
`index.html` and `logo.png` were not part of the files you sent, so copy them into `public/` yourself.

## Run it
1. Install Node.js 22.13 or newer (`node -v`).
2. Copy `.env.example` to `.env`.
3. In this folder run `node server.js`.
4. Open http://localhost:3000 (not the HTML files directly).

## What is stored in the database (linkedout.db)
- **users**: candidates and recruiters, profile fields, resume file, hashed password
- **jobs**: posted by recruiters, visible to all candidates
- **applications**: candidate + job, status, scheduled meeting
- **sessions / resets**: login sessions (hashed tokens) and password-reset tokens

## Rules the server enforces
- Passwords hashed with scrypt; sessions in HttpOnly cookies.
- Candidates must have a resume (PDF/DOC/DOCX, up to 1.5 MB) to sign up or apply.
- Only recruiters can post jobs, and only on their own jobs can they change a status, schedule a meeting or delete.
- A recruiter can open a candidate's resume only if that candidate applied to one of their jobs.
- One application per candidate per job. Deleting a job deletes its applications.
- Login attempts are rate-limited; writes must be same-origin JSON.

## Google and LinkedIn login
Add keys to `.env` (see `.env.example` for the console links and redirect URIs):
- Google redirect URI: `<BASE_URL>/auth/google/callback`
- LinkedIn redirect URL: `<BASE_URL>/auth/linkedin/callback` (enable "Sign In with LinkedIn using OpenID Connect")

Both buttons appear on the candidate and recruiter pages. New social accounts get the role of the portal they used. A social candidate has no resume yet, so they are asked to upload one in My Profile before applying.

## Going public
Set `BASE_URL=https://yourdomain`, `TRUST_PROXY=1` (behind Caddy/nginx/a platform proxy), add your domain's redirect URIs in the Google/LinkedIn consoles, publish the Google consent screen, and back up `linkedout.db` regularly.

## Known limits
- Password reset links print in the server console until you connect an email service.
- `dashboard.html` is still the static sample page from your original files.
- Resumes are stored inside the database, which is fine for a small site; move them to file storage if you grow large.
