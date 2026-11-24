LinkedOut is a web-based job recruitment management platform that brings job seekers and recruiters together in one place. Candidates create a profile, upload a resume, browse and filter openings, apply once per job, and follow the status of each application. Recruiters post jobs, review applicants for their own listings, open resumes, move applicants through five stages, and schedule interviews. An admin role manages users and jobs. The system runs as a Node.js server backed by Neon Postgres through Drizzle ORM, so user records, sessions, job listings, and applications persist across serverless instances. Users can sign in with email and password or through Google and LinkedIn using OpenID Connect, and password reset links are sent by email. Passwords are hashed with scrypt, session tokens are stored only as hashes, and every protected route checks the user's role. The project followed a modular lifecycle of eight phases over thirteen weeks, from requirement analysis to deployment and handover. A scripted run of more than thirty checks, later turned into automated tests, confirmed the main flows. The final system is deployed, runs locally with one command, and meets all eleven functional requirements.

How to access the website?
1) Open server.js

2) There will be the local host link : http://localhost:3000/

3) Open the link and the website will work
