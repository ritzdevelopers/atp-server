import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker.js";

const VALID_LEAVE_DURATIONS = ["short_leave", "half_day", "full_day"];
const VALID_APPROVAL_ROLES = ["reporting_manager", "hr", "admin"];
const DELETABLE_LEAVE_STATUSES = ["pending", "rejected"];
const SHORT_LEAVE_MIN_TIME = "09:00:00";
const SHORT_LEAVE_MAX_TIME = "18:00:00";
const UNPAID_LEAVE_TYPE_ID = 0;
const UNPAID_LEAVE_TYPE_NAME = "Unpaid Leave";

function isUnpaidLeaveTypeId(leave_type_id) {
  return Number(leave_type_id) === UNPAID_LEAVE_TYPE_ID;
}

async function isUnpaidLeaveType(connection, leave_type_id, org_id) {
  if (isUnpaidLeaveTypeId(leave_type_id)) {
    return true;
  }

  const [rows] = await connection.query(
    `SELECT id FROM leave_types
     WHERE id = ? AND org_id = ? AND LOWER(leave_type_name) = LOWER(?)
     LIMIT 1`,
    [leave_type_id, org_id, UNPAID_LEAVE_TYPE_NAME],
  );
  return rows.length > 0;
}

async function resolveLeaveTypeIdForStorage(connection, leave_type_id, org_id) {
  if (!isUnpaidLeaveTypeId(leave_type_id)) {
    return Number(leave_type_id);
  }

  const [existing] = await connection.query(
    `SELECT id FROM leave_types
     WHERE org_id = ? AND LOWER(leave_type_name) = LOWER(?)
     LIMIT 1`,
    [org_id, UNPAID_LEAVE_TYPE_NAME],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }

  const [insertResult] = await connection.query(
    `INSERT INTO leave_types (org_id, leave_type_name) VALUES (?, ?)`,
    [org_id, UNPAID_LEAVE_TYPE_NAME],
  );
  return insertResult.insertId;
}

function isMissingLeaveTypeId(leave_type_id) {
  return (
    leave_type_id === undefined ||
    leave_type_id === null ||
    leave_type_id === ""
  );
}

