import { Router } from "express";
import getMssqlPool from "../../db/connect_mssql.js";
import { canReachBiometricSqlHost } from "../../config/biometricSyncGate.js";
import { fetchEmployeeTodayFromDevice } from "../../services/biometric/fetchLivePunches.js";

const router = Router();

function bridgeAuth(req, res, next) {
  const secret =
    String(process.env.BIOMETRIC_LOCAL_BRIDGE_SECRET || "").trim() ||
    String(process.env.BIOMETRIC_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    next();
    return;
  }
  const header =
    req.headers["x-bridge-secret"] ||
    req.headers["x-biometric-secret"] ||
    req.headers["x-webhook-secret"];
  if (header !== secret) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  next();
}

async function fetchAttendanceAllRows({ punchDate, fromDate, toDate } = {}) {
  const pool = await getMssqlPool();

  if (punchDate) {
    const result = await pool
      .request()
      .input("punchDate", punchDate)
      .query(`
        SELECT *
        FROM AttendanceAll
        WHERE CAST(PunchDate AS DATE) = @punchDate
        ORDER BY PunchDate ASC
      `);
    return result.recordset ?? [];
  }

  if (fromDate && toDate) {
    const result = await pool
      .request()
      .input("fromDate", fromDate)
      .input("toDate", toDate)
      .query(`
        SELECT *
        FROM AttendanceAll
        WHERE CAST(PunchDate AS DATE) >= @fromDate
          AND CAST(PunchDate AS DATE) <= @toDate
        ORDER BY PunchDate ASC
      `);
    return result.recordset ?? [];
  }

  const result = await pool.request().query(`
    SELECT *
    FROM AttendanceAll
    ORDER BY PunchDate ASC
  `);
  return result.recordset ?? [];
}

/** Office local server exposes this for cloud production (via ngrok / tunnel). */
router.get("/health", bridgeAuth, async (_req, res) => {
  const reach = canReachBiometricSqlHost();
  if (!reach.allowed) {
    return res.status(503).json({
      success: false,
      online: false,
      message: reach.reason,
    });
  }

  try {
    const pool = await getMssqlPool();
    const result = await pool.request().query("SELECT 1 AS ok");
    return res.json({
      success: true,
      online: true,
      sql_connected: result.recordset[0]?.ok === 1,
      service: "office-biometric-bridge",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      online: false,
      message: error.message,
    });
  }
});

router.get("/attendance-all", bridgeAuth, async (req, res) => {
  const reach = canReachBiometricSqlHost();
  if (!reach.allowed) {
    return res.status(503).json({ success: false, message: reach.reason });
  }

  try {
    const punchDate = String(req.query.punchDate || req.query.punch_date || "").trim();
    const fromDate = String(req.query.fromDate || req.query.from_date || "").trim();
    const toDate = String(req.query.toDate || req.query.to_date || "").trim();
    const rows = await fetchAttendanceAllRows({
      punchDate: punchDate || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    });
    return res.json({ success: true, count: rows.length, rows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Could not read AttendanceAll",
    });
  }
});

router.get("/employee-today/:employeeCode", bridgeAuth, async (req, res) => {
  const reach = canReachBiometricSqlHost();
  if (!reach.allowed) {
    return res.status(503).json({ success: false, message: reach.reason });
  }

  try {
    const code = String(req.params.employeeCode || "").trim();
    const shiftEndTime = req.query.shift_end_time
      ? String(req.query.shift_end_time)
      : null;
    const data = await fetchEmployeeTodayFromDevice(code, { shiftEndTime });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Could not read employee punches",
    });
  }
});

export default router;
