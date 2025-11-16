/* ======================
   ENV SETUP
====================== */
import * as dotenv from 'dotenv';
dotenv.config();
if (process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pkg from 'pg';
import runPriceFetcher from './fetchPrices.js';

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 10000;

/* ======================
   MIDDLEWARE
====================== */
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());

/* ======================
   DATABASE
====================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================
   AUTH HELPERS
====================== */
function verifyToken(req, res, next) {
  const h = req.headers['authorization'];
  const t = h && h.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'No token' });

  jwt.verify(t, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN')
    return res.status(403).json({ error: 'Admin only' });
  next();
}

/* ======================
   AUTH ROUTES
====================== */
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);

  try {
    const r = await pool.query(
      `INSERT INTO users (name, email, password_hash, virtual_cash, status, role)
       VALUES ($1, $2, $3, 50000, 'PENDING', 'USER')
       RETURNING id, name, email, status, role, virtual_cash`,
      [name, email, hash]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Email already exists' });
  }
});

app.post('/auth/login', async (req,res)=>{
  const {email,password} = req.body;
  const r = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);

  if (r.rowCount === 0) return res.status(401).json({ error:'User not found' });

  const u = r.rows[0];
  if (!await bcrypt.compare(password, u.password_hash))
    return res.status(401).json({ error:'Wrong password' });

  const token = jwt.sign(
    { id: u.id, role: u.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, role: u.role, status: u.status, name: u.name });
});

/* ======================
   SYSTEM
====================== */
app.get('/api/system', async (req,res)=>{
  const r = await pool.query(`SELECT trading_enabled FROM system_state WHERE id=1`);
  res.json(r.rows[0] || { trading_enabled:false });
});

/* ======================
   LIVE MARKET
====================== */
app.get('/api/prices', async (req,res)=>{
  const r = await pool.query(`SELECT symbol,current_price FROM live_prices ORDER BY symbol`);
  res.json(r.rows);
});

/* ======================
   PORTFOLIO
====================== */
app.get('/api/portfolio', verifyToken, async (req,res)=>{
  if (req.user.role === 'ADMIN')
    return res.status(403).json({ error:'Admins cannot trade' });

  const uid = req.user.id;

  const cash = await pool.query(
    `SELECT virtual_cash,status FROM users WHERE id=$1`,
    [uid]
  );

  const positions = await pool.query(
    `SELECT p.symbol, p.quantity, p.average_price, lp.current_price
     FROM portfolio p
     LEFT JOIN live_prices lp ON lp.symbol = p.symbol
     WHERE p.user_id=$1
     ORDER BY p.symbol`,
    [uid]
  );

  res.json({
    virtual_cash: cash.rows[0]?.virtual_cash ?? 0,
    status: cash.rows[0]?.status ?? 'PENDING',
    positions: positions.rows
  });
});

/* ======================
   BUY
====================== */
app.post('/api/trade/buy', verifyToken, async (req,res)=>{
  if (req.user.role === 'ADMIN')
    return res.status(403).json({ error:'Admin cannot trade' });

  const {symbol, quantity} = req.body;
  const uid = req.user.id;
  const qty = Number(quantity);

  if (!symbol || qty <= 0) return res.status(400).json({error:'Invalid quantity'});

  const pR = await pool.query(`SELECT current_price FROM live_prices WHERE symbol=$1`, [symbol]);
  if (pR.rowCount === 0) return res.status(400).json({error:'Unknown symbol'});

  const price = Number(pR.rows[0].current_price);
  const cost = price * qty;

  const uR = await pool.query(`SELECT virtual_cash FROM users WHERE id=$1`, [uid]);
  const cash = Number(uR.rows[0].virtual_cash);

  if (cash < cost) return res.status(400).json({error:'Insufficient cash'});

  await pool.query(`UPDATE users SET virtual_cash=virtual_cash-$1 WHERE id=$2`, [cost, uid]);

  const existing = await pool.query(
    `SELECT quantity,average_price FROM portfolio WHERE user_id=$1 AND symbol=$2`,
    [uid, symbol]
  );

  if (existing.rowCount === 0) {
    await pool.query(
      `INSERT INTO portfolio(user_id,symbol,quantity,average_price)
       VALUES($1,$2,$3,$4)`,
      [uid, symbol, qty, price]
    );
  } else {
    const qOld = existing.rows[0].quantity;
    const aOld = existing.rows[0].average_price;
    const qNew = qOld + qty;
    const avg = ((qOld*aOld) + (qty*price)) / qNew;

    await pool.query(
      `UPDATE portfolio SET quantity=$1,average_price=$2
       WHERE user_id=$3 AND symbol=$4`,
      [qNew, avg, uid, symbol]
    );
  }

  // log trade
  await pool.query(`
    INSERT INTO trade_history(user_id, symbol, trade_type, quantity, price, timestamp)
    VALUES($1,$2,'BUY',$3,$4,NOW())
  `, [uid, symbol, qty, price]);

  res.json({ok:true});
});

