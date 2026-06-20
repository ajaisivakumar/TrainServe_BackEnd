// src/db/init.js
// Creates all tables if they don't already exist.
// Runs automatically when the server starts.

const pool = require('./pool');

const SQL = `
-- ── Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  TEXT        NOT NULL,
  last_name   TEXT        NOT NULL DEFAULT '',
  email       TEXT        UNIQUE NOT NULL,
  password    TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'USER',  -- USER | PANTRY | ADMIN
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Crew ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crew (
  crew_id     TEXT        PRIMARY KEY,   -- e.g. CREW001
  name        TEXT        NOT NULL,
  pin_hash    TEXT        NOT NULL,
  online      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT        PRIMARY KEY,   -- e.g. ORD-20240616-0001
  user_id           UUID        REFERENCES users(id),
  user_name         TEXT        NOT NULL,
  train_no          TEXT        NOT NULL,
  train_name        TEXT        NOT NULL,
  current_location  TEXT        NOT NULL,
  eta               TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | ACCEPTED | COMPLETED | CANCELLED
  assigned_crew_id  TEXT        REFERENCES crew(crew_id),
  total             INTEGER     NOT NULL DEFAULT 0,
  payment_uploaded  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

-- ── Order Items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL      PRIMARY KEY,
  order_id    TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  qty         INTEGER     NOT NULL,
  price       INTEGER     NOT NULL  -- price per unit in rupees
);

-- ── Notifications ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL      PRIMARY KEY,
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  crew_id     TEXT        REFERENCES crew(crew_id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  read        BOOLEAN     NOT NULL DEFAULT FALSE,
  time        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit Logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            SERIAL      PRIMARY KEY,
  order_id      TEXT        NOT NULL,
  event         TEXT        NOT NULL,   -- PLACED | ASSIGNED | ACCEPTED | COMPLETED | CANCELLED
  performed_by  TEXT,
  note          TEXT,
  event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payment Screenshots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_screenshots (
  id                SERIAL      PRIMARY KEY,
  order_id          TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  screenshot_base64 TEXT        NOT NULL,
  file_name         TEXT,
  amount_paid       INTEGER     NOT NULL DEFAULT 0,
  uploaded_by       TEXT        NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function initDb() {
  try {
    await pool.query(SQL);
    console.log('✓ Database tables ready');
  } catch (err) {
    console.error('✗ Database init failed:', err.message);
    process.exit(1);
  }
}

module.exports = initDb;
