import { wallTimeToMinutesSinceMidnight } from "../services/biometric/punchDirection.js";

const UNPAID_LEAVE_TYPE_NAME = "Unpaid Leave";

export const EXPORT_ATTENDANCE_RULES = {
  on_time_until: "09:45:00",
  late_from: "09:45:01",
  half_day_checkin_after: "10:30:00",
  half_day_checkout_before: "17:30:00",
  short_leave_from: "17:40:00",
  short_leave_until: "18:20:00",
  full_day_checkout_after: "18:20:00",
  min_full_day_hours: 8,
  min_half_day_hours: 4,
  min_absent_hours: 4,
  lates_per_derived_leave: 3,
};

const ATTENDANCE_RULES = {
  /** On time through 9:45 AM inclusive; late mark after 9:45 AM. */
  ON_TIME_UNTIL: wallTimeToMinutesSinceMidnight("09:45:00"),
  HALF_DAY_CHECKIN_AFTER: wallTimeToMinutesSinceMidnight("10:30:00"),
  /** Check-out before 5:30 PM → half day. */
  HALF_DAY_CHECKOUT_BEFORE: wallTimeToMinutesSinceMidnight("17:30:00"),
  /** Check-out between 5:40 PM and 6:20 PM → short leave. */
  SHORT_LEAVE_FROM: wallTimeToMinutesSinceMidnight("17:40:00"),
  SHORT_LEAVE_UNTIL: wallTimeToMinutesSinceMidnight("18:20:00"),
  /** Check-out after 6:20 PM → full day (when hours qualify). */
  FULL_DAY_CHECKOUT_AFTER: wallTimeToMinutesSinceMidnight("18:20:00"),
  MIN_FULL_DAY_MINUTES: 8 * 60,
  MIN_HALF_DAY_MINUTES: 4 * 60,
  MIN_ABSENT_MINUTES: 4 * 60,
  LATES_PER_DERIVED_LEAVE: 3,
};

const STATUS_PRIORITY = {
  absent: 0,
  present: 1,
  late: 2,
  short_leave: 3,
  half_day: 4,
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pickStrongerStatus(current, next) {
  const currentRank = STATUS_PRIORITY[current] ?? 0;
  const nextRank = STATUS_PRIORITY[next] ?? 0;
  return nextRank >= currentRank ? next : current;
}

function deriveStatusFromWorkingHours(workingMinutes) {
  if (!Number.isFinite(workingMinutes) || workingMinutes <= 0) {
    return "absent";
  }
  if (workingMinutes >= ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES) {
    return "present";
  }
  if (workingMinutes >= ATTENDANCE_RULES.MIN_HALF_DAY_MINUTES) {
    return "half_day";
  }
  return "absent";
}

export function deriveFinalAttendanceStatus(
  checkInMinutes,
  checkOutMinutes,
  workingMinutes,
) {
  let status = deriveStatusFromWorkingHours(workingMinutes);
  if (status === "absent") {
    return status;
  }

  if (Number.isFinite(checkInMinutes)) {
    if (checkInMinutes > ATTENDANCE_RULES.HALF_DAY_CHECKIN_AFTER) {
      status = pickStrongerStatus(status, "half_day");
    } else if (
      checkInMinutes > ATTENDANCE_RULES.ON_TIME_UNTIL &&
      status === "present"
    ) {
      status = "late";
    }
  }

  if (Number.isFinite(checkOutMinutes)) {
    if (checkOutMinutes < ATTENDANCE_RULES.HALF_DAY_CHECKOUT_BEFORE) {
      status = pickStrongerStatus(status, "half_day");
    } else if (
      checkOutMinutes >= ATTENDANCE_RULES.SHORT_LEAVE_FROM &&
      checkOutMinutes <= ATTENDANCE_RULES.SHORT_LEAVE_UNTIL
    ) {
      status = pickStrongerStatus(status, "short_leave");
    } else if (checkOutMinutes > ATTENDANCE_RULES.FULL_DAY_CHECKOUT_AFTER) {
      if (workingMinutes >= ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES) {
        status = status === "late" ? "late" : "present";
      }
    }
  }

  if (
    workingMinutes >= ATTENDANCE_RULES.MIN_HALF_DAY_MINUTES &&
    workingMinutes < ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES
  ) {
    status = pickStrongerStatus(status, "half_day");
  }

  return status;
}

export function formatLocalDateYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateYmdFromDb(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const s = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  return formatLocalDateYmd(d);
}

export function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function isFutureCalendarMonth(year, month, now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const resolvedYear = Number(year);
  const resolvedMonth = Number(month);
  if (
    !Number.isFinite(resolvedYear) ||
    !Number.isFinite(resolvedMonth) ||
    resolvedMonth < 1 ||
    resolvedMonth > 12
  ) {
    return false;
  }
  return (
    resolvedYear > currentYear ||
    (resolvedYear === currentYear && resolvedMonth > currentMonth)
  );
}

export function resolveExportDateRange({ mode, month, year, joiningDate }) {
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
      calendarDaysInMonth: lastDayOfMonth(resolvedYear, resolvedMonth),
      month: resolvedMonth,
      year: resolvedYear,
    };
  }

  const fromDate = formatDateYmdFromDb(joiningDate) || today;
  return {
    fromDate: fromDate > today ? today : fromDate,
    toDate: today,
    label: `Full history (${fromDate} to ${today})`,
    mode: "full",
    calendarDaysInMonth: null,
    month: null,
    year: null,
  };
}

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

