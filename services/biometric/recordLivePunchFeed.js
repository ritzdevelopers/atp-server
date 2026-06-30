import { pool } from "../../db/connect.js";
import { parseRawDirection } from "./punchDirection.js";

/**
 * Persist a machine punch for the production live feed (MySQL).
 * Called when the on-prem sync agent pushes punches via webhook.
 */
export async function recordLivePunchFeed(
  connection,
  orgId,
  {
    source_table,
    source_row_id,
    employee_code,
    punch_at,
    punch_date,
    direction,
    device_id,
    employee_name,
    user_id,
    portal_user_name,
  },
) {
  const deviceLogId = Number(source_row_id) || 0;
  if (!deviceLogId || !employee_code || !punch_at) return;

  const conn = connection ?? (await pool.promise().getConnection());
  const release = !connection;

  try {
    await conn.query(
      `INSERT IGNORE INTO biometric_live_punch_feed
       (org_id, device_log_id, source_table, employee_code, employee_name,
        user_id, portal_user_name, punch_at, punch_date, direction, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orgId,
        deviceLogId,
        String(source_table || "sync_agent").trim(),
        String(employee_code).trim(),
        employee_name ?? null,
        user_id ?? null,
        portal_user_name ?? null,
        punch_at,
        punch_date,
        parseRawDirection(direction),
        device_id ?? null,
      ],
    );
  } finally {
    if (release) conn.release();
  }
}
