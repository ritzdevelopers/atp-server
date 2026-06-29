import nodeCron from "node-cron";
import { biometricDB } from "../config/essl.config.js";
import { pool } from "../db/connect.js";
import { formatPunchInIndia } from "../services/biometric/esslTableResolver.js";
import { wallTimeToMinutesSinceMidnight } from "../services/biometric/punchDirection.js";

const ORG_ID = Number(process.env.BIOMETRIC_DEFAULT_ORG_ID || 1);

/** Hardcoded attendance rules (IST wall-clock). */
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

function groupAttendanceByEmpCode(rows) {
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

async function update_attendance_log(user_id, org_id, attendance_logs) {
  if (!attendance_logs?.length) return;

  const punches = attendance_logs
    .map((punch) => formatPunchInIndia(punch))
    .filter(Boolean);

  if (!punches.length) return;

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

  const connection = await pool.promise().getConnection();
  await connection.beginTransaction();

  try {
    const profile = await getEmployeeProfile(connection, user_id, org_id);
    if (!profile) {
      await connection.rollback();
      return;
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
        await connection.commit();
        return;
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
      await connection.commit();
      return;
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
      await connection.commit();
      return;
    }

    const existing = existingRows[0];
    const existingCheckOut = existing.check_out;

    if (existingCheckOut && existingCheckOut === check_out) {
      await connection.commit();
      return;
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

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error(`update_attendance_log failed for user ${user_id}:`, error);
    throw error;
  } finally {
    connection.release();
  }
}

export const syncAgent = () => {
  nodeCron.schedule("* * * * *", async () => {
    try {
      console.log("Syncing biometric data...");

      const mssqlPool = await biometricDB();
      const today = new Date().toISOString().split("T")[0];

      const result = await mssqlPool.request().input("punchDate", today).query(`
        SELECT *
        FROM AttendanceAll
        WHERE CAST(PunchDate AS DATE) = @punchDate
        ORDER BY PunchDate ASC
      `);

      const formatted_attendance_log_info = groupAttendanceByEmpCode(
        result.recordset ?? [],
      );
    //   console.log("formatted_attendance_log_info:", formatted_attendance_log_info);
      const lookupConnection = await pool.promise().getConnection();
      try {
        for (const item of formatted_attendance_log_info) {
          const user_id = await getUserIdByEmpCode(
            lookupConnection,
            item.emp_code,
            ORG_ID,
          );

          if (!user_id) {
            console.warn(`No portal user mapped for emp_code ${item.emp_code}`);
            continue;
          }

          await update_attendance_log(user_id, ORG_ID, item.attendance_log);
        }
      } finally {
        lookupConnection.release();
      }

    //   console.log(
    //     "formatted_attendance_log_info:",
    //     formatted_attendance_log_info.length,
    //     "employees synced",
    //   );
    } catch (error) {
      console.error("syncAgent:", error);
    }
  });
};
