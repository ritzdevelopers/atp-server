import { biometricDB } from "../../config/essl.config.js";
import { pool } from "../../db/connect.js";
import { formatPunchInIndia } from "../biometric/esslTableResolver.js";
import { wallTimeToMinutesSinceMidnight } from "../biometric/punchDirection.js";
import {
  fetchAttendanceAllFromLocalBridge,
  isLocalBridgeMode,
} from "../biometric/localBiometricBridge.js";

const DEFAULT_ORG_ID = Number(process.env.BIOMETRIC_DEFAULT_ORG_ID || 1);

const ATTENDANCE_RULES = {
  LATE_AFTER: wallTimeToMinutesSinceMidnight("09:45:00"),
  HALF_DAY_CHECKIN_AFTER: wallTimeToMinutesSinceMidnight("10:30:00"),
  HALF_DAY_CHECKOUT_UNTIL: wallTimeToMinutesSinceMidnight("17:29:00"),
  SHORT_LEAVE_FROM: wallTimeToMinutesSinceMidnight("17:30:00"),
  SHORT_LEAVE_UNTIL: wallTimeToMinutesSinceMidnight("18:15:00"),
  FULL_DAY_CHECKOUT_AFTER: wallTimeToMinutesSinceMidnight("18:20:00"),
  MIN_FULL_DAY_MINUTES: 8 * 60,
};

const STATUS_PRIORITY = {
  absent: 0,
  present: 1,
  late: 2,
  short_leave: 3,
  half_day: 4,
};

function getPunchDate(row) {
  return row.PunchDate ?? row.PUNCHDATE ?? row.punch_date ?? null;
}

function pickStrongerStatus(current, next) {
  const currentRank = STATUS_PRIORITY[current] ?? 0;
  const nextRank = STATUS_PRIORITY[next] ?? 0;
  return nextRank >= currentRank ? next : current;
}

function deriveCheckInStatus(checkInMinutes) {
  if (
    Number.isFinite(checkInMinutes) &&
    checkInMinutes > ATTENDANCE_RULES.HALF_DAY_CHECKIN_AFTER
  ) {
    return "half_day";
  }
  if (
    Number.isFinite(checkInMinutes) &&
    checkInMinutes > ATTENDANCE_RULES.LATE_AFTER
  ) {
    return "late";
  }
  return "present";
}

function deriveFinalAttendanceStatus(checkInMinutes, checkOutMinutes, workingMinutes) {
  let status = deriveCheckInStatus(checkInMinutes);

  if (!Number.isFinite(checkOutMinutes)) {
    return status;
  }

  if (checkOutMinutes <= ATTENDANCE_RULES.HALF_DAY_CHECKOUT_UNTIL) {
    status = pickStrongerStatus(status, "half_day");
  } else if (
    checkOutMinutes >= ATTENDANCE_RULES.SHORT_LEAVE_FROM &&
    checkOutMinutes <= ATTENDANCE_RULES.SHORT_LEAVE_UNTIL
  ) {
    status = pickStrongerStatus(status, "short_leave");
  } else if (checkOutMinutes >= ATTENDANCE_RULES.FULL_DAY_CHECKOUT_AFTER) {
    if (
      Number.isFinite(workingMinutes) &&
      workingMinutes >= ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES
    ) {
      status = status === "late" ? "late" : "present";
    }
  }

  if (
    Number.isFinite(workingMinutes) &&
    workingMinutes < ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES
  ) {
    status = pickStrongerStatus(status, "half_day");
  }

  return status;
}

export function groupAttendanceByEmpCode(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const emp_code = String(row.EMP_CODE ?? row.emp_code ?? "").trim();
    const punchDate = getPunchDate(row);

    if (!emp_code || punchDate == null) continue;

    const existing = grouped.get(emp_code.toUpperCase());
    if (existing) {
      existing.attendance_log.push(punchDate);
    } else {
      grouped.set(emp_code.toUpperCase(), {
        emp_code,
        attendance_log: [punchDate],
      });
    }
  }

  return [...grouped.values()].map((item) => ({
    emp_code: item.emp_code,
    attendance_log: item.attendance_log.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    ),
  }));
}

