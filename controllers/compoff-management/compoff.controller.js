import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker.js";
import { rollbackAndRespond } from "../../helper/rollback_and_respond.js";
import { deriveCompOffWorkStatus } from "../../helper/compoff_work_status.js";

/* 
employee work_status calculation rules [
8 hour ke niche Half day, 
4 hours ke niche absent,
9.45 ke baad late ,
10.30 ke baad half day,
5.29 per tak half day,
 6.20 ke baad ok hai
]
*/

function dateToLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDateYmd(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dateToLocalYmd(value);
  }
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const parsed = new Date(`${str}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return str;
}

function todayYmd() {
  return dateToLocalYmd(new Date());
}

function normalizeTime(value) {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  const datetimeMatch = str.match(
    /\d{4}-\d{2}-\d{2}[ T](\d{1,2}:\d{2}(?::\d{2})?)/,
  );
  const timePart = datetimeMatch ? datetimeMatch[1] : str;
  const hm = timePart.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return `${String(hm[1]).padStart(2, "0")}:${hm[2]}:00`;
  }
  const hms = timePart.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    return `${String(hms[1]).padStart(2, "0")}:${hms[2]}:${hms[3]}`;
  }
  return null;
}

function timesMatch(requestTime, dbTime) {
  const normalizedRequest = normalizeTime(requestTime);
  const normalizedDb = normalizeTime(dbTime);
  if (!normalizedRequest || !normalizedDb) return false;
  return normalizedRequest.slice(0, 5) === normalizedDb.slice(0, 5);
}

function parseCompOffId(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function validateCompOffUpdate(comp_off_query) {
  if (!comp_off_query || typeof comp_off_query !== "object") {
    return { success: false, message: "comp_off_query is required" };
  }

  const hasDate =
    comp_off_query.compoff_date !== undefined &&
    comp_off_query.compoff_date !== null &&
    comp_off_query.compoff_date !== "";
  const hasCheckIn =
    comp_off_query.check_in !== undefined &&
    comp_off_query.check_in !== null &&
    comp_off_query.check_in !== "";
  const hasCheckOut =
    comp_off_query.check_out !== undefined &&
    comp_off_query.check_out !== null &&
    comp_off_query.check_out !== "";
  const hasReason = comp_off_query.reason !== undefined && comp_off_query.reason !== null;

  if (!hasDate && !hasCheckIn && !hasCheckOut && !hasReason) {
    return {
      success: false,
      message: "At least one of compoff_date, check_in, check_out, or reason must be provided",
    };
  }

  const updates = {};

  if (hasDate) {
    const compoff_date = normalizeDateYmd(comp_off_query.compoff_date);
    if (!compoff_date) {
      return {
        success: false,
        message: "compoff_date must be YYYY-MM-DD",
      };
    }
    if (compoff_date > todayYmd()) {
      return {
        success: false,
        message: "compoff_date cannot be in the future",
      };
    }
    updates.compoff_date = compoff_date;
  }

  if (hasCheckIn) {
    const check_in = normalizeTime(comp_off_query.check_in);
    if (!check_in) {
      return {
        success: false,
        message: "check_in must be HH:MM or HH:MM:SS",
      };
    }
    updates.check_in = check_in;
  }

  if (hasCheckOut) {
    const check_out = normalizeTime(comp_off_query.check_out);
    if (!check_out) {
      return {
        success: false,
        message: "check_out must be HH:MM or HH:MM:SS",
      };
    }
    updates.check_out = check_out;
  }

  if (hasReason) {
    const reason = String(comp_off_query.reason).trim();
    if (!reason) {
      return { success: false, message: "reason cannot be empty" };
    }
    updates.reason = reason;
  }

  return { success: true, data: updates };
}

async function verifyAttendanceAndWorkStatus(
  connection,
  user_id,
  org_id,
  compoff_date,
  check_in,
  check_out,
) {
  const [attendanceRows] = await connection.query(
    `SELECT
       check_in,
       check_out,
       DATE_FORMAT(check_in, '%H:%i:%s') AS db_check_in,
       DATE_FORMAT(check_out, '%H:%i:%s') AS db_check_out
     FROM attendance
     WHERE user_id = ? AND org_id = ?
       AND DATE_FORMAT(attendance_date, '%Y-%m-%d') = ?
     LIMIT 1`,
    [user_id, org_id, compoff_date],
  );

  if (attendanceRows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "No attendance record found for this date",
    };
  }

  const attendance = attendanceRows[0];
  if (!attendance.check_in || !attendance.check_out) {
    return {
      success: false,
      status: 400,
      message: "Attendance check in and check out are required for comp off",
    };
  }

  if (!timesMatch(check_in, attendance.db_check_in)) {
    return {
      success: false,
      status: 400,
      message: "Check in time does not match attendance record",
    };
  }

  if (!timesMatch(check_out, attendance.db_check_out)) {
    return {
      success: false,
      status: 400,
      message: "Check out time does not match attendance record",
    };
  }

  const workStatusResult = deriveCompOffWorkStatus(check_in, check_out);
  if (!workStatusResult.eligible) {
    return {
      success: false,
      status: 400,
      message: workStatusResult.message,
    };
  }

  return { success: true, data: workStatusResult };
}

function validateCompOffQuery(comp_off_query) {
  if (!comp_off_query || typeof comp_off_query !== "object") {
    return { success: false, message: "comp_off_query is required" };
  }

  const compoff_date = normalizeDateYmd(comp_off_query.compoff_date);
  if (!compoff_date) {
    return {
      success: false,
      message: "compoff_date is required and must be YYYY-MM-DD",
    };
  }

  if (compoff_date > todayYmd()) {
    return {
      success: false,
      message: "compoff_date cannot be in the future",
    };
  }

  const check_in = normalizeTime(comp_off_query.check_in);
  const check_out = normalizeTime(comp_off_query.check_out);
  if (!check_in) {
    return { success: false, message: "check_in is required (HH:MM or HH:MM:SS)" };
  }
  if (!check_out) {
    return { success: false, message: "check_out is required (HH:MM or HH:MM:SS)" };
  }

  const reason = String(comp_off_query.reason ?? "").trim();
  if (!reason) {
    return { success: false, message: "reason is required" };
  }

  const reporting_manager = Number(comp_off_query.reporting_manager);
  if (!Number.isInteger(reporting_manager) || reporting_manager <= 0) {
    return {
      success: false,
      message: "reporting_manager is required and must be a valid user id",
    };
  }

  return {
    success: true,
    data: {
      compoff_date,
      check_in,
      check_out,
      reason,
      reporting_manager,
    },
  };
}

export async function applyForCompOff(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const { user_id } = req.user;
    const org_id = req.org_id;
    const { comp_off_query } = req.body;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const fieldValidation = validateCompOffQuery(comp_off_query);
    if (!fieldValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        fieldValidation.message,
      );
    }

    const {
      compoff_date,
      check_in,
      check_out,
      reason,
      reporting_manager,
    } = fieldValidation.data;

    if (Number(reporting_manager) === Number(user_id)) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "You cannot assign yourself as reporting manager",
      );
    }

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Reporting manager not found",
      );
    }

    const attendanceCheck = await verifyAttendanceAndWorkStatus(
      connection,
      user_id,
      org_id,
      compoff_date,
      check_in,
      check_out,
    );
    if (!attendanceCheck.success) {
      return await rollbackAndRespond(
        connection,
        res,
        attendanceCheck.status,
        attendanceCheck.message,
      );
    }

    const { work_status, attendance_status, working_minutes } =
      attendanceCheck.data;

    const [existingRows] = await connection.query(
      `SELECT id, query_status
       FROM employee_compoff_query
       WHERE user_id = ? AND compoff_date = ?
       LIMIT 1`,
      [user_id, compoff_date],
    );

    let compoffId;

    if (existingRows.length > 0) {
      const existingStatus = String(existingRows[0].query_status ?? "pending")
        .trim()
        .toLowerCase();

      if (existingStatus !== "rejected") {
        return await rollbackAndRespond(
          connection,
          res,
          400,
          "Comp off request already exists for this date",
        );
      }

      await connection.query(
        `UPDATE employee_compoff_query
         SET check_in = ?,
             check_out = ?,
             work_status = ?,
             reason = ?,
             reporting_manager = ?,
             query_status = 'pending',
             review_comment = NULL,
             approved_by = NULL,
             approved_at = NULL
         WHERE id = ? AND user_id = ? AND org_id = ?`,
        [
          check_in,
          check_out,
          work_status,
          reason,
          reporting_manager,
          existingRows[0].id,
          user_id,
          org_id,
        ],
      );
      compoffId = existingRows[0].id;
    } else {
      const [insertResult] = await connection.query(
        `INSERT INTO employee_compoff_query
          (user_id, org_id, compoff_date, check_in, check_out, work_status, reason, reporting_manager)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          org_id,
          compoff_date,
          check_in,
          check_out,
          work_status,
          reason,
          reporting_manager,
        ],
      );
      compoffId = insertResult.insertId;
    }

    await connection.commit();

    return res.status(201).json({
      message: "Comp off request submitted successfully",
      compoff_id: compoffId,
      work_status,
      attendance_status,
      working_minutes,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) await connection.release();
  }
}

