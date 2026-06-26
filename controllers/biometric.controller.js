import { pool } from "../db/connect.js";
import { testMssqlConnection } from "../db/connect_mssql.js";
import {
  getBiometricSyncStatus,
  runBiometricSync,
} from "../services/biometric/biometricSyncRunner.js";
import { resolveBiometricSourceTables } from "../services/biometric/esslTableResolver.js";
import { emitAttendanceLiveUpdate } from "../events/attendance.events.js";
import { processBiometricPunch } from "../services/biometric/processBiometricPunch.js";
import { formatPunchInIndia } from "../services/biometric/esslTableResolver.js";
import {
  fetchLivePunches,
  fetchEmployeeTodayFromDevice,
  fetchLatestDeviceLogId,
} from "../services/biometric/fetchLivePunches.js";
import { fetchBiometricManageAttendance } from "../services/biometric/fetchBiometricManageAttendance.js";
import { fetchMysqlManageAttendance } from "../services/biometric/fetchMysqlManageAttendance.js";

/** Auth for on-prem sync agent: Bearer token or legacy webhook secret header. */
function authenticateSyncAgent(req) {
  const expected =
    process.env.BIOMETRIC_SYNC_AGENT_TOKEN ||
    process.env.BIOMETRIC_WEBHOOK_SECRET;
  if (!expected) return true;

  const bearer = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret =
    req.headers["x-biometric-secret"] || req.headers["x-webhook-secret"];

  return bearer === expected || headerSecret === expected;
}

/** Cloud (Render): read MySQL synced by office agent. Office: read SQL directly. */
function shouldUseMysqlForManageAttendance() {
  const source = String(
    process.env.BIOMETRIC_MANAGE_ATTENDANCE_SOURCE || "",
  ).toLowerCase();
  if (source === "mysql") return true;
  if (source === "sql" || source === "mssql") return false;
  return (
    String(process.env.BIOMETRIC_SYNC_ENABLED || "false") !== "true" ||
    String(process.env.BIOMETRIC_RUN_SYNC_IN_APP || "true") !== "true"
  );
}

async function enrichPunchesWithPortalUsers(orgId, punches) {
  if (!punches?.length) return punches ?? [];

  const [rows] = await pool.promise().query(
    `SELECT m.biometric_employee_code, m.user_id, m.employee_name,
            u.user_name, u.user_email
     FROM biometric_employee_mappings m
     LEFT JOIN apt_users u ON u.id = m.user_id
     WHERE m.org_id = ?`,
    [orgId],
  );

  const byCode = new Map(
    rows.map((r) => [String(r.biometric_employee_code).toUpperCase(), r]),
  );

  return punches.map((p) => {
    const m = byCode.get(String(p.employee_code).toUpperCase());
    return {
      ...p,
      user_id: m?.user_id ?? null,
      portal_user_name: m?.user_name ?? null,
      user_email: m?.user_email ?? null,
      event_type: p.direction === "out" ? "check_out" : "check_in",
      source: "biometric_device",
    };
  });
}

/**
 * GET /api/biometric/live-punches?org_id=1&since_id=0&limit=50
 * Real-time punches straight from the biometric SQL Server.
 */
export const getLivePunchesController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const sinceId = Number(req.query.since_id ?? 0) || 0;
    const limit = Number(req.query.limit ?? 50) || 50;

    const { punches, latest_device_log_id, source_table } =
      await fetchLivePunches({ sinceId, limit });

    const enriched = await enrichPunchesWithPortalUsers(orgId, punches);

    return res.status(200).json({
      success: true,
      org_id: orgId,
      since_id: sinceId,
      latest_device_log_id,
      source_table,
      count: enriched.length,
      data: enriched,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getLivePunchesController:", error);
    return res.status(500).json({
      message: error.message || "Could not fetch live punches",
    });
  }
};

/**
 * GET /api/biometric/my-live-attendance?org_id=1
 * Logged-in user's today check-in/out directly from the biometric device DB.
 */