function isWeekendYmd(ymd) {
  const dayIndex = new Date(`${ymd}T12:00:00`).getDay();
  return dayIndex === 0 || dayIndex === 6;
}

function isSundayYmd(ymd) {
  return new Date(`${ymd}T12:00:00`).getDay() === 0;
}

function getDayNameFromYmd(ymd) {
  const dayIndex = new Date(`${ymd}T12:00:00`).getDay();
  return DAY_NAMES[dayIndex] ?? "Unknown";
}

function timePartFromDateTime(value) {
  if (!value) return "";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    const parts = String(value).split(" ");
    return parts[1] ?? String(value).slice(-8);
  }
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimeValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 8);
  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }
  return String(value).slice(0, 8);
}

function workingMinutesFromPunches(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const checkInMinutes = wallTimeToMinutesSinceMidnight(
    timePartFromDateTime(checkIn),
  );
  const checkOutMinutes = wallTimeToMinutesSinceMidnight(
    timePartFromDateTime(checkOut),
  );
  if (!Number.isFinite(checkInMinutes) || !Number.isFinite(checkOutMinutes)) {
    return null;
  }
  return Math.max(0, Math.round(checkOutMinutes - checkInMinutes));
}

function deriveStatusFromPunches(checkIn, checkOut) {
  if (!checkIn) return "absent";

  const checkInMinutes = wallTimeToMinutesSinceMidnight(
    timePartFromDateTime(checkIn),
  );
  const checkOutMinutes = checkOut
    ? wallTimeToMinutesSinceMidnight(timePartFromDateTime(checkOut))
    : NaN;
  const workingMinutes = workingMinutesFromPunches(checkIn, checkOut);

  return deriveFinalAttendanceStatus(
    checkInMinutes,
    checkOutMinutes,
    workingMinutes,
  );
}

function minutesToHours(minutesValue) {
  const minutesNum = Number(minutesValue);
  if (!Number.isFinite(minutesNum) || minutesNum < 0) return 0;
  return Math.round((minutesNum / 60) * 100) / 100;
}

function isUnpaidLeaveTypeName(leaveTypeName) {
  return (
    String(leaveTypeName || "")
      .trim()
      .toLowerCase() === UNPAID_LEAVE_TYPE_NAME.toLowerCase()
  );
}

