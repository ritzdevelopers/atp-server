import getMssqlPool from "../../db/connect_mssql.js";
import { pool } from "../../db/connect.js";
import { formatPunchInIndia } from "./esslTableResolver.js";
import {
  deriveDayAttendanceFromPunches,
  parseRawDirection,
  wallTimeToMinutesSinceMidnight,
} from "./punchDirection.js";
import { isRmwEmailOnly, isRmwPortalEmail } from "./manageAttendanceOptions.js";
import {
  countPortalManageAttendanceTotals,
  fetchPortalManageAttendanceMembers,
} from "./portalManageAttendanceMembers.js";

function resolveTableForDate(dateStr) {
  const base = process.env.BIOMETRIC_TABLE_NAME || "DeviceLogs";
  const [y, m] = dateStr.split("-").map(Number);
  return `${base}_${m}_${y}`;
}

async function biometricTableExists(mssqlPool, tableName) {
  const safe = tableName.replace(/'/g, "''");
  const result = await mssqlPool.request().query(`
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = '${safe}' AND TABLE_TYPE = 'BASE TABLE'
  `);
  return result.recordset.length > 0;
}

function minutesToHours(minutesValue) {
  if (minutesValue === null || minutesValue === undefined || minutesValue === "") {
    return 0;
  }
  const minutesNum = Number(minutesValue);
  if (Number.isNaN(minutesNum) || minutesNum < 0) return 0;
  return Math.round((minutesNum / 60) * 100) / 100;
}

function computeWorkingMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const inMin = wallTimeToMinutesSinceMidnight(checkIn);
  const outMin = wallTimeToMinutesSinceMidnight(checkOut);
  if (!Number.isFinite(inMin) || !Number.isFinite(outMin)) return 0;
  return Math.max(0, Math.round(outMin - inMin));
}

function deriveAttendanceStatus(checkIn, lateAfter) {
  if (!checkIn) return "absent";
  if (!lateAfter) return "present";
  const inMin = wallTimeToMinutesSinceMidnight(checkIn);
  const lateMin = wallTimeToMinutesSinceMidnight(lateAfter);
  if (Number.isFinite(inMin) && Number.isFinite(lateMin) && inMin > lateMin) {
    return "late";
  }
  return "present";
}

function isPresentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value === "present" || (value.includes("present") && !value.includes("absent"));
}

function isLateStatus(status) {
  return String(status || "").trim().toLowerCase().includes("late");
}

function isAbsentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "absent") return true;
  return value.includes("absent") && !value.includes("present");
}

function isJunkBiometricEmployee(emp) {
  const code = String(emp.EmployeeCode ?? "").trim();
  const name = String(emp.EmployeeName ?? "").trim();
  if (!code) return true;
  if (code === "1" && name === "1") return true;
  return false;
}

/**
 * Manage-attendance list: active portal members with emp_code,
 * merged with live biometric punches and MySQL period stats.
 */
