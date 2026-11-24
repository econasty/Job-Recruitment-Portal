'use strict';

const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('./db-schema');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for persistent application storage.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = drizzle(pool, { schema });

module.exports = { db, pool, ...schema };