export const getMyLiveAttendanceController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    const userId = req.user?.user_id;

    if (!orgId || !userId) {
      return res.status(400).json({ message: "org_id and auth are required" });
    }

    const [mapping] = await pool.promise().query(
      `SELECT biometric_employee_code, employee_name
       FROM biometric_employee_mappings
       WHERE org_id = ? AND user_id = ?
       LIMIT 1`,
      [orgId, userId],
    );

    if (!mapping.length) {
      return res.status(200).json({
        success: true,
        mapped: false,
        message: "No biometric device code linked to your account",
        data: null,
      });
    }

    const code = mapping[0].biometric_employee_code;

    const [shiftRow] = await pool.promise().query(
      `SELECT s.end_time
       FROM user_shifts us
       INNER JOIN shifts s ON s.id = us.shift_id
       WHERE us.user_id = ? AND us.org_id = ?
       LIMIT 1`,
      [userId, orgId],
    );
    const shiftEndTime = shiftRow[0]?.end_time ?? null;

    const device = await fetchEmployeeTodayFromDevice(code, { shiftEndTime });

    return res.status(200).json({
      success: true,
      mapped: true,
      user_id: userId,
      org_id: orgId,
      biometric_employee_code: code,
      data: device,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getMyLiveAttendanceController:", error);
    return res.status(500).json({
      message: error.message || "Could not fetch live attendance",
    });
  }
};

/**
 * GET /api/biometric/live-cursor
 * Latest DeviceLogId — use as since_id for polling.
 */
export const getLiveCursorController = async (_req, res) => {
  try {
    const latest_device_log_id = await fetchLatestDeviceLogId();
    return res.status(200).json({
      success: true,
      latest_device_log_id,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getLiveCursorController:", error);
    return res.status(500).json({ message: "Could not read device cursor" });
  }
};


function resolveOrgId(req) {
  const raw = req.query?.org_id ?? req.body?.org_id ?? req.org_id;
  const orgId = Number(raw);
  return Number.isFinite(orgId) ? orgId : null;
}

export const getBiometricStatusController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    let sqlConnected = false;
    let sourceTables = [];

    try {
      sqlConnected = await testMssqlConnection();
      sourceTables = await resolveBiometricSourceTables();
    } catch (err) {
      console.error("[biometric] status SQL check failed:", err.message);
    }

    let mappingCount = 0;
    let lastSync = null;

    if (orgId) {
      const [mapRows] = await pool.promise().query(
        `SELECT COUNT(*) AS cnt FROM biometric_employee_mappings WHERE org_id = ?`,
        [orgId],
      );
      mappingCount = Number(mapRows[0]?.cnt ?? 0);

      const [syncRows] = await pool.promise().query(
        `SELECT * FROM biometric_sync_logs ORDER BY id DESC LIMIT 1`,
      );
      lastSync = syncRows[0] ?? null;
    }

    return res.status(200).json({
      success: true,
      ...getBiometricSyncStatus(),
      sql_connected: sqlConnected,
      source_tables: sourceTables,
      mapping_count: mappingCount,
      last_sync: lastSync,
      org_id: orgId,
    });
  } catch (error) {
    console.error("getBiometricStatusController:", error);
    return res.status(500).json({ message: "Could not load biometric status" });
  }
};

export const listBiometricMappingsController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const [rows] = await pool.promise().query(
      `SELECT
         m.id,
         m.biometric_employee_code,
         m.user_id,
         m.employee_name,
         u.user_name,
         u.user_email
       FROM biometric_employee_mappings m
       INNER JOIN apt_users u ON u.id = m.user_id
       WHERE m.org_id = ?
       ORDER BY m.biometric_employee_code ASC`,
      [orgId],
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("listBiometricMappingsController:", error);
    return res.status(500).json({ message: "Could not load biometric mappings" });
  }
};

