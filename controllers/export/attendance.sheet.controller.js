/*

Attendance Report Export Logic For Calculation Of Employee Work Status

1. Fetch employee attendance records for the selected month and year.

2. Calculate total calendar days of the selected month (28 / 29 / 30 / 31).

3. Fetch all approved leave records of the employee from the employee_leave table for the selected month and year.

4. Fetch employee Comp Off balance from the employee_compoff_balance table.

5. Fetch all approved regularization requests from the regularization table for the selected month and year and apply the regularization to the corresponding attendance records before calculating work status.

6. For every attendance day, apply attendance rules:

   - Working Hours >= 8 Hours                → Full Day
   - Working Hours >= 4 & < 8 Hours          → Half Day
   - Working Hours < 4 Hours                 → Absent

   Late Rules:

   - Check-In after 9:45 AM                  → Late Mark
   - Check-In after 10:30 AM                 → Half Day
   - Check-Out before 5:30 PM                → Half Day
   - Check-Out between 5:40 PM and 6:20 PM   → Short Leave
   - Check-Out after 6:20 PM                 → Full Day

7. Create report columns:

   - Present Days
   - Absent Days
   - Working Days
   - Full Days
   - Half Days
   - Short Leaves
   - Paid Leaves
   - Unpaid Leaves
   - Half Day Leaves
   - Late Marks
   - Weekly Offs
   - Comp Off Balance
   - Payable Days

8. Calculate Working Days:

   - Full Day = 1
   - Half Day = 0.5
   - Short Leave = Present

   Working Days may be decimal values like:
   - 20
   - 22.5
   - 28.5

9. Calculate Late Leave deduction:

   Every 3 Late Marks = 1 Leave Deduction

   Example:

   Math.floor(totalLateMarks / 3)

   Employee A:
   5 Late Marks → 1 Leave Deduction

   Employee B:
   6 Late Marks → 2 Leave Deductions

10. Calculate Payable Days:

    Payable Days =
    Working Days
    + Paid Leaves
    + Weekly Offs
    + Comp Off Balance
    - Late Leave Deduction

11. Export the final attendance report into Excel with all calculated values.

*/

import db from "../../db/connect.js";
import {
  EXPORT_ATTENDANCE_RULES,
  calculateAttendanceSheetExport,
  fetchApprovedLeaves,
  fetchApprovedRegularizations,
  fetchCompOffBalance,
  formatDateYmdFromDb,
  isFutureCalendarMonth,
  resolveExportDateRange,
} from "../../helper/attendance_sheet_calculation.js";

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

export async function calculateAttendanceSheetExportController(req, res) {
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

    if (exportMode === "monthly" && isFutureCalendarMonth(year, month)) {
      return res.status(400).json({
        success: false,
        message: "Cannot export attendance for a future month.",
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

    const [attendanceRows, leaves, regularizations, compOffBalance] =
      await Promise.all([
        fetchAttendanceRowsInRange(
          employee_id,
          org_id,
          period.fromDate,
          period.toDate,
        ),
        fetchApprovedLeaves(
          db,
          employee_id,
          org_id,
          period.fromDate,
          period.toDate,
        ),
        fetchApprovedRegularizations(
          db,
          employee_id,
          org_id,
          period.fromDate,
          period.toDate,
        ),
        fetchCompOffBalance(db, employee_id, org_id),
      ]);

    const calculated = calculateAttendanceSheetExport({
      rows: attendanceRows,
      regularizations,
      leaves,
      compOffBalance,
      fromDate: period.fromDate,
      toDate: period.toDate,
      joiningDate,
      fromMonthStart: period.mode === "monthly",
      calendarDaysInMonth: period.calendarDaysInMonth,
    });

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
      summary: calculated.summary,
      sheet_report: calculated.sheet_report,
      calendar_days: calculated.calendar_days,
      rows: calculated.rows,
      leaves,
      regularizations_applied: regularizations.length,
    });
  } catch (error) {
    console.log("Error in calculateAttendanceSheetExportController:", error);
    return res.status(500).json({
      success: false,
      message: "Could not calculate attendance sheet export",
    });
  }
}
