import getMssqlPool from "../../db/connect_mssql.js";
import {
  formatPunchInIndia,
  resolveBiometricSourceTables,
} from "./esslTableResolver.js";
import {
  deriveDayAttendanceFromPunches,
  parseRawDirection,
} from "./punchDirection.js";

function mapPunchRow(row, sourceTable) {
  const clock = formatPunchInIndia(row.LogDate);
  return {
    device_log_id: Number(row.DeviceLogId),
    source_table: sourceTable,
    employee_code: String(row.UserId ?? "").trim(),
    employee_name: row.EmployeeName ?? null,
    punch_at: clock?.datetime ?? null,
    punch_date: clock?.attendance_date ?? null,
    direction: parseRawDirection(row.C1 ?? row.Direction),
    device_id: row.DeviceId != null ? String(row.DeviceId) : null,
  };
}

async function getCurrentMonthTable() {
  const tables = await resolveBiometricSourceTables();
  return tables[0] ?? "DeviceLogs";
}

async function maxDeviceLogId(table) {
  const pool = await getMssqlPool();
  const safeTable = table.replace(/]/g, "]]");
  const result = await pool.request().query(`
    SELECT MAX(DeviceLogId) AS maxId FROM [${safeTable}]
  `);
  return Number(result.recordset[0]?.maxId ?? 0);
}

/**
 * Live punches from the biometric SQL Server.
 * - sinceId = 0 → today's punches (newest batch)
 * - sinceId > 0 → only new punches after that id (current month table)
 */
export async function fetchLivePunches({ sinceId = 0, limit = 50 } = {}) {
  const pool = await getMssqlPool();
  const table = await getCurrentMonthTable();
  const safeTable = table.replace(/]/g, "]]");
  const batch = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const cursor = Math.max(Number(sinceId) || 0, 0);

  if (cursor === 0) {
    const result = await pool.request().query(`
      SELECT TOP (${batch})
        dl.DeviceLogId,
        dl.UserId,
        dl.LogDate,
        dl.C1,
        dl.DeviceId,
        e.EmployeeName
      FROM [${safeTable}] dl
      LEFT JOIN Employees e ON e.EmployeeCode = dl.UserId
      WHERE CAST(dl.LogDate AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY dl.DeviceLogId DESC
    `);

    const punches = result.recordset
      .map((row) => mapPunchRow(row, table))
      .reverse();

    const latestId =
      punches.length > 0
        ? punches[punches.length - 1].device_log_id
        : await maxDeviceLogId(table);

    return { punches, latest_device_log_id: latestId, source_table: table };
  }

  const result = await pool.request().query(`
    SELECT TOP (${batch})
      dl.DeviceLogId,
      dl.UserId,
      dl.LogDate,
      dl.C1,
      dl.DeviceId,
      e.EmployeeName
    FROM [${safeTable}] dl
    LEFT JOIN Employees e ON e.EmployeeCode = dl.UserId
    WHERE dl.DeviceLogId > ${cursor}
    ORDER BY dl.DeviceLogId ASC
  `);

  const punches = result.recordset.map((row) => mapPunchRow(row, table));
  const latestId =
    punches.length > 0
      ? punches[punches.length - 1].device_log_id
      : cursor;

  return { punches, latest_device_log_id: latestId, source_table: table };
}

/**
 * Today's punches for one biometric employee code.
 * @param {string} employeeCode
 * @param {{ shiftEndTime?: string | null }} [options]
 */
export async function fetchEmployeeTodayFromDevice(
  employeeCode,
  { shiftEndTime = null } = {},
) {
  const code = String(employeeCode ?? "").trim();
  if (!code) return null;

  const pool = await getMssqlPool();
  const table = await getCurrentMonthTable();
  const safeTable = table.replace(/]/g, "]]");
  const safeCode = code.replace(/'/g, "''");

  const result = await pool.request().query(`
    SELECT
      dl.DeviceLogId,
      dl.UserId,
      dl.LogDate,
      dl.C1,
      dl.DeviceId,
      e.EmployeeName
    FROM [${safeTable}] dl
    LEFT JOIN Employees e ON e.EmployeeCode = dl.UserId
    WHERE dl.UserId = '${safeCode}'
      AND CAST(dl.LogDate AS DATE) = CAST(GETDATE() AS DATE)
    ORDER BY dl.LogDate ASC
  `);

  const punches = result.recordset.map((row) => mapPunchRow(row, table));
  const derived = deriveDayAttendanceFromPunches(punches, shiftEndTime);
  const latest = punches.length ? punches[punches.length - 1] : null;

  return {
    employee_code: code,
    employee_name:
      punches[0]?.employee_name ?? latest?.employee_name ?? null,
    attendance_date: punches[0]?.punch_date ?? null,
    check_in: derived.check_in,
    check_out: derived.check_out,
    latest_punch_at: derived.latest_punch_at,
    latest_punch_direction: derived.latest_punch_direction,
    punch_count: derived.punch_count,
    punches,
    latest_device_log_id: latest?.device_log_id ?? null,
  };
}

export async function fetchLatestDeviceLogId() {
  const table = await getCurrentMonthTable();
  return maxDeviceLogId(table);
}
