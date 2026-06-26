// src/routes/orders.js
// All order-related endpoints

const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ── Fixed: pass client in so it runs inside the transaction (no race condition) ──
async function generateOrderId(client) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
  const { rows } = await client.query(
    `SELECT COUNT(*) AS cnt FROM orders WHERE id LIKE $1 FOR UPDATE`,
    [`ORD-${today}-%`]
  );
  const seq = String(parseInt(rows[0].cnt) + 1).padStart(4, '0');
  return `ORD-${today}-${seq}`;
}

// ── Helper: fetch full order rows with items ─────────────────────────
async function fetchOrders(whereClause = '', params = []) {
  const { rows } = await pool.query(
    `SELECT
       o.id,
       o.user_id           AS "userId",
       o.user_name         AS "userName",
       o.train_no          AS "trainNo",
       o.train_name        AS "trainName",
       o.current_location  AS "currentLocation",
       o.eta,
       o.order_type        AS "orderType",
       o.stall_name        AS "stallName",
       o.stall_location    AS "stallLocation",
       o.status,
       o.assigned_crew_id  AS "assignedCrewId",
       o.total,
       o.payment_uploaded  AS "paymentUploaded",
       o.created_at        AS "createdAt",
       o.accepted_at       AS "acceptedAt",
       o.completed_at      AS "completedAt",
       EXTRACT(EPOCH FROM (o.accepted_at - o.created_at))    AS "acceptanceDurationSeconds",
       EXTRACT(EPOCH FROM (o.completed_at - o.accepted_at))  AS "deliveryDurationSeconds"
     FROM orders o
     ${whereClause}
     ORDER BY o.created_at DESC`,
    params
  );

  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const { rows: items } = await pool.query(
    `SELECT order_id AS "orderId", product_id AS "productId", name, qty, price
     FROM order_items
     WHERE order_id = ANY($1)`,
    [ids]
  );

  return rows.map(o => ({
    ...o,
    items: items.filter(i => i.orderId === o.id),
  }));
}

// ── POST /orders ─────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const {
    orderType = 'train',
    userName, trainNo, trainName, currentLocation, eta,
    stallName, stallLocation,
    items
  } = req.body;

  // Input length guards
  if (userName && userName.length > 100)
    return res.status(400).json({ error: 'Name is too long (max 100 characters)' });
  if (trainName && trainName.length > 150)
    return res.status(400).json({ error: 'Train name is too long (max 150 characters)' });
  if (!items || !Array.isArray(items) || items.length > 50)
    return res.status(400).json({ error: 'Invalid items list' });

  if (orderType === 'train') {
    if (!userName || !trainNo || !trainName || !currentLocation || !eta || !items?.length) {
      return res.status(400).json({ error: 'All train order fields are required' });
    }
  } else if (orderType === 'stall') {
    if (!userName || !stallName || !items?.length) {
      return res.status(400).json({ error: 'Stall owner name, stall name, and items are required' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid orderType' });
  }

  const total  = items.reduce((s, i) => s + i.price * i.qty, 0);
  const userId = req.user.role === 'CREW' ? null : (req.user.id || null);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate ID inside transaction to prevent race condition
    const orderId = await generateOrderId(client);

    await client.query(
      `INSERT INTO orders
         (id, user_id, user_name, train_no, train_name, current_location, eta, total, order_type, stall_name, stall_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        orderId,
        userId,
        userName,
        orderType === 'train' ? trainNo : '',
        orderType === 'train' ? trainName : stallName,
        orderType === 'train' ? currentLocation : (stallLocation || stallName),
        orderType === 'train' ? eta : 'N/A',
        total,
        orderType,
        orderType === 'stall' ? stallName : null,
        orderType === 'stall' ? (stallLocation || null) : null,
      ]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.productId, item.name, item.qty, item.price]
      );
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (order_id, event, performed_by, note)
       VALUES ($1, 'PLACED', $2, 'Order placed')`,
      [orderId, req.user.name || req.user.email]
    );

    // Notify admins
    const { rows: admins } = await client.query(
      `SELECT id FROM users WHERE role = 'ADMIN'`
    );
    for (const admin of admins) {
      await client.query(
        `INSERT INTO notifications (user_id, message)
         VALUES ($1, $2)`,
        [admin.id, `New order ${orderId} placed by ${userName} — ₹${total}`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: orderId, total });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /orders]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    client.release();
  }
});

