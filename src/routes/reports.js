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

    const [
      ordersRes,
      itemsRes,
      auditRes,
      paymentsRes,
      signupsRes,
      notifsRes,
    ] = await Promise.all([
      pool.query(`
        SELECT
          o.id, o.created_at, o.order_type, o.user_name,
          o.train_no, o.train_name, o.stall_name, o.stall_location,
          o.current_location, o.eta, o.status, o.total,
          o.assigned_crew_id, o.payment_uploaded, o.accepted_at, o.completed_at,
          EXTRACT(EPOCH FROM (o.accepted_at - o.created_at))   AS accept_secs,
          EXTRACT(EPOCH FROM (o.completed_at - o.accepted_at)) AS deliver_secs,
          c.name AS crew_name, u.email AS user_email
        FROM orders o
        LEFT JOIN crew c ON c.crew_id = o.assigned_crew_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at
      `, [dateStart, dateEnd]),

      pool.query(`
        SELECT oi.order_id, oi.name, oi.qty, oi.price, oi.product_id
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at BETWEEN $1 AND $2
      `, [dateStart, dateEnd]),

      pool.query(`
        SELECT event_time, order_id, event, performed_by, note
        FROM audit_logs
        WHERE event_time BETWEEN $1 AND $2
        ORDER BY event_time
      `, [dateStart, dateEnd]),

      pool.query(`
        SELECT p.order_id, p.amount_paid, p.uploaded_by, p.uploaded_at,
               p.file_name, p.screenshot_base64
        FROM payment_screenshots p
        INNER JOIN orders o ON o.id = p.order_id
        WHERE p.uploaded_at BETWEEN $1 AND $2
        ORDER BY p.uploaded_at
      `, [dateStart, dateEnd]),

      pool.query(`
        SELECT first_name, last_name, email, role, created_at
        FROM users
        WHERE created_at BETWEEN $1 AND $2
        ORDER BY created_at
      `, [dateStart, dateEnd]),

      pool.query(`
        SELECT n.message, n.time, n.read, u.email AS user_email, n.crew_id
        FROM notifications n
        LEFT JOIN users u ON u.id = n.user_id
        WHERE n.time BETWEEN $1 AND $2
        ORDER BY n.time
      `, [dateStart, dateEnd]),
    ]);

    const itemsByOrder = {};
    for (const item of itemsRes.rows) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }

    const paymentByOrder = {};
    for (const p of paymentsRes.rows) {
      paymentByOrder[p.order_id] = p;
    }

    const auditByOrder = {};
    for (const a of auditRes.rows) {
      if (!auditByOrder[a.order_id]) auditByOrder[a.order_id] = [];
      auditByOrder[a.order_id].push(`${a.event} by ${a.performed_by}`);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TrainServe';
    wb.created = new Date();

    const ws = wb.addWorksheet(`Report ${date}`, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: 'Row Type', key: 'rowType', width: 20 },
      { header: 'Timestamp', key: 'timestamp', width: 25 },
      { header: 'Order ID', key: 'orderId', width: 22 },
      { header: 'Order Type', key: 'orderType', width: 15 },
      { header: 'Customer / Person', key: 'customerName', width: 25 },
      { header: 'Customer Email', key: 'customerEmail', width: 30 },
      { header: 'Train No', key: 'trainNo', width: 15 },
      { header: 'Train Name', key: 'trainName', width: 25 },
      { header: 'Stall Name', key: 'stallName', width: 25 },
      { header: 'Stall Location', key: 'stallLocation', width: 25 },
      { header: 'Station / Location', key: 'location', width: 25 },
      { header: 'ETA', key: 'eta', width: 15 },
      { header: 'Items Ordered', key: 'itemsOrdered', width: 40 },
      { header: 'Item Quantities', key: 'itemQtys', width: 35 },
      { header: 'Item Subtotals (₹)', key: 'itemSubtotals', width: 35 },
      { header: 'Order Total (₹)', key: 'orderTotal', width: 18 },
      { header: 'Order Status', key: 'orderStatus', width: 18 },
      { header: 'Assigned Crew', key: 'assignedCrew', width: 20 },
      { header: 'All Events / Actions', key: 'events', width: 40 },
      { header: 'Payment Uploaded', key: 'paymentUploaded', width: 20 },
      { header: 'Amount Paid (₹)', key: 'amountPaid', width: 18 },
      { header: 'Payment File', key: 'paymentFile', width: 25 },
      { header: 'Accepted At', key: 'acceptedAt', width: 25 },
      { header: 'Completed At', key: 'completedAt', width: 25 },
      { header: 'Accept Time (mins)', key: 'acceptMins', width: 20 },
      { header: 'Delivery Time (mins)', key: 'deliveryMins', width: 20 },
      { header: 'Notes / Extra', key: 'notes', width: 35 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 35;
    headerRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    const ROW_COLORS = {
      ORDER: 'FFFFFFFF',
      SIGNUP: 'FFE0F2FE',
      AUDIT: 'FFFFF3CD',
      PAYMENT: 'FFD4EDDA',
      NOTIF: 'FFF3E8FF',
    };

    function styleRow(row, type) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_COLORS[type] || 'FFFFFFFF' } };
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.height = 25;
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    }

    // ORDER rows
    for (const o of ordersRes.rows) {
      const items = itemsByOrder[o.id] || [];
      const payment = paymentByOrder[o.id];
      const auditStr = (auditByOrder[o.id] || []).join(' | ');

      const itemNames = items.map(i => i.name).join(', ');
      const itemQtys = items.map(i => `${i.name}: ×${i.qty}`).join(', ');
      const itemSubtots = items.map(i => `${i.name}: ₹${i.qty * i.price}`).join(', ');

      const row = ws.addRow({
        rowType: 'ORDER',
        timestamp: o.created_at ? new Date(o.created_at).toLocaleString('en-IN') : '',
        orderId: o.id,
        orderType: o.order_type?.toUpperCase() || 'TRAIN',
        customerName: o.user_name,
        customerEmail: o.user_email || '',
        trainNo: o.order_type === 'train' ? o.train_no : '',
        trainName: o.order_type === 'train' ? o.train_name : '',
        stall
