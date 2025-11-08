import * as dotenv from "dotenv";
dotenv.config();

import dns from "dns";
dns.setDefaultResultOrder("ipv4first"); // ✅ Force IPv4

import pkg from "pg";
const { Pool } = pkg;

// ✅ Render & Supabase-friendly IPv4 PostgreSQL connection:
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
  ssl: { rejectUnauthorized: false }
});

// ✅ Stocks with volatility + sectors
const STOCKS = [
  { sym: "AAPL", sector: "TECH", vol: 0.004 },
  { sym: "MSFT", sector: "TECH", vol: 0.0035 },
  { sym: "GOOGL", sector: "TECH", vol: 0.0045 },
  { sym: "NVDA", sector: "TECH", vol: 0.007 },
  { sym: "TSLA", sector: "AUTO", vol: 0.009 },
  { sym: "AMZN", sector: "RETAIL", vol: 0.0045 },
  { sym: "META", sector: "TECH", vol: 0.0038 },
  { sym: "NFLX", sector: "MEDIA", vol: 0.006 },
  { sym: "INTC", sector: "CHIP", vol: 0.002 },
  { sym: "AMD", sector: "CHIP", vol: 0.0055 }
];

function marketSentiment() {
  const r = Math.random();
  if (r < 0.02) return 0.02;
  if (r < 0.04) return -0.02;
  if (r < 0.08) return 0.01;
  if (r < 0.12) return -0.01;
  return 0;
}

function sectorSentiment(sector) {
  const r = Math.random();
  if (r < 0.03 && sector === "TECH") return 0.015;
  if (r < 0.03 && sector === "AUTO") return -0.015;
  if (r < 0.03 && sector === "CHIP") return 0.02;
  return 0;
}

function nextPrice(prev, vol, global, sector) {
  let move = prev * vol * (Math.random() - 0.5);
  move += prev * global;
  move += prev * sector;
  if (Math.random() < 0.02) move *= (2 + Math.random() * 3);
  return Math.max(prev + move, 1);
}

export default async function runPriceFetcher() {
  console.log("⚙️ Price tick...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const global = marketSentiment();
    if (global > 0) console.log(`🔥 MARKET PUMP: +${(global*100).toFixed(2)}%`);
    else if (global < 0) console.log(`🚨 MARKET DROP: ${(global*100).toFixed(2)}%`);
    else console.log(`✅ Normal market`);

    for (const s of STOCKS) {
      const sectorBias = sectorSentiment(s.sector);

      const prev = await client.query(
        `SELECT current_price FROM live_prices WHERE symbol=$1`,
        [s.sym]
      );

      const oldPrice = Number(prev.rows?.[0]?.current_price || 100);
      const newPrice = nextPrice(oldPrice, s.vol, global, sectorBias);

      await client.query(
        `INSERT INTO live_prices(symbol,current_price,last_updated)
         VALUES($1,$2,NOW())
         ON CONFLICT(symbol)
         DO UPDATE SET current_price=$2,last_updated=NOW()`,
        [s.sym, newPrice]
      );

      console.log(`📈 ${s.sym} → ${newPrice.toFixed(2)}`);
    }

    await client.query("COMMIT");
  } catch (e) {
    console.error("❌ Price Engine Error:", e.message);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