function roundDecimal(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function applyRegularizationToAttendanceRows(rows, regularizations) {
  const rowByDate = new Map(
    rows.map((row) => [String(row.attendance_date), { ...row }]),
  );

  for (const reg of regularizations) {
    const date = formatDateYmdFromDb(reg.action_date);
    if (!date) continue;

    const existing = rowByDate.get(date) ?? {
      attendance_date: date,
      check_in: null,
      check_out: null,
      attendance_status: null,
      working_time: 0,
      working_hours: 0,
    };

    const requestType = String(reg.request_type || "").toLowerCase();
    const checkInTime = formatTimeValue(reg.check_in_time);
    const checkOutTime = formatTimeValue(reg.check_out_time);

    if (
      (requestType === "check_in" || requestType === "both") &&
      checkInTime
    ) {
      existing.check_in = `${date} ${checkInTime}`;
    }
    if (
      (requestType === "check_out" || requestType === "both") &&
      checkOutTime
    ) {
      existing.check_out = `${date} ${checkOutTime}`;
    }

    const workingMinutes = workingMinutesFromPunches(
      existing.check_in,
      existing.check_out,
    );
    existing.working_time =
      workingMinutes != null ? workingMinutes : existing.working_time ?? 0;
    existing.working_hours = minutesToHours(existing.working_time);
    existing.regularization_applied = true;

    rowByDate.set(date, existing);
  }

  return [...rowByDate.values()].sort((a, b) =>
    String(a.attendance_date).localeCompare(String(b.attendance_date)),
  );
}

function buildLeaveByDate(leaves, fromDate, toDate) {
  const leaveByDate = new Map();

  for (const leave of leaves) {
    const start = formatDateYmdFromDb(leave.start_date);
    const end = formatDateYmdFromDb(leave.end_date || leave.start_date);
    if (!start || !end) continue;

    const overlapStart = start > fromDate ? start : fromDate;
    const overlapEnd = end < toDate ? end : toDate;
    if (overlapStart > overlapEnd) continue;

    for (const date of enumerateDatesInclusive(overlapStart, overlapEnd)) {
      leaveByDate.set(date, leave);
    }
  }

  return leaveByDate;
}

function countApprovedLeaves(leaves, fromDate, toDate) {
  let paidLeaves = 0;
  let unpaidLeaves = 0;
  let halfDayLeaves = 0;

  for (const leave of leaves) {
    const start = formatDateYmdFromDb(leave.start_date);
    const end = formatDateYmdFromDb(leave.end_date || leave.start_date);
    if (!start || !end) continue;

    const overlapStart = start > fromDate ? start : fromDate;
    const overlapEnd = end < toDate ? end : toDate;
    if (overlapStart > overlapEnd) continue;

    const duration = String(leave.leave_duration || "full_day").toLowerCase();
    const isUnpaid = isUnpaidLeaveTypeName(leave.leave_type_name);
    let daysInPeriod = 0;

    if (duration === "half_day") {
      if (start >= overlapStart && start <= overlapEnd) {
        daysInPeriod = Number(leave.leave_days) || 0.5;
        halfDayLeaves += daysInPeriod;
      }
    } else if (duration === "short_leave") {
      if (start >= overlapStart && start <= overlapEnd) {
        daysInPeriod = Number(leave.leave_days) || 0;
      }
    } else {
      daysInPeriod = enumerateDatesInclusive(overlapStart, overlapEnd).length;
    }

    if (daysInPeriod <= 0) continue;

    if (isUnpaid) {
      unpaidLeaves += daysInPeriod;
    } else if (duration !== "half_day") {
      paidLeaves += daysInPeriod;
    }
  }

  return {
    paid_leaves: roundDecimal(paidLeaves),
    unpaid_leaves: roundDecimal(unpaidLeaves),
    half_day_leaves: roundDecimal(halfDayLeaves),
  };
}

function workingDayCredit(status) {
  const value = String(status || "").trim().toLowerCase();
  if (
    value === "present" ||
    value === "late" ||
    value === "present_full_day" ||
    value === "short_leave"
  ) {
    return 1;
  }
  if (value === "half_day") return 0.5;
  return 0;
}

export function buildCalculatedCalendarDays({
  fromDate,
  toDate,
  rows,
  joiningDate,
  leaveByDate,
  fromMonthStart = false,
}) {
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
    const isFuture = date > today;
    const beforeJoining = !fromMonthStart && date < joinedOn;
    const approvedLeave = leaveByDate.get(date) ?? null;

    if (beforeJoining) {
      return {
        date,
        day_name: dayName,
        day_short: dayName.slice(0, 3),
        is_sunday: isSunday,
        is_weekend: isWeekend,
        is_weekly_off: false,
        is_future: isFuture,
        is_absent: false,
        check_in: null,
        check_out: null,
        attendance_status: "not_joined",
        stored_status: record?.attendance_status ?? null,
        working_time: null,
        working_hours: null,
        on_approved_leave: false,
        regularization_applied: Boolean(record?.regularization_applied),
      };
    }

    if (isFuture) {
      return {
        date,
        day_name: dayName,
        day_short: dayName.slice(0, 3),
        is_sunday: isSunday,
        is_weekend: isWeekend,
        is_weekly_off: false,
        is_future: true,
        is_absent: false,
        check_in: record?.check_in ?? null,
        check_out: record?.check_out ?? null,
        attendance_status: "future",
        stored_status: record?.attendance_status ?? null,
        working_time: null,
        working_hours: null,
        on_approved_leave: false,
        regularization_applied: Boolean(record?.regularization_applied),
      };
    }

    const checkIn = record?.check_in ?? null;
    const checkOut = record?.check_out ?? null;
    const workingMinutes = workingMinutesFromPunches(checkIn, checkOut);

    if (isWeekend && !checkIn) {
      return {
        date,
        day_name: dayName,
        day_short: dayName.slice(0, 3),
        is_sunday: isSunday,
        is_weekend: isWeekend,
        is_weekly_off: true,
        is_future: false,
        is_absent: false,
        check_in: null,
        check_out: null,
        attendance_status: "weekly_off",
        stored_status: record?.attendance_status ?? null,
        working_time: null,
        working_hours: null,
        on_approved_leave: false,
        regularization_applied: Boolean(record?.regularization_applied),
      };
    }

    if (!checkIn) {
      if (approvedLeave) {
        return {
          date,
          day_name: dayName,
          day_short: dayName.slice(0, 3),
          is_sunday: isSunday,
          is_weekend: isWeekend,
          is_weekly_off: false,
          is_future: false,
          is_absent: false,
          check_in: null,
          check_out: null,
          attendance_status: "on_leave",
          stored_status: record?.attendance_status ?? null,
          working_time: null,
          working_hours: null,
          on_approved_leave: true,
          leave_type_name: approvedLeave.leave_type_name ?? null,
          regularization_applied: Boolean(record?.regularization_applied),
        };
      }

      return {
        date,
        day_name: dayName,
        day_short: dayName.slice(0, 3),
        is_sunday: isSunday,
        is_weekend: isWeekend,
        is_weekly_off: false,
        is_future: false,
        is_absent: !isWeekend,
        check_in: null,
        check_out: null,
        attendance_status: isWeekend ? "weekly_off" : "absent",
        stored_status: record?.attendance_status ?? null,
        working_time: null,
        working_hours: null,
        on_approved_leave: false,
        regularization_applied: Boolean(record?.regularization_applied),
      };
    }

    const attendanceStatus = deriveStatusFromPunches(checkIn, checkOut);

    return {
      date,
      day_name: dayName,
      day_short: dayName.slice(0, 3),
      is_sunday: isSunday,
      is_weekend: isWeekend,
      is_weekly_off: false,
      is_future: false,
      is_absent: attendanceStatus === "absent",
      check_in: checkIn,
      check_out: checkOut,
      attendance_status: attendanceStatus,
      stored_status: record?.attendance_status ?? null,
      working_time: workingMinutes,
      working_hours: minutesToHours(workingMinutes ?? 0),
      on_approved_leave: Boolean(approvedLeave),
      leave_type_name: approvedLeave?.leave_type_name ?? null,
      regularization_applied: Boolean(record?.regularization_applied),
    };
  });
}