/* ======================
   SELL
====================== */
app.post('/api/trade/sell', verifyToken, async (req,res)=>{
  if (req.user.role === 'ADMIN')
    return res.status(403).json({ error:'Admin cannot trade' });

  const {symbol, quantity} = req.body;
  const uid = req.user.id;
  const qty = Number(quantity);

  if (qty <= 0) return res.status(400).json({error:'Invalid quantity'});

  const pos = await pool.query(
    `SELECT quantity FROM portfolio WHERE user_id=$1 AND symbol=$2`,
    [uid, symbol]
  );

  if (pos.rowCount === 0) return res.status(400).json({error:'No holdings'});
  
  const owned = pos.rows[0].quantity;
  if (qty > owned) return res.status(400).json({error:'Not enough shares'});

  const pR = await pool.query(`SELECT current_price FROM live_prices WHERE symbol=$1`, [symbol]);
  const price = Number(pR.rows[0].current_price);
  const revenue = price * qty;

  if (qty === owned) {
    await pool.query(`DELETE FROM portfolio WHERE user_id=$1 AND symbol=$2`, [uid, symbol]);
  } else {
    await pool.query(
      `UPDATE portfolio SET quantity=$1 WHERE user_id=$2 AND symbol=$3`,
      [owned - qty, uid, symbol]
    );
  }

  await pool.query(
    `UPDATE users SET virtual_cash=virtual_cash+$1 WHERE id=$2`,
    [revenue, uid]
  );

  await pool.query(`
    INSERT INTO trade_history(user_id, symbol, trade_type, quantity, price, timestamp)
    VALUES($1,$2,'SELL',$3,$4,NOW())
  `, [uid, symbol, qty, price]);

  res.json({ok:true});
});

/* ======================
   CHART DATA
====================== */
app.get('/api/candles/:symbol', async (req,res)=>{
  const sym = req.params.symbol.toUpperCase();
  const r = await pool.query(
    `SELECT extract(epoch from ts)::int AS time, open, high, low, close
     FROM price_history
     WHERE symbol=$1
     ORDER BY ts ASC`,
    [sym]
  );
  res.json(r.rows);
});

/* ======================
   ADMIN ROUTES
====================== */
app.get('/api/admin/players', verifyToken, requireAdmin, async (req,res)=>{
  const r = await pool.query(
    `SELECT id, name, email, status, virtual_cash
     FROM users
     ORDER BY email`
  );
  res.json(r.rows);
});

app.post('/api/admin/approve', verifyToken, requireAdmin, async (req,res)=>{
  const { user_id, virtual_cash } = req.body;
  await pool.query(
    `UPDATE users SET status='APPROVED', virtual_cash=$1 WHERE id=$2`,
    [virtual_cash, user_id]
  );
  res.json({ ok:true });
});

app.post('/api/admin/block', verifyToken, requireAdmin, async (req,res)=>{
  const { user_id } = req.body;
  await pool.query(`UPDATE users SET status='BLOCKED' WHERE id=$1`, [user_id]);
  res.json({ ok:true });
});

