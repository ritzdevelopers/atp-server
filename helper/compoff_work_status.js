import { wallTimeToMinutesSinceMidnight } from "../services/biometric/punchDirection.js";

const ATTENDANCE_RULES = {
  LATE_FROM: wallTimeToMinutesSinceMidnight("09:46:00"),
  HALF_DAY_CHECKIN_AFTER: wallTimeToMinutesSinceMidnight("10:30:00"),
  HALF_DAY_CHECKOUT_UNTIL: wallTimeToMinutesSinceMidnight("17:29:00"),
  SHORT_LEAVE_FROM: wallTimeToMinutesSinceMidnight("17:30:00"),
  SHORT_LEAVE_UNTIL: wallTimeToMinutesSinceMidnight("18:15:00"),
  FULL_DAY_CHECKOUT_AFTER: wallTimeToMinutesSinceMidnight("18:20:00"),
  MIN_FULL_DAY_MINUTES: 8 * 60,
  MIN_ABSENT_MINUTES: 4 * 60,
};

const STATUS_PRIORITY = {
  absent: 0,
  present: 1,
  late: 2,
  short_leave: 3,
  half_day: 4,
};

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
    checkInMinutes >= ATTENDANCE_RULES.LATE_FROM
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

  if (
    Number.isFinite(workingMinutes) &&
    workingMinutes > 0 &&
    workingMinutes < ATTENDANCE_RULES.MIN_ABSENT_MINUTES
  ) {
    return "absent";
  }

  return status;
}

/**
 * Derives comp-off work_status (half_day | full_day) from punch times.
 * Returns eligible: false when worked less than 4 hours (absent).
 */
export function deriveCompOffWorkStatus(checkIn, checkOut) {
  const checkInMinutes = wallTimeToMinutesSinceMidnight(checkIn);
  const checkOutMinutes = wallTimeToMinutesSinceMidnight(checkOut);

  if (!Number.isFinite(checkInMinutes) || !Number.isFinite(checkOutMinutes)) {
    return {
      eligible: false,
      message: "Invalid check in or check out time for work status calculation",
    };
  }

  if (checkOutMinutes <= checkInMinutes) {
    return {
      eligible: false,
      message: "Check out time must be after check in time",
    };
  }

  const workingMinutes = Math.max(
    0,
    Math.round(checkOutMinutes - checkInMinutes),
  );
  const attendanceStatus = deriveFinalAttendanceStatus(
    checkInMinutes,
    checkOutMinutes,
    workingMinutes,
  );

  if (attendanceStatus === "absent") {
    return {
      eligible: false,
      message:
        "Worked less than 4 hours on this date — not eligible for comp off",
      attendance_status: attendanceStatus,
      working_minutes: workingMinutes,
    };
  }

  const isFullDay =
    workingMinutes >= ATTENDANCE_RULES.MIN_FULL_DAY_MINUTES &&
    checkOutMinutes >= ATTENDANCE_RULES.FULL_DAY_CHECKOUT_AFTER &&
    (attendanceStatus === "present" || attendanceStatus === "late");

  return {
    eligible: true,
    work_status: isFullDay ? "full_day" : "half_day",
    attendance_status: attendanceStatus,
    working_minutes: workingMinutes,
  };
}
