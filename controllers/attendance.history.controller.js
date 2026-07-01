import db from "../db/connect.js";
import { isEmployeeExists } from "../helper/employee_checker.js";

async function fetchSingleUserAttendanceRows(
  employee_id,
  org_id,
  { date, month, year },
) {
  const now = new Date();
  const hasDateFilter =
    date !== undefined && date !== null && String(date).trim() !== "";
  const resolvedDate = hasDateFilter ? Number(date) : null;
  const resolvedMonth = Number(month) || now.getMonth() + 1;
  const resolvedYear = Number(year) || now.getFullYear();

  const queryValues = [employee_id, org_id];
  let dateFilterSql = "";
  if (resolvedDate) {
    dateFilterSql = "AND DAY(user_info.attendance_date) = ?";
    queryValues.push(resolvedDate);
  }
  queryValues.push(resolvedMonth, resolvedYear);

  const query = `
    SELECT
      user_info.user_id,
      user_info.user_name,
      user_info.user_email,
      COALESCE(apt_roles.role_name, user_info.user_role_name) AS user_role_name,
      om.emp_code,
      user_info.id AS attendance_id,
      DATE_FORMAT(user_info.attendance_date, '%Y-%m-%d') AS attendance_date,
      DATE_FORMAT(user_info.check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
      DATE_FORMAT(user_info.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
      user_info.attendance_status,
      COALESCE(user_info.working_time, user_info.working_hours, 0) AS working_time,
      apt_users.user_phone,
      apt_users.created_at AS joining_date
    FROM attendance AS user_info
    INNER JOIN apt_users ON user_info.user_id = apt_users.id
    INNER JOIN apt_org_members om
      ON om.user_id = user_info.user_id
      AND om.org_id = user_info.org_id
    LEFT JOIN apt_user_roles
      ON apt_user_roles.user_id = apt_users.id
      AND apt_user_roles.org_id = user_info.org_id
    LEFT JOIN apt_roles
      ON apt_roles.id = apt_user_roles.role_id
      AND apt_roles.org_id = user_info.org_id
    WHERE user_info.user_id = ?
      AND user_info.org_id = ?
      ${dateFilterSql}
      AND MONTH(user_info.attendance_date) = ?
      AND YEAR(user_info.attendance_date) = ?
    ORDER BY user_info.attendance_date DESC
  `;

  const [result] = await db.promise().query(query, queryValues);

  if (result.length === 0) {
    const [profileRows] = await db.promise().query(
      `
        SELECT
          apt_users.id AS user_id,
          apt_users.user_name,
          apt_users.user_email,
          apt_users.user_phone,
          apt_users.created_at AS joining_date,
          apt_org_members.emp_code,
          COALESCE(apt_roles.role_name, '') AS user_role_name
        FROM apt_users
        INNER JOIN apt_org_members
          ON apt_org_members.user_id = apt_users.id
          AND apt_org_members.org_id = ?
        LEFT JOIN apt_user_roles
          ON apt_user_roles.user_id = apt_users.id
          AND apt_user_roles.org_id = ?
        LEFT JOIN apt_roles
          ON apt_roles.id = apt_user_roles.role_id
          AND apt_roles.org_id = ?
        WHERE apt_users.id = ?
        LIMIT 1
      `,
      [org_id, org_id, org_id, employee_id],
    );

    return profileRows;
  }

  return result;
}

