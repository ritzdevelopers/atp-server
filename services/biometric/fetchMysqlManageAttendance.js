import { pool } from "../../db/connect.js";
import {
  countPortalManageAttendanceTotals,
  fetchPortalManageAttendanceMembers,
} from "./portalManageAttendanceMembers.js";

function minutesToHours(minutesValue) {
  if (minutesValue === null || minutesValue === undefined || minutesValue === "") {
    return 0;
  }
  const minutesNum = Number(minutesValue);
  if (Number.isNaN(minutesNum) || minutesNum < 0) return 0;
  return Math.round((minutesNum / 60) * 100) / 100;
}

function isPresentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value === "present" || (value.includes("present") && !value.includes("absent"));
}

function isLateStatus(status) {
  return String(status || "").trim().toLowerCase().includes("late");
}

function isLeaveStatus(status) {
  return String(status || "").trim().toLowerCase().includes("leave");
}

function isAbsentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "absent") return true;
  return value.includes("absent") && !value.includes("present");
}

/**
 * Manage-attendance from cloud MySQL (synced by office attendance-sync-agent).
 * Lists one row per active portal member with emp_code.
 */
export async function fetchMysqlManageAttendance(
  orgId,
  selectedDate,
  selectedMonth,
  selectedYear,
) {
  const { activeTotal, inactiveTotal } =
    await countPortalManageAttendanceTotals(orgId);

  const portalMembers = await fetchPortalManageAttendanceMembers(orgId);
  const userIds = portalMembers.map((row) => Number(row.user_id)).filter((id) => id > 0);

  const attendanceByUser = new Map();
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(", ");
    const [attendanceRows] = await pool.promise().query(
      `SELECT
         user_id,
         DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS attendance_check_in_time,
         DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS attendance_check_out_time,
         working_time AS employee_working_in_minutes,
         attendance_status AS employee_attendance_status,
         DATE_FORMAT(COALESCE(attendance_date, ?), '%Y-%m-%d') AS attendance_date
       FROM attendance
       WHERE org_id = ?
         AND attendance_date = ?
         AND user_id IN (${placeholders})`,
      [selectedDate, orgId, selectedDate, ...userIds],
    );
    for (const row of attendanceRows) {
      attendanceByUser.set(Number(row.user_id), row);
    }
  }

  const [periodStatsRows] = await pool.promise().query(
    `SELECT
       user_id,
       COUNT(*) AS total_attendance_days,
       SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) AS total_present_days,
       SUM(
         CASE
           WHEN attendance_status LIKE '%absent%'
             AND attendance_status NOT LIKE '%present%'
           THEN 1 ELSE 0
         END
       ) AS total_absent_days,
       SUM(CASE WHEN attendance_status LIKE '%leave%' THEN 1 ELSE 0 END) AS total_on_leave_days,
       SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) AS total_check_in_on_time_days,
       SUM(CASE WHEN attendance_status LIKE '%late%' THEN 1 ELSE 0 END) AS total_check_in_late_days
     FROM attendance
     WHERE org_id = ?
       AND MONTH(attendance_date) = ?
       AND YEAR(attendance_date) = ?
     GROUP BY user_id`,
    [orgId, selectedMonth, selectedYear],
  );

  const periodStatsMap = new Map(
    periodStatsRows.map((row) => [Number(row.user_id), row]),
  );

  let selectedDatePresent = 0;
  let selectedDateAbsent = 0;
  let checkInOnTime = 0;
  let checkInLate = 0;
  let selectedDateOnLeave = 0;

  const employeesAttendanceData = [];

  for (const row of portalMembers) {
    const empCode = String(row.emp_code || "").trim();
    if (!empCode) continue;

    const userId = Number(row.user_id);
    const attendance = attendanceByUser.get(userId);
    const rawStatus = attendance?.employee_attendance_status;
    const resolvedStatus = rawStatus ? String(rawStatus) : "absent";

    if (
      isPresentStatus(resolvedStatus) ||
      (isLateStatus(resolvedStatus) && !isAbsentStatus(resolvedStatus))
    ) {
      selectedDatePresent += 1;
    }
    if (!rawStatus || isAbsentStatus(resolvedStatus)) {
      selectedDateAbsent += 1;
    }
    if (isPresentStatus(resolvedStatus)) checkInOnTime += 1;
    if (isLateStatus(resolvedStatus)) checkInLate += 1;
    if (isLeaveStatus(resolvedStatus)) selectedDateOnLeave += 1;

    const periodStats = periodStatsMap.get(userId) || {};

    employeesAttendanceData.push({
      employee_id: row.employee_id,
      user_id: userId,
      emp_code: empCode,
      biometric_employee_code: empCode,
      employee_name: row.employee_name || "",
      employee_email: row.employee_email || "",
      org_id: row.org_id,
      employee_designation: row.employee_designation || "employee",
      employee_profile_img: row.employee_profile_img || "",
      employee_phone: row.employee_phone || "",
      attendance_check_in_time: attendance?.attendance_check_in_time || "",
      attendance_check_out_time: attendance?.attendance_check_out_time || "",
      employee_working_hours: minutesToHours(attendance?.employee_working_in_minutes),
      employee_attendance_status: resolvedStatus,
      attendance_date: attendance?.attendance_date || selectedDate,
      is_active_employee: true,
      total_attendance_days: Number(periodStats.total_attendance_days || 0),
      total_present_days: Number(periodStats.total_present_days || 0),
      total_absent_days: Number(periodStats.total_absent_days || 0),
      total_on_leave_days: Number(periodStats.total_on_leave_days || 0),
      total_check_in_on_time_days: Number(
        periodStats.total_check_in_on_time_days || 0,
      ),
      total_check_in_late_days: Number(
        periodStats.total_check_in_late_days || 0,
      ),
    });
  }

  return {
    selected_date: selectedDate,
    header_data: {
      total_company_employees: activeTotal,
      inactive_company_employees: inactiveTotal,
      selected_date_present_employees: selectedDatePresent,
      selected_date_absent_employees: selectedDateAbsent,
      check_in_on_time_employees: checkInOnTime,
      check_in_late_employees: checkInLate,
      selected_date_on_leave_employees: selectedDateOnLeave,
    },
    employees_attendance_data: employeesAttendanceData,
  };
}
