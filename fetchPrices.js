import * as dotenv from 'dotenv';
dotenv.config();
if (process.env.ALLOW_INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ STOCK GROUPS (for sector influence)
const STOCKS = [
  { sym: "AAPL",  sector: "TECH",  vol: 0.004 },
  { sym: "MSFT",  sector: "TECH",  vol: 0.0035 },
  { sym: "GOOGL", sector: "TECH",  vol: 0.0045 },
  { sym: "NVDA",  sector: "TECH",  vol: 0.007 },

  { sym: "TSLA",  sector: "AUTO",  vol: 0.009 },
  { sym: "AMZN",  sector: "RETAIL",vol: 0.0045 },
  { sym: "META",  sector: "TECH",  vol: 0.0038 },
  { sym: "NFLX",  sector: "MEDIA", vol: 0.006 },
  { sym: "INTC",  sector: "CHIP",  vol: 0.002 },
  { sym: "AMD",   sector: "CHIP",  vol: 0.0055 },
];

// ✅ RANDOM GLOBAL MARKET NEWS (rare)
function marketSentiment() {
  const roll = Math.random();

  if (roll < 0.02) return 0.02;     // 🔥 Strong bull market
  if (roll < 0.04) return -0.02;    // 📉 Strong crash moment
  if (roll < 0.08) return 0.01;     // mild positive
  if (roll < 0.12) return -0.01;    // mild negative
  return 0;
}

// ✅ SECTOR-BASED NEWS (tech boom, retail crash, etc.)
function sectorSentiment(sector) {
  const roll = Math.random();
  if (roll < 0.03 && sector === "TECH") return 0.015;
  if (roll < 0.03 && sector === "AUTO") return -0.015;
  if (roll < 0.03 && sector === "CHIP") return 0.02;
  return 0;
}

// ✅ Final realistic price function
function nextPrice(prev, vol, global, sectorBias) {
  let baseMove = prev * vol * (Math.random() - 0.5);

  // apply global news
  baseMove += prev * global;

  // apply sector news
  baseMove += prev * sectorBias;

  // rare individual spike/crash
  if (Math.random() < 0.02) baseMove *= (2 + Math.random() * 3);

  const price = prev + baseMove;
  return Math.max(price, 1);
}

export default async function runPriceFetcher() {
  console.log("⚙️ Realistic price tick started");
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const globalNews = marketSentiment();
    console.log(globalNews > 0 
      ? `🔥 MARKET RALLY: +${(globalNews*100).toFixed(2)}%` 
      : globalNews < 0 
        ? `🚨 MARKET SELL-OFF: ${(globalNews*100).toFixed(2)}%` 
        : `✅ Normal market`
    );

    for (const s of STOCKS) {
      const sectorNews = sectorSentiment(s.sector);

      const r = await client.query(
        `SELECT current_price FROM live_prices WHERE symbol=$1`,
        [s.sym]
      );

      const prev = Number(r.rows?.[0]?.current_price || 100);
      const price = nextPrice(prev, s.vol, globalNews, sectorNews);

      await client.query(
        `INSERT INTO live_prices(symbol,current_price,last_updated)
         VALUES ($1,$2,NOW())
         ON CONFLICT(symbol) DO UPDATE SET current_price=$2,last_updated=NOW()`,
        [s.sym, price]
      );

      console.log(`📈 ${s.sym} (${s.sector}) → ${price.toFixed(2)}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    console.error("❌ Price engine error:", err.message);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
