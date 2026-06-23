// src/routes/users.js
// GET  /api/users/crew       — list all crew (authenticated)
// GET  /api/users/all        — list all users (admin only)
// POST /api/users/logout     — mark crew offline, clear session

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── GET /users/crew ──────────────────────────────────────────────────
// Used by admin pages to list crew with online status
router.get('/crew', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT crew_id AS "crewId",
              name,
              online,
              UPPER(LEFT(name, 1)) AS initials
       FROM crew
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ── POST /users/crew ─────────────────────────────────────────────────
// Admin only: add a new crew member. Auto-generates the next CREW00N id.
router.post('/crew', ...requireRole('ADMIN'), async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'name and pin are required' });
  if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

  try {
    const { rows: existing } = await pool.query(
      `SELECT crew_id FROM crew ORDER BY crew_id DESC LIMIT 1`
    );
    let nextNum = 1;
    if (existing.length) {
      const m = existing[0].crew_id.match(/(\d+)$/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    const crewId = 'CREW' + String(nextNum).padStart(3, '0');

    const pinHash = await bcrypt.hash(String(pin), 10);
    await pool.query(
      `INSERT INTO crew (crew_id, name, pin_hash, online)
       VALUES ($1, $2, $3, FALSE)`,
      [crewId, name, pinHash]
    );

    res.status(201).json({ crewId, name });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Crew ID already exists, try again' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /users/crew/:crewId ────────────────────────────────────────
// Admin only: update a crew member's name and/or PIN.
router.patch('/crew/:crewId', ...requireRole('ADMIN'), async (req, res) => {
  const { crewId } = req.params;
  const { name, pin } = req.body;

  if (!name && !pin) return res.status(400).json({ error: 'Provide a name or pin to update' });
  if (pin && !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

  try {
    const { rows: found } = await pool.query('SELECT crew_id FROM crew WHERE crew_id = $1', [crewId]);
    if (!found.length) return res.status(404).json({ error: 'Crew member not found' });

    if (name && pin) {
      const pinHash = await bcrypt.hash(String(pin), 10);
      await pool.query('UPDATE crew SET name = $1, pin_hash = $2 WHERE crew_id = $3', [name, pinHash, crewId]);
    } else if (name) {
      await pool.query('UPDATE crew SET name = $1 WHERE crew_id = $2', [name, crewId]);
    } else if (pin) {
      const pinHash = await bcrypt.hash(String(pin), 10);
      await pool.query('UPDATE crew SET pin_hash = $1 WHERE crew_id = $2', [pinHash, crewId]);
    }

    res.json({ message: 'Crew member updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /users/crew/:crewId ───────────────────────────────────────
// Admin only: remove a crew member.
// Blocked if they still have non-completed orders assigned, to avoid
// orphaning an active delivery.
router.delete('/crew/:crewId', ...requireRole('ADMIN'), async (req, res) => {
  const { crewId } = req.params;
  try {
    const { rows: active } = await pool.query(
      `SELECT id FROM orders WHERE assigned_crew_id = $1 AND status != 'COMPLETED'`,
      [crewId]
    );
    if (active.length) {
      return res.status(409).json({
        error: `Cannot delete — this crew member has ${active.length} active order(s) still in progress.`
      });
    }

    const { rowCount } = await pool.query('DELETE FROM crew WHERE crew_id = $1', [crewId]);
    if (!rowCount) return res.status(404).json({ error: 'Crew member not found' });

    res.json({ message: 'Crew member deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /users/all ───────────────────────────────────────────────────
// Admin only: lists all registered users
router.get('/all', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,
              CONCAT(first_name, ' ', last_name) AS name,
              email,
              role,
              created_at AS "createdAt"
       FROM users
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/logout ───────────────────────────────────────────────
// Marks crew as offline; for regular users it's just a client-side clear
router.post('/logout', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'CREW') {
      await pool.query(
        'UPDATE crew SET online = FALSE WHERE crew_id = $1',
        [req.user.crewId]
      );
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