// ── GET /orders/my ───────────────────────────────────────────────────
router.get('/my', requireAuth, async (req, res) => {
  try {
    const orders = await fetchOrders('WHERE o.user_id = $1', [req.user.id]);
    res.json(orders);
  } catch (err) {
    console.error('[GET /orders/my]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/pending ──────────────────────────────────────────────
router.get('/pending', ...requireRole('CREW', 'ADMIN'), async (req, res) => {
  try {
    const orders = await fetchOrders(`WHERE o.status = 'PENDING'`);
    res.json(orders);
  } catch (err) {
    console.error('[GET /orders/pending]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/deliveries ───────────────────────────────────────────
router.get('/deliveries', ...requireRole('CREW'), async (req, res) => {
  try {
    const orders = await fetchOrders(
      `WHERE o.assigned_crew_id = $1 AND o.status != 'PENDING'`,
      [req.user.crewId]
    );
    res.json(orders);
  } catch (err) {
    console.error('[GET /orders/deliveries]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/all ──────────────────────────────────────────────────
router.get('/all', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const { date } = req.query;
    let orders;
    if (date) {
      orders = await fetchOrders("WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = $1", [date]);
    } else {
      orders = await fetchOrders();
    }
    res.json(orders);
  } catch (err) {
    console.error('[GET /orders/all]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/stats ────────────────────────────────────────────────
router.get('/stats', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const date = req.query.date || todayIST();
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                           AS "totalOrders",
        COUNT(*) FILTER (WHERE status = 'PENDING')        AS pending,
        COUNT(*) FILTER (WHERE status = 'ACCEPTED')       AS accepted,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')      AS completed,
        COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0) AS revenue
      FROM orders
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1
    `, [date]);
    const s = rows[0];
    res.json({
      totalOrders: parseInt(s.totalOrders),
      pending:     parseInt(s.pending),
      accepted:    parseInt(s.accepted),
      completed:   parseInt(s.completed),
      revenue:     parseInt(s.revenue),
      date,
    });
  } catch (err) {
    console.error('[GET /orders/stats]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── PATCH /orders/:id/accept ─────────────────────────────────────────
router.patch('/:id/accept', ...requireRole('CREW'), async (req, res) => {
  const { id } = req.params;
  const client  = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'ACCEPTED', assigned_crew_id = $1, accepted_at = NOW()
       WHERE id = $2 AND status = 'PENDING'
       RETURNING *`,
      [req.user.crewId, id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order is no longer available' });
    }

    await client.query(
      `INSERT INTO audit_logs (order_id, event, performed_by, note)
       VALUES ($1, 'ACCEPTED', $2, 'Order accepted by crew')`,
      [id, req.user.name]
    );

    const o = rows[0];
    if (o.user_id) {
      await client.query(
        `INSERT INTO notifications (user_id, message)
         VALUES ($1, $2)`,
        [o.user_id, `Your order ${id} has been accepted by crew and is being prepared.`]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Order accepted' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /orders/:id/accept]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    client.release();
  }
});

// ── PATCH /orders/:id/assign ─────────────────────────────────────────
router.patch('/:id/assign', ...requireRole('ADMIN'), async (req, res) => {
  const { id }     = req.params;
  const { crewId } = req.body;
  if (!crewId) return res.status(400).json({ error: 'crewId is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE orders
       SET assigned_crew_id = $1, status = 'ACCEPTED', accepted_at = COALESCE(accepted_at, NOW())
       WHERE id = $2
       RETURNING *`,
      [crewId, id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    await client.query(
      `INSERT INTO audit_logs (order_id, event, performed_by, note)
       VALUES ($1, 'ASSIGNED', $2, $3)`,
      [id, req.user.name, `Crew ${crewId} assigned by admin`]
    );

    await client.query(
      `INSERT INTO notifications (crew_id, message)
       VALUES ($1, $2)`,
      [crewId, `You have been assigned to order ${id}.`]
    );

    await client.query('COMMIT');
    res.json({ message: 'Crew assigned' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /orders/:id/assign]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    client.release();
  }
});

// ── PATCH /orders/:id/payment-screenshot ─────────────────────────────
router.patch('/:id/payment-screenshot', ...requireRole('CREW', 'ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { screenshotBase64, fileName, amountPaid = 0 } = req.body;
  if (!screenshotBase64) return res.status(400).json({ error: 'screenshotBase64 is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO payment_screenshots
         (order_id, screenshot_base64, file_name, amount_paid, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, screenshotBase64, fileName || 'payment.jpg', amountPaid, req.user.name]
    );

    await client.query(
      `UPDATE orders SET payment_uploaded = TRUE WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Screenshot saved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /orders/:id/payment-screenshot]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    client.release();
  }
});

// ── PATCH /orders/:id/complete ───────────────────────────────────────
router.patch('/:id/complete', ...requireRole('CREW', 'ADMIN'), async (req, res) => {
  const { id } = req.params;
  const client  = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'COMPLETED', completed_at = NOW()
       WHERE id = $1 AND (assigned_crew_id = $2 OR $3 = 'ADMIN')
       RETURNING *`,
      [id, req.user.crewId || null, req.user.role]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or not yours' });
    }

    await client.query(
      `INSERT INTO audit_logs (order_id, event, performed_by, note)
       VALUES ($1, 'COMPLETED', $2, 'Order delivered and marked complete')`,
      [id, req.user.name]
    );

    const o = rows[0];
    if (o.user_id) {
      await client.query(
        `INSERT INTO notifications (user_id, message)
         VALUES ($1, $2)`,
        [o.user_id, `Your order ${id} has been delivered! Thank you for ordering with KB ENTERPRISES.`]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Order completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /orders/:id/complete]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    client.release();
  }
});

// ── GET /orders/admin/logs ───────────────────────────────────────────
router.get('/admin/logs', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, order_id AS "orderId", event,
              performed_by AS "performedBy", note,
              event_time AS "eventTime"
       FROM audit_logs
       ORDER BY event_time DESC
       LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /orders/admin/logs]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/admin/delivery-logs ─────────────────────────────────
router.get('/admin/delivery-logs', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.id                                                          AS "orderId",
         o.train_no                                                    AS "trainNo",
         o.train_name                                                  AS "trainName",
         o.eta                                                         AS "etaGiven",
         o.order_type                                                  AS "orderType",
         o.stall_name                                                  AS "stallName",
         o.created_at                                                  AS "placedAt",
         o.accepted_at                                                 AS "acceptedAt",
         o.completed_at                                                AS "deliveredAt",
         EXTRACT(EPOCH FROM (o.accepted_at - o.created_at))           AS "acceptanceDurationSeconds",
         EXTRACT(EPOCH FROM (o.completed_at - o.accepted_at))         AS "deliveryDurationSeconds"
       FROM orders o
       ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /orders/admin/delivery-logs]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /orders/admin/payments ───────────────────────────────────────
router.get('/admin/payments', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.order_id           AS "orderId",
         p.screenshot_base64  AS "screenshotBase64",
         p.file_name          AS "fileName",
         p.amount_paid        AS "amountPaid",
         p.uploaded_by        AS "uploadedBy",
         p.uploaded_at        AS "uploadedAt"
       FROM payment_screenshots p
       ORDER BY p.uploaded_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /orders/admin/payments]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
