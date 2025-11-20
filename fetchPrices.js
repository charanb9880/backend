import * as dotenv from "dotenv";
dotenv.config();
if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ======================================
   1) REAL COMPANIES (US + INDIA)
====================================== */
const STOCKS = [
  // ======================
  // 🇺🇸 US TECH
  // ======================
  { name: "Apple Inc",            sym: "AAPL",  sector: "TECH", vol: 0.004 },
  { name: "Microsoft Corp",       sym: "MSFT",  sector: "TECH", vol: 0.0035 },
  { name: "Alphabet (Google)",    sym: "GOOGL", sector: "TECH", vol: 0.0045 },
  { name: "Meta Platforms",       sym: "META",  sector: "TECH", vol: 0.0038 },
  { name: "Netflix",              sym: "NFLX",  sector: "TECH", vol: 0.006 },
  { name: "Adobe",                sym: "ADBE",  sector: "TECH", vol: 0.0035 },
  { name: "Oracle",               sym: "ORCL",  sector: "TECH", vol: 0.0025 },

  // ======================
  // 🇺🇸 CHIP MANUFACTURERS
  // ======================
  { name: "Nvidia",               sym: "NVDA", sector: "CHIP", vol: 0.007 },
  { name: "Advanced Micro Devices", sym: "AMD",  sector: "CHIP", vol: 0.0055 },
  { name: "Intel",                sym: "INTC", sector: "CHIP", vol: 0.002 },
  { name: "Qualcomm",             sym: "QCOM", sector: "CHIP", vol: 0.0035 },
  { name: "Broadcom",             sym: "AVGO", sector: "CHIP", vol: 0.003 },

  // ======================
  // 🇺🇸 AUTO + EV
  // ======================
  { name: "Tesla",                sym: "TSLA", sector: "AUTO", vol: 0.009 },
  { name: "Ford Motors",          sym: "F",    sector: "AUTO", vol: 0.002 },
  { name: "General Motors",       sym: "GM",   sector: "AUTO", vol: 0.0022 },
  { name: "Rivian",               sym: "RIVN", sector: "AUTO", vol: 0.006 },

  // ======================
  // 🇺🇸 RETAIL + ECOM
  // ======================
  { name: "Amazon",               sym: "AMZN", sector: "RETAIL", vol: 0.0045 },
  { name: "Walmart",              sym: "WMT",  sector: "RETAIL", vol: 0.0015 },
  { name: "Target",               sym: "TGT",  sector: "RETAIL", vol: 0.002 },

  // ======================
  // 🇺🇸 FINANCIAL
  // ======================
  { name: "JP Morgan Chase",      sym: "JPM",  sector: "FINANCE", vol: 0.0015 },
  { name: "Goldman Sachs",        sym: "GS",   sector: "FINANCE", vol: 0.002 },
  { name: "Bank of America",      sym: "BAC",  sector: "FINANCE", vol: 0.0018 },

  // ======================
  // 🇺🇸 PHARMA / HEALTHCARE
  // ======================
  { name: "Pfizer",               sym: "PFE",  sector: "PHARMA", vol: 0.0014 },
  { name: "Moderna",              sym: "MRNA", sector: "PHARMA", vol: 0.003 },
  { name: "Johnson & Johnson",    sym: "JNJ",  sector: "PHARMA", vol: 0.0013 },

  // ======================
  // 🇮🇳 INDIAN IT
  // ======================
  { name: "Tata Consultancy Services", sym: "TCS",   sector: "IN_IT", vol: 0.002 },
  { name: "Infosys",                  sym: "INFY",  sector: "IN_IT", vol: 0.0025 },
  { name: "HCL Technologies",         sym: "HCL",   sector: "IN_IT", vol: 0.0022 },
  { name: "Wipro",                    sym: "WIPRO", sector: "IN_IT", vol: 0.0023 },

  // ======================
  // 🇮🇳 INDIAN BANKS
  // ======================
  { name: "HDFC Bank",               sym: "HDFCBK", sector: "IN_BANK", vol: 0.0015 },
  { name: "ICICI Bank",              sym: "ICICIBK", sector: "IN_BANK", vol: 0.0017 },
  { name: "SBI",                     sym: "SBIN",   sector: "IN_BANK", vol: 0.0016 },

  // ======================
  // 🇮🇳 ENERGY + OIL
  // ======================
  { name: "Reliance Industries",     sym: "RELIANCE", sector: "IN_ENERGY", vol: 0.002 },
  { name: "ONGC",                    sym: "ONGC",     sector: "IN_ENERGY", vol: 0.0022 },
  { name: "BPCL",                    sym: "BPCL",     sector: "IN_ENERGY", vol: 0.0024 },

  // ======================
  // GLOBAL OIL
  // ======================
  { name: "Exxon Mobil",             sym: "XOM", sector: "OIL", vol: 0.002 },
  { name: "Chevron",                 sym: "CVX", sector: "OIL", vol: 0.002 },
  { name: "British Petroleum",       sym: "BP",  sector: "OIL", vol: 0.0025 },
];

