import { Router } from "express";
import { pool } from "../../db/connect.js";
import {
  DEFAULT_ORG_ID,
  syncAllAttendanceHistory,
  syncTodayAttendance,
} from "../../services/sync/attendanceAllSync.js";

const router = Router();

/**
 * POST /api/sync-esl/sync-all-esl-data-to-mysql-attendance
 * Body (optional): { org_id, from_date, to_date }
 *
 * Imports all AttendanceAll rows from eSSL, groups by emp_code + date,
 * and upserts into MySQL attendance (same rules as sync.agent.js).
 */
router.post("/sync-all-esl-data-to-mysql-attendance", async (req, res) => {
  let connection;
  try {
    const org_id = Number(req.body?.org_id ?? DEFAULT_ORG_ID) || DEFAULT_ORG_ID;
    const from_date = req.body?.from_date
      ? String(req.body.from_date).trim()
      : null;
    const to_date = req.body?.to_date ? String(req.body.to_date).trim() : null;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const result = await syncAllAttendanceHistory(org_id, {
      fromDate: from_date || undefined,
      toDate: to_date || undefined,
      connection,
    });

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Attendance history sync completed",
      data: result,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "sync-all-esl-data-to-mysql-attendance rollback failed:",
          rollbackError,
        );
      }
    }
    console.error("sync-all-esl-data-to-mysql-attendance:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      rolled_back: true,
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * POST /api/sync-esl/sync-today-esl-data-to-mysql-attendance
 * Body (optional): { org_id }
 */
router.post("/sync-today-esl-data-to-mysql-attendance", async (req, res) => {
  try {
    const org_id = Number(req.body?.org_id ?? DEFAULT_ORG_ID) || DEFAULT_ORG_ID;
    const result = await syncTodayAttendance(org_id);

    return res.status(200).json({
      success: true,
      message: "Today's attendance sync completed",
      data: result,
    });
  } catch (error) {
    console.error("sync-today-esl-data-to-mysql-attendance:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
});

export default router;
