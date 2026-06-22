// src/routes/reports.js
const router   = require('express').Router();
const pool     = require('../db/pool');
const ExcelJS  = require('exceljs');
const { requireRole } = require('../middleware/auth');

router.get('/daily', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const dateStart = `${date} 00:00:00+05:30`;
    const dateEnd   = `${date} 23:59:59+05:30`;

    // ── Pull all data in parallel ────────────────────────────────────
    const [
      ordersRes,
      itemsRes,
      auditRes,
      paymentsRes,
      signupsRes,
      notifsRes,
    ] = await Promise.all([

      // Full orders with crew name
      pool.query(`
        SELECT
          o.id,
          o.created_at,
          o.order_type,
          o.user_name,
          o.train_no,
          o.train_name,
          o.stall_name,
          o.stall_location,
          o.current_location,
          o.eta,
          o.status,
          o.total,
          o.assigned_crew_id,
          o.payment_uploaded,
          o.accepted_at,
          o.completed_at,
          EXTRACT(EPOCH FROM (o.accepted_at - o.created_at))   AS accept_secs,
          EXTRACT(EPOCH FROM (o.completed_at - o.accepted_at)) AS deliver_secs,
          c.name AS crew_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN crew c ON c.crew_id = o.assigned_crew_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at
      `, [dateStart, dateEnd]),

      // All order items for those orders (we join in JS)
      pool.query(`
        SELECT oi.order_id, oi.name, oi.qty, oi.price, oi.product_id
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at BETWEEN $1 AND $2
      `, [dateStart, dateEnd]),

      // Audit log
      pool.query(`
        SELECT event_time, order_id, event, performed_by, note
        FROM audit_logs
        WHERE event_time BETWEEN $1 AND $2
        ORDER BY event_time
      `, [dateStart, dateEnd]),

      // Payment screenshots
      pool.query(`
        SELECT
          p.order_id,
          p.amount_paid,
          p.uploaded_by,
          p.uploaded_at,
          p.file_name,
          p.screenshot_base64
        FROM payment_screenshots p
        INNER JOIN orders o ON o.id = p.order_id
        WHERE p.uploaded_at BETWEEN $1 AND $2
        ORDER BY p.uploaded_at
      `, [dateStart, dateEnd]),

      // New signups
      pool.query(`
        SELECT first_name, last_name, email, role, created_at
        FROM users
        WHERE created_at BETWEEN $1 AND $2
        ORDER BY created_at
      `, [dateStart, dateEnd]),

      // Notifications sent
      pool.query(`
        SELECT n.message, n.time, n.read,
               u.email AS user_email,
               n.crew_id
        FROM notifications n
        LEFT JOIN users u ON u.id = n.user_id
        WHERE n.time BETWEEN $1 AND $2
        ORDER BY n.time
      `, [dateStart, dateEnd]),
    ]);

    // Build a lookup: orderId → items array
    const itemsByOrder = {};
    for (const item of itemsRes.rows) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }

    // Build a lookup: orderId → payment row
    const paymentByOrder = {};
    for (const p of paymentsRes.rows) {
      paymentByOrder[p.order_id] = p;
    }

    // Build a lookup: orderId → audit events (comma joined)
    const auditByOrder = {};
    for (const a of auditRes.rows) {
      if (!auditByOrder[a.order_id]) auditByOrder[a.order_id] = [];
      auditByOrder[a.order_id].push(`${a.event} by ${a.performed_by}`);
    }

    // ── Workbook setup ───────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TrainServe';
    wb.created = new Date();

    const ws = wb.addWorksheet(`Report ${date}`, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // ── 25 columns ───────────────────────────────────────────────────
    ws.columns = [
      { header: 'Row Type',              key: 'rowType',          width: 18 },
      { header: 'Timestamp',             key: 'timestamp',        width: 22 },
      { header: 'Order ID',              key: 'orderId',          width: 20 },
      { header: 'Order Type',            key: 'orderType',        width: 12 },
      { header: 'Customer / Person',     key: 'customerName',     width: 22 },
      { header: 'Customer Email',        key: 'customerEmail',    width: 28 },
      { header: 'Train No',              key: 'trainNo',          width: 12 },
      { header: 'Train Name',            key: 'trainName',        width: 22 },
      { header: 'Stall Name',            key: 'stallName',        width: 22 },
      { header: 'Stall Location',        key: 'stallLocation',    width: 22 },
      { header: 'Station / Location',    key: 'location',         width: 22 },
      { header: 'ETA',                   key: 'eta',              width: 12 },
      { header: 'Items Ordered',         key: 'itemsOrdered',     width: 40 },
      { header: 'Item Quantities',       key: 'itemQtys',         width: 30 },
      { header: 'Item Subtotals (₹)',    key: 'itemSubtotals',    width: 30 },
      { header: 'Order Total (₹)',       key: 'orderTotal',       width: 16 },
      { header: 'Order Status',          key: 'orderStatus',      width: 14 },
      { header: 'Assigned Crew',         key: 'assignedCrew',     width: 18 },
      { header: 'All Events / Actions',  key: 'events',           width: 40 },
      { header: 'Payment Uploaded',      key: 'paymentUploaded',  width: 18 },
      { header: 'Amount Paid (₹)',       key: 'amountPaid',       width: 16 },
      { header: 'Payment File',          key: 'paymentFile',      width: 22 },
      { header: 'Accepted At',           key: 'acceptedAt',       width: 22 },
      { header: 'Completed At',          key: 'completedAt',      width: 22 },
      { header: 'Accept Time (mins)',    key: 'acceptMins',       width: 18 },
      { header: 'Delivery Time (mins)',  key: 'deliveryMins',     width: 20 },
      { header: 'Notes / Extra',         key: 'notes',            width: 35 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 30;

    // ── Helper: row background by type ──────────────────────────────
    const ROW_COLORS = {
      ORDER:    'FFFFFFFF',
      SIGNUP:   'FFE0F2FE',
      AUDIT:    'FFFFF3CD',
      PAYMENT:  'FFD4EDDA',
      NOTIF:    'FFF3E8FF',
    };

    function styleRow(row, type) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_COLORS[type] || 'FFFFFFFF' } };
      row.alignment = { vertical: 'middle', wrapText: true };
      row.height = 20;
    }

    // ── 1. ORDER rows ────────────────────────────────────────────────
    for (const o of ordersRes.rows) {
      const items    = itemsByOrder[o.id] || [];
      const payment  = paymentByOrder[o.id];
      const auditStr = (auditByOrder[o.id] || []).join(' | ');

      const itemNames    = items.map(i => i.name).join(', ');
      const itemQtys     = items.map(i => `${i.name}: ×${i.qty}`).join(', ');
      const itemSubtots  = items.map(i => `${i.name}: ₹${i.qty * i.price}`).join(', ');

      const row = ws.addRow({
        rowType:         'ORDER',
        timestamp:       o.created_at ? new Date(o.created_at).toLocaleString('en-IN') : '',
        orderId:         o.id,
        orderType:       o.order_type?.toUpperCase() || 'TRAIN',
        customerName:    o.user_name,
        customerEmail:   o.user_email || '',
        trainNo:         o.order_type === 'train' ? o.train_no : '',
        trainName:       o.order_type === 'train' ? o.train_name : '',
        stallName:       o.stall_name || '',
        stallLocation:   o.stall_location || '',
        location:        o.current_location || '',
        eta:             o.eta || '',
        itemsOrdered:    itemNames,
        itemQtys:        itemQtys,
        itemSubtotals:   itemSubtots,
        orderTotal:      o.total,
        orderStatus:     o.status,
        assignedCrew:    o.crew_name || 'Unassigned',
        events:          auditStr,
        paymentUploaded: o.payment_uploaded ? 'Yes' : 'No',
        amountPaid:      payment ? payment.amount_paid : '',
        paymentFile:     payment ? payment.file_name : '',
        acceptedAt:      o.accepted_at ? new Date(o.accepted_at).toLocaleString('en-IN') : '',
        completedAt:     o.completed_at ? new Date(o.completed_at).toLocaleString('en-IN') : '',
        acceptMins:      o.accept_secs != null ? Math.round(o.accept_secs / 60) : '',
        deliveryMins:    o.deliver_secs != null ? Math.round(o.deliver_secs / 60) : '',
        notes:           payment ? `Screenshot: ${payment.file_name || 'uploaded'}` : '',
      });
      styleRow(row, 'ORDER');

      // Embed payment screenshot image if present
      if (payment?.screenshot_base64) {
        try {
          const b64 = payment.screenshot_base64.startsWith('data:')
            ? payment.screenshot_base64.split(',')[1]
            : payment.screenshot_base64;
          const imgId = wb.addImage({ base64: b64, extension: 'jpeg' });
          // Place a small thumbnail beside the row — col 22 (paymentFile), row index
          const rowIdx = row.number;
          ws.addImage(imgId, {
            tl: { col: 21.1, row: rowIdx - 0.9 },
            br: { col: 22.9, row: rowIdx + 0.1 },
            editAs: 'oneCell',
          });
          row.height = 50;
        } catch (_) {
          // If image embedding fails, just leave the filename text
        }
      }
    }

    // ── 2. USER SIGNUP rows ──────────────────────────────────────────
    for (const u of signupsRes.rows) {
      const row = ws.addRow({
        rowType:       'SIGNUP',
        timestamp:     u.created_at ? new Date(u.created_at).toLocaleString('en-IN') : '',
        customerName:  `${u.first_name} ${u.last_name}`.trim(),
        customerEmail: u.email,
        orderType:     u.role,
        notes:         `New ${u.role} account created`,
      });
      styleRow(row, 'SIGNUP');
    }

    // ── 3. AUDIT EVENT rows (non-order events / standalone logs) ─────
    // We already merged order-level audit into order rows above.
    // Here we add them as standalone rows too so nothing is missed.
    for (const a of auditRes.rows) {
      const row = ws.addRow({
        rowType:   'AUDIT',
        timestamp: a.event_time ? new Date(a.event_time).toLocaleString('en-IN') : '',
        orderId:   a.order_id,
        events:    a.event,
        assignedCrew: a.performed_by,
        notes:     a.note || '',
      });
      styleRow(row, 'AUDIT');
    }

    // ── 4. PAYMENT rows (standalone payment records) ─────────────────
    for (const p of paymentsRes.rows) {
      const row = ws.addRow({
        rowType:         'PAYMENT',
        timestamp:       p.uploaded_at ? new Date(p.uploaded_at).toLocaleString('en-IN') : '',
        orderId:         p.order_id,
        assignedCrew:    p.uploaded_by,
        paymentUploaded: 'Yes',
        amountPaid:      p.amount_paid,
        paymentFile:     p.file_name || '',
        notes:           'Payment screenshot uploaded',
      });
      styleRow(row, 'PAYMENT');
    }

    // ── 5. NOTIFICATION rows ─────────────────────────────────────────
    for (const n of notifsRes.rows) {
      const row = ws.addRow({
        rowType:       'NOTIFICATION',
        timestamp:     n.time ? new Date(n.time).toLocaleString('en-IN') : '',
        customerEmail: n.user_email || '',
        assignedCrew:  n.crew_id || '',
        notes:         n.message,
        events:        n.read ? 'Read' : 'Unread',
      });
      styleRow(row, 'NOTIF');
    }

    // ── Add a colour legend at the bottom ────────────────────────────
    ws.addRow({});
    const legendHeader = ws.addRow({ rowType: 'LEGEND', notes: 'Row colour guide:' });
    legendHeader.font = { bold: true };
    const legends = [
      { rowType: 'ORDER (white)',        notes: 'Each order placed, with items, crew, payment info' },
      { rowType: 'SIGNUP (light blue)',  notes: 'New user account created that day' },
      { rowType: 'AUDIT (yellow)',       notes: 'Every action taken on an order (placed/accepted/completed)' },
      { rowType: 'PAYMENT (green)',      notes: 'Payment screenshot uploaded by crew' },
      { rowType: 'NOTIFICATION (purple)',notes: 'System notifications sent to users/crew' },
    ];
    for (const l of legends) {
      ws.addRow(l);
    }

    // ── Autofilter on header ─────────────────────────────────────────
    ws.autoFilter = { from: 'A1', to: 'AA1' };

    // ── Stream response ──────────────────────────────────────────────
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TrainServe-${date}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