export async function getSelectedDateAttendanceRecord(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const { compoff_date } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const date = normalizeDateYmd(compoff_date);
    if (!date) {
      return res.status(400).json({
        message: "compoff_date is required and must be YYYY-MM-DD",
      });
    }

    if (date > todayYmd()) {
      return res.status(400).json({
        message: "compoff_date cannot be in the future",
      });
    }

    const [existingRows] = await connection.query(
      `SELECT id, query_status
       FROM employee_compoff_query
       WHERE user_id = ? AND compoff_date = ?
       LIMIT 1`,
      [user_id, date],
    );

    let existing_request = null;
    if (existingRows.length > 0) {
      const existingStatus = String(existingRows[0].query_status ?? "pending")
        .trim()
        .toLowerCase();
      existing_request = {
        id: existingRows[0].id,
        query_status: existingStatus,
      };
      if (existingStatus !== "rejected") {
        return res.status(200).json({
          compoff_date: date,
          eligible: false,
          message: "Comp off request already exists for this date",
          existing_request,
        });
      }
    }

    const [attendanceRows] = await connection.query(
      `SELECT
         attendance_status,
         working_time,
         DATE_FORMAT(check_in, '%H:%i:%s') AS check_in,
         DATE_FORMAT(check_out, '%H:%i:%s') AS check_out
       FROM attendance
       WHERE user_id = ? AND org_id = ?
         AND DATE_FORMAT(attendance_date, '%Y-%m-%d') = ?
       LIMIT 1`,
      [user_id, org_id, date],
    );

    if (attendanceRows.length === 0) {
      return res.status(200).json({
        compoff_date: date,
        eligible: false,
        message: "No attendance record found for this date",
        existing_request,
      });
    }

    const attendance = attendanceRows[0];
    if (!attendance.check_in || !attendance.check_out) {
      return res.status(200).json({
        compoff_date: date,
        eligible: false,
        message: "Attendance check in and check out are required for comp off",
        attendance_status: attendance.attendance_status ?? null,
        existing_request,
      });
    }

    const workStatusResult = deriveCompOffWorkStatus(
      attendance.check_in,
      attendance.check_out,
    );

    if (!workStatusResult.eligible) {
      return res.status(200).json({
        compoff_date: date,
        eligible: false,
        message: workStatusResult.message,
        check_in: attendance.check_in,
        check_out: attendance.check_out,
        attendance_status: attendance.attendance_status ?? null,
        existing_request,
      });
    }

    return res.status(200).json({
      compoff_date: date,
      eligible: true,
      check_in: attendance.check_in,
      check_out: attendance.check_out,
      attendance_status: attendance.attendance_status ?? null,
      working_time: attendance.working_time ?? null,
      work_status: workStatusResult.work_status,
      derived_attendance_status: workStatusResult.attendance_status,
      working_minutes: workStatusResult.working_minutes,
      existing_request,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function updateCompOffInfo(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const compoffId = parseCompOffId(req.params.id);
    if (!compoffId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid comp off ID is required",
      );
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const [existingRows] = await connection.query(
      `SELECT
         id,
         query_status,
         DATE_FORMAT(compoff_date, '%Y-%m-%d') AS compoff_date,
         DATE_FORMAT(check_in, '%H:%i:%s') AS check_in,
         DATE_FORMAT(check_out, '%H:%i:%s') AS check_out,
         work_status,
         reason
       FROM employee_compoff_query
       WHERE id = ? AND user_id = ? AND org_id = ?
       LIMIT 1`,
      [compoffId, user_id, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Comp off request not found",
      );
    }

    const existing = existingRows[0];

    if (String(existing.query_status ?? "pending").toLowerCase() !== "pending") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending comp off requests can be updated",
      );
    }

    const fieldValidation = validateCompOffUpdate(req.body?.comp_off_query);
    if (!fieldValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        fieldValidation.message,
      );
    }

    const updates = fieldValidation.data;
    const finalCompoffDate = updates.compoff_date ?? existing.compoff_date;
    const finalCheckIn = updates.check_in ?? existing.check_in;
    const finalCheckOut = updates.check_out ?? existing.check_out;
    const finalReason = updates.reason ?? existing.reason;

    const punchFieldsChanged =
      updates.compoff_date !== undefined ||
      updates.check_in !== undefined ||
      updates.check_out !== undefined;

    let work_status = existing.work_status;
    let attendance_status;
    let working_minutes;

    if (punchFieldsChanged) {
      if (updates.compoff_date !== undefined && finalCompoffDate !== existing.compoff_date) {
        const [duplicateRows] = await connection.query(
          `SELECT id
           FROM employee_compoff_query
           WHERE user_id = ? AND compoff_date = ? AND id != ?
           LIMIT 1`,
          [user_id, finalCompoffDate, compoffId],
        );

        if (duplicateRows.length > 0) {
          return await rollbackAndRespond(
            connection,
            res,
            400,
            "Comp off request already exists for this date",
          );
        }
      }

      const attendanceCheck = await verifyAttendanceAndWorkStatus(
        connection,
        user_id,
        org_id,
        finalCompoffDate,
        finalCheckIn,
        finalCheckOut,
      );
      if (!attendanceCheck.success) {
        return await rollbackAndRespond(
          connection,
          res,
          attendanceCheck.status,
          attendanceCheck.message,
        );
      }

      work_status = attendanceCheck.data.work_status;
      attendance_status = attendanceCheck.data.attendance_status;
      working_minutes = attendanceCheck.data.working_minutes;
    }

    await connection.query(
      `UPDATE employee_compoff_query
       SET compoff_date = ?,
           check_in = ?,
           check_out = ?,
           work_status = ?,
           reason = ?
       WHERE id = ? AND user_id = ? AND org_id = ? AND query_status = 'pending'`,
      [
        finalCompoffDate,
        finalCheckIn,
        finalCheckOut,
        work_status,
        finalReason,
        compoffId,
        user_id,
        org_id,
      ],
    );

    await connection.commit();

    const response = {
      message: "Comp off request updated successfully",
      compoff_id: compoffId,
      work_status,
      reason: finalReason,
      compoff_date: finalCompoffDate,
      check_in: finalCheckIn,
      check_out: finalCheckOut,
    };

    if (punchFieldsChanged) {
      response.attendance_status = attendance_status;
      response.working_minutes = working_minutes;
    }

    return res.status(200).json(response);
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) await connection.release();
  }
}