export function summarizeAttendanceSheet(calendarDays, leaveTotals, compOffBalance, calendarDaysInMonth) {
  let presentDays = 0;
  let absentDays = 0;
  let fullDays = 0;
  let halfDays = 0;
  let shortLeaves = 0;
  let lateMarks = 0;
  let workingDays = 0;
  let weeklyOffDays = 0;
  let totalWorkingMinutes = 0;

  for (const day of calendarDays) {
    if (day.is_future || day.attendance_status === "not_joined") continue;

    const status = String(day.attendance_status || "").trim().toLowerCase();

    if (day.is_weekly_off || (day.is_weekend && !day.check_in)) {
      weeklyOffDays += 1;
      continue;
    }

    if (status === "on_leave") continue;

    if (day.is_absent || status === "absent") {
      absentDays += 1;
      continue;
    }

    const credit = workingDayCredit(status);
    workingDays += credit;

    if (status === "present" || status === "present_full_day") {
      presentDays += 1;
      fullDays += 1;
    } else if (status === "late") {
      presentDays += 1;
      fullDays += 1;
      lateMarks += 1;
    } else if (status === "half_day") {
      halfDays += 1;
    } else if (status === "short_leave") {
      shortLeaves += 1;
      presentDays += 1;
    }

    const minutes = Number(day.working_time ?? 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      totalWorkingMinutes += minutes;
    }
  }

  const lateLeaveDeduction = Math.floor(
    lateMarks / ATTENDANCE_RULES.LATES_PER_DERIVED_LEAVE,
  );
  const payableDays = Math.max(
    0,
    roundDecimal(
      workingDays +
        leaveTotals.paid_leaves +
        weeklyOffDays +
        Number(compOffBalance || 0) -
        lateLeaveDeduction,
    ),
  );

  return {
    calendar_days_in_month: calendarDaysInMonth,
    present_days: presentDays,
    absent_days: absentDays,
    working_days: roundDecimal(workingDays),
    full_days: fullDays,
    half_days: halfDays,
    short_leaves: shortLeaves,
    paid_leaves: leaveTotals.paid_leaves,
    unpaid_leaves: leaveTotals.unpaid_leaves,
    half_day_leaves: leaveTotals.half_day_leaves,
    late_marks: lateMarks,
    weekly_offs: weeklyOffDays,
    comp_off_balance: roundDecimal(Number(compOffBalance || 0)),
    late_leave_deduction: lateLeaveDeduction,
    payable_days: payableDays,
    weekly_off_days: weeklyOffDays,
    total_working_minutes: totalWorkingMinutes,
    total_working_hours: minutesToHours(totalWorkingMinutes),
    total_days: calendarDays.filter(
      (day) =>
        day.attendance_status !== "future" &&
        day.attendance_status !== "not_joined",
    ).length,
  };
}

