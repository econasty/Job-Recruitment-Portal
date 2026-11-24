'use strict';

const { pgTable, serial, integer, text, doublePrecision } = require('drizzle-orm/pg-core');

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  role: text('role').notNull(),
  full_name: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  pass: text('pass'),
  provider: text('provider'),
  provider_id: text('provider_id'),
  avatar: text('avatar'),
  phone: text('phone'),
  location: text('location'),
  education: text('education'),
  skills: text('skills'),
  summary: text('summary'),
  company: text('company'),
  designation: text('designation'),
  about: text('about'),
  resume_name: text('resume_name'),
  resume_data: text('resume_data'),
  created: doublePrecision('created').notNull(),
  website: text('website'),
});

const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  recruiter_id: integer('recruiter_id').notNull(),
  company: text('company').notNull(),
  title: text('title').notNull(),
  location: text('location').notNull(),
  salary: text('salary'),
  type: text('type'),
  skills: text('skills'),
  description: text('description'),
  created: doublePrecision('created').notNull(),
  experience: text('experience'),
  qualification: text('qualification'),
  website: text('website'),
});

const applications = pgTable('applications', {
  id: serial('id').primaryKey(),
  job_id: integer('job_id').notNull(),
  candidate_id: integer('candidate_id').notNull(),
  status: text('status').notNull().default('Applied'),
  meeting: text('meeting'),
  created: doublePrecision('created').notNull(),
});

const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  user_id: integer('user_id').notNull(),
  expires: doublePrecision('expires').notNull(),
});

const resets = pgTable('resets', {
  token: text('token').primaryKey(),
  user_id: integer('user_id').notNull(),
  expires: doublePrecision('expires').notNull(),
});

module.exports = { users, jobs, applications, sessions, resets };
