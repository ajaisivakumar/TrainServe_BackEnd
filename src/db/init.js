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

-- ── Products ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              TEXT         PRIMARY KEY,
  name            TEXT         NOT NULL,
  icon            TEXT         NOT NULL DEFAULT '📦',
  img             TEXT         NOT NULL,
  price           NUMERIC      NOT NULL,
  unit            TEXT         NOT NULL,
  in_stock        BOOLEAN      NOT NULL DEFAULT TRUE,
  case_price      NUMERIC,
  pieces_per_case INTEGER,
  deleted         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
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

const MIGRATIONS = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'train';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stall_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stall_location TEXT;
`;

async function initDb() {
  try {
    await pool.query(SQL);
    await pool.query(MIGRATIONS);
    console.log('✓ Database tables ready');

    // Seed default products catalog if empty
    const { rows } = await pool.query('SELECT COUNT(*) FROM products');
    if (parseInt(rows[0].count, 10) === 0) {
      console.log('🌱 Seeding default products catalog...');
      const defaultProducts = [
        { id:'wb1', name:'Water Bottle', icon:'💧', img:'assets/products/RAILNEER.jpg', price:20, unit:'1 L' },
        { id:'lays-blue',   name:'Lays Blue',   icon:'🍟', img:'assets/products/LAYS-BLUE.jpg',   price:20, unit:'Pack' },
        { id:'lays-red',    name:'Lays Red',    icon:'🍟', img:'assets/products/LAYS-RED.jpg',    price:20, unit:'Pack' },
        { id:'lays-yellow', name:'Lays Yellow', icon:'🍟', img:'assets/products/LAYS-YELLOW.jpg', price:20, unit:'Pack' },
        { id:'lays-green',  name:'Lays Green',  icon:'🍟', img:'assets/products/LAYS-GREEN.jpg',  price:20, unit:'Pack' },
        { id:'kure', name:'Kure Kure', icon:'🍿', img:'assets/products/KURE-KURE.jpg', price:20, unit:'Pack' },
        { id:'bikaji', name:'Bikaji', icon:'🍪', img:'assets/products/BIKAJI.jpg', price:30, unit:'Pack' },
        { id:'njuze', name:'Njuze Litchi', icon:'🥤', img:'assets/products/NJUZE-LITCHI.jpg', price:40, unit:'200 ml' },
        { id:'cavins-lassi', name:'Cavins Lassi', icon:'🥛', img:'assets/products/CAVINS-LASSI.jpg', price:30, unit:'200 ml' },
        { id:'cavins-buttermilk', name:'Cavins Buttermilk', icon:'🥛', img:'assets/products/CAVINS-BUTTERMILK.jpg', price:25, unit:'200 ml' },
        { id:'unibic', name:'Unibic', icon:'🍪', img:'assets/products/UNIBIC.jpg', price:30, unit:'Pack' },
        { id:'butterscotch', name:'Butterscotch Ice Cream', icon:'🍨', img:'assets/products/CAVINS-BUTTERSCOTCH.jpg', price:40, unit:'Cup' },
        { id:'chocolate', name:'Chocolate Ice Cream', icon:'🍨', img:'assets/products/CAVINS-CHOCOLATE.jpg', price:40, unit:'Cup' },
        { id:'strawberry', name:'Strawberry Ice Cream', icon:'🍨', img:'assets/products/CAVINS-STRAWBERRY.jpg', price:40, unit:'Cup' },
        { id:'vanila', name:'Vanila Ice Cream', icon:'🍨', img:'assets/products/CAVINS-VANILA.jpg', price:40, unit:'Cup' }
      ];
      for (const p of defaultProducts) {
        await pool.query(
          `INSERT INTO products (id, name, icon, img, price, unit, in_stock)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
          [p.id, p.name, p.icon, p.img, p.price, p.unit]
        );
      }
      console.log('✓ Default products catalog successfully seeded');
    }
  } catch (err) {
    console.error('✗ Database init failed:', err.message);
    process.exit(1);
  }
}

module.exports = initDb;
