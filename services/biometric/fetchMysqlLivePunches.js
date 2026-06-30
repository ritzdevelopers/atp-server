import { pool } from "../../db/connect.js";

/**
 * Live punch feed from MySQL — used on production where the cloud server
 * cannot reach the office biometric SQL Server (10.10.x.x).
 * Rows are written by the on-prem sync agent via /api/biometric/webhook/batch.
 */
export async function fetchMysqlLivePunches(orgId, { sinceId = 0, limit = 50 } = {}) {
  const cursor = Math.max(Number(sinceId) || 0, 0);
  const batch = Math.min(Math.max(Number(limit) || 50, 1), 200);

  if (cursor === 0) {
    const [rows] = await pool.promise().query(
      `SELECT
         device_log_id,
         employee_code,
         employee_name,
         user_id,
         portal_user_name,
         DATE_FORMAT(punch_at, '%Y-%m-%d %H:%i:%s') AS punch_at,
         DATE_FORMAT(punch_date, '%Y-%m-%d') AS punch_date,
         direction,
         device_id,
         source_table
       FROM biometric_live_punch_feed
       WHERE org_id = ?
         AND punch_date = CURDATE()
       ORDER BY device_log_id DESC
       LIMIT ?`,
      [orgId, batch],
    );

    const punches = rows
      .map(mapFeedRow)
      .reverse();

    const latestId =
      punches.length > 0
        ? punches[punches.length - 1].device_log_id
        : await getLatestFeedLogId(orgId);

    return {
      punches,
      latest_device_log_id: latestId,
      source_table: "mysql_feed",
    };
  }

  const [rows] = await pool.promise().query(
    `SELECT
       device_log_id,
       employee_code,
       employee_name,
       user_id,
       portal_user_name,
       DATE_FORMAT(punch_at, '%Y-%m-%d %H:%i:%s') AS punch_at,
       DATE_FORMAT(punch_date, '%Y-%m-%d') AS punch_date,
       direction,
       device_id,
       source_table
     FROM biometric_live_punch_feed
     WHERE org_id = ?
       AND device_log_id > ?
     ORDER BY device_log_id ASC
     LIMIT ?`,
    [orgId, cursor, batch],
  );

  const punches = rows.map(mapFeedRow);
  const latestId =
    punches.length > 0
      ? punches[punches.length - 1].device_log_id
      : cursor;

  return {
    punches,
    latest_device_log_id: latestId,
    source_table: "mysql_feed",
  };
}

async function getLatestFeedLogId(orgId) {
  const [rows] = await pool.promise().query(
    `SELECT COALESCE(MAX(device_log_id), 0) AS maxId
     FROM biometric_live_punch_feed
     WHERE org_id = ?`,
    [orgId],
  );
  return Number(rows[0]?.maxId ?? 0);
}

function mapFeedRow(row) {
  return {
    device_log_id: Number(row.device_log_id),
    employee_code: String(row.employee_code ?? "").trim(),
    employee_name: row.employee_name ?? null,
    punch_at: row.punch_at ?? null,
    punch_date: row.punch_date ?? null,
    direction: row.direction ?? "unknown",
    device_id: row.device_id != null ? String(row.device_id) : null,
    user_id: row.user_id != null ? Number(row.user_id) : null,
    portal_user_name: row.portal_user_name ?? null,
  };
}

/** Today's attendance for one employee from MySQL (production fallback). */
export async function fetchMysqlEmployeeToday(orgId, userId, employeeCode) {
  const [attendanceRows] = await pool.promise().query(
    `SELECT
       DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
       DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
       DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out
     FROM attendance
     WHERE org_id = ? AND user_id = ? AND attendance_date = CURDATE()
     LIMIT 1`,
    [orgId, userId],
  );

  if (attendanceRows.length > 0) {
    const row = attendanceRows[0];
    return {
      employee_code: String(employeeCode ?? "").trim(),
      attendance_date: row.attendance_date,
      check_in: row.check_in,
      check_out: row.check_out,
      latest_punch_at: row.check_out || row.check_in,
      latest_punch_direction: row.check_out ? "out" : row.check_in ? "in" : null,
      punch_count: row.check_in && row.check_out ? 2 : row.check_in ? 1 : 0,
      punches: [],
      source: "mysql_attendance",
    };
  }

  const [feedRows] = await pool.promise().query(
    `SELECT
       device_log_id,
       employee_code,
       employee_name,
       DATE_FORMAT(punch_at, '%Y-%m-%d %H:%i:%s') AS punch_at,
       DATE_FORMAT(punch_date, '%Y-%m-%d') AS punch_date,
       direction
     FROM biometric_live_punch_feed
     WHERE org_id = ?
       AND UPPER(employee_code) = UPPER(?)
       AND punch_date = CURDATE()
     ORDER BY device_log_id ASC`,
    [orgId, employeeCode],
  );

  if (!feedRows.length) return null;

  const punches = feedRows.map(mapFeedRow);
  const first = punches[0];
  const last = punches[punches.length - 1];
  const checkIn = punches.find((p) => p.direction === "in")?.punch_at ?? first.punch_at;
  const checkOut = [...punches].reverse().find((p) => p.direction === "out")?.punch_at ?? null;

  return {
    employee_code: String(employeeCode ?? "").trim(),
    employee_name: first.employee_name ?? null,
    attendance_date: first.punch_date,
    check_in: checkIn,
    check_out: checkOut,
    latest_punch_at: last.punch_at,
    latest_punch_direction: last.direction,
    punch_count: punches.length,
    punches,
    source: "mysql_feed",
  };
}
