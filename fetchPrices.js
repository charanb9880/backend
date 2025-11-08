import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import * as dotenv from "dotenv";
dotenv.config();

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

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
  const p = prev + move;
  return Math.max(p, 1);
}

export default async function runPriceFetcher() {
  console.log("⚙️ Price tick...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const global = marketSentiment();
    console.log(global === 0 ? "✅ Normal market" : global > 0 ? "🔥 Mini rally" : "🚨 Mini drop");

    for (const s of STOCKS) {
      const sector = sectorSentiment(s.sector);
      const prev = await client.query(`SELECT current_price FROM live_prices WHERE symbol=$1`, [s.sym]);
      const oldP = Number(prev.rows?.[0]?.current_price || 100);
      const newP = nextPrice(oldP, s.vol, global, sector);

      await client.query(`
        INSERT INTO live_prices(symbol,current_price,last_updated)
        VALUES($1,$2,NOW())
        ON CONFLICT(symbol) DO UPDATE SET current_price=$2,last_updated=NOW()
      `, [s.sym, newP]);

      console.log(`📈 ${s.sym} → ${newP.toFixed(2)}`);
    }

    await client.query("COMMIT");
  } catch (e) {
    console.error("❌ Tick:", e.message);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