/** Group punches by employee code and calendar day (for full history import). */
export function groupAttendanceByEmpCodeAndDate(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const emp_code = String(row.EMP_CODE ?? row.emp_code ?? "").trim();
    const rawPunch = getPunchDate(row);
    if (!emp_code || rawPunch == null) continue;

    const punch = formatPunchInIndia(rawPunch);
    if (!punch?.attendance_date) continue;

    const key = `${emp_code.toUpperCase()}|${punch.attendance_date}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.attendance_log.push(rawPunch);
    } else {
      grouped.set(key, {
        emp_code,
        attendance_date: punch.attendance_date,
        attendance_log: [rawPunch],
      });
    }
  }

  return [...grouped.values()].map((item) => ({
    emp_code: item.emp_code,
    attendance_date: item.attendance_date,
    attendance_log: item.attendance_log.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    ),
  }));
}

async function getUserIdByEmpCode(connection, emp_code, org_id) {
  const [rows] = await connection.query(
    `SELECT user_id
     FROM apt_org_members
     WHERE UPPER(emp_code) = UPPER(?) AND org_id = ?
     LIMIT 1`,
    [emp_code, org_id],
  );
  return rows[0]?.user_id ?? null;
}

async function getEmployeeProfile(connection, user_id, org_id) {
  const [rows] = await connection.query(
    `SELECT
       u.user_name,
       u.user_email,
       COALESCE(r.role_name, 'employee') AS user_role_name
     FROM apt_users u
     LEFT JOIN apt_user_roles ur
       ON ur.user_id = u.id AND ur.org_id = ?
     LEFT JOIN apt_roles r
       ON r.id = ur.role_id AND r.org_id = ?
     WHERE u.id = ?
     LIMIT 1`,
    [org_id, org_id, user_id],
  );
  return rows[0] ?? null;
}

async function insertAttendanceLog(connection, user_id, org_id, action_type, timestamp) {
  await connection.query(
    `INSERT INTO attendance_logs (user_id, action_type, timestamp_time, org_id)
     VALUES (?, ?, ?, ?)`,
    [user_id, action_type, timestamp, org_id],
  );
}

export async function updateAttendanceFromPunches(
  user_id,
  org_id,
  attendance_logs,
  externalConnection = null,
) {
  if (!attendance_logs?.length) return { skipped: true, reason: "no_punches" };

  const punches = attendance_logs
    .map((punch) => formatPunchInIndia(punch))
    .filter(Boolean);

  if (!punches.length) return { skipped: true, reason: "invalid_punches" };

  const firstPunch = punches[0];
  const lastPunch = punches[punches.length - 1];
  const attendance_date = firstPunch.attendance_date;
  const check_in = firstPunch.datetime;
  const check_out = punches.length > 1 ? lastPunch.datetime : null;

  const checkInMinutes = wallTimeToMinutesSinceMidnight(firstPunch.time_part);
  const checkOutMinutes = check_out
    ? wallTimeToMinutesSinceMidnight(lastPunch.time_part)
    : NaN;
  const workingMinutes =
    check_out && Number.isFinite(checkInMinutes) && Number.isFinite(checkOutMinutes)
      ? Math.max(0, Math.round(checkOutMinutes - checkInMinutes))
      : null;

  const attendance_status = deriveFinalAttendanceStatus(
    checkInMinutes,
    checkOutMinutes,
    workingMinutes,
  );

  const ownsConnection = !externalConnection;
  const connection = externalConnection ?? (await pool.promise().getConnection());

  if (ownsConnection) {
    await connection.beginTransaction();
  }

  try {
    const profile = await getEmployeeProfile(connection, user_id, org_id);
    if (!profile) {
      if (ownsConnection) await connection.rollback();
      return { skipped: true, reason: "profile_not_found" };
    }

    const { user_name, user_email, user_role_name } = profile;

    const [existingRows] = await connection.query(
      `SELECT
         id,
         DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
         DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
         attendance_status
       FROM attendance
       WHERE user_id = ? AND org_id = ? AND attendance_date = ?
       LIMIT 1`,
      [user_id, org_id, attendance_date],
    );

    if (attendance_logs.length === 1) {
      if (existingRows.length > 0) {
        if (ownsConnection) await connection.commit();
        return { skipped: true, reason: "already_exists", attendance_date };
      }

      await connection.query(
        `INSERT INTO attendance
         (user_id, user_name, user_email, user_role_name, org_id, attendance_date, check_in, attendance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          user_name,
          user_email,
          user_role_name,
          org_id,
          attendance_date,
          check_in,
          attendance_status,
        ],
      );

      await insertAttendanceLog(connection, user_id, org_id, "check_in", check_in);
      if (ownsConnection) await connection.commit();
      return { synced: true, action: "insert_check_in", attendance_date };
    }

    if (existingRows.length === 0) {
      await connection.query(
        `INSERT INTO attendance
         (user_id, user_name, user_email, user_role_name, org_id, attendance_date, check_in, check_out, attendance_status, working_time, working_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          user_name,
          user_email,
          user_role_name,
          org_id,
          attendance_date,
          check_in,
          check_out,
          attendance_status,
          workingMinutes,
          workingMinutes != null ? (workingMinutes / 60).toFixed(2) : 0,
        ],
      );

      await insertAttendanceLog(connection, user_id, org_id, "check_in", check_in);
      await insertAttendanceLog(connection, user_id, org_id, "check_out", check_out);
      if (ownsConnection) await connection.commit();
      return { synced: true, action: "insert_full_day", attendance_date };
    }

    const existing = existingRows[0];
    const existingCheckOut = existing.check_out;

    if (existingCheckOut && existingCheckOut === check_out) {
      if (ownsConnection) await connection.commit();
      return { skipped: true, reason: "unchanged", attendance_date };
    }

    await connection.query(
      `UPDATE attendance
       SET
         check_out = ?,
         attendance_status = ?,
         working_time = ?,
         working_hours = ?
       WHERE id = ?`,
      [
        check_out,
        attendance_status,
        workingMinutes,
        workingMinutes != null ? (workingMinutes / 60).toFixed(2) : 0,
        existing.id,
      ],
    );

    if (existingCheckOut) {
      await insertAttendanceLog(
        connection,
        user_id,
        org_id,
        "manual_update",
        check_out,
      );
    } else {
      await insertAttendanceLog(connection, user_id, org_id, "check_out", check_out);
    }

    if (ownsConnection) await connection.commit();
    return { synced: true, action: "update_check_out", attendance_date };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function fetchAttendanceAllRows({ punchDate, fromDate, toDate } = {}) {
  if (isLocalBridgeMode()) {
    return fetchAttendanceAllFromLocalBridge({ punchDate, fromDate, toDate });
  }

  const mssqlPool = await biometricDB();

  if (punchDate) {
    const result = await mssqlPool.request().input("punchDate", punchDate).query(`
      SELECT *
      FROM AttendanceAll
      WHERE CAST(PunchDate AS DATE) = @punchDate
      ORDER BY PunchDate ASC
    `);
    return result.recordset ?? [];
  }

  if (fromDate && toDate) {
    const result = await mssqlPool
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

  const result = await mssqlPool.request().query(`
    SELECT *
    FROM AttendanceAll
    ORDER BY PunchDate ASC
  `);
  return result.recordset ?? [];
}

export async function syncFormattedAttendance(
  org_id,
  formattedItems,
  { connection: externalConnection = null } = {},
) {
  const stats = {
    total_groups: formattedItems.length,
    synced: 0,
    skipped_unmapped: 0,
    skipped_unchanged: 0,
    failed: 0,
    unmapped_codes: [],
    errors: [],
  };

  const ownsConnection = !externalConnection;
  const connection =
    externalConnection ?? (await pool.promise().getConnection());
  const userCache = new Map();

  try {
    for (const item of formattedItems) {
      const cacheKey = `${org_id}|${item.emp_code.toUpperCase()}`;
      let user_id = userCache.get(cacheKey);

      if (user_id === undefined) {
        user_id = await getUserIdByEmpCode(connection, item.emp_code, org_id);
        userCache.set(cacheKey, user_id);
      }

      if (!user_id) {
        stats.skipped_unmapped += 1;
        if (!stats.unmapped_codes.includes(item.emp_code)) {
          stats.unmapped_codes.push(item.emp_code);
        }
        continue;
      }

      if (externalConnection) {
        const result = await updateAttendanceFromPunches(
          user_id,
          org_id,
          item.attendance_log,
          connection,
        );
        if (result?.synced) {
          stats.synced += 1;
        } else if (
          result?.reason === "unchanged" ||
          result?.reason === "already_exists"
        ) {
          stats.skipped_unchanged += 1;
        }
        continue;
      }

      try {
        const result = await updateAttendanceFromPunches(
          user_id,
          org_id,
          item.attendance_log,
        );
        if (result?.synced) {
          stats.synced += 1;
        } else if (
          result?.reason === "unchanged" ||
          result?.reason === "already_exists"
        ) {
          stats.skipped_unchanged += 1;
        }
      } catch (error) {
        stats.failed += 1;
        stats.errors.push({
          emp_code: item.emp_code,
          attendance_date: item.attendance_date ?? null,
          message: error.message,
        });
      }
    }
  } finally {
    if (ownsConnection) connection.release();
  }

  return stats;
}

export async function syncTodayAttendance(org_id = DEFAULT_ORG_ID) {
  const today = new Date().toISOString().split("T")[0];
  const rows = await fetchAttendanceAllRows({ punchDate: today });
  const formatted = groupAttendanceByEmpCode(rows);

  const connection = await pool.promise().getConnection();
  try {
    const stats = await syncFormattedAttendance(org_id, formatted, { connection });
    return {
      mode: "today",
      punch_date: today,
      total_essl_rows: rows.length,
      ...stats,
    };
  } finally {
    connection.release();
  }
}

export async function syncAllAttendanceHistory(
  org_id = DEFAULT_ORG_ID,
  { fromDate, toDate, connection = null } = {},
) {
  const rows = await fetchAttendanceAllRows({ fromDate, toDate });
  const formatted = groupAttendanceByEmpCodeAndDate(rows);
  const stats = await syncFormattedAttendance(org_id, formatted, { connection });

  return {
    mode: "full",
    from_date: fromDate ?? null,
    to_date: toDate ?? null,
    total_essl_rows: rows.length,
    ...stats,
  };
}

export { DEFAULT_ORG_ID };