async function assertTeamLeaderCanViewMember(
  user_id,
  org_id,
  team_id,
  employee_id,
) {
  const [teamRows] = await db
    .promise()
    .query(
      `SELECT admin_id FROM org_teams WHERE id = ? AND org_id = ? LIMIT 1`,
      [team_id, org_id],
    );
  if (teamRows.length === 0) {
    return { ok: false, status: 404, message: "Team not found" };
  }
  if (Number(teamRows[0].admin_id) !== Number(user_id)) {
    return {
      ok: false,
      status: 403,
      message: "Only the team reporting manager can view member attendance",
    };
  }

  const [memberRows] = await db.promise().query(
    `
      SELECT id
      FROM team_members
      WHERE team_id = ?
        AND user_id = ?
        AND leave_date IS NULL
      LIMIT 1
    `,
    [team_id, employee_id],
  );
  if (memberRows.length === 0) {
    return {
      ok: false,
      status: 404,
      message: "Employee is not an active member of this team",
    };
  }

  const [employeeRows] = await db
    .promise()
    .query(
      `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
      [employee_id, org_id],
    );
  if (employeeRows.length === 0) {
    return { ok: false, status: 404, message: "Employee not found" };
  }

  return { ok: true };
}

export const getAttendanceHistoryOfEmployeeController = async (req, res) => {
  try {
    const { user_id } = req.user || {};
    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      month,
      year,
      status,
      page = 1,
      limit = 10,
      sort = "DESC",
    } = req.query;

    const orderDir = String(sort).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      200,
      Math.max(1, parseInt(String(limit), 10) || 10),
    );

    let query = `
      SELECT 
        id AS attendance_id,
        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
        DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
        DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        attendance_status AS status,
        COALESCE(working_time, working_hours, 0) AS working_time
      FROM attendance
      WHERE user_id = ?
    `;

    const values = [user_id];

    if (month && year) {
      query += ` AND MONTH(attendance_date) = ? AND YEAR(attendance_date) = ?`;
      values.push(month, year);
    }

    if (status) {
      query += ` AND attendance_status = ?`;
      values.push(status);
    }

    query += ` ORDER BY attendance_date ${orderDir}`;

    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT ? OFFSET ?`;

    values.push(limitNum, offset);

    const [rows] = await db.promise().query(query, values);

    res.status(200).json({
      success: true,
      page: pageNum,
      limit: limitNum,
      data: rows,
    });
  } catch (error) {
    console.log("Error in getAttendanceHistoryOfEmployeeController:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch attendance history",
    });
  }
};

function formatLocalDateYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function minutesToHours(minutesValue) {
  if (minutesValue === null || minutesValue === undefined || minutesValue === "") {
    return 0;
  }
  const minutesNum = Number(minutesValue);
  if (Number.isNaN(minutesNum) || minutesNum < 0) return 0;
  return Math.round((minutesNum / 60) * 100) / 100;
}

function resolveSelectedAttendanceDate({ date, month, year }) {
  const now = new Date();
  const dateStr = String(date || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  const resolvedYear = Number(year) || now.getFullYear();
  const resolvedMonth = Number(month) || now.getMonth() + 1;

  if (month && year && !date) {
    const day =
      resolvedYear === now.getFullYear() && resolvedMonth === now.getMonth() + 1
        ? now.getDate()
        : 1;
    return `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (year && !month && !date) {
    const day =
      resolvedYear === now.getFullYear() ? now.getDate() : 1;
    const monthNum =
      resolvedYear === now.getFullYear() ? now.getMonth() + 1 : 1;
    return `${resolvedYear}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return formatLocalDateYmd(now);
}

function isPresentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value === "present" || (value.includes("present") && !value.includes("absent"));
}

function isLateStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value.includes("late");
}

function isLeaveStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value.includes("leave");
}

function isAbsentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "absent") return true;
  return value.includes("absent") && !value.includes("present");
}