/* ======================
   NEW: ASSIGN CASH TO A SINGLE USER
   POST /api/admin/assign-cash/:userId
   Body: { amount: number }
====================== */
app.post('/api/admin/assign-cash/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount } = req.body;

    if (typeof amount === 'undefined') {
      return res.status(400).json({ error: 'Missing amount' });
    }

    const am = Number(amount);
    if (!Number.isFinite(am) || am < 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const upd = await pool.query(
      `UPDATE users SET virtual_cash = $1 WHERE id = $2 RETURNING id, name, email, virtual_cash, status, role`,
      [am, userId]
    );

    if (upd.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, user: upd.rows[0] });
  } catch (err) {
    console.error('❌ assign-cash error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/* ======================
   NEW: BULK APPROVE + ASSIGN FUNDS
   POST /api/admin/approve-all
   Body: { amount: number }
====================== */
app.post('/api/admin/approve-all', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { amount } = req.body;

    if (typeof amount === 'undefined') {
      return res.status(400).json({ error: 'Missing amount' });
    }

    const am = Number(amount);
    if (!Number.isFinite(am) || am < 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await pool.query(
      `UPDATE users SET status='APPROVED', virtual_cash=$1 WHERE status='PENDING' RETURNING id`,
      [am]
    );

    res.json({ ok: true, approved_count: result.rowCount });
  } catch (err) {
    console.error('❌ approve-all error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/admin/remove', verifyToken, requireAdmin, async (req,res)=>{
  const { user_id } = req.body;
  await pool.query(`DELETE FROM trade_history WHERE user_id=$1`, [user_id]);
  await pool.query(`DELETE FROM portfolio WHERE user_id=$1`, [user_id]);
  await pool.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  res.json({ ok:true });
});

/* ======================
   ADMIN — SET VIRTUAL CASH
====================== */
app.post('/api/admin/set-virtual-cash', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { user_id, virtual_cash } = req.body;

    if (typeof user_id === 'undefined' || typeof virtual_cash === 'undefined') {
      return res.status(400).json({ error: 'Missing user_id or virtual_cash' });
    }

    const vc = Number(virtual_cash);
    if (!Number.isFinite(vc) || vc < 0) {
      return res.status(400).json({ error: 'virtual_cash must be non-negative' });
    }

    const upd = await pool.query(
      `UPDATE users SET virtual_cash = $1 WHERE id = $2 RETURNING id, name, email, virtual_cash, status, role`,
      [vc, user_id]
    );

    if (upd.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, user: upd.rows[0] });
  } catch (err) {
    console.error('❌ set-virtual-cash error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/* ======================
   ADMIN — LEADERBOARD
====================== */
app.get('/api/admin/leaderboard', verifyToken, requireAdmin, async (_, res) => {
  const r = await pool.query(`
    SELECT 
      u.id,
      u.name,
      u.email,
      (
        u.virtual_cash + COALESCE(SUM(p.quantity * lp.current_price), 0)
      )::numeric AS total_value,
      (
        (COALESCE(SUM(p.quantity * lp.current_price), 0) + u.virtual_cash) - 50000
      )::numeric AS profit
    FROM users u
    LEFT JOIN portfolio p ON p.user_id = u.id
    LEFT JOIN live_prices lp ON lp.symbol = p.symbol
    WHERE u.role <> 'ADMIN'
    GROUP BY u.id
    ORDER BY total_value DESC
  `);
  res.json(r.rows);
});

/* ======================
   ADMIN — RECENT TRADES
====================== */
app.get('/api/admin/recent-trades', verifyToken, requireAdmin, async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT 
        th.id,
        th.symbol,
        th.trade_type,
        th.quantity,
        th.price,
        th.timestamp AS time,
        u.name,
        u.email
      FROM trade_history th
      JOIN users u ON u.id = th.user_id
      ORDER BY th.timestamp DESC
      LIMIT 15
    `);

    res.json(r.rows);
  } catch (err) {
    console.error("❌ Recent Trades Error:", err.message);
    res.json([]);
  }
});

/* ======================
   DEBUG: DB INFO
====================== */
pool.query("SELECT current_database(), current_user", (err, r) => {
  console.log("Connected to:", r?.rows);
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, () => {
  console.log(`✅ TradeRace backend running on :${PORT}`);

  if (process.env.ENABLE_PRICE_TICK === "1") {
    runPriceFetcher().catch(e=>console.error("❌ First tick:", e));
    setInterval(
      () => runPriceFetcher().catch(e=>console.error("❌ Tick:", e)),
      Number(process.env.PRICE_TICK_INTERVAL_MS || 10000)
    );
  } else {
    console.log("⚠️ Price engine disabled");
  }
});
