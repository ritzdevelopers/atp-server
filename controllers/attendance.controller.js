import { pool as db } from "../db/connect.js";
import { markAttendanceLogController } from "../helper/mark_attendance_logs.js";

const INDIA_TIMEZONE = "Asia/Kolkata";

/** Calendar date + naive datetime string in Asia/Kolkata (IST), stable for MySQL storage. */
function getIndiaAttendanceClock() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const [datePart, timePart] = formatted.split(" ");
  if (!datePart || !timePart) return null;
  return {
    attendance_date: datePart,
    check_in: `${datePart} ${timePart}`,
    time_part: timePart,
  };
}

/** Minutes since midnight from trailing HH:mm:ss (e.g. on `YYYY-MM-DD HH:mm:ss` or `HH:mm:ss`). */
function wallTimeToMinutesSinceMidnight(value) {
  if (value == null || value === "") return NaN;
  const s = String(value).trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (![h, mi, sec].every((x) => Number.isFinite(x))) return NaN;
  return h * 60 + mi + sec / 60;
}

// Check In Attendance Controller
export const markAttendanceController = async (req, res) => {
  const { org_id } = req.body;

  const { user_id, user_email, user_role_name } = req.user;

  if (!user_id || !user_email || !user_role_name || !org_id) {
    return res.status(400).json({
      message: "All fields are required",
    });
  }

  let connection;

  try {
    connection = await db.promise().getConnection();

    await connection.beginTransaction();

    // 1. Check Organization
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        message: "Organization not found",
      });
    }

    // 2. Check Membership
    const [member] = await connection.query(
      `SELECT user_id
       FROM apt_org_members
       WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        message: "User not part of organization",
      });
    }

    // 3. Get User Name
    const [userRow] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );

    const user_name = userRow[0].user_name;

    // 4.  IP Check First Get All User Assigned IPs
   const [userAssignedIps] = await connection.query(
    "SELECT ip_address FROM ip_address_assignments WHERE user_id = ? AND org_id = ?",
    [user_id, org_id],
   );
   if (userAssignedIps.length === 0) {
    await connection.rollback();
    return res.status(403).json({
      message: "User not assigned any IP addresses",
    });
   } 
   const assignedIps = userAssignedIps.map(
    (ip) => ip.ip_address
  );

    const userIp = getUserIP(req);
 

    if (userIp !== "::1" && userIp !== "::ffff:127.0.0.1" && !assignedIps.includes(userIp)) {
      await connection.rollback();

      return res.status(403).json({
        message: "Unauthorized IP",
      });
    }

    const indiaClock = getIndiaAttendanceClock();
    if (!indiaClock) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        message: "Could not resolve attendance date/time",
      });
    }

    const { attendance_date, check_in, time_part } = indiaClock;

    // 5. Duplicate Attendance Check (India calendar day)
    const [attendance] = await connection.query(
      `SELECT id
       FROM attendance
       WHERE user_id = ?
       AND org_id = ?
       AND attendance_date = ?`,
      [user_id, org_id, attendance_date],
    );

    if (attendance.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        message: "Attendance already marked",
      });
    }

    // 7. Get Shift
    const [shiftRow] = await connection.query(
      `SELECT shift_id
       FROM user_shifts
       WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (shiftRow.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        message: "Shift not assigned",
      });
    }

    const shift_id = shiftRow[0].shift_id;

    const [shift] = await connection.query(
      `SELECT start_time, late_after
       FROM shifts
       WHERE id = ?`,
      [shift_id],
    );

    const { late_after } = shift[0];

    // ---------- TIME HELPER ----------
    const toMinutes = (time) => {
      if (!time) return NaN;

      if (time instanceof Date) {
        return time.getHours() * 60 + time.getMinutes();
      }

      const [h, m] = String(time).split(":").map(Number);

      return h * 60 + m;
    };

    const currentMinutes = toMinutes(time_part);
    const lateMinutes = toMinutes(late_after);

    if (Number.isNaN(currentMinutes) || Number.isNaN(lateMinutes)) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid time format for check-in or shift late_after" });
    }

    // ---------- STATUS ----------
    let status = "present";

    if (currentMinutes > lateMinutes) {
      status = "late";
    }

    // 8. Insert Attendance
    const [attendanceResult] = await connection.query(
      `INSERT INTO attendance
      (
        user_id,
        user_name,
        user_email,
        user_role_name,
        org_id,
        attendance_date,
        check_in,
        attendance_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        user_name,
        user_email,
        user_role_name,
        org_id,
        attendance_date,
        check_in,
        status,
      ],
    );

    // 9. Create Attendance Log
   const ats_res = await markAttendanceLogController(
    connection,
    user_id,
    org_id,
    attendanceResult.insertId,
    userIp
  ); 
   // rollback if success is false
   if (ats_res.success === false) {
    await connection.rollback();
    return res.status(400).json({
      success: false,
      message: ats_res.message,
    });
   }
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Check-in marked successfully",
      status,
      attendance_id: attendanceResult.insertId,
    });

  } catch (error) {

    if (connection) {
      await connection.rollback();
    }

    console.error("Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });

  } finally {

    if (connection) {
      connection.release();
    }
  }
};
// Check Out Attendance Controller
// export const markCheckOutAttendanceController = async (req, res) => {
//   const { org_id, user_date, user_time } = req.body;
//   const { user_id, user_email, user_role_name } = req.user;

//   if (
//     !user_id ||
//     !user_email ||
//     !user_role_name ||
//     !org_id ||
//     !user_date ||
//     !user_time
//   ) {
//     return res.status(400).json({ message: "All fields are required" });
//   }

//   let connection;

//   try {
//     connection = await db.promise().getConnection();
//     await connection.beginTransaction();

//     // 1. Check Org
//     const [org] = await connection.query(
//       "SELECT id FROM apt_organizations WHERE id = ?",
//       [org_id],
//     );
//     if (org.length === 0) {
//       await connection.rollback();
//       return res.status(404).json({ message: "Organization not found" });
//     }

//     // 2. Check Membership
//     const [member] = await connection.query(
//       "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
//       [user_id, org_id],
//     );
//     if (member.length === 0) {
//       await connection.rollback();
//       return res.status(403).json({ message: "User not part of organization" });
//     }

//     // 3. IP Check
//     const [ips] = await connection.query(
//       "SELECT ip_address FROM organization_ips WHERE org_id = ?",
//       [org_id],
//     );

//     const allowedIps = ips.map((i) => i.ip_address);
//     const userIp = getUserIP(req);
//     // console.log("userIp", userIp);
//     if (userIp !== "::1" && !allowedIps.includes(userIp)) {
//       console.log("check-out Unauthorized IP");
//       await connection.rollback();
//       return res.status(403).json({
//         message: "Unauthorized IP. Contact Admin",
//       });
//     }

//     // 4. Check Attendance Exists
//     const [attendance] = await connection.query(
//       `SELECT id,
//         DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
//         DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
//         attendance_status 
//        FROM attendance 
//        WHERE user_id = ? AND org_id = ? AND attendance_date = ?`,
//       [user_id, org_id, user_date],
//     );

//     if (attendance.length === 0) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "Check-in not found. Please check-in first",
//       });
//     }

//     const existing = attendance[0];

//     if (existing.check_out) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "Check-out already done",
//       });
//     }

//     // 5. Get Shift
//     const [shiftRow] = await connection.query(
//       "SELECT shift_id FROM user_shifts WHERE user_id = ? AND org_id = ?",
//       [user_id, org_id],
//     );

//     if (shiftRow.length === 0) {
//       await connection.rollback();
//       return res.status(404).json({ message: "Shift not assigned" });
//     }

//     const shift_id = shiftRow[0].shift_id;

//     const [shift] = await connection.query(
//       `SELECT start_time, end_time, half_day_hours, short_leave_hours
//        FROM shifts WHERE id = ?`,
//       [shift_id],
//     );

//     const { start_time, end_time, half_day_hours, short_leave_hours } =
//       shift[0];

//     const previousStatus = existing.attendance_status;

//     // ---------- TIME HELPERS ----------
//     const extractTime = (value) => {
//       const s = String(value || "").trim();
//       const match = s.match(/(?:^|\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
//       if (!match) return null;
//       const h = Number(match[1]);
//       const m = Number(match[2]);
//       const sec = Number(match[3] ?? 0);
//       if (
//         !Number.isFinite(h) ||
//         !Number.isFinite(m) ||
//         !Number.isFinite(sec) ||
//         h < 0 ||
//         h > 23 ||
//         m < 0 ||
//         m > 59 ||
//         sec < 0 ||
//         sec > 59
//       ) {
//         return null;
//       }
//       return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
//     };

//     const toSeconds = (t) => {
//       const normalized = extractTime(t);
//       if (!normalized) return NaN;
//       const [h, m, s] = normalized.split(":").map(Number);
//       return h * 3600 + m * 60 + s;
//     };

//     const calculateWorkingTime = (start, end) => {
//       const diff = toSeconds(end) - toSeconds(start);
//       if (diff < 0) throw new Error("End time must be greater than start time");
//       return diff / 60; // minutes
//     };

//     const timeToMinutes = (time) => {
//       const normalized = extractTime(time);
//       if (!normalized) return NaN;
//       const [h, m, s] = normalized.split(":").map(Number);
//       return h * 60 + m + s / 60;
//     };

//     // ---------- CALCULATIONS ----------

//     // Shift working minutes
//     const realWorkingMinutes = calculateWorkingTime(start_time, end_time);

//     // User working minutes
//     const checkInTime = extractTime(existing.check_in);
//     const checkOutTime = extractTime(user_time);

//     if (!checkInTime || !checkOutTime) {
//       await connection.rollback();
//       return res.status(400).json({ message: "Invalid user_time" });
//     }

//     console.log(
//       "Check Out Time:",
//       checkOutTime,
//       "Split Check In Time: ",
//       checkInTime,
//       "User Time:",
//       user_time,
//     );

//     const userWorkingMinutes = calculateWorkingTime(checkInTime, checkOutTime);

//     // Limits
//     const halfDayMinutes = timeToMinutes(half_day_hours);
//     const shortLeaveMinutes = timeToMinutes(short_leave_hours);

//     // ---------- WORK STATUS ----------
//     let work_status;

//     if (userWorkingMinutes >= realWorkingMinutes) {
//       work_status = "full_day";
//     } else if (userWorkingMinutes >= shortLeaveMinutes) {
//       work_status = "short_leave";
//     } else if (userWorkingMinutes >= halfDayMinutes) {
//       work_status = "half_day";
//     } else {
//       work_status = "absent";
//     }

//     console.log(
//       "Working Status:",
//       work_status,
//       "Previous Status:",
//       previousStatus,
//       "User Working Minutes:",
//       userWorkingMinutes,
//     );

//     // FINAL STATUS (late + full_day etc.)
//     const finalStatus = `${previousStatus}_${work_status}`;

//     const checkOutDateTime = `${user_date} ${checkOutTime}`;

//     // ---------- UPDATE ----------
//     await connection.query(
//       `UPDATE attendance 
//        SET attendance_status = ?, check_out = ?, working_time = ? 
//        WHERE id = ?`,
//       [finalStatus, checkOutDateTime, userWorkingMinutes, existing.id],
//     );

//     await connection.commit();

//     return res.status(200).json({
//       message: "Check-out marked successfully",
//       finalStatus,
//       workingMinutes: userWorkingMinutes,
//     });
//   } catch (error) {
//     if (connection) await connection.rollback();
//     console.error("Error:", error);
//     return res.status(500).json({ message: "Internal server error" });
//   } finally {
//     if (connection) connection.release();
//   }
// };
// Check Out Attendance Controller
export const markCheckOutAttendanceController = async (req, res) => {

  const { org_id } = req.body;

  const { user_id, user_email, user_role_name } = req.user;

  if (
    !user_id ||
    !user_email ||
    !user_role_name ||
    !org_id
  ) {
    return res.status(400).json({
      message: "All fields are required",
    });
  }

  let connection;

  try {

    connection = await db.promise().getConnection();

    await connection.beginTransaction();

    // 1. Check Organization
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        message: "Organization not found",
      });
    }

    // 2. Check Membership
    const [member] = await connection.query(
      `SELECT user_id
       FROM apt_org_members
       WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (member.length === 0) {

      await connection.rollback();

      return res.status(403).json({
        message: "User not part of organization",
      });
    }

    // 3. IP Check
    const [userAssignedIps] = await connection.query(
      "SELECT ip_address FROM ip_address_assignments WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (userAssignedIps.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not assigned any IP addresses",
      });
    }
    const assignedIps = userAssignedIps.map(
      (ip) => ip.ip_address
    );

    const userIp = getUserIP(req);

    if (userIp !== "::1" && userIp !== "::ffff:127.0.0.1" && !assignedIps.includes(userIp)) {

      await connection.rollback();

      return res.status(403).json({
        message: "Unauthorized IP",
      });
    }

    const indiaClock = getIndiaAttendanceClock();
    if (!indiaClock) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        message: "Could not resolve attendance date/time",
      });
    }

    const { attendance_date, time_part } = indiaClock;
    const check_out = `${attendance_date} ${time_part}`;

    // 4. Get Attendance (India calendar day — same as check-in)
    const [attendance] = await connection.query(
      `SELECT 
          id,
          DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
          DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
          attendance_status
       FROM attendance
       WHERE user_id = ?
       AND org_id = ?
       AND attendance_date = ?`,
      [user_id, org_id, attendance_date],
    );

    if (attendance.length === 0) {

      await connection.rollback();

      return res.status(400).json({
        message: "Check-in not found",
      });
    }

    const existing = attendance[0];

    // Already checked out
    if (existing.check_out) {

      await connection.rollback();

      return res.status(400).json({
        message: "Check-out already done",
      });
    }

    // 6. Get Shift
    const [shiftRow] = await connection.query(
      `SELECT shift_id
       FROM user_shifts
       WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (shiftRow.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        message: "Shift not assigned",
      });
    }

    const shift_id = shiftRow[0].shift_id;

    const [shift] = await connection.query(
      `SELECT
          start_time,
          end_time,
          half_day_hours,
          short_leave_hours
       FROM shifts
       WHERE id = ?`,
      [shift_id],
    );

    const {
      start_time,
      end_time,
      half_day_hours,
      short_leave_hours,
    } = shift[0];

    // ---------- HELPERS ----------

    const timeToMinutes = (time) => {

      if (!time) return NaN;

      const [h, m, s] = String(time)
        .split(":")
        .map(Number);

      return h * 60 + m + (s || 0) / 60;
    };

    const currentMinutes = wallTimeToMinutesSinceMidnight(time_part);
    const checkInMinutes = wallTimeToMinutesSinceMidnight(existing.check_in);

    if (Number.isNaN(currentMinutes) || Number.isNaN(checkInMinutes)) {
      await connection.rollback();
      return res.status(400).json({
        message: "Invalid check-in or checkout time for working hours calculation",
      });
    }

    // ---------- SHIFT WORKING TIME ----------

    const shiftStart = timeToMinutes(start_time);

    const shiftEnd = timeToMinutes(end_time);

    const realWorkingMinutes = shiftEnd - shiftStart;

    // ---------- USER WORKING TIME ----------

    const userWorkingMinutes = Math.round(currentMinutes - checkInMinutes);

    if (userWorkingMinutes < 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "Checkout time is before check-in time",
      });
    }

    // ---------- LIMITS ----------

    const halfDayMinutes =
      timeToMinutes(half_day_hours);

    const shortLeaveMinutes =
      timeToMinutes(short_leave_hours);

    // ---------- WORK STATUS ----------

    let work_status;

    if (userWorkingMinutes >= realWorkingMinutes) {

      work_status = "full_day";

    } else if (
      userWorkingMinutes >= shortLeaveMinutes
    ) {

      work_status = "short_leave";

    } else if (
      userWorkingMinutes >= halfDayMinutes
    ) {

      work_status = "half_day";

    } else {

      work_status = "absent";
    }

    // ---------- FINAL STATUS ----------

    const previousStatus =
      existing.attendance_status;

    const finalStatus =
      `${previousStatus}_${work_status}`;

    // ---------- UPDATE ----------

    await connection.query(
      `UPDATE attendance
       SET
         attendance_status = ?,
         check_out = ?,
         working_time = ?
       WHERE id = ?`,
      [
        finalStatus,
        check_out,
        userWorkingMinutes,
        existing.id,
      ],
    );

    // ---------- ATTENDANCE LOG ----------

  const ats_res =  await markAttendanceLogController(
    connection,
      user_id,
      org_id,
      existing.id,
      userIp,
    ); 
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Check-out marked successfully",
      finalStatus,
      workingMinutes: userWorkingMinutes,
    });

  } catch (error) {

    if (connection) {
      await connection.rollback();
    }

    console.error("Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });

  } finally {

    if (connection) {
      connection.release();
    }
  }
};
//  Better IP extraction
const getUserIP = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress
  );
};