export async function fetchBiometricManageAttendance(
  orgId,
  selectedDate,
  selectedMonth,
  selectedYear,
) {
  const mssqlPool = await getMssqlPool();

  const empResult = await mssqlPool.request().query(`
    SELECT
      EmployeeId,
      EmployeeCode,
      EmployeeName,
      Designation,
      Email,
      ContactNo,
      Status
    FROM Employees
    WHERE RecordStatus = 1
  `);

  const deviceEmpByCode = new Map();
  for (const emp of empResult.recordset) {
    if (isJunkBiometricEmployee(emp)) continue;
    const codeKey = String(emp.EmployeeCode ?? "").trim().toUpperCase();
    if (!codeKey) continue;
    deviceEmpByCode.set(codeKey, emp);
  }

  const punchesByCode = new Map();
  const logTable = resolveTableForDate(selectedDate);

  if (await biometricTableExists(mssqlPool, logTable)) {
    const safeTable = logTable.replace(/]/g, "]]");
    const punchResult = await mssqlPool.request().query(`
      SELECT UserId, LogDate, C1
      FROM [${safeTable}]
      WHERE CAST(LogDate AS DATE) = '${selectedDate.replace(/'/g, "''")}'
      ORDER BY LogDate ASC
    `);

    for (const row of punchResult.recordset) {
      const codeKey = String(row.UserId ?? "").trim().toUpperCase();
      if (!codeKey) continue;

      const clock = formatPunchInIndia(row.LogDate);
      const punch = {
        punch_at: clock?.datetime ?? null,
        direction: parseRawDirection(row.C1),
      };

      if (!punchesByCode.has(codeKey)) punchesByCode.set(codeKey, []);
      punchesByCode.get(codeKey).push(punch);
    }
  }

  const [mappings] = await pool.promise().query(
    `SELECT
       m.biometric_employee_code,
       m.user_id,
       m.employee_name,
       u.user_name,
       u.user_email,
       u.user_phone,
       u.user_image,
       om.is_active AS org_member_is_active,
       COALESCE(r.role_name, 'employee') AS role_name,
       s.end_time AS shift_end_time,
       s.late_after
     FROM biometric_employee_mappings m
     LEFT JOIN apt_users u ON u.id = m.user_id
     LEFT JOIN apt_org_members om ON om.user_id = m.user_id AND om.org_id = m.org_id
     LEFT JOIN apt_user_roles ur ON ur.user_id = m.user_id AND ur.org_id = m.org_id
     LEFT JOIN apt_roles r ON r.id = ur.role_id AND r.org_id = m.org_id
     LEFT JOIN user_shifts us ON us.user_id = m.user_id AND us.org_id = m.org_id
     LEFT JOIN shifts s ON s.id = us.shift_id
     WHERE m.org_id = ?`,
    [orgId],
  );

  const mappingByUserId = new Map(
    mappings.map((m) => [Number(m.user_id), m]),
  );

  const { activeTotal, inactiveTotal } =
    await countPortalManageAttendanceTotals(orgId);
  const portalMembers = await fetchPortalManageAttendanceMembers(orgId);

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

  const [mysqlDayRows] = await pool.promise().query(
    `SELECT
       user_id,
       attendance_status,
       working_time,
       DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
       DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out
     FROM attendance
     WHERE org_id = ? AND attendance_date = ?`,
    [orgId, selectedDate],
  );

  const mysqlDayByUser = new Map(
    mysqlDayRows.map((row) => [Number(row.user_id), row]),
  );

  let selectedDatePresent = 0;
  let selectedDateAbsent = 0;
  let checkInOnTime = 0;
  let checkInLate = 0;

  const employeesAttendanceData = [];
  const rmwEmailOnly = isRmwEmailOnly();

  for (const member of portalMembers) {
    const empCode = String(member.emp_code || "").trim();
    if (!empCode) continue;

    const codeKey = empCode.toUpperCase();
    const userId = Number(member.user_id);
    const mapping = mappingByUserId.get(userId) ?? null;
    const deviceEmp = deviceEmpByCode.get(codeKey) ?? null;

    if (rmwEmailOnly && !isRmwPortalEmail(member.employee_email)) continue;

    const punches = punchesByCode.get(codeKey) ?? [];
    const shiftEnd = member.shift_end_time ?? mapping?.shift_end_time ?? null;
    const lateAfter = member.late_after ?? mapping?.late_after ?? null;
    const derived = deriveDayAttendanceFromPunches(punches, shiftEnd);
    const mysqlDay = mysqlDayByUser.get(userId) ?? null;

    const machineCheckIn = derived.check_in || "";
    const machineCheckOut = derived.check_out || "";
    const checkIn = machineCheckIn || mysqlDay?.check_in || "";
    const checkOut = machineCheckOut || mysqlDay?.check_out || "";

    const resolvedStatus = machineCheckIn
      ? deriveAttendanceStatus(machineCheckIn, lateAfter)
      : mysqlDay?.attendance_status
        ? String(mysqlDay.attendance_status)
        : deriveAttendanceStatus(checkIn, lateAfter);

    if (
      isPresentStatus(resolvedStatus) ||
      (isLateStatus(resolvedStatus) && !isAbsentStatus(resolvedStatus))
    ) {
      selectedDatePresent += 1;
    }
    if (!checkIn || isAbsentStatus(resolvedStatus)) {
      selectedDateAbsent += 1;
    }
    if (isPresentStatus(resolvedStatus)) checkInOnTime += 1;
    if (isLateStatus(resolvedStatus)) checkInLate += 1;

    const workingMinutes =
      machineCheckIn && machineCheckOut
        ? computeWorkingMinutes(machineCheckIn, machineCheckOut)
        : mysqlDay?.working_time != null && !machineCheckOut
          ? Number(mysqlDay.working_time)
          : computeWorkingMinutes(checkIn, checkOut);

    const periodStats = periodStatsMap.get(userId) || {};

    employeesAttendanceData.push({
      employee_id: userId,
      user_id: userId,
      emp_code: empCode,
      biometric_employee_code: empCode,
      biometric_employee_id: deviceEmp?.EmployeeId ?? null,
      employee_name: member.employee_name || deviceEmp?.EmployeeName || empCode,
      employee_email: member.employee_email || deviceEmp?.Email || "",
      org_id: orgId,
      employee_designation:
        member.employee_designation || deviceEmp?.Designation || "employee",
      employee_profile_img: member.employee_profile_img || "",
      employee_phone: member.employee_phone || deviceEmp?.ContactNo || "",
      attendance_check_in_time: checkIn,
      attendance_check_out_time: checkOut,
      employee_working_hours: minutesToHours(workingMinutes),
      employee_attendance_status: resolvedStatus,
      attendance_date: selectedDate,
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
      selected_date_on_leave_employees: 0,
    },
    employees_attendance_data: employeesAttendanceData,
  };
}
