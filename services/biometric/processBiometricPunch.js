import { markAttendanceLogController } from "../../helper/mark_attendance_logs.js";
import { formatPunchInIndia } from "./esslTableResolver.js";
import {
  isAtOrAfterCheckoutThreshold,
  resolvePunchDirection,
  timeToMinutes,
  wallTimeToMinutesSinceMidnight,
} from "./punchDirection.js";

async function resolvePortalUser(connection, orgId, employeeCode) {
  const [rows] = await connection.query(
    `SELECT m.user_id, m.employee_name, u.user_name, u.user_email
     FROM biometric_employee_mappings m
     INNER JOIN apt_users u ON u.id = m.user_id
     WHERE m.org_id = ? AND UPPER(m.biometric_employee_code) = UPPER(?)
     LIMIT 1`,
    [orgId, employeeCode],
  );
  return rows[0] ?? null;
}

async function resolveUserRole(connection, userId, orgId) {
  const [rows] = await connection.query(
    `SELECT r.role_name
     FROM apt_user_roles ur
     INNER JOIN apt_roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
     WHERE ur.user_id = ? AND ur.org_id = ?
     LIMIT 1`,
    [userId, orgId],
  );
  return rows[0]?.role_name ?? "employee";
}

async function getShiftForUser(connection, userId, orgId) {
  const [shiftRow] = await connection.query(
    `SELECT s.start_time, s.end_time, s.late_after, s.half_day_hours, s.short_leave_hours
     FROM user_shifts us
     INNER JOIN shifts s ON s.id = us.shift_id
     WHERE us.user_id = ? AND us.org_id = ?
     LIMIT 1`,
    [userId, orgId],
  );
  return shiftRow[0] ?? null;
}

async function getTodayAttendance(connection, userId, orgId, attendanceDate) {
  const [rows] = await connection.query(
    `SELECT
       id,
       DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
       DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
       attendance_status
     FROM attendance
     WHERE user_id = ? AND org_id = ? AND attendance_date = ?
     LIMIT 1`,
    [userId, orgId, attendanceDate],
  );
  return rows[0] ?? null;
}

