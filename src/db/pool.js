// src/db/pool.js
// PostgreSQL connection pool using pg
require('dotenv').config();
const { Pool } = require('pg');
console.log('DB_PASSWORD type:', typeof process.env.DB_PASSWORD, '|' + process.env.DB_PASSWORD + '|');
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

module.exports = pool;