export function convertToMinutes(timeStr) {
  const [time, modifier] = timeStr.split(" ");
  let [hours, minutes] = time.split(":");

  if (modifier === "PM" && hours !== "12") {
    hours = parseInt(hours) + 12;
  }
  if (modifier === "AM" && hours === "12") {
    hours = 0;
  }
  return parseInt(hours) * 60 + parseInt(minutes);
}

// Create company work shifts *This controller only used by admin and hr ::
export const createCompanyWorkShiftsController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 2. Check Role (admin / hr only)
    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const {
      org_id,
      shift_name,
      start_time,
      end_time,
      late_after,
      half_day_hours,
      short_leave_hours,
      is_night_shift,
      working_days,
    } = req.body; 
    // 3. Validate Required Fields
    if (
      !org_id ||
      !shift_name ||
      !start_time ||
      !end_time ||
      !late_after ||
      !half_day_hours ||
      !short_leave_hours
    ) {
      return res.status(400).json({
        message: "All shift fields are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 4. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 5. Check User Member of Org
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const shift_created_by_name = userName[0].user_name;

    if (!shift_created_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 6. Insert Shift
    const insertQuery = `
      INSERT INTO shifts (
        org_id,
        shift_name,
        start_time,
        end_time,
        late_after,
        half_day_hours,
        short_leave_hours,
        is_night_shift,
        shift_created_by,
        shift_creator_name,
        working_days
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await connection.query(insertQuery, [
      org_id,
      shift_name,
      start_time,
      end_time,
      late_after,
      half_day_hours,
      short_leave_hours,
      is_night_shift || false,
      user.user_id,
      shift_created_by_name,
      working_days || "MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY",
    ]);

    await connection.query(
      `INSERT INTO management_activity_log
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "ADD_SHIFT",
        `Work shift '${shift_name}' added (${start_time} to ${end_time})`,
        user.user_id,
        shift_created_by_name,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      message: "Shift created successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Get All Shifts Controller
export const getAllShiftsController = async (req, res) => {
  try {
    const user = req.user;
    const org_id = req.query?.org_id ?? req.body?.org_id;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!org_id) {
      return res.status(400).json({ message: "org_id is required" });
    }

    // 1. Check Org Exists
    const [org] = await db
      .promise()
      .query("SELECT id FROM apt_organizations WHERE id = ?", [org_id]);

    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // 2. Check Is User Valid Member of Org
    const [member] = await db
      .promise()
      .query(
        "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
        [user.user_id, org_id],
      );

    if (member.length === 0) {
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    // 3. Get All Shifts
    const [shifts] = await db.promise().query(
      `SELECT 
        id,
        org_id,
        shift_name,
        start_time,
        end_time,
        late_after,
        half_day_hours,
        short_leave_hours,
        is_night_shift,
        shift_created_by,
        shift_creator_name,
        working_days
      
      FROM shifts
      WHERE org_id = ?
      `,
      [org_id],
    );

    return res.status(200).json({
      message: "Shifts fetched successfully",
      data: shifts,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update company shift *Used by admin and hr only
export const updateCompanyShiftController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 2. Check Role (admin / hr only)
    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const {
      org_id,
      shift_id,
      shift_name,
      start_time,
      end_time,
      late_after,
      half_day_hours,
      short_leave_hours,
      is_night_shift,
      working_days,
    } = req.body;

    // 3. Validate required fields
    if (
      !org_id ||
      !shift_id ||
      !shift_name ||
      !start_time ||
      !end_time ||
      !late_after ||
      !half_day_hours ||
      !short_leave_hours
    ) {
      return res.status(400).json({
        message:
          "org_id, shift_id, shift_name, start_time, end_time, late_after, half_day_hours and short_leave_hours are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 4. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 5. Check User Member of Org
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    // Get performer name for activity log
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const performed_by_name = userName[0]?.user_name;

    if (!performed_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 6. Check Shift exists and belongs to this org
    const [existingShift] = await connection.query(
      "SELECT id, shift_name FROM shifts WHERE id = ? AND org_id = ?",
      [shift_id, org_id],
    );

    if (existingShift.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Shift not found in this organization",
      });
    }

    const previousName = existingShift[0].shift_name;

    // 7. Update Shift
    await connection.query(
      `UPDATE shifts SET
        shift_name = ?,
        start_time = ?,
        end_time = ?,
        late_after = ?,
        half_day_hours = ?,
        short_leave_hours = ?,
        is_night_shift = ?,
        working_days = ?
      WHERE id = ? AND org_id = ?`,
      [
        shift_name,
        start_time,
        end_time,
        late_after,
        half_day_hours,
        short_leave_hours,
        is_night_shift || false,
        working_days || "MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY",
        shift_id,
        org_id,
      ],
    );

    // 8. Management activity log (insert new row — same pattern as create)
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "UPDATE_SHIFT",
        `Work shift updated from '${previousName}' to '${shift_name}' (${start_time} to ${end_time})`,
        user.user_id,
        performed_by_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Shift updated successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Delete company shift *Used by admin and hr only
export const deleteCompanyShiftController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 2. Check Role (admin / hr only)
    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, shift_id } = req.body;

    // 3. Validate required fields
    if (!org_id || !shift_id) {
      return res
        .status(400)
        .json({ message: "org_id and shift_id are required" });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 4. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 5. Check User Member of Org
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    // Get performer name for activity log
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const performed_by_name = userName[0]?.user_name;

    if (!performed_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 6. Check Shift exists and belongs to this org
    const [existingShift] = await connection.query(
      "SELECT id, shift_name FROM shifts WHERE id = ? AND org_id = ?",
      [shift_id, org_id],
    );

    if (existingShift.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Shift not found in this organization",
      });
    }

    const shiftName = existingShift[0].shift_name;

    // 7. Management activity log (before delete so overview still describes the shift)
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "DELETE_SHIFT",
        `Work shift '${shiftName}' (id: ${shift_id}) deleted`,
        user.user_id,
        performed_by_name,
      ],
    );

    // 8. Delete Shift (user_shifts rows cascade per schema)
    await connection.query("DELETE FROM shifts WHERE id = ? AND org_id = ?", [
      shift_id,
      org_id,
    ]);

    await connection.commit();

    return res.status(200).json({ message: "Shift deleted successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error:", error);

    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// User Assign Shift Controller
export const userAssignShiftController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User & Role
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, user_id, shift_id } = req.body;

    // 2. Required fields
    if (!org_id || !user_id || !shift_id) {
      return res.status(400).json({
        message: "org_id, user_id, shift_id are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // Get assigner display name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const user_assigned_by_name = userName[0]?.user_name;
    if (!user_assigned_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 3. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    // 4. Check Target User is member of Org
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "User is not part of this organization",
      });
    }

    // 5. Check Shift Exists & belongs to same org
    const [shift] = await connection.query(
      "SELECT id, shift_name FROM shifts WHERE id = ? AND org_id = ?",
      [shift_id, org_id],
    );

    if (shift.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Shift not found in this organization",
      });
    }

    const shift_name = shift[0].shift_name;

    const [assigneeRow] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    const assignee_name =
      assigneeRow.length > 0 ? assigneeRow[0].user_name : `User ${user_id}`;

    // 6. Check Already Assigned (prevent duplicate)
    const [existing] = await connection.query(
      "SELECT id FROM user_shifts WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );

    if (existing.length > 0) {
      // update instead of insert (better approach)
      await connection.query(
        `UPDATE user_shifts 
         SET shift_id = ?, user_assigned_by = ?, assigned_by_name = ?
         WHERE user_id = ? AND org_id = ?`,
        [shift_id, user.user_id, user_assigned_by_name, user_id, org_id],
      );
    } else {
      // first time assign
      await connection.query(
        `INSERT INTO user_shifts 
        (user_id, shift_id, org_id, user_assigned_by, assigned_by_name)
        VALUES (?, ?, ?, ?, ?)`,
        [user_id, shift_id, org_id, user.user_id, user_assigned_by_name],
      );
    }

    const assignOverview =
      existing.length > 0
        ? `Shift for '${assignee_name}' updated to '${shift_name}'`
        : `Shift '${shift_name}' assigned to '${assignee_name}'`;

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "ASSIGN_SHIFT",
        assignOverview,
        user.user_id,
        user_assigned_by_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Shift assigned successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Company IP Address
export const addCompanyIPAddressController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User & Role (admin / hr only)
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, ip_address, label } = req.body;

    // 2. Required fields
    if (!org_id || !ip_address) {
      return res.status(400).json({
        message: "org_id and ip_address are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 3. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    // 4. Check User is member of org
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const ip_added_by_name = userName[0].user_name;

    // 5. Check duplicate IP (IMPORTANT)
    const [existingIp] = await connection.query(
      "SELECT id FROM organization_ips WHERE org_id = ? AND ip_address = ?",
      [org_id, ip_address],
    );

    if (existingIp.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "IP address already exists for this organization",
      });
    }

    // 6. Insert IP
    const insertQuery = `
      INSERT INTO organization_ips (
        org_id,
        ip_address,
        ip_added_by_id,
        ip_added_by_name,
        label
      )
      VALUES (?, ?, ?, ?, ?)
    `;

    await connection.query(insertQuery, [
      org_id,
      ip_address,
      user.user_id,
      ip_added_by_name,
      label || null,
    ]);

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "ADD_IP",
        `IP ${ip_address} (${label || "No Label"}) added`,
        user.user_id,
        ip_added_by_name,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      message: "IP address added successfully",
      data: {
        org_id,
        ip_address,
        label: label || null,
        ip_added_by_name,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Update Company IP Label Controller

export const updateCompanyIPLabelController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User & Role
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, ip_id, label } = req.body;

    // 2. Required fields
    if (!org_id || !ip_id || !label) {
      return res.status(400).json({
        message: "org_id, ip_id and label are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 3. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 4. Check Membership
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    //  5. Fetch existing IP details (IMPORTANT)
    const [ip] = await connection.query(
      "SELECT ip_address, label FROM organization_ips WHERE id = ? AND org_id = ?",
      [ip_id, org_id],
    );

    if (ip.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "IP not found",
      });
    }

    const old_label = ip[0].label;
    const ip_address = ip[0].ip_address;

    // 6. Update Label
    await connection.query(
      "UPDATE organization_ips SET label = ? WHERE id = ? AND org_id = ?",
      [label, ip_id, org_id],
    );

    //  7. Activity Log (before → after)
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "UPDATE_IP_LABEL",
        `IP ${ip_address} label changed from '${old_label || "No Label"}' to '${label}'`,
        user.user_id,
        user.user_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "IP label updated successfully",
      data: {
        ip_id,
        label,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Delete Company IP Address Controller
export const deleteCompanyIPAddressController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    // 1. Check User & Role
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, ip_id } = req.body;

    // 2. Required fields
    if (!org_id || !ip_id) {
      return res.status(400).json({
        message: "org_id and ip_id are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // 3. Check Org Exists
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 4. Check Membership
    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );

    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    //  IMPORTANT: IP details fetch karo BEFORE delete
    const [ip] = await connection.query(
      "SELECT ip_address, label FROM organization_ips WHERE id = ? AND org_id = ?",
      [ip_id, org_id],
    );

    if (ip.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "IP not found",
      });
    }

    const { ip_address, label } = ip[0];

    // 6. Delete IP
    await connection.query(
      "DELETE FROM organization_ips WHERE id = ? AND org_id = ?",
      [ip_id, org_id],
    );

    //  7. Activity Log Insert
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "DELETE_IP",
        `IP ${ip_address} (${label || "No Label"}) deleted`,
        user.user_id,
        user.user_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "IP deleted successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Get All IP Addresses Controller
export const getAllIPAddressesController = async (req, res) => {
  try {
    const user = req.user;
    const org_id = req.query?.org_id ?? req.body?.org_id;

    if (!user?.user_id || !org_id) {
      return res
        .status(400)
        .json({ message: "user_id and org_id are required" });
    }

    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }
    // 1. Check Organization Exists
    const [org] = await db
      .promise()
      .query("SELECT id FROM apt_organizations WHERE id = ?", [org_id]);
    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // 2. Check Is User Valid Member Of Organization
    const [member] = await db
      .promise()
      .query(
        "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
        [user.user_id, org_id],
      );
    if (member.length === 0) {
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    // 3. Get All IP Addresses And Join Total Assigned Users To Each IP Use Left Join On ip_address_assignments Table
    const [ipAddresses] = await db.promise().query(
      `SELECT
  oi.id,
  oi.ip_address,
  oi.label,
  oi.created_at,
  oi.ip_added_by_name,
  COUNT(ia.user_id) AS total_assigned_users
FROM organization_ips oi
LEFT JOIN ip_address_assignments ia 
  ON oi.id = ia.ip_id 
  AND ia.org_id = oi.org_id
WHERE oi.org_id = ?
GROUP BY oi.id`,
      [org_id],
    );
    return res.status(200).json({
      message: "IP Addresses fetched successfully",
      data: ipAddresses,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Add Holiday Controller
export const addHolidayController = async (req, res) => {
  const { org_id, holiday_name, holiday_date } = req.body;
  const { user_id, user_role_name } = req.user;
  let connection;

  if (!user_id || !org_id || !holiday_name || !holiday_date) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (user_role_name !== "admin" && user_role_name !== "hr") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    const holiday_created_by_name = userName[0]?.user_name;
    if (!holiday_created_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 1. Check Org
    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    // 2. Check Duplicate Holiday
    const [existing] = await connection.query(
      "SELECT id FROM holidays WHERE org_id = ? AND holiday_date = ?",
      [org_id, holiday_date],
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Holiday already exists" });
    }

    // 3. Insert Holiday
    await connection.query(
      `INSERT INTO holidays 
      (org_id, holiday_name, holiday_date, holiday_created_by_id, holiday_created_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [org_id, holiday_name, holiday_date, user_id, holiday_created_by_name],
    );

    // 4. Activity Log
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "ADD_HOLIDAY",
        `Holiday '${holiday_name}' added for date ${holiday_date}`,
        user_id,
        holiday_created_by_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Holiday added successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Update Holiday Controller
export const updateHolidayController = async (req, res) => {
  const { holiday_id, holiday_name, holiday_date } = req.body;
  const { user_id, user_role_name } = req.user;
  let connection;

  if (!holiday_id || !holiday_name || !holiday_date) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (user_role_name !== "admin" && user_role_name !== "hr") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    const holiday_updated_by_name = userName[0]?.user_name;

    if (!holiday_updated_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 1. Check Holiday Exists
    const [holiday] = await connection.query(
      "SELECT * FROM holidays WHERE id = ?",
      [holiday_id],
    );

    if (holiday.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Holiday not found" });
    }

    const org_id = holiday[0].org_id;

    // 2. Update Holiday
    await connection.query(
      "UPDATE holidays SET holiday_name = ?, holiday_date = ? WHERE id = ?",
      [holiday_name, holiday_date, holiday_id],
    );

    // 3. Activity Log
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "UPDATE_HOLIDAY",
        `Holiday updated to '${holiday_name}' on ${holiday_date}`,
        user_id,
        holiday_updated_by_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Holiday updated successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Delete Holiday Controller
export const deleteHolidayController = async (req, res) => {
  const { holiday_id } = req.body;
  const { user_id, user_role_name } = req.user;
  let connection;

  if (!holiday_id) {
    return res.status(400).json({ message: "Holiday ID is required" });
  }

  if (user_role_name !== "admin" && user_role_name !== "hr") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    const holiday_deleted_by_name = userName[0]?.user_name;

    if (!holiday_deleted_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    // 1. Get Holiday
    const [holiday] = await connection.query(
      "SELECT * FROM holidays WHERE id = ?",
      [holiday_id],
    );

    if (holiday.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Holiday not found" });
    }

    const { org_id, holiday_name, holiday_date } = holiday[0];

    // 2. Delete Holiday
    await connection.query("DELETE FROM holidays WHERE id = ?", [holiday_id]);

    // 3. Activity Log
    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "DELETE_HOLIDAY",
        `Holiday '${holiday_name}' on ${holiday_date} deleted`,
        user_id,
        holiday_deleted_by_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Holiday deleted successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Get All Holidays Controller
export const getAllHolidaysController = async (req, res) => {
  try {
    const user = req.user;
    const org_id = req.query?.org_id ?? req.body?.org_id;

    if (!user?.user_id || !org_id) {
      return res
        .status(400)
        .json({ message: "user_id and org_id are required" });
    }

    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    // 1. Check Org Exists
    const [org] = await db
      .promise()
      .query("SELECT id FROM apt_organizations WHERE id = ?", [org_id]);

    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // 2. Check Is User Valid Member of Org
    const [member] = await db
      .promise()
      .query(
        "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
        [user.user_id, org_id],
      );

    if (member.length === 0) {
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    // 3. Get All Holidays
    const [holidays] = await db.promise().query(
      `SELECT
        id,
        org_id,
        holiday_name,
        holiday_date,
        holiday_created_by_id,
        holiday_created_by_name,
        created_at,
        updated_at
      FROM holidays
      WHERE org_id = ?
      ORDER BY holiday_date ASC`,
      [org_id],
    );

    // 4. Return Holidays
    return res.status(200).json({
      message: "Holidays fetched successfully",
      data: holidays,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const LEAVE_TYPES = ["full_day", "half_day", "short_leave"];

function parseDateOnly(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00`);
  return Number.isNaN(t) ? null : s;
}

/** MySQL DATE columns may come back as Date objects from mysql2. */
function toYmd(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return iso ? iso[1] : null;
}

/** Next calendar day as YYYY-MM-DD (UTC noon stepping avoids DST ambiguity). */
function addCalendarDays(ymdStr, deltaDays) {
  const base = Date.parse(`${ymdStr}T12:00:00Z`);
  const d = new Date(base + deltaDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Paid leave units taken from monthly `leave_balance` (INT counts).
 * - full_day: 1 unit per calendar day in range (inclusive).
 * - half_day: 1 unit in the month of start_date.
 * - short_leave: 0 units (approval does not reduce paid quota).
 */
function computePaidLeaveUnitsByMonth(leave_type, rawStart, rawEnd) {
  const startStr = toYmd(rawStart);
  if (!startStr) return [];

  if (leave_type === "short_leave") {
    return [];
  }

  if (leave_type === "half_day") {
    const y = Number(startStr.slice(0, 4));
    const m = Number(startStr.slice(5, 7));
    return [{ year: y, month: m, units: 1 }];
  }

  if (leave_type === "full_day") {
    let endFinal = rawEnd ? toYmd(rawEnd) : startStr;
    if (!endFinal) endFinal = startStr;
    if (endFinal < startStr) endFinal = startStr;

    const byKey = new Map();
    let cur = startStr;
    for (;;) {
      const y = Number(cur.slice(0, 4));
      const mo = Number(cur.slice(5, 7));
      const k = `${y}-${mo}`;
      byKey.set(k, (byKey.get(k) || 0) + 1);
      if (cur >= endFinal) break;
      cur = addCalendarDays(cur, 1);
    }

    return Array.from(byKey.entries()).map(([k, units]) => {
      const [y, mo] = k.split("-").map(Number);
      return { year: y, month: mo, units };
    });
  }

  return [];
}

function clampPaidLeaveNumbers(totalNum, usedNum) {
  const t = Math.max(0, parseInt(String(totalNum), 10) || 0);
  let u = Math.max(0, parseInt(String(usedNum), 10) || 0);
  if (u > t) u = t;
  return {
    total: t,
    used: u,
    remaining: Math.max(0, t - u),
  };
}

// Leave Query Controller *Uses By Employees ::
export const leaveQueryController = async (req, res) => {
  const { user_id, user_email } = req.user;
  const { org_id, leave_type, start_date, end_date, reason, team_id } = req.body;
  console.log("This is team_id", team_id);
  if (!user_id || !user_email) {
    return res.status(400).json({
      message: "User ID and email are required",
    });
  }

  if (!org_id || !leave_type || !start_date) {
    return res.status(400).json({
      message: "org_id, leave_type and start_date are required",
    });
  }

  if (!LEAVE_TYPES.includes(leave_type)) {
    return res.status(400).json({
      message: "leave_type must be full_day, half_day or short_leave",
    });
  }

  const startNorm = parseDateOnly(start_date);
  if (!startNorm) {
    return res
      .status(400)
      .json({ message: "Invalid start_date (use YYYY-MM-DD)" });
  }

  let endNorm = parseDateOnly(end_date);
  if (end_date != null && end_date !== "" && !endNorm) {
    return res
      .status(400)
      .json({ message: "Invalid end_date (use YYYY-MM-DD)" });
  }

  if (endNorm && endNorm < startNorm) {
    return res.status(400).json({
      message: "end_date must be on or after start_date",
    });
  }

  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (member.length === 0) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    const [user] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    if (user.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    const user_name = user[0].user_name;
    const [insertResult] = await connection.query(
      `INSERT INTO leave_quiry (
        user_id, user_name, user_email, org_id,
        leave_type, start_date, end_date, reason, status, team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        user_id,
        user_name,
        user_email,
        org_id,
        leave_type,
        startNorm,
        endNorm,
        reason != null && reason !== "" ? String(reason) : null,
        team_id != null && team_id !== "" ? Number(team_id) : null,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      message: "Leave request submitted successfully",
      data: { id: insertResult.insertId },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Get My Leave Queries Controller *Uses By Employees ::
export const getMyLeaveQueriesController = async (req, res) => {
  try {
    const { user_id } = req.user;
    const org_id = req.body?.org_id ?? req.query?.org_id;

    if (!user_id) {
      return res.status(400).json({
        message: "user_id is required",
      });
    }

    if (org_id == null || org_id === "") {
      return res.status(400).json({
        message: "org_id is required",
      });
    }

    const orgIdNum = Number(org_id);
    if (!Number.isFinite(orgIdNum)) {
      return res.status(400).json({ message: "org_id must be a valid number" });
    }

    const [orgRows] = await db.promise().query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [orgIdNum],
    );
    if (orgRows.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const [memberRows] = await db.promise().query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, orgIdNum],
    );
    if (memberRows.length === 0) {
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    const [rows] = await db.promise().query(
      `SELECT
        lq.id,
        lq.user_id,
        lq.user_name,
        lq.user_email,
        lq.org_id,
        lq.leave_type,
        lq.start_date,
        lq.end_date,
        lq.reason,
        lq.status,
        lq.approved_by,
        approver.user_name AS approved_by_name,
        lq.team_id,
        lq.created_at,
        lq.updated_at
      FROM leave_quiry lq
      LEFT JOIN apt_users approver ON lq.approved_by = approver.id
      WHERE lq.user_id = ? AND lq.org_id = ?
      ORDER BY lq.created_at DESC, lq.id DESC`,
      [user_id, orgIdNum],
    );

    return res.status(200).json({
      message: "Leave requests fetched successfully",
      data: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error("getMyLeaveQueriesController:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


// Update Leave Query Controller *Uses By Employees ::
export const updateLeaveQueryController = async (req, res) => {
  const { user_id } = req.user;
  const { leave_id, org_id, leave_type, start_date, end_date, reason } =
    req.body;

  if (!user_id || !leave_id || !org_id) {
    return res.status(400).json({
      message: "leave_id and org_id are required",
    });
  }

  if (
    leave_type !== undefined &&
    leave_type !== null &&
    !LEAVE_TYPES.includes(leave_type)
  ) {
    return res.status(400).json({
      message: "leave_type must be full_day, half_day or short_leave",
    });
  }

  let startNorm;
  if (start_date !== undefined && start_date !== null && start_date !== "") {
    startNorm = parseDateOnly(start_date);
    if (!startNorm) {
      return res
        .status(400)
        .json({ message: "Invalid start_date (use YYYY-MM-DD)" });
    }
  }

  let endNorm;
  if (end_date !== undefined) {
    if (end_date === null || end_date === "") {
      endNorm = null;
    } else {
      endNorm = parseDateOnly(end_date);
      if (!endNorm) {
        return res
          .status(400)
          .json({ message: "Invalid end_date (use YYYY-MM-DD)" });
      }
    }
  }

  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (member.length === 0) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    const [rows] = await connection.query(
      `SELECT id, start_date, end_date, status FROM leave_quiry
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [leave_id, user_id, org_id],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave request not found" });
    }

    if (rows[0].status !== "pending") {
      await connection.rollback();
      return res.status(403).json({
        message: "Only pending leave requests can be updated",
      });
    }

    const nextStart =
      startNorm !== undefined ? startNorm : toYmd(rows[0].start_date);
    const nextEnd =
      endNorm !== undefined
        ? endNorm
        : rows[0].end_date != null
          ? toYmd(rows[0].end_date)
          : null;

    const startForCompare = nextStart;
    if (nextEnd && nextEnd < startForCompare) {
      await connection.rollback();
      return res.status(400).json({
        message: "end_date must be on or after start_date",
      });
    }

    const sets = [];
    const params = [];

    if (leave_type !== undefined && leave_type !== null) {
      sets.push("leave_type = ?");
      params.push(leave_type);
    }
    if (startNorm !== undefined) {
      sets.push("start_date = ?");
      params.push(startNorm);
    }
    if (endNorm !== undefined) {
      sets.push("end_date = ?");
      params.push(endNorm);
    }
    if (reason !== undefined) {
      sets.push("reason = ?");
      params.push(reason != null && reason !== "" ? String(reason) : null);
    }

    if (sets.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No fields to update" });
    }

    params.push(leave_id, user_id, org_id);

    await connection.query(
      `UPDATE leave_quiry SET ${sets.join(", ")}
       WHERE id = ? AND user_id = ? AND org_id = ? AND status = 'pending'`,
      params,
    );

    await connection.commit();

    return res
      .status(200)
      .json({ message: "Leave request updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Delete Leave Query Controller *Uses By Employees ::
export const deleteLeaveQueryController = async (req, res) => {
  const { user_id } = req.user;
  const { leave_id, org_id } = req.body;

  if (!user_id || !leave_id || !org_id) {
    return res.status(400).json({
      message: "leave_id and org_id are required",
    });
  }

  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (member.length === 0) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "User not part of this organization" });
    }

    const [del] = await connection.query(
      `DELETE FROM leave_quiry
       WHERE id = ? AND user_id = ? AND org_id = ? AND status = 'pending'`,
      [leave_id, user_id, org_id],
    );

    if (del.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Leave request not found or cannot be deleted (only pending)",
      });
    }

    await connection.commit();

    return res
      .status(200)
      .json({ message: "Leave request deleted successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Leave Response Controller *Uses By Admin and HR and Manager ::
export const leaveResponseController = async (req, res) => {
  const user = req.user;
  const { leave_id, org_id, status: responseStatus } = req.body;

  if (
    !user ||
    (user.user_role_name !== "admin" &&
      user.user_role_name !== "hr" &&
      user.user_role_name !== "manager")
  ) {
    return res.status(403).json({ message: "Forbidden" });
  }

  if (!leave_id || !org_id || !responseStatus) {
    return res.status(400).json({
      message: "leave_id, org_id and status are required",
    });
  }

  if (responseStatus !== "approved" && responseStatus !== "rejected") {
    return res.status(400).json({
      message: "status must be approved or rejected",
    });
  }

  let connection;

  try {
    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [member] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );
    if (member.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    const [leaveRows] = await connection.query(
      `SELECT id, user_id, user_name, leave_type, start_date, end_date, status
       FROM leave_quiry WHERE id = ? AND org_id = ?`,
      [leave_id, org_id],
    );

    if (leaveRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave request not found" });
    }

    const leave = leaveRows[0];
    if (leave.status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        message: "Leave request is no longer pending",
      });
    }

    const startStr = toYmd(leave.start_date) || "";
    const endStr = toYmd(leave.end_date);
    const rangeStr = endStr ? `${startStr} to ${endStr}` : startStr;

    const deductionBuckets =
      responseStatus === "approved"
        ? computePaidLeaveUnitsByMonth(
            leave.leave_type,
            leave.start_date,
            leave.end_date,
          )
        : [];

    const empUserId = leave.user_id;

    if (responseStatus === "approved" && deductionBuckets.length > 0) {
      if (empUserId == null) {
        await connection.rollback();
        return res.status(400).json({
          message: "Cannot approve: leave request has no employee user linked",
        });
      }

      for (const { year, month, units } of deductionBuckets) {
        const [balRows] = await connection.query(
          `SELECT id, total_leaves, used_leaves, remaining_leaves
           FROM leave_balance
           WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?`,
          [empUserId, org_id, year, month],
        );

        if (balRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({
            message: `No paid leave allocation for ${year}-${String(month).padStart(2, "0")}. Assign paid leaves for this month first.`,
          });
        }

        const b = balRows[0];
        if (Number(b.remaining_leaves) < units) {
          await connection.rollback();
          return res.status(400).json({
            message: `Insufficient paid leave balance for ${year}-${String(month).padStart(2, "0")}: need ${units}, remaining ${b.remaining_leaves}.`,
          });
        }
      }
    }

    // Get User Name
    const [userName] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    const leave_approved_by_name = userName[0].user_name;
    if (!leave_approved_by_name) {
      await connection.rollback();
      return res.status(404).json({
        message: "User name not found",
      });
    }

    const [updResult] = await connection.query(
      `UPDATE leave_quiry
       SET status = ?, approved_by = ?
       WHERE id = ? AND org_id = ? AND status = 'pending'`,
      [responseStatus, user.user_id, leave_id, org_id],
    );

    if (!updResult.affectedRows) {
      await connection.rollback();
      return res.status(409).json({
        message: "Leave request was already processed",
      });
    }

    if (
      responseStatus === "approved" &&
      deductionBuckets.length > 0 &&
      empUserId != null
    ) {
      for (const { year, month, units } of deductionBuckets) {
        const [balRows] = await connection.query(
          `SELECT id, total_leaves, used_leaves FROM leave_balance
           WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?
           FOR UPDATE`,
          [empUserId, org_id, year, month],
        );

        const b = balRows[0];
        const newUsed = Number(b.used_leaves) + units;
        const newRem = clampPaidLeaveNumbers(
          Number(b.total_leaves),
          newUsed,
        ).remaining;

        await connection.query(
          `UPDATE leave_balance
           SET used_leaves = ?, remaining_leaves = ?, last_leave_update = CURDATE()
           WHERE id = ?`,
          [newUsed, newRem, b.id],
        );
      }
    }

    const activityType =
      responseStatus === "approved" ? "APPROVE_LEAVE" : "REJECT_LEAVE";
    const actionWord = responseStatus === "approved" ? "Approved" : "Rejected";
    const overview = `${actionWord} leave #${leave_id} for '${leave.user_name}' (${leave.leave_type}, ${rangeStr})`;

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [org_id, activityType, overview, user.user_id, leave_approved_by_name],
    );

    await connection.commit();

    return res.status(200).json({
      message:
        responseStatus === "approved"
          ? "Leave request approved"
          : "Leave request rejected",
      data: { leave_id, status: responseStatus },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Assign Paid Leaves Controller *Uses By Admin and HR  ::

export const assignPaidLeavesController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const {
      org_id,
      user_id: target_user_id,
      year,
      month,
      total_leaves,
    } = req.body;

    if (
      org_id == null ||
      target_user_id == null ||
      year == null ||
      month == null ||
      total_leaves == null
    ) {
      return res.status(400).json({
        message: "org_id, user_id, year, month and total_leaves are required",
      });
    }

    const y = parseInt(String(year), 10);
    const mo = parseInt(String(month), 10);
    const totalNum = parseInt(String(total_leaves), 10);

    if (
      Number.isNaN(y) ||
      Number.isNaN(mo) ||
      mo < 1 ||
      mo > 12 ||
      Number.isNaN(totalNum) ||
      totalNum < 0
    ) {
      return res.status(400).json({
        message:
          "year, month (1–12) and non-negative total_leaves are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [actorMember] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );
    if (actorMember.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    const [actorRows] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user.user_id],
    );
    if (actorRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    const actor_name = actorRows[0].user_name;

    const [targetMember] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [target_user_id, org_id],
    );
    if (targetMember.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "User is not part of this organization",
      });
    }

    const [assigneeRow] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [target_user_id],
    );
    const assignee_name =
      assigneeRow.length > 0
        ? assigneeRow[0].user_name
        : `User ${target_user_id}`;

    const [existing] = await connection.query(
      `SELECT id, used_leaves FROM leave_balance
       WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?
       FOR UPDATE`,
      [target_user_id, org_id, y, mo],
    );

    let balanceId;
    let used = 0;
    if (existing.length > 0) {
      used = Number(existing[0].used_leaves) || 0;
    }

    if (existing.length > 0 && totalNum < used) {
      await connection.rollback();
      return res.status(400).json({
        message: `total_leaves cannot be less than already used leaves (${used})`,
      });
    }

    const {
      total,
      used: uFinal,
      remaining,
    } = clampPaidLeaveNumbers(totalNum, used);

    // This updates the default monthly leaves used by the auto-assignment cron.
    await connection.query(
      `
      INSERT INTO company_leave_sheet 
      (user_id, org_id, leaves_per_month)
      VALUES (?, ?, ?)
    
      ON DUPLICATE KEY UPDATE
      leaves_per_month = VALUES(leaves_per_month)
      `,
      [target_user_id, org_id, totalNum],
    );

    if (existing.length > 0) {
      await connection.query(
        `UPDATE leave_balance
         SET total_leaves = ?, used_leaves = ?, remaining_leaves = ?,
             last_leave_update = CURDATE()
         WHERE id = ?`,
        [total, uFinal, remaining, existing[0].id],
      );
      balanceId = existing[0].id;
    } else {
      const [ins] = await connection.query(
        `INSERT INTO leave_balance (
          user_id, org_id, year, month,
          total_leaves, used_leaves, remaining_leaves, last_leave_update
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
        [target_user_id, org_id, y, mo, total, uFinal, remaining],
      );
      balanceId = ins.insertId;
    }

    const ym = `${y}-${String(mo).padStart(2, "0")}`;
    const overview = `Paid leave allocation for '${assignee_name}' ${ym}: ${total} total (${remaining} remaining)`;

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [org_id, "ASSIGN_PAID_LEAVES", overview, user.user_id, actor_name],
    );

    await connection.commit();

    return res.status(existing.length ? 200 : 201).json({
      message: existing.length
        ? "Paid leave balance updated"
        : "Paid leaves assigned successfully",
      data: {
        id: balanceId,
        user_id: target_user_id,
        org_id,
        year: y,
        month: mo,
        total_leaves: total,
        used_leaves: uFinal,
        remaining_leaves: remaining,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};
// Update Paid Leaves Controller *Uses By Admin and HR ::
export const updatePaidLeavesController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, balance_id, total_leaves, used_leaves } = req.body;

    if (!org_id || !balance_id) {
      return res.status(400).json({
        message: "org_id and balance_id are required",
      });
    }

    if (total_leaves === undefined && used_leaves === undefined) {
      return res.status(400).json({
        message: "Provide total_leaves and/or used_leaves to update",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [actorMember] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );
    if (actorMember.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    const [rows] = await connection.query(
      `SELECT lb.id, lb.user_id, lb.org_id, lb.year, lb.month,
              lb.total_leaves, lb.used_leaves, lb.remaining_leaves,
              u.user_name AS employee_name
       FROM leave_balance lb
       LEFT JOIN apt_users u ON u.id = lb.user_id
       WHERE lb.id = ? AND lb.org_id = ?`,
      [balance_id, org_id],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave balance not found" });
    }

    const row = rows[0];
    const employee_name = row.employee_name || `User ${row.user_id}`;

    let nextTotal = Number(row.total_leaves);
    let nextUsed = Number(row.used_leaves);

    if (total_leaves !== undefined) {
      const t = parseInt(String(total_leaves), 10);
      if (Number.isNaN(t) || t < 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "total_leaves must be a non-negative integer",
        });
      }
      nextTotal = t;
    }

    if (used_leaves !== undefined) {
      const u = parseInt(String(used_leaves), 10);
      if (Number.isNaN(u) || u < 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "used_leaves must be a non-negative integer",
        });
      }
      nextUsed = u;
    }

    const {
      total,
      used: uF,
      remaining,
    } = clampPaidLeaveNumbers(nextTotal, nextUsed);

    await connection.query(
      `UPDATE leave_balance
       SET total_leaves = ?, used_leaves = ?, remaining_leaves = ?,
           last_leave_update = CURDATE()
       WHERE id = ? AND org_id = ?`,
      [total, uF, remaining, balance_id, org_id],
    );

    const ym = `${row.year}-${String(row.month).padStart(2, "0")}`;
    const overview = `Paid leave ${ym} for '${employee_name}' adjusted: total ${row.total_leaves} → ${total}, used ${row.used_leaves} → ${uF}, remaining ${remaining}`;

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [org_id, "UPDATE_PAID_LEAVES", overview, user.user_id, user.user_name],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Paid leave balance updated successfully",
      data: {
        id: balance_id,
        user_id: row.user_id,
        org_id,
        year: row.year,
        month: row.month,
        total_leaves: total,
        used_leaves: uF,
        remaining_leaves: remaining,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};
// Delete Paid Leaves Controller *Uses By Admin and HR ::
export const deletePaidLeavesController = async (req, res) => {
  let connection;

  try {
    const user = req.user;

    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { org_id, balance_id } = req.body;

    if (!org_id || !balance_id) {
      return res.status(400).json({
        message: "org_id and balance_id are required",
      });
    }

    connection = await db.promise().getConnection();
    await connection.beginTransaction();

    const [org] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (org.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [actorMember] = await connection.query(
      "SELECT user_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user.user_id, org_id],
    );
    if (actorMember.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        message: "User not part of this organization",
      });
    }

    const [rows] = await connection.query(
      `SELECT lb.id, lb.user_id, lb.year, lb.month, lb.total_leaves,
              lb.used_leaves, u.user_name AS employee_name
       FROM leave_balance lb
       LEFT JOIN apt_users u ON u.id = lb.user_id
       WHERE lb.id = ? AND lb.org_id = ?`,
      [balance_id, org_id],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave balance not found" });
    }

    const row = rows[0];
    const employee_name = row.employee_name || `User ${row.user_id}`;
    const ym = `${row.year}-${String(row.month).padStart(2, "0")}`;

    await connection.query(
      "DELETE FROM leave_balance WHERE id = ? AND org_id = ?",
      [balance_id, org_id],
    );

    await connection.query(
      `INSERT INTO management_activity_log 
      (org_id, activity_type, activity_overview, performed_by, performed_by_name)
      VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "DELETE_PAID_LEAVES",
        `Monthly paid leave ledger removed (${ym}) for '${employee_name}' (${row.used_leaves} used of ${row.total_leaves})`,
        user.user_id,
        user.user_name,
      ],
    );

    await connection.commit();

    return res.status(200).json({
      message: "Paid leave balance deleted successfully",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

function toSeconds(t) {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function calculateWorkingTime(start, end) {
  const toSeconds = (t) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };

  const toTime = (sec) => {
    let h = Math.floor(sec / 3600);
    let m = Math.floor((sec % 3600) / 60);
    let s = sec % 60;

    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const diffSeconds = toSeconds(end) - toSeconds(start);

  if (diffSeconds < 0) {
    throw new Error("End time must be greater than start time");
  }

  return {
    seconds: diffSeconds,
    minutes: diffSeconds / 60,
    time: toTime(diffSeconds),
  };
}

function timeToMinutes(time) {
  const [hours, minutes, seconds] = time.split(":").map(Number);

  return hours * 60 + minutes + seconds / 60;
}


export const addAttendanceLogController = async (req, res) => {

  let connection;

  try {

    const { user_id } = req.user;
    const { org_id, attendance_id } = req.body;

    if (!org_id || !attendance_id) {
      return res.status(400).json({
        message: "org_id and attendance_id are required",
      });
    }

    connection = await db.promise().getConnection();

    await connection.beginTransaction();

    const [attendance] = await connection.query(
      `SELECT id
       FROM attendance
       WHERE id = ?
       AND org_id = ?
       AND user_id = ?`,
      [attendance_id, org_id, user_id]
    );

    if (attendance.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    const ip_address = getUserIP(req);

    const ats_res = await markAttendanceLogController(
      connection,
      user_id,
      org_id,
      attendance_id,
      ip_address
    );

    if (!ats_res.success) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: ats_res.message,
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Attendance log added successfully",
      data: ats_res,
    });

  } catch (error) {

    if (connection) {
      await connection.rollback();
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });

  } finally {

    if (connection) {
      connection.release();
    }
  }
};