function toDbNullable(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function calculateCalendarDays(start_date, end_date) {
  const start = new Date(`${start_date}T00:00:00`);
  const end = new Date(`${end_date}T00:00:00`);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

function isTimeWithinRange(timeStr, minTime, maxTime) {
  return (
    parseTimeToMinutes(timeStr) >= parseTimeToMinutes(minTime) &&
    parseTimeToMinutes(timeStr) <= parseTimeToMinutes(maxTime)
  );
}

async function validate_leave_type_and_employee_leave_balance(
  connection,
  leave_type_id,
  org_id,
  user_id,
  leave_days,
) {
  if (await isUnpaidLeaveType(connection, leave_type_id, org_id)) {
    return {
      success: true,
      message: "Unpaid leave does not require balance validation",
    };
  }

  const [rows] = await connection.query(
    "SELECT id FROM leave_types WHERE id = ? AND org_id = ?",
    [leave_type_id, org_id],
  );
  if (rows.length === 0) {
    return { success: false, message: "Leave type not found" };
  }

  const [leave_balance] = await connection.query(
    "SELECT remaining_leaves FROM employee_leave_balance WHERE user_id = ? AND org_id = ? AND leave_type_id = ?",
    [user_id, org_id, leave_type_id],
  );
  if (leave_balance.length === 0) {
    return { success: false, message: "Employee leave balance not found" };
  }
  if (Number(leave_balance[0].remaining_leaves) < Number(leave_days)) {
    return { success: false, message: "Employee leave balance is not enough" };
  }

  return {
    success: true,
    message: "Leave type and employee leave balance is valid",
  };
}

function validateLeaveQuery(query) {
  const {
    leave_type_id,
    leave_duration,
    start_date,
    end_date,
    leave_days,
    session_info,
    timing,
    reason,
  } = query;

  if (isMissingLeaveTypeId(leave_type_id)) {
    return { success: false, message: "Leave type is required" };
  }
  if (!VALID_LEAVE_DURATIONS.includes(leave_duration)) {
    return { success: false, message: "Invalid leave duration" };
  }
  if (!start_date || !end_date) {
    return { success: false, message: "Start date and end date are required" };
  }
  if (start_date > end_date) {
    return { success: false, message: "Start date is greater than end date" };
  }
  if (!reason || !String(reason).trim()) {
    return { success: false, message: "Reason is required" };
  }
  if (
    leave_days === undefined ||
    leave_days === null ||
    Number.isNaN(Number(leave_days)) ||
    Number(leave_days) <= 0
  ) {
    return { success: false, message: "Leave days must be a positive number" };
  }

  const parsedLeaveDays = Number(leave_days);

  if (leave_duration === "short_leave") {
    if (!timing) {
      return { success: false, message: "Timing is required for short leave" };
    }
    if (
      !isTimeWithinRange(timing, SHORT_LEAVE_MIN_TIME, SHORT_LEAVE_MAX_TIME)
    ) {
      return {
        success: false,
        message: "Timing must be between 09:00:00 and 18:00:00",
      };
    }
    if (start_date !== end_date) {
      return {
        success: false,
        message: "Short leave must be for a single day",
      };
    }
    if (parsedLeaveDays > 1) {
      return {
        success: false,
        message: "Leave days must not exceed 1 for short leave",
      };
    }
  }

  if (leave_duration === "half_day") {
    if (!session_info) {
      return {
        success: false,
        message: "Session info is required for half day leave",
      };
    }
    if (session_info !== "session_1" && session_info !== "session_2") {
      return {
        success: false,
        message: "Session info must be either session_1 or session_2",
      };
    }
    if (start_date !== end_date) {
      return {
        success: false,
        message: "Half day leave must be for a single day",
      };
    }
    if (parsedLeaveDays !== 0.5) {
      return {
        success: false,
        message: "Leave days must be 0.5 for half day leave",
      };
    }
  }

  if (leave_duration === "full_day") {
    const expectedDays = calculateCalendarDays(start_date, end_date);
    if (parsedLeaveDays !== expectedDays) {
      return {
        success: false,
        message: `Leave days must be ${expectedDays} for the selected date range`,
      };
    }
  }

  return { success: true, parsedLeaveDays };
}

function validateLeaveReviewer(reviewer) {
  const reviewer_id =
    typeof reviewer === "object" ? reviewer.reviewer_id : reviewer;
  const approval_role =
    typeof reviewer === "object" ? reviewer.approval_role : undefined;
  const approval_role_id =
    typeof reviewer === "object" ? reviewer.approval_role_id : undefined;

  if (!reviewer_id) {
    return { success: false, message: "Reviewer ID is required" };
  }
  if (!approval_role || !VALID_APPROVAL_ROLES.includes(approval_role)) {
    return {
      success: false,
      message: "Approval role must be reporting_manager, hr, or admin",
    };
  }
  if (!approval_role_id) {
    return { success: false, message: "Approval role ID is required" };
  }

  return { success: true, reviewer_id, approval_role, approval_role_id };
}

function formatDateValue(value) {
  if (!value) return value;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function normalizeLeaveByDuration(leave) {
  const normalized = { ...leave };

  if (normalized.leave_duration === "full_day") {
    normalized.session_info = null;
    normalized.timing = null;
  } else if (normalized.leave_duration === "half_day") {
    normalized.timing = null;
  } else if (normalized.leave_duration === "short_leave") {
    normalized.session_info = null;
  }

  return normalized;
}

function mergeLeaveUpdate(existing, updates) {
  const merged = normalizeLeaveByDuration({
    leave_type_id: updates.leave_type_id ?? existing.leave_type_id,
    leave_duration: updates.leave_duration ?? existing.leave_duration,
    start_date: updates.start_date ?? formatDateValue(existing.start_date),
    end_date: updates.end_date ?? formatDateValue(existing.end_date),
    leave_days: updates.leave_days ?? existing.leave_days,
    reason: updates.reason ?? existing.reason,
    team_id: updates.team_id !== undefined ? updates.team_id : existing.team_id,
    session_info:
      updates.session_info !== undefined
        ? updates.session_info
        : existing.session_info,
    timing: updates.timing !== undefined ? updates.timing : existing.timing,
  });

  if (
    merged.leave_duration === "half_day" &&
    updates.leave_days === undefined
  ) {
    merged.leave_days = 0.5;
  }

  if (
    merged.leave_duration === "full_day" &&
    updates.leave_days === undefined &&
    (updates.start_date !== undefined || updates.end_date !== undefined)
  ) {
    merged.leave_days = calculateCalendarDays(
      merged.start_date,
      merged.end_date,
    );
  }

  return merged;
}

function hasLeaveFieldUpdates(updates) {
  const leaveFields = [
    "reason",
    "start_date",
    "end_date",
    "leave_duration",
    "leave_type_id",
    "leave_days",
    "session_info",
    "timing",
    "team_id",
  ];
  return leaveFields.some((field) => updates[field] !== undefined);
}

export const createLeave = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { leave_query, leave_reviewer } = req.body;
    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    if (!Array.isArray(leave_query) || leave_query.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Leave query is required" });
    }

    if (!Array.isArray(leave_reviewer) || leave_reviewer.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Leave reviewer is required" });
    }

    const validatedReviewers = [];
    for (const reviewer of leave_reviewer) {
      const reviewerValidation = validateLeaveReviewer(reviewer);
      if (!reviewerValidation.success) {
        await connection.rollback();
        return res.status(400).json({ message: reviewerValidation.message });
      }

      if (
        !(await isEmployeeExists(
          connection,
          reviewerValidation.reviewer_id,
          org_id,
        ))
      ) {
        await connection.rollback();
        return res.status(404).json({ message: "Reviewer not found" });
      }

      validatedReviewers.push(reviewerValidation);
    }

    const createdLeaveIds = [];

    for (const query of leave_query) {
      const fieldValidation = validateLeaveQuery(query);
      if (!fieldValidation.success) {
        await connection.rollback();
        return res.status(400).json({ message: fieldValidation.message });
      }

      const {
        team_id,
        leave_type_id,
        leave_duration,
        start_date,
        end_date,
        leave_days,
        session_info,
        timing,
        reason,
      } = query;

      const balanceValidation = isUnpaidLeaveTypeId(leave_type_id)
        ? { success: true }
        : await validate_leave_type_and_employee_leave_balance(
            connection,
            leave_type_id,
            org_id,
            user_id,
            fieldValidation.parsedLeaveDays,
          );
      if (!balanceValidation.success) {
        await connection.rollback();
        return res.status(400).json({ message: balanceValidation.message });
      }

      // No team_id → employee is not on a team and reports directly to HR.
      // If team_id is sent by the client, use it as-is (no team lookup on create).
      const resolvedTeamId =
        team_id !== undefined && team_id !== null && team_id !== ""
          ? Number(team_id)
          : null;

      const storedLeaveTypeId = await resolveLeaveTypeIdForStorage(
        connection,
        leave_type_id,
        org_id,
      );

      const [insertLeaveResult] = await connection.query(
        `INSERT INTO employee_leave
          (user_id, org_id, team_id, leave_type_id, leave_duration, start_date, end_date, leave_days, session_info, timing, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          org_id,
          resolvedTeamId,
          storedLeaveTypeId,
          leave_duration,
          start_date,
          end_date,
          leave_days,
          toDbNullable(session_info),
          toDbNullable(timing),
          reason,
        ],
      );

      const leaveId = insertLeaveResult.insertId;
      createdLeaveIds.push(leaveId);

      for (const reviewer of validatedReviewers) {
        await connection.query(
          `INSERT INTO leave_reviewer
            (leave_query_id, reviewer_id, approval_role, approval_role_id)
           VALUES (?, ?, ?, ?)`,
          [
            leaveId,
            reviewer.reviewer_id,
            reviewer.approval_role,
            reviewer.approval_role_id,
          ],
        );
      }
    }

    await connection.commit();
    return res.status(201).json({
      message: "Leave query created successfully",
      leave_ids: createdLeaveIds,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const updateLeave = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { id } = req.params;
    const { user_id } = req.user;
    const org_id = req.org_id;
    const { leave_reviewer, ...leaveUpdates } = req.body;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    const [existingRows] = await connection.query(
      `SELECT id, user_id, org_id, team_id, leave_type_id, leave_duration,
              start_date, end_date, leave_days, session_info, timing, reason, leave_status
       FROM employee_leave
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [id, user_id, org_id],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave not found" });
    }

    const existingLeave = existingRows[0];

    if (existingLeave.leave_status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        message: "Only pending leave requests can be updated",
      });
    }

    const hasReviewerUpdates =
      Array.isArray(leave_reviewer) && leave_reviewer.length > 0;
    const hasFieldUpdates = hasLeaveFieldUpdates(leaveUpdates);

    if (!hasReviewerUpdates && !hasFieldUpdates) {
      await connection.rollback();
      return res.status(400).json({ message: "No valid fields to update" });
    }

    if (hasFieldUpdates) {
      const mergedLeave = mergeLeaveUpdate(existingLeave, leaveUpdates);
      const fieldValidation = validateLeaveQuery(mergedLeave);

      if (!fieldValidation.success) {
        await connection.rollback();
        return res.status(400).json({ message: fieldValidation.message });
      }

      const leaveTypeChanged =
        mergedLeave.leave_type_id !== existingLeave.leave_type_id;
      const leaveDaysChanged =
        Number(mergedLeave.leave_days) !== Number(existingLeave.leave_days);

      if (leaveTypeChanged || leaveDaysChanged) {
        const balanceValidation =
          isUnpaidLeaveTypeId(mergedLeave.leave_type_id) ||
          (await isUnpaidLeaveType(
            connection,
            mergedLeave.leave_type_id,
            org_id,
          ))
            ? { success: true }
            : await validate_leave_type_and_employee_leave_balance(
                connection,
                mergedLeave.leave_type_id,
                org_id,
                user_id,
                fieldValidation.parsedLeaveDays,
              );
        if (!balanceValidation.success) {
          await connection.rollback();
          return res.status(400).json({ message: balanceValidation.message });
        }
      }

      if (mergedLeave.team_id) {
        const [team] = await connection.query(
          "SELECT id FROM org_teams WHERE id = ? AND org_id = ?",
          [mergedLeave.team_id, org_id],
        );
        if (team.length === 0) {
          await connection.rollback();
          return res.status(404).json({ message: "Team not found" });
        }
      }

      const storedLeaveTypeId = await resolveLeaveTypeIdForStorage(
        connection,
        mergedLeave.leave_type_id,
        org_id,
      );

      const [updateResult] = await connection.query(
        `UPDATE employee_leave
         SET team_id = ?, leave_type_id = ?, leave_duration = ?, start_date = ?,
             end_date = ?, leave_days = ?, session_info = ?, timing = ?, reason = ?
         WHERE id = ? AND user_id = ? AND org_id = ? AND leave_status = 'pending'`,
        [
          mergedLeave.team_id ?? null,
          storedLeaveTypeId,
          mergedLeave.leave_duration,
          mergedLeave.start_date,
          mergedLeave.end_date,
          mergedLeave.leave_days,
          toDbNullable(mergedLeave.session_info),
          toDbNullable(mergedLeave.timing),
          mergedLeave.reason,
          id,
          user_id,
          org_id,
        ],
      );

      if (!updateResult.affectedRows) {
        await connection.rollback();
        return res.status(400).json({ message: "Failed to update leave" });
      }
    }

    const addedReviewerIds = [];

    if (hasReviewerUpdates) {
      const [existingReviewers] = await connection.query(
        "SELECT reviewer_id FROM leave_reviewer WHERE leave_query_id = ?",
        [id],
      );
      const existingReviewerIds = new Set(
        existingReviewers.map((row) => row.reviewer_id),
      );

      for (const reviewer of leave_reviewer) {
        const reviewerValidation = validateLeaveReviewer(reviewer);
        if (!reviewerValidation.success) {
          await connection.rollback();
          return res.status(400).json({ message: reviewerValidation.message });
        }

        if (existingReviewerIds.has(reviewerValidation.reviewer_id)) {
          await connection.rollback();
          return res.status(400).json({
            message: `Reviewer ${reviewerValidation.reviewer_id} is already assigned to this leave`,
          });
        }

        if (
          !(await isEmployeeExists(
            connection,
            reviewerValidation.reviewer_id,
            org_id,
          ))
        ) {
          await connection.rollback();
          return res.status(404).json({ message: "Reviewer not found" });
        }

        await connection.query(
          `INSERT INTO leave_reviewer
            (leave_query_id, reviewer_id, approval_role, approval_role_id)
           VALUES (?, ?, ?, ?)`,
          [
            id,
            reviewerValidation.reviewer_id,
            reviewerValidation.approval_role,
            reviewerValidation.approval_role_id,
          ],
        );

        existingReviewerIds.add(reviewerValidation.reviewer_id);
        addedReviewerIds.push(reviewerValidation.reviewer_id);
      }
    }

    await connection.commit();
    return res.status(200).json({
      message: "Leave updated successfully",
      leave_id: Number(id),
      added_reviewer_ids: addedReviewerIds,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const deleteLeave = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { id } = req.params;
    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!id || Number.isNaN(Number(id))) {
      await connection.rollback();
      return res.status(400).json({ message: "Valid leave ID is required" });
    }

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    const [existingRows] = await connection.query(
      `SELECT id, leave_status
       FROM employee_leave
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [id, user_id, org_id],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave not found" });
    }

    const { leave_status } = existingRows[0];

    if (leave_status === "approved") {
      await connection.rollback();
      return res.status(400).json({
        message: "Approved leave requests cannot be deleted",
      });
    }

    if (!DELETABLE_LEAVE_STATUSES.includes(leave_status)) {
      await connection.rollback();
      return res.status(400).json({
        message: "Only pending or rejected leave requests can be deleted",
      });
    }

    await connection.query(
      "DELETE FROM leave_reviewer WHERE leave_query_id = ?",
      [id],
    );

    const [deleteResult] = await connection.query(
      `DELETE FROM employee_leave
       WHERE id = ? AND user_id = ? AND org_id = ? AND leave_status IN (?, ?)`,
      [id, user_id, org_id, "pending", "rejected"],
    );

    if (!deleteResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({ message: "Failed to delete leave" });
    }

    await connection.commit();
    return res.status(200).json({
      message: "Leave deleted successfully",
      leave_id: Number(id),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

function formatTimeValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 8);
  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }
  return String(value);
}

function mapReviewerRow(reviewer) {
  return {
    reviewer_id: reviewer.reviewer_id,
    leave_query_id: reviewer.leave_query_id,
    query_status: reviewer.query_status,
    approval_role: reviewer.approval_role,
    approval_role_id: reviewer.approval_role_id,
    review_comment: reviewer.review_comment ?? null,
    reviewer_name: reviewer.reviewer_name,
    reviewer_code: reviewer.reviewer_code ?? null,
    reviewer_email: reviewer.reviewer_email,
    reviewer_role_name: reviewer.reviewer_role_name ?? null,
    reviewer_emp_code: reviewer.reviewer_emp_code ?? null,
  };
}

function mapLeaveRow(leave, employeeInfo, reviewers) {
  return {
    id: leave.id,
    user_id: leave.user_id,
    org_id: leave.org_id,
    team_id: leave.team_id ?? null,
    team_name: leave.team_name ?? null,
    team_leader_id: leave.team_leader_id ?? null,
    team_leader_name: leave.team_leader_name ?? null,
    leave_type_id: leave.leave_type_id,
    leave_type_name: leave.leave_type_name,
    leave_duration: leave.leave_duration,
    start_date: formatDateValue(leave.start_date),
    end_date: formatDateValue(leave.end_date),
    leave_days: Number(leave.leave_days),
    session_info: leave.session_info ?? null,
    timing: formatTimeValue(leave.timing),
    reason: leave.reason,
    leave_status: leave.leave_status,
    created_at: leave.created_at,
    updated_at: leave.updated_at,
    employee_name: employeeInfo.employee_name ?? null,
    employee_code: employeeInfo.employee_code ?? null,
    employee_email: employeeInfo.employee_email ?? null,
    employee_role_name: employeeInfo.employee_role_name ?? null,
    emp_code: employeeInfo.emp_code ?? null,
    reviewers_info: reviewers,
  };
}

export const get_my_all_leaves = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [employeeRows] = await connection.query(
      `SELECT
        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        om.emp_code AS employee_code,
        om.emp_code AS emp_code,
        ar.role_name AS employee_role_name
      FROM apt_users emp
      INNER JOIN apt_org_members om
        ON om.user_id = emp.id AND om.org_id = ? AND om.is_active = 1
      LEFT JOIN apt_user_roles aur
        ON aur.user_id = emp.id AND aur.org_id = ?
      LEFT JOIN apt_roles ar
        ON ar.id = aur.role_id AND ar.org_id = ?
      WHERE emp.id = ?
      LIMIT 1`,
      [org_id, org_id, org_id, user_id],
    );

    const employeeInfo = employeeRows[0] ?? {};

    const [leaveRows] = await connection.query(
      `SELECT
        el.id,
        el.user_id,
        el.org_id,
        el.team_id,
        ot.team_name,
        ot.admin_id AS team_leader_id,
        team_leader.user_name AS team_leader_name,
        el.leave_type_id,
        COALESCE(lt.leave_type_name, 'Unpaid Leave') AS leave_type_name,
        el.leave_duration,
        el.start_date,
        el.end_date,
        el.leave_days,
        el.session_info,
        el.timing,
        el.reason,
        el.leave_status,
        el.created_at,
        el.updated_at
      FROM employee_leave el
      LEFT JOIN org_teams ot
        ON ot.id = el.team_id AND ot.org_id = el.org_id
      LEFT JOIN apt_users team_leader
        ON team_leader.id = ot.admin_id
      LEFT JOIN leave_types lt
        ON lt.id = el.leave_type_id AND lt.org_id = el.org_id
      WHERE el.user_id = ? AND el.org_id = ?
      ORDER BY el.created_at DESC`,
      [user_id, org_id],
    );

    if (leaveRows.length === 0) {
      return res.status(200).json({ result: [] });
    }

    const leaveIds = leaveRows.map((leave) => leave.id);

    const [reviewerRows] = await connection.query(
      `SELECT
        lr.reviewer_id,
        lr.leave_query_id,
        lr.query_status,
        lr.approval_role,
        lr.approval_role_id,
        lr.review_comment,
        reviewer.user_name AS reviewer_name,
        reviewer.user_email AS reviewer_email,
        rom.emp_code AS reviewer_code,
        rom.emp_code AS reviewer_emp_code,
        rr.role_name AS reviewer_role_name
      FROM leave_reviewer lr
      INNER JOIN apt_users reviewer
        ON reviewer.id = lr.reviewer_id
      LEFT JOIN apt_org_members rom
        ON rom.user_id = lr.reviewer_id AND rom.org_id = ?
      LEFT JOIN apt_user_roles rur
        ON rur.user_id = lr.reviewer_id AND rur.org_id = ?
      LEFT JOIN apt_roles rr
        ON rr.id = rur.role_id AND rr.org_id = ?
      WHERE lr.leave_query_id IN (?)
      ORDER BY lr.created_at ASC`,
      [org_id, org_id, org_id, leaveIds],
    );

    const reviewersByLeaveId = reviewerRows.reduce((acc, reviewer) => {
      const leaveId = reviewer.leave_query_id;
      if (!acc[leaveId]) {
        acc[leaveId] = [];
      }
      acc[leaveId].push(mapReviewerRow(reviewer));
      return acc;
    }, {});

    const result = leaveRows.map((leave) =>
      mapLeaveRow(leave, employeeInfo, reviewersByLeaveId[leave.id] ?? []),
    );

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

function pushUniqueReviewer(reviewers, seen, reviewer) {
  const key = `${reviewer.reviewer_id}-${reviewer.approval_role}`;
  if (seen.has(key)) return;
  seen.add(key);
  reviewers.push(reviewer);
}

async function fetchOrgHrAndAdminReviewers(connection, org_id) {
  const reviewers = [];
  const seen = new Set();

  const [adminRows] = await connection.query(
    `SELECT
      admin_user.id AS reviewer_id,
      admin_user.user_name AS reviewer_name,
      admin_user.user_email AS reviewer_email,
      om.emp_code AS reviewer_emp_code,
      aur.role_id AS approval_role_id
    FROM apt_organizations org
    INNER JOIN apt_users admin_user ON admin_user.id = org.owner_id
    INNER JOIN apt_org_members om
      ON om.user_id = admin_user.id AND om.org_id = org.id AND om.is_active = 1
    INNER JOIN apt_user_roles aur
      ON aur.user_id = admin_user.id AND aur.org_id = org.id
    INNER JOIN apt_roles ar
      ON ar.id = aur.role_id AND ar.org_id = org.id AND ar.role_name = 'admin'
    WHERE org.id = ?`,
    [org_id],
  );

  for (const row of adminRows) {
    pushUniqueReviewer(reviewers, seen, {
      reviewer_id: row.reviewer_id,
      reviewer_name: row.reviewer_name,
      reviewer_email: row.reviewer_email,
      reviewer_emp_code: row.reviewer_emp_code ?? null,
      approval_role: "admin",
      approval_role_id: row.approval_role_id,
      team_id: null,
      team_name: null,
    });
  }

  const [hrRows] = await connection.query(
    `SELECT
      hr_user.id AS reviewer_id,
      hr_user.user_name AS reviewer_name,
      hr_user.user_email AS reviewer_email,
      om.emp_code AS reviewer_emp_code,
      aur.role_id AS approval_role_id
    FROM apt_user_roles aur
    INNER JOIN apt_roles ar
      ON ar.id = aur.role_id AND ar.org_id = aur.org_id AND ar.role_name = 'hr'
    INNER JOIN apt_users hr_user ON hr_user.id = aur.user_id
    INNER JOIN apt_org_members om
      ON om.user_id = hr_user.id AND om.org_id = aur.org_id AND om.is_active = 1
    WHERE aur.org_id = ?`,
    [org_id],
  );

  for (const row of hrRows) {
    pushUniqueReviewer(reviewers, seen, {
      reviewer_id: row.reviewer_id,
      reviewer_name: row.reviewer_name,
      reviewer_email: row.reviewer_email,
      reviewer_emp_code: row.reviewer_emp_code ?? null,
      approval_role: "hr",
      approval_role_id: row.approval_role_id,
      team_id: null,
      team_name: null,
    });
  }

  return reviewers;
}

async function insertLeaveReviewersIfMissing(connection, leaveId, reviewers) {
  for (const reviewer of reviewers) {
    const [existing] = await connection.query(
      `SELECT id
       FROM leave_reviewer
       WHERE leave_query_id = ? AND reviewer_id = ? AND approval_role = ?
       LIMIT 1`,
      [leaveId, reviewer.reviewer_id, reviewer.approval_role],
    );
    if (existing.length > 0) continue;

    await connection.query(
      `INSERT INTO leave_reviewer
        (leave_query_id, reviewer_id, approval_role, approval_role_id)
       VALUES (?, ?, ?, ?)`,
      [
        leaveId,
        reviewer.reviewer_id,
        reviewer.approval_role,
        reviewer.approval_role_id,
      ],
    );
  }
}

async function assertHrAdminCanReview(connection, leaveId) {
  const [rmRows] = await connection.query(
    `SELECT query_status
     FROM leave_reviewer
     WHERE leave_query_id = ? AND approval_role = 'reporting_manager'
     LIMIT 1`,
    [leaveId],
  );

  if (rmRows.length === 0) {
    return { success: true };
  }

  const rmStatus = rmRows[0].query_status;
  if (rmStatus === "pending") {
    return {
      success: false,
      message: "Reporting manager approval is required before HR or admin review",
    };
  }
  if (rmStatus === "rejected") {
    return {
      success: false,
      message: "Leave was rejected by the reporting manager",
    };
  }

  return { success: true };
}

function mapReviewerLeaveRow(leave, employeeInfo, reviewers, myReview) {
  return {
    ...mapLeaveRow(leave, employeeInfo, reviewers),
    my_reviewer_row_id: myReview.id,
    my_approval_role: myReview.approval_role,
    my_query_status: myReview.query_status,
    my_designation:
      myReview.designation_name ?? myReview.approval_role ?? null,
    my_review_comment: myReview.review_comment ?? null,
  };
}

export const get_leave_reviewers = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const { team_id: teamIdQuery, scope } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (scope === "hr_admin") {
      const reviewers = await fetchOrgHrAndAdminReviewers(connection, org_id);
      return res.status(200).json({ result: reviewers });
    }

    const [[employeeRole]] = await connection.query(
      `SELECT id AS approval_role_id
       FROM apt_roles
       WHERE org_id = ? AND role_name = 'employee'
       LIMIT 1`,
      [org_id],
    );
    const fallbackRoleId = employeeRole?.approval_role_id ?? null;

    const reviewers = [];
    const seen = new Set();

    const [adminRows] = await connection.query(
      `SELECT
        admin_user.id AS reviewer_id,
        admin_user.user_name AS reviewer_name,
        admin_user.user_email AS reviewer_email,
        om.emp_code AS reviewer_emp_code,
        aur.role_id AS approval_role_id
      FROM apt_organizations org
      INNER JOIN apt_users admin_user ON admin_user.id = org.owner_id
      INNER JOIN apt_org_members om
        ON om.user_id = admin_user.id AND om.org_id = org.id AND om.is_active = 1
      INNER JOIN apt_user_roles aur
        ON aur.user_id = admin_user.id AND aur.org_id = org.id
      INNER JOIN apt_roles ar
        ON ar.id = aur.role_id AND ar.org_id = org.id AND ar.role_name = 'admin'
      WHERE org.id = ?`,
      [org_id],
    );

    for (const row of adminRows) {
      pushUniqueReviewer(reviewers, seen, {
        reviewer_id: row.reviewer_id,
        reviewer_name: row.reviewer_name,
        reviewer_email: row.reviewer_email,
        reviewer_emp_code: row.reviewer_emp_code ?? null,
        approval_role: "admin",
        approval_role_id: row.approval_role_id,
        team_id: null,
        team_name: null,
      });
    }

    const [hrRows] = await connection.query(
      `SELECT
        hr_user.id AS reviewer_id,
        hr_user.user_name AS reviewer_name,
        hr_user.user_email AS reviewer_email,
        om.emp_code AS reviewer_emp_code,
        aur.role_id AS approval_role_id
      FROM apt_user_roles aur
      INNER JOIN apt_roles ar
        ON ar.id = aur.role_id AND ar.org_id = aur.org_id AND ar.role_name = 'hr'
      INNER JOIN apt_users hr_user ON hr_user.id = aur.user_id
      INNER JOIN apt_org_members om
        ON om.user_id = hr_user.id AND om.org_id = aur.org_id AND om.is_active = 1
      WHERE aur.org_id = ?`,
      [org_id],
    );

    for (const row of hrRows) {
      pushUniqueReviewer(reviewers, seen, {
        reviewer_id: row.reviewer_id,
        reviewer_name: row.reviewer_name,
        reviewer_email: row.reviewer_email,
        reviewer_emp_code: row.reviewer_emp_code ?? null,
        approval_role: "hr",
        approval_role_id: row.approval_role_id,
        team_id: null,
        team_name: null,
      });
    }

    const reportingManagerParams = [user_id, org_id];
    let reportingManagerFilter = "";
    if (teamIdQuery && !Number.isNaN(Number(teamIdQuery))) {
      reportingManagerFilter = " AND ot.id = ?";
      reportingManagerParams.push(Number(teamIdQuery));
    }

    const [reportingManagerRows] = await connection.query(
      `SELECT DISTINCT
        team_leader.id AS reviewer_id,
        team_leader.user_name AS reviewer_name,
        team_leader.user_email AS reviewer_email,
        rom.emp_code AS reviewer_emp_code,
        COALESCE(tl_aur.role_id, ?) AS approval_role_id,
        ot.id AS team_id,
        ot.team_name
      FROM team_members tm
      INNER JOIN org_teams ot
        ON ot.id = tm.team_id AND ot.org_id = tm.org_id
      INNER JOIN apt_users team_leader
        ON team_leader.id = ot.admin_id
      INNER JOIN apt_org_members rom
        ON rom.user_id = team_leader.id AND rom.org_id = tm.org_id AND rom.is_active = 1
      LEFT JOIN apt_user_roles tl_aur
        ON tl_aur.user_id = team_leader.id AND tl_aur.org_id = tm.org_id
      WHERE tm.user_id = ?
        AND tm.org_id = ?
        AND tm.leave_date IS NULL
        ${reportingManagerFilter}`,
      [fallbackRoleId, ...reportingManagerParams],
    );

    for (const row of reportingManagerRows) {
      if (!row.approval_role_id) continue;
      pushUniqueReviewer(reviewers, seen, {
        reviewer_id: row.reviewer_id,
        reviewer_name: row.reviewer_name,
        reviewer_email: row.reviewer_email,
        reviewer_emp_code: row.reviewer_emp_code ?? null,
        approval_role: "reporting_manager",
        approval_role_id: row.approval_role_id,
        team_id: row.team_id,
        team_name: row.team_name,
      });
    }

    return res.status(200).json({ result: reviewers });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const get_single_leave = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { id } = req.params;
    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!id || Number.isNaN(Number(id))) {
      return res.status(400).json({ message: "Valid leave ID is required" });
    }

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [leaveRows] = await connection.query(
      `SELECT
        el.id,
        el.user_id,
        el.org_id,
        el.team_id,
        ot.team_name,
        ot.admin_id AS team_leader_id,
        team_leader.user_name AS team_leader_name,
        el.leave_type_id,
        COALESCE(lt.leave_type_name, 'Unpaid Leave') AS leave_type_name,
        el.leave_duration,
        el.start_date,
        el.end_date,
        el.leave_days,
        el.session_info,
        el.timing,
        el.reason,
        el.leave_status,
        el.created_at,
        el.updated_at
      FROM employee_leave el
      LEFT JOIN org_teams ot
        ON ot.id = el.team_id AND ot.org_id = el.org_id
      LEFT JOIN apt_users team_leader
        ON team_leader.id = ot.admin_id
      LEFT JOIN leave_types lt
        ON lt.id = el.leave_type_id AND lt.org_id = el.org_id
      WHERE el.id = ? AND el.user_id = ? AND el.org_id = ?`,
      [id, user_id, org_id],
    );

    if (leaveRows.length === 0) {
      return res.status(404).json({ message: "Leave not found" });
    }

    const leave = leaveRows[0];

    const [employeeRows] = await connection.query(
      `SELECT
        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        om.emp_code AS employee_code,
        om.emp_code AS emp_code,
        ar.role_name AS employee_role_name
      FROM apt_users emp
      INNER JOIN apt_org_members om
        ON om.user_id = emp.id AND om.org_id = ? AND om.is_active = 1
      LEFT JOIN apt_user_roles aur
        ON aur.user_id = emp.id AND aur.org_id = ?
      LEFT JOIN apt_roles ar
        ON ar.id = aur.role_id AND ar.org_id = ?
      WHERE emp.id = ?
      LIMIT 1`,
      [org_id, org_id, org_id, user_id],
    );

    const [reviewerRows] = await connection.query(
      `SELECT
        lr.reviewer_id,
        lr.leave_query_id,
        lr.query_status,
        lr.approval_role,
        lr.approval_role_id,
        lr.review_comment,
        reviewer.user_name AS reviewer_name,
        reviewer.user_email AS reviewer_email,
        rom.emp_code AS reviewer_code,
        rom.emp_code AS reviewer_emp_code,
        rr.role_name AS reviewer_role_name
      FROM leave_reviewer lr
      INNER JOIN apt_users reviewer
        ON reviewer.id = lr.reviewer_id
      LEFT JOIN apt_org_members rom
        ON rom.user_id = lr.reviewer_id AND rom.org_id = ?
      LEFT JOIN apt_user_roles rur
        ON rur.user_id = lr.reviewer_id AND rur.org_id = ?
      LEFT JOIN apt_roles rr
        ON rr.id = rur.role_id AND rr.org_id = ?
      WHERE lr.leave_query_id = ?
      ORDER BY lr.created_at ASC`,
      [org_id, org_id, org_id, id],
    );

    return res.status(200).json({
      result: mapLeaveRow(
        leave,
        employeeRows[0] ?? {},
        reviewerRows.map(mapReviewerRow),
      ),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const get_leaves_where_i_am_reviewer = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const {
      leave_duration: leaveDurationQuery,
      leave_status: leaveStatusQuery,
      my_query_status: myQueryStatusQuery,
      user_name: userNameQuery,
      created_at: createdAtQuery,
      is_ascending: isAscendingQuery,
    } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const leaveParams = [user_id, org_id];
    const leaveFilters = [
      "lr.reviewer_id = ?",
      "el.org_id = ?",
    ];

    if (leaveDurationQuery && VALID_LEAVE_DURATIONS.includes(leaveDurationQuery)) {
      leaveFilters.push("el.leave_duration = ?");
      leaveParams.push(leaveDurationQuery);
    }
    if (
      leaveStatusQuery &&
      ["pending", "approved", "rejected"].includes(leaveStatusQuery)
    ) {
      leaveFilters.push("el.leave_status = ?");
      leaveParams.push(leaveStatusQuery);
    }
    if (
      myQueryStatusQuery &&
      ["pending", "approved", "rejected"].includes(myQueryStatusQuery)
    ) {
      leaveFilters.push("lr.query_status = ?");
      leaveParams.push(myQueryStatusQuery);
    }
    if (userNameQuery && String(userNameQuery).trim()) {
      leaveFilters.push("emp.user_name = ?");
      leaveParams.push(String(userNameQuery).trim());
    }
    if (createdAtQuery) {
      leaveFilters.push("DATE(el.created_at) = ?");
      leaveParams.push(createdAtQuery);
    }

    const sortDirection =
      String(isAscendingQuery).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [leaveRows] = await connection.query(
      `SELECT
        el.id,
        el.user_id,
        el.org_id,
        el.team_id,
        ot.team_name,
        ot.admin_id AS team_leader_id,
        team_leader.user_name AS team_leader_name,
        el.leave_type_id,
        COALESCE(lt.leave_type_name, 'Unpaid Leave') AS leave_type_name,
        el.leave_duration,
        el.start_date,
        el.end_date,
        el.leave_days,
        el.session_info,
        el.timing,
        el.reason,
        el.leave_status,
        el.created_at,
        el.updated_at,
        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        om.emp_code AS employee_code,
        om.emp_code AS emp_code,
        ear.role_name AS employee_role_name,
        lr.id AS my_reviewer_row_id,
        lr.query_status AS my_query_status,
        lr.approval_role AS my_approval_role,
        lr.review_comment AS my_review_comment,
        ar.role_name AS my_designation
      FROM leave_reviewer lr
      INNER JOIN employee_leave el
        ON el.id = lr.leave_query_id AND el.org_id = ?
      INNER JOIN apt_users emp
        ON emp.id = el.user_id
      LEFT JOIN apt_org_members om
        ON om.user_id = emp.id AND om.org_id = el.org_id AND om.is_active = 1
      LEFT JOIN apt_user_roles eaur
        ON eaur.user_id = emp.id AND eaur.org_id = el.org_id
      LEFT JOIN apt_roles ear
        ON ear.id = eaur.role_id AND ear.org_id = el.org_id
      LEFT JOIN org_teams ot
        ON ot.id = el.team_id AND ot.org_id = el.org_id
      LEFT JOIN apt_users team_leader
        ON team_leader.id = ot.admin_id
      LEFT JOIN leave_types lt
        ON lt.id = el.leave_type_id AND lt.org_id = el.org_id
      LEFT JOIN apt_roles ar
        ON ar.id = lr.approval_role_id AND ar.org_id = el.org_id
      WHERE ${leaveFilters.join(" AND ")}
      ORDER BY el.created_at ${sortDirection}`,
      [org_id, ...leaveParams],
    );

    if (leaveRows.length === 0) {
      return res.status(200).json({ result: [] });
    }

    const leaveIds = leaveRows.map((leave) => leave.id);

    const [reviewerRows] = await connection.query(
      `SELECT
        lr.id,
        lr.reviewer_id,
        lr.leave_query_id,
        lr.query_status,
        lr.approval_role,
        lr.approval_role_id,
        lr.review_comment,
        reviewer.user_name AS reviewer_name,
        reviewer.user_email AS reviewer_email,
        rom.emp_code AS reviewer_code,
        rom.emp_code AS reviewer_emp_code,
        rr.role_name AS reviewer_role_name
      FROM leave_reviewer lr
      INNER JOIN apt_users reviewer
        ON reviewer.id = lr.reviewer_id
      LEFT JOIN apt_org_members rom
        ON rom.user_id = lr.reviewer_id AND rom.org_id = ?
      LEFT JOIN apt_user_roles rur
        ON rur.user_id = lr.reviewer_id AND rur.org_id = ?
      LEFT JOIN apt_roles rr
        ON rr.id = rur.role_id AND rr.org_id = ?
      WHERE lr.leave_query_id IN (?)
      ORDER BY lr.created_at ASC`,
      [org_id, org_id, org_id, leaveIds],
    );

    const reviewersByLeaveId = reviewerRows.reduce((acc, reviewer) => {
      const leaveId = reviewer.leave_query_id;
      if (!acc[leaveId]) {
        acc[leaveId] = [];
      }
      acc[leaveId].push(mapReviewerRow(reviewer));
      return acc;
    }, {});

    const result = leaveRows.map((leave) => {
      const employeeInfo = {
        employee_name: leave.employee_name,
        employee_email: leave.employee_email,
        employee_code: leave.employee_code,
        emp_code: leave.emp_code,
        employee_role_name: leave.employee_role_name,
      };
      const myReview = {
        id: leave.my_reviewer_row_id,
        approval_role: leave.my_approval_role,
        query_status: leave.my_query_status,
        review_comment: leave.my_review_comment,
        designation_name: leave.my_designation,
      };
      const { my_reviewer_row_id, my_query_status, my_approval_role, my_review_comment, my_designation, employee_name, employee_email, employee_code, emp_code, employee_role_name, ...leaveCore } = leave;
      return mapReviewerLeaveRow(
        leaveCore,
        employeeInfo,
        reviewersByLeaveId[leave.id] ?? [],
        myReview,
      );
    });

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const perform_leave_review = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const { leave_id, action, review_comment } = req.body;

    if (!leave_id || Number.isNaN(Number(leave_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "Valid leave ID is required" });
    }

    if (!action || !["approved", "rejected"].includes(action)) {
      await connection.rollback();
      return res.status(400).json({
        message: "Action must be approved or rejected",
      });
    }

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    const [leaveRows] = await connection.query(
      `SELECT id, leave_status
       FROM employee_leave
       WHERE id = ? AND org_id = ?
       LIMIT 1`,
      [leave_id, org_id],
    );

    if (leaveRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave not found" });
    }

    const leave = leaveRows[0];

    const [myReviewerRows] = await connection.query(
      `SELECT id, approval_role, query_status
       FROM leave_reviewer
       WHERE leave_query_id = ? AND reviewer_id = ?
       LIMIT 1`,
      [leave_id, user_id],
    );

    if (myReviewerRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({ message: "You are not a reviewer for this leave" });
    }

    const myReviewer = myReviewerRows[0];

    if (
      leave.leave_status !== "pending" &&
      (myReviewer.approval_role === "hr" || myReviewer.approval_role === "admin")
    ) {
      await connection.rollback();
      return res.status(400).json({
        message: "This leave request is no longer pending review",
      });
    }

    if (myReviewer.query_status !== "pending") {
      await connection.rollback();
      return res.status(400).json({
        message: "You have already reviewed this leave request",
      });
    }

    const commentValue = review_comment ? String(review_comment).trim() : null;

    if (myReviewer.approval_role === "reporting_manager") {
      await connection.query(
        `UPDATE leave_reviewer
         SET query_status = ?, review_comment = ?
         WHERE id = ?`,
        [action, commentValue, myReviewer.id],
      );

      if (action === "approved") {
        const hrAdminReviewers = await fetchOrgHrAndAdminReviewers(
          connection,
          org_id,
        );
        await insertLeaveReviewersIfMissing(
          connection,
          leave_id,
          hrAdminReviewers,
        );
      }
    } else if (
      myReviewer.approval_role === "hr" ||
      myReviewer.approval_role === "admin"
    ) {
      const canReview = await assertHrAdminCanReview(connection, leave_id);
      if (!canReview.success) {
        await connection.rollback();
        return res.status(400).json({ message: canReview.message });
      }

      await connection.query(
        `UPDATE leave_reviewer
         SET query_status = ?, review_comment = ?
         WHERE id = ?`,
        [action, commentValue, myReviewer.id],
      );

      await connection.query(
        `UPDATE employee_leave
         SET leave_status = ?
         WHERE id = ? AND org_id = ?`,
        [action, leave_id, org_id],
      );
    } else {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid reviewer role" });
    }

    await connection.commit();

    const [updatedLeaveRows] = await connection.query(
      `SELECT
        el.id,
        el.user_id,
        el.org_id,
        el.team_id,
        ot.team_name,
        ot.admin_id AS team_leader_id,
        team_leader.user_name AS team_leader_name,
        el.leave_type_id,
        COALESCE(lt.leave_type_name, 'Unpaid Leave') AS leave_type_name,
        el.leave_duration,
        el.start_date,
        el.end_date,
        el.leave_days,
        el.session_info,
        el.timing,
        el.reason,
        el.leave_status,
        el.created_at,
        el.updated_at
      FROM employee_leave el
      LEFT JOIN org_teams ot
        ON ot.id = el.team_id AND ot.org_id = el.org_id
      LEFT JOIN apt_users team_leader
        ON team_leader.id = ot.admin_id
      LEFT JOIN leave_types lt
        ON lt.id = el.leave_type_id AND lt.org_id = el.org_id
      WHERE el.id = ? AND el.org_id = ?
      LIMIT 1`,
      [leave_id, org_id],
    );

    const [employeeRows] = await connection.query(
      `SELECT
        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        om.emp_code AS employee_code,
        om.emp_code AS emp_code,
        ar.role_name AS employee_role_name
      FROM apt_users emp
      INNER JOIN apt_org_members om
        ON om.user_id = emp.id AND om.org_id = ? AND om.is_active = 1
      LEFT JOIN apt_user_roles aur
        ON aur.user_id = emp.id AND aur.org_id = ?
      LEFT JOIN apt_roles ar
        ON ar.id = aur.role_id AND ar.org_id = ?
      WHERE emp.id = ?
      LIMIT 1`,
      [org_id, org_id, org_id, updatedLeaveRows[0].user_id],
    );

    const [reviewerRows] = await connection.query(
      `SELECT
        lr.id,
        lr.reviewer_id,
        lr.leave_query_id,
        lr.query_status,
        lr.approval_role,
        lr.approval_role_id,
        lr.review_comment,
        reviewer.user_name AS reviewer_name,
        reviewer.user_email AS reviewer_email,
        rom.emp_code AS reviewer_code,
        rom.emp_code AS reviewer_emp_code,
        rr.role_name AS reviewer_role_name
      FROM leave_reviewer lr
      INNER JOIN apt_users reviewer
        ON reviewer.id = lr.reviewer_id
      LEFT JOIN apt_org_members rom
        ON rom.user_id = lr.reviewer_id AND rom.org_id = ?
      LEFT JOIN apt_user_roles rur
        ON rur.user_id = lr.reviewer_id AND rur.org_id = ?
      LEFT JOIN apt_roles rr
        ON rr.id = rur.role_id AND rr.org_id = ?
      WHERE lr.leave_query_id = ?
      ORDER BY lr.created_at ASC`,
      [org_id, org_id, org_id, leave_id],
    );

    const [myReviewAfter] = await connection.query(
      `SELECT
        lr.id,
        lr.approval_role,
        lr.query_status,
        lr.review_comment,
        ar.role_name AS designation_name
      FROM leave_reviewer lr
      LEFT JOIN apt_roles ar
        ON ar.id = lr.approval_role_id AND ar.org_id = ?
      WHERE lr.leave_query_id = ? AND lr.reviewer_id = ?
      LIMIT 1`,
      [org_id, leave_id, user_id],
    );

    const result = mapReviewerLeaveRow(
      updatedLeaveRows[0],
      employeeRows[0] ?? {},
      reviewerRows.map(mapReviewerRow),
      myReviewAfter[0] ?? {},
    );

    return res.status(200).json({
      message:
        action === "approved"
          ? "Leave review approved successfully"
          : "Leave review rejected successfully",
      result,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
};