export async function deleteCompOff(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const compoffId = parseCompOffId(req.params.id);
    if (!compoffId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid comp off ID is required",
      );
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const [existingRows] = await connection.query(
      `SELECT id, query_status
       FROM employee_compoff_query
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [compoffId, user_id, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Comp off request not found",
      );
    }

    const status = String(existingRows[0].query_status ?? "pending")
      .trim()
      .toLowerCase();

    if (status === "approved") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Approved comp off requests cannot be deleted",
      );
    }

    if (status !== "pending" && status !== "rejected") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending or rejected comp off requests can be deleted",
      );
    }

    const [deleteResult] = await connection.query(
      `DELETE FROM employee_compoff_query
       WHERE id = ? AND user_id = ? AND org_id = ? AND query_status IN ('pending', 'rejected')`,
      [compoffId, user_id, org_id],
    );

    if (!deleteResult.affectedRows) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Failed to delete comp off request",
      );
    }

    await connection.commit();

    return res.status(200).json({
      message: "Comp off request deleted successfully",
      compoff_id: compoffId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) await connection.release();
  }
}


const VALID_QUERY_STATUSES = ["pending", "approved", "rejected"];
const REVIEWABLE_QUERY_STATUSES = ["approved", "rejected"];

function validateCompOffReview(body) {
  const query_status = String(body?.query_status ?? "").trim().toLowerCase();
  if (!REVIEWABLE_QUERY_STATUSES.includes(query_status)) {
    return {
      success: false,
      message: "query_status must be approved or rejected",
    };
  }

  const review_comment =
    body?.review_comment != null && String(body.review_comment).trim() !== ""
      ? String(body.review_comment).trim()
      : null;

  if (query_status === "rejected" && !review_comment) {
    return {
      success: false,
      message: "review_comment is required when rejecting a request",
    };
  }

  return {
    success: true,
    data: { query_status, review_comment },
  };
}

function getCompOffCreditAmount(work_status) {
  const status = String(work_status ?? "").trim().toLowerCase();
  if (status === "full_day") return 1.0;
  if (status === "half_day") return 0.5;
  return null;
}

async function creditCompOffBalance(connection, user_id, org_id, work_status) {
  const credit = getCompOffCreditAmount(work_status);
  if (credit == null) {
    return {
      success: false,
      message: "Invalid work status for comp off balance credit",
    };
  }

  const [balanceRows] = await connection.query(
    `SELECT id, balance, used
     FROM employee_compoff_balance
     WHERE user_id = ? AND org_id = ?
     LIMIT 1`,
    [user_id, org_id],
  );

  if (balanceRows.length === 0) {
    await connection.query(
      `INSERT INTO employee_compoff_balance (user_id, org_id, balance, used)
       VALUES (?, ?, ?, 0)`,
      [user_id, org_id, credit],
    );
  } else {
    const [updateResult] = await connection.query(
      `UPDATE employee_compoff_balance
       SET balance = balance + ?
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [credit, balanceRows[0].id, user_id, org_id],
    );

    if (!updateResult.affectedRows) {
      return {
        success: false,
        message: "Failed to update comp off balance",
      };
    }
  }

  return { success: true, credit };
}