/* ======================================
   REALISTIC BEHAVIOR COMPONENTS
====================================== */

let macroEvent = null;

// Persistent macro event (rally/panic)
function updateMacroEvent() {
  if (!macroEvent && Math.random() < 0.01) {
    const isBull = Math.random() < 0.5;
    macroEvent = {
      drift: isBull ? 0.01 : -0.01,
      ticksLeft: 40 + Math.floor(Math.random() * 80),
    };

    console.log(
      isBull
        ? "📈 Macro Rally Started!"
        : "📉 Macro Panic Started!"
    );
  }

  if (macroEvent) {
    macroEvent.ticksLeft--;
    if (macroEvent.ticksLeft <= 0) {
      console.log("🟢 Macro Event Ended");
      macroEvent = null;
    }
  }

  return macroEvent ? macroEvent.drift : 0;
}

// Short-term global sentiment
function marketSentiment() {
  const r = Math.random();
  if (r < 0.01) return 0.02; // big up
  if (r < 0.02) return -0.02; // big drop
  if (r < 0.08) return 0.008;
  if (r < 0.15) return -0.008;
  return 0;
}

// Weekly behavior
function weeklyDrift() {
  const day = new Date().getDay();
  if (day === 1) return 0.002; // Monday optimistic
  if (day === 5) return -0.002; // Friday selling
  return 0;
}

// Intraday volatility approximation
function intradayVolatility() {
  const hour = new Date().getHours();
  if (hour < 10) return 1.8; // open
  if (hour < 14) return 1.1; // normal
  if (hour < 16) return 1.6; // close
  return 1.0;
}

// Sector sentiment
function sectorSentiment(sector) {
  if (Math.random() < 0.015) {
    if (sector.includes("TECH")) return 0.01;
    if (sector.includes("BANK")) return -0.01;
    if (sector.includes("ENERGY")) return 0.015;
    if (sector.includes("AUTO")) return -0.015;
  }
  return 0;
}

// Company-specific news
function companyNews(name) {
  if (Math.random() < 0.003) return 0.03; // big positive
  if (Math.random() < 0.006) return -0.025; // negative
  return 0;
}

function nextPrice(prev, vol, globalSent, macro, sector, company) {
  let movePct = (Math.random() - 0.5) * vol;

  movePct += globalSent + macro + sector + company;
  movePct += weeklyDrift();
  movePct *= intradayVolatility();

  movePct = Math.max(Math.min(movePct, 0.12), -0.12);

  return Math.max(prev * (1 + movePct), 1);
}

/* ======================================
   MAIN PRICE ENGINE
====================================== */

export default async function runPriceFetcher() {
  console.log("⚙️ Price tick running...");

  const client = await pool.connect();
  try {
    await client.query("SET search_path TO public");
    await client.query("BEGIN");

    const macro = updateMacroEvent();
    const globalSent = marketSentiment();

    for (const stock of STOCKS) {
      const { sym, name, sector, vol } = stock;

      const prevQuery = await client.query(
        "SELECT current_price FROM live_prices WHERE symbol=$1",
        [sym]
      );

      const prev = Number(prevQuery.rows?.[0]?.current_price ?? 100);

      const newPrice = nextPrice(
        prev,
        vol,
        globalSent,
        macro,
        sectorSentiment(sector),
        companyNews(name)
      );

      await client.query(
        `INSERT INTO live_prices(symbol,current_price,last_updated)
         VALUES($1,$2,NOW())
         ON CONFLICT(symbol) DO UPDATE SET current_price=$2,last_updated=NOW()`,
        [sym, newPrice]
      );

      console.log(`📊 ${name} (${sym}) → ${newPrice.toFixed(2)}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    console.error("❌ Price engine error:", err);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
