// src/routes/users.js
// GET  /api/users/crew       — list all crew (authenticated)
// GET  /api/users/all        — list all users (admin only)
// POST /api/users/logout     — mark crew offline, clear session

const router = require('express').Router();
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
