import { pool } from "../../db/connect.js";

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
 * Used on Render where SQL Server is not reachable.
 */
export async function fetchMysqlManageAttendance(
  orgId,
  selectedDate,
  selectedMonth,
  selectedYear,
) {
  const [totalRows] = await pool.promise().query(
    `SELECT
       SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_total,
       SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_total
     FROM apt_org_members WHERE org_id = ?`,
    [orgId],
  );
  const activeTotal = Number(totalRows[0]?.active_total || 0);
  const inactiveTotal = Number(totalRows[0]?.inactive_total || 0);

  const [attendanceRows] = await pool.promise().query(
    `SELECT
       emp_info.id AS employee_id,
       emp_info.id AS user_id,
       emp_info.user_name AS employee_name,
       emp_info.user_email AS employee_email,
       om.org_id AS org_id,
       COALESCE(apt_roles.role_name, 'employee') AS employee_designation,
       DATE_FORMAT(emp_attendance.check_in, '%Y-%m-%d %H:%i:%s') AS attendance_check_in_time,
       DATE_FORMAT(emp_attendance.check_out, '%Y-%m-%d %H:%i:%s') AS attendance_check_out_time,
       emp_attendance.working_time AS employee_working_in_minutes,
       emp_attendance.attendance_status AS employee_attendance_status,
       DATE_FORMAT(COALESCE(emp_attendance.attendance_date, ?), '%Y-%m-%d') AS attendance_date,
       emp_info.user_phone AS employee_phone,
       emp_info.user_image AS employee_profile_img,
       om.is_active AS org_member_is_active,
       m.biometric_employee_code
     FROM apt_org_members om
     INNER JOIN apt_users emp_info ON emp_info.id = om.user_id
     LEFT JOIN attendance emp_attendance
       ON emp_attendance.user_id = emp_info.id
       AND emp_attendance.org_id = om.org_id
       AND emp_attendance.attendance_date = ?
     LEFT JOIN apt_user_roles
       ON apt_user_roles.user_id = emp_info.id
       AND apt_user_roles.org_id = om.org_id
     LEFT JOIN apt_roles
       ON apt_roles.id = apt_user_roles.role_id
       AND apt_roles.org_id = om.org_id
     LEFT JOIN biometric_employee_mappings m
       ON m.user_id = emp_info.id AND m.org_id = om.org_id
     WHERE om.org_id = ?
     ORDER BY emp_info.user_name ASC`,
    [selectedDate, selectedDate, orgId],
  );

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

  for (const row of attendanceRows) {
    const rawStatus = row.employee_attendance_status;
    const resolvedStatus = rawStatus ? String(rawStatus) : "absent";
    const isActiveEmployee = Number(row.org_member_is_active) === 1;

    if (isActiveEmployee) {
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
    }

    const periodStats = periodStatsMap.get(Number(row.employee_id)) || {};

    employeesAttendanceData.push({
      employee_id: row.employee_id,
      user_id: row.user_id,
      biometric_employee_code: row.biometric_employee_code || "",
      employee_name: row.employee_name || "",
      employee_email: row.employee_email || "",
      org_id: row.org_id,
      employee_designation: row.employee_designation || "employee",
      employee_profile_img: row.employee_profile_img || "",
      employee_phone: row.employee_phone || "",
      attendance_check_in_time: row.attendance_check_in_time || "",
      attendance_check_out_time: row.attendance_check_out_time || "",
      employee_working_hours: minutesToHours(row.employee_working_in_minutes),
      employee_attendance_status: resolvedStatus,
      attendance_date: row.attendance_date || selectedDate,
      is_active_employee: isActiveEmployee,
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
