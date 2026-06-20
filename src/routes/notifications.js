// src/routes/notifications.js
// GET   /api/notifications             — get current user's / crew's notifications
// PATCH /api/notifications/mark-read   — mark all as read

const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// ── GET /notifications ───────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'CREW') {
      ({ rows } = await pool.query(
        `SELECT id, message, read, time
         FROM notifications
         WHERE crew_id = $1
         ORDER BY time DESC
         LIMIT 100`,
        [req.user.crewId]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, message, read, time
         FROM notifications
         WHERE user_id = $1
         ORDER BY time DESC
         LIMIT 100`,
        [req.user.id]
      ));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /notifications/mark-read ──────────────────────────────────
router.patch('/mark-read', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'CREW') {
      await pool.query(
        `UPDATE notifications SET read = TRUE WHERE crew_id = $1`,
        [req.user.crewId]
      );
    } else {
      await pool.query(
        `UPDATE notifications SET read = TRUE WHERE user_id = $1`,
        [req.user.id]
      );
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