export const get_all_users_with_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req;
    if (!(await isEmployeeExists(db.promise(), user_id, org_id))) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const { month, year, date, status } = req.query;
    const selectedDate = resolveSelectedAttendanceDate({ date, month, year });
    const [selectedYear, selectedMonth] = selectedDate.split("-").map(Number);
    const statusFilter = String(status || "").trim().toLowerCase();

    const [totalRows] = await db.promise().query(
      `SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_total,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_total
      FROM apt_org_members WHERE org_id = ?`,
      [org_id],
    );
    const totalCompanyEmployees = Number(totalRows[0]?.active_total || 0);
    const inactiveCompanyEmployees = Number(totalRows[0]?.inactive_total || 0);

    const attendanceQuery = `
      SELECT
        emp_info.id AS employee_id,
        emp_info.user_name AS employee_name,
        emp_info.user_email AS employee_email,
        om.org_id AS org_id,
        COALESCE(apt_roles.role_name, emp_attendance.user_role_name, 'employee') AS employee_designation,
        DATE_FORMAT(emp_attendance.check_in, '%Y-%m-%d %H:%i:%s') AS attendance_check_in_time,
        DATE_FORMAT(emp_attendance.check_out, '%Y-%m-%d %H:%i:%s') AS attendance_check_out_time,
        emp_attendance.working_time AS employee_working_in_minutes,
        emp_attendance.attendance_status AS employee_attendance_status,
        DATE_FORMAT(COALESCE(emp_attendance.attendance_date, ?), '%Y-%m-%d') AS attendance_date,
        emp_info.user_phone AS employee_phone,
        emp_info.user_image AS employee_profile_img,
        om.is_active AS org_member_is_active
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
      WHERE om.org_id = ?
      ORDER BY emp_info.user_name ASC
    `;

    const [attendanceRows] = await db.promise().query(attendanceQuery, [
      selectedDate,
      selectedDate,
      org_id,
    ]);

    const [periodStatsRows] = await db.promise().query(
      `
        SELECT
          user_id,
          COUNT(*) AS total_attendance_days,
          SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) AS total_present_days,
          SUM(
            CASE
              WHEN attendance_status LIKE '%absent%'
                AND attendance_status NOT LIKE '%present%'
              THEN 1
              ELSE 0
            END
          ) AS total_absent_days,
          SUM(CASE WHEN attendance_status LIKE '%leave%' THEN 1 ELSE 0 END) AS total_on_leave_days,
          SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) AS total_check_in_on_time_days,
          SUM(CASE WHEN attendance_status LIKE '%late%' THEN 1 ELSE 0 END) AS total_check_in_late_days
        FROM attendance
        WHERE org_id = ?
          AND MONTH(attendance_date) = ?
          AND YEAR(attendance_date) = ?
        GROUP BY user_id
      `,
      [org_id, selectedMonth, selectedYear],
    );

    const periodStatsMap = new Map(
      periodStatsRows.map((row) => [Number(row.user_id), row]),
    );

    let selectedDatePresent = 0;
    let selectedDateAbsent = 0;
    let checkInOnTime = 0;
    let checkInLate = 0;
    let selectedDateOnLeave = 0;

    const employeesAttendanceData = attendanceRows
      .map((row) => {
        const rawStatus = row.employee_attendance_status;
        const resolvedStatus = rawStatus
          ? String(rawStatus)
          : "absent";
        const isActiveEmployee = Number(row.org_member_is_active) === 1;

        if (isActiveEmployee) {
          if (isPresentStatus(resolvedStatus) || (isLateStatus(resolvedStatus) && !isAbsentStatus(resolvedStatus))) {
            selectedDatePresent += 1;
          }
          if (!rawStatus || isAbsentStatus(resolvedStatus)) {
            selectedDateAbsent += 1;
          }
          if (isPresentStatus(resolvedStatus)) {
            checkInOnTime += 1;
          }
          if (isLateStatus(resolvedStatus)) {
            checkInLate += 1;
          }
          if (isLeaveStatus(resolvedStatus)) {
            selectedDateOnLeave += 1;
          }
        }

        const periodStats = periodStatsMap.get(Number(row.employee_id)) || {};

        return {
          employee_id: row.employee_id,
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
        };
      })
      .filter((row) => {
        if (!statusFilter) return true;
        return (
          String(row.employee_attendance_status || "")
            .trim()
            .toLowerCase() === statusFilter
        );
      });

    const headerData = {
      total_company_employees: totalCompanyEmployees,
      inactive_company_employees: inactiveCompanyEmployees,
      selected_date_present_employees: selectedDatePresent,
      selected_date_absent_employees: selectedDateAbsent,
      check_in_on_time_employees: checkInOnTime,
      check_in_late_employees: checkInLate,
      selected_date_on_leave_employees: selectedDateOnLeave,
    };

    return res.status(200).json({
      success: true,
      selected_date: selectedDate,
      header_data: headerData,
      employees_attendance_data: employeesAttendanceData,
    });
  } catch (error) {
    console.log("Error in get_all_users_with_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch all users with attendance history",
    });
  }
};

export const get_single_user_with_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id, employee_id, date, month, year } = req.query;

    if (!user_id || !org_id || !employee_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid Credentials",
      });
    }
    // Validate Req User -> apt_org_members
    const fetch_org_member_query =
      "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [org_member_result] = await db
      .promise()
      .query(fetch_org_member_query, [user_id, org_id]);
    if (org_member_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }
    // Validate Employee -> apt_org_members
    const fetch_employee_query =
      "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [employee_result] = await db
      .promise()
      .query(fetch_employee_query, [employee_id, org_id]);
    if (employee_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }
    const now = new Date();
    const hasDateFilter =
      date !== undefined && date !== null && String(date).trim() !== "";
    const resolvedDate = hasDateFilter ? Number(date) : null;
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const resolvedYear = Number(year) || now.getFullYear();

    const result = await fetchSingleUserAttendanceRows(employee_id, org_id, {
      date: resolvedDate,
      month: resolvedMonth,
      year: resolvedYear,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.log("Error in get_single_user_with_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch single user with attendance history",
    });
  }
};