export async function fetchApprovedLeaves(db, userId, orgId, fromDate, toDate) {
  const [rows] = await db.promise().query(
    `
      SELECT
        el.id,
        el.leave_duration,
        DATE_FORMAT(el.start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(el.end_date, '%Y-%m-%d') AS end_date,
        el.leave_days,
        lt.leave_type_name
      FROM employee_leave el
      LEFT JOIN leave_types lt
        ON lt.id = el.leave_type_id
      WHERE el.user_id = ?
        AND el.org_id = ?
        AND el.leave_status = 'approved'
        AND el.start_date <= ?
        AND COALESCE(el.end_date, el.start_date) >= ?
      ORDER BY el.start_date ASC
    `,
    [userId, orgId, toDate, fromDate],
  );
  return rows;
}

export async function fetchApprovedRegularizations(
  db,
  userId,
  orgId,
  fromDate,
  toDate,
) {
  const [rows] = await db.promise().query(
    `
      SELECT
        id,
        request_type,
        check_in_time,
        check_out_time,
        DATE_FORMAT(action_date, '%Y-%m-%d') AS action_date
      FROM regularization
      WHERE user_id = ?
        AND org_id = ?
        AND reg_status = 'approved'
        AND action_date >= ?
        AND action_date <= ?
      ORDER BY action_date ASC, id ASC
    `,
    [userId, orgId, fromDate, toDate],
  );
  return rows;
}

export async function fetchCompOffBalance(db, userId, orgId) {
  const [rows] = await db.promise().query(
    `
      SELECT balance, used
      FROM employee_compoff_balance
      WHERE user_id = ? AND org_id = ?
      LIMIT 1
    `,
    [userId, orgId],
  );
  if (!rows.length) return 0;
  return Number(rows[0].balance ?? 0);
}

export function calculateAttendanceSheetExport({
  rows,
  regularizations,
  leaves,
  compOffBalance,
  fromDate,
  toDate,
  joiningDate,
  fromMonthStart = false,
  calendarDaysInMonth = null,
}) {
  const adjustedRows = applyRegularizationToAttendanceRows(rows, regularizations);
  const leaveByDate = buildLeaveByDate(leaves, fromDate, toDate);
  const leaveTotals = countApprovedLeaves(leaves, fromDate, toDate);
  const calendarDays = buildCalculatedCalendarDays({
    fromDate,
    toDate,
    rows: adjustedRows,
    joiningDate,
    leaveByDate,
    fromMonthStart,
  });
  const sheetReport = summarizeAttendanceSheet(
    calendarDays,
    leaveTotals,
    compOffBalance,
    calendarDaysInMonth,
  );

  return {
    rows: adjustedRows,
    calendar_days: calendarDays,
    sheet_report: sheetReport,
    summary: {
      total_days: sheetReport.total_days,
      present_days: sheetReport.present_days,
      late_days: sheetReport.late_marks,
      absent_days: sheetReport.absent_days,
      half_day_days: sheetReport.half_days,
      short_leave_days: sheetReport.short_leaves,
      on_leave_days: sheetReport.paid_leaves + sheetReport.half_day_leaves,
      late_derived_leaves: sheetReport.late_leave_deduction,
      total_absent_with_late_leaves:
        sheetReport.absent_days + sheetReport.late_leave_deduction,
      weekly_off_days: sheetReport.weekly_off_days,
      weekly_offs: sheetReport.weekly_offs,
      total_working_minutes: sheetReport.total_working_minutes,
      total_working_hours: sheetReport.total_working_hours,
    },
  };
}