export async function processBiometricPunch(connection, orgId, mapped) {
  const employeeCode = mapped.employee_code;
  if (!employeeCode) {
    return { ok: false, skipped: true, reason: "missing_employee_code" };
  }

  const portalUser = await resolvePortalUser(connection, orgId, employeeCode);
  if (!portalUser) {
    return { ok: false, skipped: true, reason: "unmapped_employee", employeeCode };
  }

  const clock = formatPunchInIndia(mapped.punch_at);
  if (!clock) {
    return { ok: false, skipped: true, reason: "invalid_punch_time" };
  }

  const userId = portalUser.user_id;
  const userName = portalUser.user_name;
  const userEmail = portalUser.user_email;
  const userRole = await resolveUserRole(connection, userId, orgId);
  const shift = await getShiftForUser(connection, userId, orgId);

  const existing = await getTodayAttendance(
    connection,
    userId,
    orgId,
    clock.attendance_date,
  );

  const direction = resolvePunchDirection({
    rawDirection: mapped.direction,
    punchTimePart: clock.time_part,
    hasCheckIn: !!existing?.check_in,
    hasCheckOut: !!existing?.check_out,
    shiftEndTime: shift?.end_time,
  });

  let eventType;
  let attendanceId = existing?.id ?? null;
  let checkIn = existing?.check_in ?? null;
  let checkOut = existing?.check_out ?? null;
  let attendanceStatus = existing?.attendance_status ?? null;

  if (direction === "in") {
    if (existing?.check_in) {
      eventType = "duplicate_check_in";
      return {
        ok: true,
        skipped: false,
        duplicate: true,
        event: buildEventPayload({
          orgId,
          eventType,
          attendanceId,
          userId,
          userName,
          userEmail,
          employeeCode,
          portalUser,
          mapped,
          clock,
          checkIn,
          checkOut,
          attendanceStatus,
        }),
      };
    }

    let status = "present";
    if (shift?.late_after) {
      const currentMinutes = wallTimeToMinutesSinceMidnight(clock.time_part);
      const lateMinutes = wallTimeToMinutesSinceMidnight(shift.late_after);
      if (
        Number.isFinite(currentMinutes) &&
        Number.isFinite(lateMinutes) &&
        currentMinutes > lateMinutes
      ) {
        status = "late";
      }
    }

    const [insertResult] = await connection.query(
      `INSERT INTO attendance
       (user_id, user_name, user_email, user_role_name, org_id, attendance_date, check_in, attendance_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        userName,
        userEmail,
        userRole,
        orgId,
        clock.attendance_date,
        clock.datetime,
        status,
      ],
    );

    attendanceId = insertResult.insertId;
    checkIn = clock.datetime;
    attendanceStatus = status;
    eventType = "check_in";

    await markAttendanceLogController(
      connection,
      userId,
      orgId,
      attendanceId,
      "biometric",
    );
  } else {
    if (!existing?.check_in) {
      return { ok: false, skipped: true, reason: "checkout_without_checkin" };
    }

    if (existing.check_out) {
      const existingOutMin = wallTimeToMinutesSinceMidnight(existing.check_out);
      const newOutMin = wallTimeToMinutesSinceMidnight(clock.time_part);
      const isLaterCheckout =
        Number.isFinite(existingOutMin) &&
        Number.isFinite(newOutMin) &&
        newOutMin > existingOutMin &&
        isAtOrAfterCheckoutThreshold(clock.time_part, shift?.end_time);

      if (!isLaterCheckout) {
        eventType = "duplicate_check_out";
        return {
          ok: true,
          skipped: false,
          duplicate: true,
          event: buildEventPayload({
            orgId,
            eventType,
            attendanceId: existing.id,
            userId,
            userName,
            userEmail,
            employeeCode,
            portalUser,
            mapped,
            clock,
            checkIn: existing.check_in,
            checkOut: existing.check_out,
            attendanceStatus: existing.attendance_status,
          }),
        };
      }
    }

    const currentMinutes = wallTimeToMinutesSinceMidnight(clock.time_part);
    const checkInMinutes = wallTimeToMinutesSinceMidnight(existing.check_in);

    let userWorkingMinutes = Math.round(currentMinutes - checkInMinutes);
    if (userWorkingMinutes < 0) userWorkingMinutes = 0;

    let finalStatus = existing.attendance_status;

    if (shift) {
      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);
      const realWorkingMinutes = shiftEnd - shiftStart;
      const halfDayMinutes = timeToMinutes(shift.half_day_hours);
      const shortLeaveMinutes = timeToMinutes(shift.short_leave_hours);

      let workStatus = "absent";
      if (userWorkingMinutes >= realWorkingMinutes) workStatus = "full_day";
      else if (userWorkingMinutes >= shortLeaveMinutes) workStatus = "short_leave";
      else if (userWorkingMinutes >= halfDayMinutes) workStatus = "half_day";

      finalStatus = `${existing.attendance_status}_${workStatus}`;
    }

    await connection.query(
      `UPDATE attendance
       SET attendance_status = ?, check_out = ?, working_time = ?
       WHERE id = ?`,
      [finalStatus, clock.datetime, userWorkingMinutes, existing.id],
    );

    attendanceId = existing.id;
    checkIn = existing.check_in;
    checkOut = clock.datetime;
    attendanceStatus = finalStatus;
    eventType = "check_out";

    await markAttendanceLogController(
      connection,
      userId,
      orgId,
      attendanceId,
      "biometric",
    );
  }

  return {
    ok: true,
    skipped: false,
    duplicate: false,
    event: buildEventPayload({
      orgId,
      eventType,
      attendanceId,
      userId,
      userName,
      userEmail,
      employeeCode,
      portalUser,
      mapped,
      clock,
      checkIn,
      checkOut,
      attendanceStatus,
    }),
  };
}

function buildEventPayload({
  orgId,
  eventType,
  attendanceId,
  userId,
  userName,
  userEmail,
  employeeCode,
  portalUser,
  mapped,
  clock,
  checkIn,
  checkOut,
  attendanceStatus,
}) {
  return {
    org_id: Number(orgId),
    event_type: eventType,
    attendance_id: attendanceId,
    user_id: userId,
    user_name: userName,
    user_email: userEmail,
    biometric_employee_code: employeeCode,
    employee_name: portalUser.employee_name ?? userName,
    device_id: mapped.device_id,
    attendance_date: clock.attendance_date,
    check_in: checkIn,
    check_out: checkOut,
    attendance_status: attendanceStatus,
    punch_at: clock.datetime,
    source: "biometric",
  };
}
