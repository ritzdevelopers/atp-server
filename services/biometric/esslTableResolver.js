import getMssqlPool from "../../db/connect_mssql.js";
import { parseRawDirection } from "./punchDirection.js";

function getRowValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.toLowerCase() === lower && v != null && v !== "") return v;
    }
  }
  return null;
}

export function formatPunchInIndia(value) {
  if (value == null || value === "") return null;

  let datePart;
  let timePart;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SQL Server datetime has no timezone; mssql driver puts wall-clock in UTC fields.
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    const ss = String(value.getUTCSeconds()).padStart(2, "0");
    datePart = `${y}-${mo}-${d}`;
    timePart = `${hh}:${mm}:${ss}`;
  } else {
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    datePart = `${m[1]}-${m[2]}-${m[3]}`;
    timePart = `${String(m[4]).padStart(2, "0")}:${m[5]}:${String(m[6] ?? "00").padStart(2, "0")}`;
  }

  if (!datePart || !timePart) return null;

  return {
    attendance_date: datePart,
    datetime: `${datePart} ${timePart}`,
    time_part: timePart,
  };
}

export function mapBiometricRow(row, sourceTable) {
  const employeeCode = String(
    getRowValue(
      row,
      "EmployeeCode",
      "EmpCode",
      "UserId",
      "USERID",
      "EnrollNumber",
      "Badgenumber",
    ) ?? "",
  ).trim();

  const punchAt =
    getRowValue(row, "LogDate", "PunchTime", "CheckTime", "CHECKTIME") ??
    getRowValue(row, "InTime", "OutTime");

  const rawDirection = String(
    getRowValue(row, "C1", "Direction", "AttDirection", "PunchState") ?? "",
  );

  const direction = parseRawDirection(rawDirection);

  const rowId = Number(
    getRowValue(
      row,
      "DeviceLogId",
      "AttendanceLogId",
      "Id",
      "ID",
      "CHECKINOUTID",
    ) ?? 0,
  );

  const safeRowId =
    Number.isFinite(rowId) && rowId > 0 ? Math.floor(rowId) : 0;

  const deviceId = String(
    getRowValue(row, "DeviceId", "InDeviceId", "OutDeviceId", "MachineNumber") ??
      "",
  ).trim();

  return {
    source_table: sourceTable,
    source_row_id: safeRowId,
    employee_code: employeeCode,
    punch_at: punchAt,
    direction,
    device_id: deviceId || null,
    raw: row,
  };
}

export function buildPunchFingerprint(mapped) {
  return [
    mapped.source_table,
    mapped.source_row_id,
    mapped.employee_code,
    mapped.direction,
    mapped.punch_at instanceof Date
      ? mapped.punch_at.toISOString()
      : String(mapped.punch_at ?? ""),
  ].join("|");
}

export async function resolveBiometricIdColumn(pool, tableName) {
  const safe = tableName.replace(/]/g, "]]");
  const result = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${safe.replace(/'/g, "''")}'
    ORDER BY ORDINAL_POSITION ASC
  `);

  const columns = result.recordset.map((r) => r.COLUMN_NAME);
  const preferred = [
    "DeviceLogId",
    "AttendanceLogId",
    "Id",
    "ID",
    "CHECKINOUTID",
  ];

  for (const name of preferred) {
    const match = columns.find((c) => c.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }

  const numericTypes = new Set([
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "decimal",
    "numeric",
  ]);
  const numericIdCol = result.recordset.find(
    (r) =>
      numericTypes.has(String(r.DATA_TYPE).toLowerCase()) &&
      /id$/i.test(r.COLUMN_NAME),
  );
  if (numericIdCol) return numericIdCol.COLUMN_NAME;

  return columns[0] ?? "DeviceLogId";
}

function currentMonthSuffix() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return `${month}_${year}`;
}

function previousMonthSuffix() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getMonth() + 1}_${d.getFullYear()}`;
}

export async function resolveBiometricSourceTables() {
  const baseName = process.env.BIOMETRIC_TABLE_NAME || "DeviceLogs";
  const dynamic = String(process.env.BIOMETRIC_DYNAMIC_TABLES || "true") === "true";

  if (!dynamic) return [baseName];

  const pool = await getMssqlPool();
  const likePattern = `${baseName.replace(/'/g, "''")}_%`;

  const result = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME LIKE '${likePattern}'
    ORDER BY TABLE_NAME DESC
  `);

  const monthly = result.recordset.map((r) => r.TABLE_NAME);
  const current = `${baseName}_${currentMonthSuffix()}`;
  const previous = `${baseName}_${previousMonthSuffix()}`;

  const tables = [];
  if (monthly.includes(current)) tables.push(current);
  if (monthly.includes(previous) && !tables.includes(previous)) {
    tables.push(previous);
  }

  for (const name of monthly) {
    if (!tables.includes(name)) tables.push(name);
  }

  if (tables.length === 0) {
    try {
      const probe = await pool
        .request()
        .query(`SELECT TOP 1 1 AS ok FROM [${baseName.replace(/]/g, "]]")}]`);
      if (probe.recordset.length >= 0) tables.push(baseName);
    } catch {
      /* base table may not exist */
    }
  }

  return tables.length > 0 ? tables.slice(0, 3) : [baseName];
}