export const saveBiometricMappingController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    const { biometric_employee_code, user_id, employee_name } = req.body;

    if (!orgId || !biometric_employee_code || !user_id) {
      return res.status(400).json({
        message: "org_id, biometric_employee_code and user_id are required",
      });
    }

    const code = String(biometric_employee_code).trim();
    const portalUserId = Number(user_id);

    const [member] = await pool.promise().query(
      `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?`,
      [portalUserId, orgId],
    );
    if (member.length === 0) {
      return res.status(400).json({ message: "User is not a member of this organization" });
    }

    await pool.promise().query(
      `INSERT INTO biometric_employee_mappings
       (org_id, biometric_employee_code, user_id, employee_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         employee_name = VALUES(employee_name),
         updated_at = CURRENT_TIMESTAMP`,
      [orgId, code, portalUserId, employee_name ?? null],
    );

    return res.status(200).json({ success: true, message: "Mapping saved" });
  } catch (error) {
    console.error("saveBiometricMappingController:", error);
    return res.status(500).json({ message: "Could not save mapping" });
  }
};

export const deleteBiometricMappingController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    const mappingId = Number(req.params.id);

    if (!orgId || !mappingId) {
      return res.status(400).json({ message: "org_id and mapping id are required" });
    }

    const [result] = await pool.promise().query(
      `DELETE FROM biometric_employee_mappings WHERE id = ? AND org_id = ?`,
      [mappingId, orgId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Mapping not found" });
    }

    return res.status(200).json({ success: true, message: "Mapping deleted" });
  } catch (error) {
    console.error("deleteBiometricMappingController:", error);
    return res.status(500).json({ message: "Could not delete mapping" });
  }
};

export const syncBiometricNowController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    const result = await runBiometricSync(orgId);
    return res.status(200).json(result);
  } catch (error) {
    console.error("syncBiometricNowController:", error);
    return res.status(500).json({ message: error.message || "Sync failed" });
  }
};