const COMP_OFF_SELECT_SQL = `
  SELECT
    c.id,
    c.user_id,
    c.org_id,
    DATE_FORMAT(c.compoff_date, '%Y-%m-%d') AS compoff_date,
    c.check_in,
    c.check_out,
    c.work_status,
    c.reason,
    c.query_status,
    c.review_comment,
    c.reporting_manager,
    rm.user_name AS reporting_manager_name,
    rm.user_email AS reporting_manager_email,
    rom.emp_code AS reporting_manager_code,
    c.approved_by,
    ab.user_name AS approved_by_name,
    c.approved_at,
    c.created_at,
    c.updated_at
  FROM employee_compoff_query c
  LEFT JOIN apt_users rm
    ON rm.id = c.reporting_manager
  LEFT JOIN apt_org_members rom
    ON rom.user_id = c.reporting_manager AND rom.org_id = c.org_id
  LEFT JOIN apt_users ab
    ON ab.id = c.approved_by
`;

function formatTimeValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 8);
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  return String(value);
}

function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dateToLocalYmd(value);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return str.slice(0, 10);
}

function mapCompOffRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    org_id: row.org_id,
    compoff_date: formatDateValue(row.compoff_date),
    check_in: formatTimeValue(row.check_in),
    check_out: formatTimeValue(row.check_out),
    work_status: row.work_status,
    reason: row.reason,
    query_status: row.query_status,
    review_comment: row.review_comment ?? null,
    reporting_manager: row.reporting_manager,
    reporting_manager_name: row.reporting_manager_name ?? null,
    reporting_manager_email: row.reporting_manager_email ?? null,
    reporting_manager_code: row.reporting_manager_code ?? null,
    approved_by: row.approved_by ?? null,
    approved_by_name: row.approved_by_name ?? null,
    approved_at: row.approved_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getMyAllCompOffs(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const { query_status, compoff_date } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const filters = ["c.user_id = ?", "c.org_id = ?"];
    const params = [user_id, org_id];

    if (query_status != null && String(query_status).trim() !== "") {
      const status = String(query_status).trim().toLowerCase();
      if (!VALID_QUERY_STATUSES.includes(status)) {
        return res.status(400).json({
          message: "query_status must be pending, approved, or rejected",
        });
      }
      filters.push("c.query_status = ?");
      params.push(status);
    }

    if (compoff_date != null && String(compoff_date).trim() !== "") {
      const date = normalizeDateYmd(compoff_date);
      if (!date) {
        return res.status(400).json({
          message: "compoff_date must be YYYY-MM-DD",
        });
      }
      filters.push("c.compoff_date = ?");
      params.push(date);
    }

    const [rows] = await connection.query(
      `${COMP_OFF_SELECT_SQL}
       WHERE ${filters.join(" AND ")}
       ORDER BY c.created_at DESC`,
      params,
    );

    return res.status(200).json({
      result: rows.map(mapCompOffRow),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getSingleCompOff(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const compoffId = parseCompOffId(req.params.id);
    if (!compoffId) {
      return res.status(400).json({ message: "Valid comp off ID is required" });
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [rows] = await connection.query(
      `${COMP_OFF_SELECT_SQL}
       WHERE c.id = ? AND c.user_id = ? AND c.org_id = ?
       LIMIT 1`,
      [compoffId, user_id, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Comp off request not found" });
    }

    return res.status(200).json({
      result: mapCompOffRow(rows[0]),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

const COMP_OFF_MANAGER_SELECT_SQL = `
  SELECT
    c.id,
    c.user_id,
    c.org_id,
    DATE_FORMAT(c.compoff_date, '%Y-%m-%d') AS compoff_date,
    c.check_in,
    c.check_out,
    c.work_status,
    c.reason,
    c.query_status,
    c.review_comment,
    c.reporting_manager,
    rm.user_name AS reporting_manager_name,
    rm.user_email AS reporting_manager_email,
    rom.emp_code AS reporting_manager_code,
    c.approved_by,
    ab.user_name AS approved_by_name,
    c.approved_at,
    c.created_at,
    c.updated_at,
    emp.user_name AS employee_name,
    emp.user_email AS employee_email,
    eom.emp_code AS employee_code,
    eom.emp_code AS emp_code,
    ear.role_name AS employee_role_name,
    ot.id AS team_id,
    ot.team_name,
    ot.admin_id AS team_leader_id,
    team_leader.user_name AS team_leader_name,
    cb.balance AS compoff_balance,
    cb.used AS compoff_used
  FROM employee_compoff_query c
  INNER JOIN apt_users emp
    ON emp.id = c.user_id
  LEFT JOIN apt_org_members eom
    ON eom.user_id = c.user_id AND eom.org_id = c.org_id AND eom.is_active = 1
  LEFT JOIN apt_user_roles eaur
    ON eaur.user_id = c.user_id AND eaur.org_id = c.org_id
  LEFT JOIN apt_roles ear
    ON ear.id = eaur.role_id AND ear.org_id = c.org_id
  LEFT JOIN (
    SELECT user_id, org_id, MIN(team_id) AS team_id
    FROM team_members
    WHERE leave_date IS NULL
    GROUP BY user_id, org_id
  ) tm
    ON tm.user_id = c.user_id AND tm.org_id = c.org_id
  LEFT JOIN org_teams ot
    ON ot.id = tm.team_id AND ot.org_id = c.org_id
  LEFT JOIN apt_users team_leader
    ON team_leader.id = ot.admin_id
  LEFT JOIN apt_users rm
    ON rm.id = c.reporting_manager
  LEFT JOIN apt_org_members rom
    ON rom.user_id = c.reporting_manager AND rom.org_id = c.org_id
  LEFT JOIN apt_users ab
    ON ab.id = c.approved_by
  LEFT JOIN employee_compoff_balance cb
    ON cb.user_id = c.user_id AND cb.org_id = c.org_id
`;

function mapCompOffManagerRow(row) {
  return {
    ...mapCompOffRow(row),
    employee_name: row.employee_name ?? null,
    employee_email: row.employee_email ?? null,
    employee_code: row.employee_code ?? null,
    emp_code: row.emp_code ?? null,
    employee_role_name: row.employee_role_name ?? null,
    team_id: row.team_id ?? null,
    team_name: row.team_name ?? null,
    team_leader_id: row.team_leader_id ?? null,
    team_leader_name: row.team_leader_name ?? null,
    compoff_balance:
      row.compoff_balance != null ? Number(row.compoff_balance) : null,
    compoff_used: row.compoff_used != null ? Number(row.compoff_used) : null,
  };
}

// Manager Routes ::
export async function getRMAllCompOffs(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: reporting_manager } = req.user;
    const org_id = req.org_id;
    const {
      query_status,
      compoff_date,
      employee_id,
      is_ascending: isAscendingQuery,
    } = req.query;

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const filters = ["c.reporting_manager = ?", "c.org_id = ?"];
    const params = [reporting_manager, org_id];

    if (query_status != null && String(query_status).trim() !== "") {
      const status = String(query_status).trim().toLowerCase();
      if (!VALID_QUERY_STATUSES.includes(status)) {
        return res.status(400).json({
          message: "query_status must be pending, approved, or rejected",
        });
      }
      filters.push("c.query_status = ?");
      params.push(status);
    }

    if (compoff_date != null && String(compoff_date).trim() !== "") {
      const date = normalizeDateYmd(compoff_date);
      if (!date) {
        return res.status(400).json({
          message: "compoff_date must be YYYY-MM-DD",
        });
      }
      filters.push("c.compoff_date = ?");
      params.push(date);
    }

    if (employee_id != null && String(employee_id).trim() !== "") {
      const applicantId = Number(employee_id);
      if (!Number.isInteger(applicantId) || applicantId <= 0) {
        return res.status(400).json({
          message: "employee_id must be a valid user id",
        });
      }
      filters.push("c.user_id = ?");
      params.push(applicantId);
    }

    const sortDirection =
      String(isAscendingQuery).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [rows] = await connection.query(
      `${COMP_OFF_MANAGER_SELECT_SQL}
       WHERE ${filters.join(" AND ")}
       ORDER BY c.created_at ${sortDirection}`,
      params,
    );

    return res.status(200).json({
      result: rows.map(mapCompOffManagerRow),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getManagerSingleCompOff(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const compoffId = parseCompOffId(req.params.id);
    if (!compoffId) {
      return res.status(400).json({ message: "Valid comp off ID is required" });
    }

    const { user_id: reporting_manager } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [rows] = await connection.query(
      `${COMP_OFF_MANAGER_SELECT_SQL}
       WHERE c.id = ? AND c.reporting_manager = ? AND c.org_id = ?
       LIMIT 1`,
      [compoffId, reporting_manager, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Comp off request not found" });
    }

    return res.status(200).json({
      result: mapCompOffManagerRow(rows[0]),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function updateCompOffStatus(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const compoffId = parseCompOffId(req.params.id);
    if (!compoffId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid comp off ID is required",
      );
    }

    const { user_id: reporting_manager } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const reviewValidation = validateCompOffReview(req.body);
    if (!reviewValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        reviewValidation.message,
      );
    }

    const { query_status, review_comment } = reviewValidation.data;

    const [existingRows] = await connection.query(
      `SELECT id, user_id, org_id, reporting_manager, query_status, work_status
       FROM employee_compoff_query
       WHERE id = ? AND org_id = ?
       LIMIT 1`,
      [compoffId, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Comp off request not found",
      );
    }

    const existing = existingRows[0];

    if (Number(existing.reporting_manager) !== Number(reporting_manager)) {
      return await rollbackAndRespond(
        connection,
        res,
        403,
        "Only the assigned reporting manager can review this request",
      );
    }

    if (String(existing.query_status ?? "pending").toLowerCase() !== "pending") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending comp off requests can be reviewed",
      );
    }

    if (!(await isEmployeeExists(connection, existing.user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Applicant employee not found or inactive",
      );
    }

    const [updateResult] = await connection.query(
      `UPDATE employee_compoff_query
       SET query_status = ?,
           review_comment = ?,
           approved_by = ?,
           approved_at = NOW()
       WHERE id = ? AND org_id = ? AND reporting_manager = ? AND query_status = 'pending'`,
      [
        query_status,
        review_comment,
        reporting_manager,
        compoffId,
        org_id,
        reporting_manager,
      ],
    );

    if (!updateResult.affectedRows) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Failed to update comp off request",
      );
    }

    let credited_amount = null;

    if (query_status === "approved") {
      const creditResult = await creditCompOffBalance(
        connection,
        existing.user_id,
        org_id,
        existing.work_status,
      );

      if (!creditResult.success) {
        return await rollbackAndRespond(
          connection,
          res,
          400,
          creditResult.message,
        );
      }

      credited_amount = creditResult.credit;
    }

    await connection.commit();

    const [updatedRows] = await connection.query(
      `${COMP_OFF_MANAGER_SELECT_SQL}
       WHERE c.id = ? AND c.reporting_manager = ? AND c.org_id = ?
       LIMIT 1`,
      [compoffId, reporting_manager, org_id],
    );

    return res.status(200).json({
      message:
        query_status === "approved"
          ? "Comp off request approved successfully"
          : "Comp off request rejected successfully",
      compoff_id: compoffId,
      credited_amount,
      result: mapCompOffManagerRow(updatedRows[0]),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) await connection.release();
  }
}