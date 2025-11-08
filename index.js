/* ======================
   ENV SETUP
====================== */
import * as dotenv from 'dotenv';
dotenv.config();
process.env.PGHOSTADDR = '0.0.0.0';  // ✅ Force IPv4 for Render PG

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
   CORS FIX ✅
====================== */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
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
   SYSTEM / LIVE MARKET / TRADING / ADMIN
====================== */
/* ✅ KEEP YOUR EXISTING FULL CODE BELOW — it stays the same */
/* ======================
   ENV SETUP
====================== */
import * as dotenv from 'dotenv';
dotenv.config();
process.env.PGHOSTADDR = '0.0.0.0';  // ✅ Force IPv4 for Render PG

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
   CORS FIX ✅
====================== */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
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
   SYSTEM / LIVE MARKET / TRADING / ADMIN
====================== */
/* ✅ KEEP YOUR EXISTING FULL CODE BELOW — it stays the same */