export const biometricWebhookController = async (req, res) => {
  try {
    if (!authenticateSyncAgent(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const {
      biometric_employee_code,
      employee_code,
      direction,
      punch_at,
      device_id,
    } = req.body;

    const code = String(biometric_employee_code || employee_code || "").trim();
    if (!code || !punch_at) {
      return res.status(400).json({
        message: "biometric_employee_code and punch_at are required",
      });
    }

    const clock = formatPunchInIndia(punch_at);
    if (!clock) {
      return res.status(400).json({ message: "Invalid punch_at" });
    }

    const connection = await pool.promise().getConnection();
    try {
      await connection.beginTransaction();
      const outcome = await processBiometricPunch(connection, orgId, {
        source_table: "webhook",
        source_row_id: Date.now(),
        employee_code: code,
        punch_at,
        direction: direction ?? "unknown",
        device_id: device_id ?? null,
      });
      await connection.commit();

      if (outcome.event) {
        outcome.event.source = "webhook";
        emitAttendanceLiveUpdate(outcome.event);
      }

      return res.status(200).json({ success: true, ...outcome });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("biometricWebhookController:", error);
    return res.status(500).json({ message: error.message || "Webhook failed" });
  }
};

/**
 * POST /api/biometric/webhook/batch
 * Batch upload from on-prem Attendance Sync Agent (max 500 records).
 */
export const biometricWebhookBatchController = async (req, res) => {
  try {
    if (!authenticateSyncAgent(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const records = req.body?.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: "records array is required" });
    }
    if (records.length > 500) {
      return res.status(400).json({
        message: "Maximum 500 records per batch",
      });
    }

    const connection = await pool.promise().getConnection();
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    try {
      for (const rec of records) {
        const code = String(
          rec.biometric_employee_code || rec.employee_code || "",
        ).trim();
        const punchAt = rec.punch_at;

        if (!code || !punchAt) {
          skipped += 1;
          continue;
        }

        const clock = formatPunchInIndia(punchAt);
        if (!clock) {
          skipped += 1;
          continue;
        }

        const sourceTable = String(rec.source_table || "sync_agent").trim();
        const sourceRowId = Number(rec.source_row_id) || 0;

        if (sourceRowId > 0) {
          const [existing] = await connection.query(
            `SELECT id FROM biometric_processed_punches
             WHERE org_id = ? AND source_table = ? AND source_row_id = ?
             LIMIT 1`,
            [orgId, sourceTable, sourceRowId],
          );
          if (existing.length > 0) {
            skipped += 1;
            continue;
          }
        }

        try {
          await connection.beginTransaction();
          const outcome = await processBiometricPunch(connection, orgId, {
            source_table: sourceTable,
            source_row_id: sourceRowId > 0 ? sourceRowId : Date.now(),
            employee_code: code,
            punch_at: punchAt,
            direction: rec.direction ?? "unknown",
            device_id: rec.device_id ?? null,
          });

          if (sourceRowId > 0) {
            await connection.query(
              `INSERT IGNORE INTO biometric_processed_punches
               (org_id, source_table, source_row_id, punch_fingerprint)
               VALUES (?, ?, ?, ?)`,
              [
                orgId,
                sourceTable,
                sourceRowId,
                `${sourceTable}|${sourceRowId}|${code}`,
              ],
            );
          }

          await connection.commit();

          if (outcome.skipped) {
            skipped += 1;
          } else {
            imported += 1;
            if (outcome.event) {
              outcome.event.source = "sync_agent";
              emitAttendanceLiveUpdate(outcome.event);
            }
          }
        } catch (err) {
          await connection.rollback();
          failed += 1;
          errors.push({
            biometric_employee_code: code,
            source_row_id: sourceRowId,
            message: err.message,
          });
        }
      }
    } finally {
      connection.release();
    }

    return res.status(200).json({
      success: true,
      org_id: orgId,
      received: records.length,
      imported,
      skipped,
      failed,
      errors: errors.length ? errors.slice(0, 20) : undefined,
    });
  } catch (error) {
    console.error("biometricWebhookBatchController:", error);
    return res.status(500).json({
      message: error.message || "Batch webhook failed",
    });
  }
};

/**
 * GET /api/biometric/manage-attendance?org_id=1&date=2026-06-25
 * Employee list from biometric SQL Server with portal user_id mapping.
 */
export const getBiometricManageAttendanceController = async (req, res) => {
  try {
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const dateParam = String(req.query.date || "").trim();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);
    const [selectedYear, selectedMonth] = selectedDate.split("-").map(Number);
    const statusFilter = String(req.query.status || "").trim().toLowerCase();

    const useMysql = shouldUseMysqlForManageAttendance();
    const result = useMysql
      ? await fetchMysqlManageAttendance(
          orgId,
          selectedDate,
          selectedMonth,
          selectedYear,
        )
      : await fetchBiometricManageAttendance(
          orgId,
          selectedDate,
          selectedMonth,
          selectedYear,
        );

    let employees = result.employees_attendance_data;
    if (statusFilter) {
      employees = employees.filter(
        (row) =>
          String(row.employee_attendance_status || "")
            .trim()
            .toLowerCase() === statusFilter,
      );
    }

    return res.status(200).json({
      success: true,
      source: useMysql ? "mysql" : "biometric",
      selected_date: result.selected_date,
      header_data: result.header_data,
      employees_attendance_data: employees,
    });
  } catch (error) {
    console.error("getBiometricManageAttendanceController:", error);

    if (!shouldUseMysqlForManageAttendance()) {
      try {
        const orgId = resolveOrgId(req);
        const dateParam = String(req.query.date || "").trim();
        const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
          ? dateParam
          : new Date().toISOString().slice(0, 10);
        const [selectedYear, selectedMonth] = selectedDate.split("-").map(Number);
        const statusFilter = String(req.query.status || "").trim().toLowerCase();
        const result = await fetchMysqlManageAttendance(
          orgId,
          selectedDate,
          selectedMonth,
          selectedYear,
        );
        let employees = result.employees_attendance_data;
        if (statusFilter) {
          employees = employees.filter(
            (row) =>
              String(row.employee_attendance_status || "")
                .trim()
                .toLowerCase() === statusFilter,
          );
        }
        return res.status(200).json({
          success: true,
          source: "mysql",
          selected_date: result.selected_date,
          header_data: result.header_data,
          employees_attendance_data: employees,
        });
      } catch (fallbackErr) {
        console.error("manage-attendance mysql fallback failed:", fallbackErr);
      }
    }

    return res.status(500).json({
      message: error.message || "Could not load biometric manage attendance",
    });
  }
};