export const get_team_member_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id, employee_id, team_id, date, month, year } = req.query;

    if (!user_id || !org_id || !employee_id || !team_id) {
      return res.status(400).json({
        success: false,
        message: "org_id, team_id, and employee_id are required",
      });
    }

    const [orgMemberRows] = await db
      .promise()
      .query(
        "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
        [user_id, org_id],
      );
    if (orgMemberRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }

    const access = await assertTeamLeaderCanViewMember(
      user_id,
      org_id,
      team_id,
      employee_id,
    );
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const now = new Date();
    const hasDateFilter =
      date !== undefined && date !== null && String(date).trim() !== "";
    const resolvedDate = hasDateFilter ? Number(date) : null;
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const resolvedYear = Number(year) || now.getFullYear();

    const result = await fetchSingleUserAttendanceRows(employee_id, org_id, {
      date: resolvedDate,
      month: resolvedMonth,
      year: resolvedYear,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.log("Error in get_team_member_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch team member attendance history",
    });
  }
};

function isHalfDayStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value.includes("half");
}

function isShortLeaveStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return value.includes("short");
}

function formatDateYmdFromDb(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const s = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  return formatLocalDateYmd(d);
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function resolveExportDateRange({ mode, month, year, joiningDate }) {
  const now = new Date();
  const today = formatLocalDateYmd(now);

  if (mode === "monthly") {
    const resolvedYear = Number(year) || now.getFullYear();
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const fromDate = `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-01`;
    const monthEnd = `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-${String(lastDayOfMonth(resolvedYear, resolvedMonth)).padStart(2, "0")}`;
    const toDate = monthEnd > today ? today : monthEnd;
    const monthLabel = new Date(`${fromDate}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" },
    );
    return {
      fromDate,
      toDate,
      label: monthLabel,
      mode: "monthly",
    };
  }

  const fromDate = formatDateYmdFromDb(joiningDate) || today;
  return {
    fromDate: fromDate > today ? today : fromDate,
    toDate: today,
    label: `Full history (${fromDate} to ${today})`,
    mode: "full",
  };
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const EXPORT_ATTENDANCE_RULES = {
  late_after: "09:45:00",
  half_day_checkin_after: "10:30:00",
  half_day_checkout_until: "17:29:00",
  short_leave_from: "17:30:00",
  short_leave_until: "18:15:00",
  full_day_checkout_after: "18:20:00",
  min_full_day_hours: 8,
};

function addDaysToYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDateYmd(d);
}

function enumerateDatesInclusive(fromDate, toDate) {
  const dates = [];
  let current = fromDate;
  while (current <= toDate) {
    dates.push(current);
    current = addDaysToYmd(current, 1);
  }
  return dates;
}

function getDayNameFromYmd(ymd) {
  const dayIndex = new Date(`${ymd}T12:00:00`).getDay();
  return DAY_NAMES[dayIndex] ?? "Unknown";
}

function isSundayYmd(ymd) {
  return new Date(`${ymd}T12:00:00`).getDay() === 0;
}

function isWeekendYmd(ymd) {
  const dayIndex = new Date(`${ymd}T12:00:00`).getDay();
  return dayIndex === 0 || dayIndex === 6;
}

function resolveEffectiveDayStatus({
  record,
  date,
  today,
  joiningDate,
  fromMonthStart = false,
}) {
  const isWeekend = isWeekendYmd(date);
  const isFuture = date > today;
  const joinedOn = joiningDate || date;
  const beforeJoining = !fromMonthStart && date < joinedOn;

  if (beforeJoining) {
    return {
      attendance_status: "not_joined",
      is_absent: false,
      is_weekly_off: false,
    };
  }

  if (isFuture) {
    return {
      attendance_status: "future",
      is_absent: false,
      is_weekly_off: false,
    };
  }

  if (isWeekend && !record?.check_in && !record?.attendance_status) {
    return {
      attendance_status: "weekly_off",
      is_absent: false,
      is_weekly_off: true,
    };
  }

  if (isWeekend && (record?.check_in || record?.attendance_status)) {
    const status = record?.attendance_status
      ? String(record.attendance_status).trim()
      : "present";
    return {
      attendance_status: status,
      is_absent: isAbsentStatus(status),
      is_weekly_off: false,
    };
  }

  if (record?.attendance_status) {
    const status = String(record.attendance_status).trim();
    return {
      attendance_status: status,
      is_absent: isAbsentStatus(status),
      is_weekly_off: false,
    };
  }

  if (record?.check_in) {
    return {
      attendance_status: "present",
      is_absent: false,
      is_weekly_off: false,
    };
  }

  return {
    attendance_status: "absent",
    is_absent: true,
    is_weekly_off: false,
  };
}

function buildCalendarDays(
  fromDate,
  toDate,
  rows,
  joiningDate,
  { fromMonthStart = false } = {},
) {
  const today = formatLocalDateYmd(new Date());
  const joinedOn = formatDateYmdFromDb(joiningDate) || fromDate;
  const rowByDate = new Map(
    rows.map((row) => [String(row.attendance_date), row]),
  );

  return enumerateDatesInclusive(fromDate, toDate).map((date) => {
    const record = rowByDate.get(date) ?? null;
    const dayName = getDayNameFromYmd(date);
    const isSunday = isSundayYmd(date);
    const isWeekend = isWeekendYmd(date);
    const resolved = resolveEffectiveDayStatus({
      record,
      date,
      today,
      joiningDate: joinedOn,
      fromMonthStart,
    });

    const minutes = Number(record?.working_time ?? 0);
    const workingMinutes =
      Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : Number(record?.working_hours ?? 0) > 0
          ? Math.round(Number(record.working_hours) * 60)
          : 0;

    return {
      date,
      day_name: dayName,
      day_short: dayName.slice(0, 3),
      is_sunday: isSunday,
      is_weekend: isWeekend,
      is_weekly_off: resolved.is_weekly_off,
      is_future: date > today,
      is_absent: resolved.is_absent,
      check_in: record?.check_in ?? null,
      check_out: record?.check_out ?? null,
      attendance_status: resolved.attendance_status,
      stored_status: record?.attendance_status ?? null,
      working_time: workingMinutes > 0 ? workingMinutes : null,
      working_hours:
        workingMinutes > 0
          ? minutesToHours(workingMinutes)
          : record?.working_hours ?? null,
    };
  });
}

function summarizeCalendarDays(calendarDays) {
  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let halfDayDays = 0;
  let shortLeaveDays = 0;
  let onLeaveDays = 0;
  let weeklyOffDays = 0;
  let totalWorkingMinutes = 0;

  for (const day of calendarDays) {
    if (day.is_future || day.attendance_status === "not_joined") continue;

    const status = String(day.attendance_status || "").trim();
    if (day.is_weekly_off) weeklyOffDays += 1;
    if (day.is_absent || isAbsentStatus(status)) absentDays += 1;
    if (isPresentStatus(status) && !isLateStatus(status)) presentDays += 1;
    if (isLateStatus(status)) lateDays += 1;
    if (isHalfDayStatus(status)) halfDayDays += 1;
    if (isShortLeaveStatus(status)) shortLeaveDays += 1;
    if (isLeaveStatus(status)) onLeaveDays += 1;

    const minutes = Number(day.working_time ?? 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      totalWorkingMinutes += minutes;
    }
  }

  return {
    total_days: calendarDays.filter(
      (day) =>
        day.attendance_status !== "future" &&
        day.attendance_status !== "not_joined",
    ).length,
    present_days: presentDays,
    late_days: lateDays,
    absent_days: absentDays,
    half_day_days: halfDayDays,
    short_leave_days: shortLeaveDays,
    on_leave_days: onLeaveDays,
    weekly_off_days: weeklyOffDays,
    total_working_minutes: totalWorkingMinutes,
    total_working_hours: minutesToHours(totalWorkingMinutes),
  };
}

function summarizeAttendanceRows(rows) {
  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let halfDayDays = 0;
  let shortLeaveDays = 0;
  let onLeaveDays = 0;
  let totalWorkingMinutes = 0;

  for (const row of rows) {
    const status = String(row.attendance_status || "").trim();
    if (isPresentStatus(status) && !isLateStatus(status)) presentDays += 1;
    if (isLateStatus(status)) lateDays += 1;
    if (isAbsentStatus(status)) absentDays += 1;
    if (isHalfDayStatus(status)) halfDayDays += 1;
    if (isShortLeaveStatus(status)) shortLeaveDays += 1;
    if (isLeaveStatus(status)) onLeaveDays += 1;

    const minutes = Number(row.working_time ?? 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      totalWorkingMinutes += minutes;
    } else {
      const hours = Number(row.working_hours ?? 0);
      if (Number.isFinite(hours) && hours > 0) {
        totalWorkingMinutes += Math.round(hours * 60);
      }
    }
  }

  return {
    total_days: rows.length,
    present_days: presentDays,
    late_days: lateDays,
    absent_days: absentDays,
    half_day_days: halfDayDays,
    short_leave_days: shortLeaveDays,
    on_leave_days: onLeaveDays,
    total_working_minutes: totalWorkingMinutes,
    total_working_hours: minutesToHours(totalWorkingMinutes),
  };
}

async function fetchEmployeeExportProfile(employee_id, org_id) {
  const [rows] = await db.promise().query(
    `
      SELECT
        u.id AS user_id,
        u.user_name,
        u.user_email,
        u.user_phone,
        u.created_at AS user_created_at,
        om.created_at AS member_since,
        om.emp_code,
        COALESCE(r.role_name, 'employee') AS user_role_name
      FROM apt_users u
      INNER JOIN apt_org_members om
        ON om.user_id = u.id AND om.org_id = ?
      LEFT JOIN apt_user_roles ur
        ON ur.user_id = u.id AND ur.org_id = ?
      LEFT JOIN apt_roles r
        ON r.id = ur.role_id AND r.org_id = ?
      WHERE u.id = ?
      LIMIT 1
    `,
    [org_id, org_id, org_id, employee_id],
  );
  return rows[0] ?? null;
}

async function fetchAttendanceRowsInRange(employee_id, org_id, fromDate, toDate) {
  const [rows] = await db.promise().query(
    `
      SELECT
        id AS attendance_id,
        user_id,
        user_name,
        user_email,
        user_role_name,
        org_id,
        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
        DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
        DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        attendance_status,
        COALESCE(working_time, ROUND(working_hours * 60), 0) AS working_time,
        working_hours
      FROM attendance
      WHERE user_id = ?
        AND org_id = ?
        AND attendance_date >= ?
        AND attendance_date <= ?
      ORDER BY attendance_date ASC
    `,
    [employee_id, org_id, fromDate, toDate],
  );
  return rows;
}

export const export_single_user_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id, employee_id, mode, month, year } = req.query;

    if (!user_id || !org_id || !employee_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and employee_id are required",
      });
    }

    const exportMode = String(mode || "monthly").trim().toLowerCase();
    if (exportMode !== "full" && exportMode !== "monthly") {
      return res.status(400).json({
        success: false,
        message: "mode must be full or monthly",
      });
    }

    const [orgMemberRows] = await db
      .promise()
      .query(
        "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
        [user_id, org_id],
      );
    if (orgMemberRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }

    const profile = await fetchEmployeeExportProfile(employee_id, org_id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const joiningDate = profile.member_since || profile.user_created_at;
    const period = resolveExportDateRange({
      mode: exportMode,
      month,
      year,
      joiningDate,
    });

    const rows = await fetchAttendanceRowsInRange(
      employee_id,
      org_id,
      period.fromDate,
      period.toDate,
    );

    const calendar_days = buildCalendarDays(
      period.fromDate,
      period.toDate,
      rows,
      joiningDate,
      { fromMonthStart: period.mode === "monthly" },
    );

    return res.status(200).json({
      success: true,
      employee: {
        user_id: profile.user_id,
        user_name: profile.user_name,
        user_email: profile.user_email,
        user_phone: profile.user_phone || "",
        user_role_name: profile.user_role_name,
        emp_code: profile.emp_code || "",
        joining_date: formatDateYmdFromDb(joiningDate) || period.fromDate,
      },
      period: {
        mode: period.mode,
        from_date: period.fromDate,
        to_date: period.toDate,
        label: period.label,
      },
      attendance_rules: EXPORT_ATTENDANCE_RULES,
      summary: summarizeCalendarDays(calendar_days),
      calendar_days,
      rows,
    });
  } catch (error) {
    console.log("Error in export_single_user_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not export attendance history",
    });
  }
};
