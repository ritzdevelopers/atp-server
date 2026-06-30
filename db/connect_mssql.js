import sql from "mssql";
import dotenv from "dotenv";
import { canReachBiometricSqlHost } from "../config/biometricSyncGate.js";

dotenv.config();

let pool = null;
let connecting = null;
let sqlBlockedUntil = 0;
let lastBlockReason = "";

const MAX_RETRIES = Number(process.env.BIOMETRIC_DB_MAX_RETRIES || 5);
const RETRY_DELAY_MS = Number(process.env.BIOMETRIC_DB_RETRY_DELAY_MS || 3_000);
const BLOCK_TTL_MS = Number(process.env.BIOMETRIC_DB_BLOCK_TTL_MS || 60_000);

function buildMssqlConfig() {
  return {
    server: process.env.BIOMETRIC_DB_HOST || "localhost",
    port: Number(process.env.BIOMETRIC_DB_PORT || 1433),
    database: process.env.BIOMETRIC_DB_NAME || "etimetracklite1",
    user: process.env.BIOMETRIC_DB_USER || "essl",
    password: process.env.BIOMETRIC_DB_PASSWORD || "",
    options: {
      encrypt: String(process.env.BIOMETRIC_DB_ENCRYPT || "false") === "true",
      trustServerCertificate:
        String(process.env.BIOMETRIC_DB_TRUST_CERT || "true") === "true",
    },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
  const reach = canReachBiometricSqlHost();
  if (!reach.allowed) {
    lastBlockReason = reach.reason;
    sqlBlockedUntil = Date.now() + BLOCK_TTL_MS;
    const err = new Error(reach.reason);
    err.code = "BIOMETRIC_SYNC_DISABLED";
    throw err;
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const created = await sql.connect(buildMssqlConfig());
      console.log(
        `[biometric] SQL Server connected (${process.env.BIOMETRIC_DB_HOST}:${process.env.BIOMETRIC_DB_PORT || 1433})`,
      );
      return created;
    } catch (err) {
      lastError = err;
      console.error(
        `[biometric] SQL Server connect attempt ${attempt}/${MAX_RETRIES} failed:`,
        err.message,
      );
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function throwCachedUnavailable() {
  const err = new Error(
    lastBlockReason || "Biometric SQL Server is not reachable in this environment",
  );
  err.code = "BIOMETRIC_SYNC_DISABLED";
  throw err;
}

export default async function getMssqlPool() {
  if (Date.now() < sqlBlockedUntil) {
    throwCachedUnavailable();
  }

  if (pool?.connected) return pool;

  if (!connecting) {
    connecting = connectWithRetry()
      .then((p) => {
        pool = p;
        pool.on("error", (err) => {
          console.error("[biometric] SQL pool error:", err.message);
          pool = null;
        });
        return pool;
      })
      .catch((err) => {
        if (err?.code === "BIOMETRIC_SYNC_DISABLED") {
          sqlBlockedUntil = Date.now() + BLOCK_TTL_MS;
          lastBlockReason = err.message;
        }
        throw err;
      })
      .finally(() => {
        connecting = null;
      });
  }

  return connecting;
}

export async function closeMssqlPool() {
  if (!pool) return;
  try {
    await pool.close();
  } catch {
    /* ignore */
  }
  pool = null;
}

export async function testMssqlConnection() {
  const p = await getMssqlPool();
  const result = await p.request().query("SELECT 1 AS ok");
  return result.recordset[0]?.ok === 1;
}
