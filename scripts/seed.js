// scripts/seed.js
// Run ONCE to create the admin user and initial crew members.
// Usage:  node scripts/seed.js
//
// ⚠️  Edit the values below before running!

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('../src/db/pool');

// ─────────────────────────────────────────────────────────────────────
//  EDIT THESE VALUES before running
// ─────────────────────────────────────────────────────────────────────

const ADMIN = {
  firstName: 'Admin',
  lastName:  'TrainServe',
  email:     'haja@gmail.com',   // ← change to your admin email
  password:  'haja@018',              // ← change to a strong password
};

const CREW_MEMBERS = [
  { crewId: 'CREW001', name: 'GURU',    pin: '1111' },  // ← change PINs
  { crewId: 'CREW002', name: 'GOVINDAN',  pin: '2222' },
  { crewId: 'CREW003', name: 'SURIYA RAJAN',   pin: '3333' },
  { crewId: 'CREW004', name: 'AJAI',  pin: '4444' },
];

// ─────────────────────────────────────────────────────────────────────

async function seed() {
  try {
    console.log('🌱 Seeding database…');

    // Admin user
    const passHash = await bcrypt.hash(ADMIN.password, 10);
    await pool.query(
      `INSERT INTO users (first_name, last_name, email, password, role)
       VALUES ($1, $2, $3, $4, 'ADMIN')
       ON CONFLICT (email) DO NOTHING`,
      [ADMIN.firstName, ADMIN.lastName, ADMIN.email, passHash]
    );
    console.log(`  ✓ Admin: ${ADMIN.email} / ${ADMIN.password}`);

    // Crew members
    for (const c of CREW_MEMBERS) {
      const pinHash = await bcrypt.hash(c.pin, 10);
      await pool.query(
        `INSERT INTO crew (crew_id, name, pin_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (crew_id) DO NOTHING`,
        [c.crewId, c.name, pinHash]
      );
      console.log(`  ✓ Crew: ${c.crewId} — ${c.name} / PIN: ${c.pin}`);
    }

    console.log('\n✅ Seeding complete! You can now sign in with the credentials above.\n');
  } catch (err) {
    console.error('Seed error:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
