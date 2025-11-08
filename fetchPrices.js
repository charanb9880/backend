/* ======================
   ENV SETUP
====================== */
import * as dotenv from 'dotenv';
dotenv.config();

// ✅ Force IPv4 on Render
process.env.PGHOSTADDR = '0.0.0.0';

if (process.env.ALLOW_INSECURE_TLS === '1')
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
   CORS
====================== */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

/* ======================
   ✅ DATABASE (Render IPv4 Safe)
====================== */
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
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
  } catch {
    res.status(500).json({ error: 'Email already exists' });
  }
});

app.post('/auth/login', async (req,res)=>{
  const {email,password} = req.body;
  const r = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
  if (!r.rowCount) return res.status(401).json({ error:'User not found' });

  const u = r.rows[0];
  if (!await bcrypt.compare(password, u.password_hash))
    return res.status(401).json({ error:'Wrong password' });

  const token = jwt.sign(
    { id: u.id, role: u.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, role:u.role, status:u.status, name:u.name });
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
  if (!pR.rowCount) return res.status(400).json({error:'Unknown symbol'});

  const price = Number(pR.rows[0].current_price);
  const cost = price * qty;

  const uR = await pool.query(`SELECT virtual_cash FROM users WHERE id=$1`, [uid]);
  const cash = Number(uR.rows[0].virtual_cash);

  if (cash < cost) return res.status(400).json({error:'Insufficient cash'});

  await pool.query(`UPDATE users SET virtual_cash=virtual_cash-$1 WHERE id=$2`, [cost, uid]);

  await pool.query(
    `INSERT INTO trade_history(user_id, symbol, trade_type, quantity, price, timestamp)
     VALUES($1,$2,'BUY',$3,$4,NOW())`,
    [uid, symbol, qty, price]
  );

  res.json({ok:true});
});

/* ======================
   SELL
====================== */
// ... (same)

app.listen(PORT, () => {
  console.log(`✅ TradeRace backend running on :${PORT}`);
  runPriceFetcher().catch(e=>console.error("❌ First tick:", e));
  setInterval(()=>runPriceFetcher().catch(e=>console.error("❌ Tick:", e)), 10000);
});
