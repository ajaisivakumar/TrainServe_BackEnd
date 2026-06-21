// src/routes/reports.js
const router = require('express').Router();
const pool = require('../db/pool');
const ExcelJS = require('exceljs');
const { requireRole } = require('../middleware/auth');

router.get('/daily', ...requireRole('ADMIN'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [signups, orders, crewActivity, summary] = await Promise.all([
      pool.query(
        `SELECT first_name, last_name, email, role, created_at
         FROM users WHERE created_at::date = $1 ORDER BY created_at`,
        [date]
      ),
      pool.query(
        `SELECT o.id, o.order_type, o.user_name, o.train_name, o.stall_name,
                o.status, o.total, o.assigned_crew_id, c.name AS crew_name,
                o.created_at, o.completed_at
         FROM orders o
         LEFT JOIN crew c ON c.crew_id = o.assigned_crew_id
         WHERE o.created_at::date = $1 ORDER BY o.created_at`,
        [date]
      ),
      pool.query(
        `SELECT event_time, order_id, event, performed_by, note
         FROM audit_logs WHERE event_time::date = $1 ORDER BY event_time`,
        [date]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_orders,
           COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
           COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
           COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0) AS revenue
         FROM orders WHERE created_at::date = $1`,
        [date]
      ),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TrainServe';
    wb.created = new Date();

    // ── Summary sheet ──
    const sSheet = wb.addWorksheet('Summary');
    sSheet.columns = [{ header: 'Metric', key: 'm', width: 30 }, { header: 'Value', key: 'v', width: 20 }];
    const s = summary.rows[0];
    sSheet.addRows([
      { m: 'Report Date', v: date },
      { m: 'Total Orders', v: parseInt(s.total_orders) },
      { m: 'Completed Orders', v: parseInt(s.completed) },
      { m: 'Pending Orders', v: parseInt(s.pending) },
      { m: 'Revenue (₹)', v: parseInt(s.revenue) },
      { m: 'New Signups', v: signups.rows.length },
    ]);
    sSheet.getRow(1).font = { bold: true };

    // ── New Signups sheet ──
    const uSheet = wb.addWorksheet('New Signups');
    uSheet.columns = [
      { header: 'First Name', key: 'first_name', width: 18 },
      { header: 'Last Name', key: 'last_name', width: 18 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Role', key: 'role', width: 14 },
      { header: 'Signed Up At', key: 'created_at', width: 22 },
    ];
    uSheet.addRows(signups.rows);
    uSheet.getRow(1).font = { bold: true };

    // ── Orders sheet ──
    const oSheet = wb.addWorksheet('Orders');
    oSheet.columns = [
      { header: 'Order ID', key: 'id', width: 18 },
      { header: 'Type', key: 'order_type', width: 10 },
      { header: 'Customer/Stall Owner', key: 'user_name', width: 22 },
      { header: 'Train / Stall', key: 'place', width: 22 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total (₹)', key: 'total', width: 12 },
      { header: 'Crew Assigned', key: 'crew_name', width: 18 },
      { header: 'Placed At', key: 'created_at', width: 22 },
      { header: 'Completed At', key: 'completed_at', width: 22 },
    ];
    orders.rows.forEach(o => {
      oSheet.addRow({
        ...o,
        place: o.order_type === 'stall' ? o.stall_name : o.train_name,
      });
    });
    oSheet.getRow(1).font = { bold: true };

    // ── Crew Activity sheet ──
    const cSheet = wb.addWorksheet('Crew Activity');
    cSheet.columns = [
      { header: 'Time', key: 'event_time', width: 22 },
      { header: 'Order ID', key: 'order_id', width: 18 },
      { header: 'Event', key: 'event', width: 14 },
      { header: 'Performed By', key: 'performed_by', width: 20 },
      { header: 'Note', key: 'note', width: 30 },
    ];
    cSheet.addRows(crewActivity.rows);
    cSheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="TrainServe-Report-${date}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
