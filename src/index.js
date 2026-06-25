// src/index.js
// TrainServe Backend — Express server entry point

require('dotenv').config();

const express       = require('express');
const cors          = require('cors');
const initDb        = require('./db/init');

const authRoutes    = require('./routes/auth');
const userRoutes    = require('./routes/users');
const orderRoutes   = require('./routes/orders');
const notifRoutes   = require('./routes/notifications');
const reportRoutes   = require('./routes/reports');
const productRoutes  = require('./routes/products');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── CORS ─────────────────────────────────────────────────────────────
// Allows your GitHub Pages frontend to call this backend.
// FRONTEND_ORIGIN is set in your .env file.
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,      // your GitHub Pages URL
  'http://localhost:3000',           // local dev
  'http://localhost:5500',           // Live Server
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ─────────────────────────────────────────────────────
// Payment screenshots are base64 strings and can be large — allow 10 MB
app.use(express.json({ limit: '10mb' }));

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── API routes ───────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/products',      productRoutes);

// ── 404 fallback ───────────────────────────────────


app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// ── Global error handler ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────
(async () => {
  await initDb();          // create tables if they don't exist
  app.listen(PORT, () => {
    console.log(`\n🚂 TrainServe backend running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   API:    http://localhost:${PORT}/api\n`);
  });
})();
