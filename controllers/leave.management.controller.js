import db, { pool } from "../db/connect.js";

export const getAllLeavesController = async (req, res) => {
  try {
    const { user_id } = req.user;

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const query1 = `
      SELECT org_id FROM apt_org_members WHERE user_id = ?
    `;
    const [result1] = await db.promise().query(query1, [user_id]);
    if (result1.length === 0) {
      return res
        .status(400)
        .json({ message: "User is not a member of any organization" });
    }
    const org_id = result1[0].org_id;

    const query2 = `
      SELECT id FROM apt_organizations WHERE id = ?
    `;
    const [result2] = await db.promise().query(query2, [org_id]);
    if (result2.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    let query3 = `
     SELECT * FROM leave_quiry WHERE org_id = ?
    `;
    const { leave_type, status, created_at, user_name, is_ascending } =
      req.query;
    const values = [org_id];

    if (leave_type) {
      query3 += ` AND leave_type = ?`;
      values.push(leave_type);
    }
    if (status) {
      query3 += ` AND status = ?`;
      values.push(status);
    }
    if (created_at) {
      query3 += ` AND DATE(created_at) = ?`;
      values.push(created_at);
    }
    if (user_name) {
      query3 += ` AND user_name = ?`;
      values.push(user_name);
    }

    const orderDir =
      String(is_ascending || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    query3 += ` ORDER BY created_at ${orderDir}`;

    const [result3] = await db.promise().query(query3, values);
    return res.status(200).json({ data: result3 });
  } catch (error) {
    console.error("Error in getAllLeavesController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const LEAVE_STATUSES = ["pending", "approved", "rejected"];

export const updateLeaveStatusController = async (req, res) => {
  const { leave_id, status } = req.body;
  const { user_id } = req.user;

  if (!leave_id || !status) {
    return res
      .status(400)
      .json({ message: "Leave ID and status are required" });
  }
  if (!LEAVE_STATUSES.includes(status)) {
    return res.status(400).json({
      message: "status must be pending, approved or rejected",
    });
  }
  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [[actor]] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [user_id],
    );
    if (!actor) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    const user_name = actor.user_name;

    const [[member]] = await connection.query(
      "SELECT org_id FROM apt_org_members WHERE user_id = ?",
      [user_id],
    );
    if (!member) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "User is not a member of any organization" });
    }
    const org_id = member.org_id;

    const [[org]] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (!org) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [leaveRows] = await connection.query(
      "SELECT user_name, user_id, status FROM leave_quiry WHERE id = ? AND org_id = ?",
      [leave_id, org_id],
    );
    if (leaveRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave not found" });
    }

    const { user_name: leave_by_name, status: previous_status } = leaveRows[0];
    if (previous_status === status) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Leave status is already updated" });
    }

    const [updResult] = await connection.query(
      "UPDATE leave_quiry SET status = ?, approved_by = ? WHERE id = ? AND org_id = ? ",
      [status, user_id, leave_id, org_id],
    );
    if (!updResult.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "Leave not found" });
    }

    const overview = `Leave status updated for ${leave_by_name} previous status was (${previous_status}) and now it is set to ${status} by ${user_name} (${user_id})`;
    const [insertResult] = await connection.query(
      `INSERT INTO management_activity_log
        (org_id, activity_type, activity_overview, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?)`,
      [org_id, "Leave Status Updated", overview, user_id, user_name],
    );
    if (!insertResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        message: "Failed to save management activity log",
      });
    }

    await connection.commit();
    return res
      .status(200)
      .json({ message: "Leave status updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error in updateLeaveStatusController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

const ATTENDANCE_QUERY_CATEGORIES = [
  "forget_punch_in",
  "forget_punch_out",
  "late_punch_in",
];

const ATTENDANCE_QUERY_STATUSES = ["pending", "approved", "rejected"];

function parseDateOnly(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Attendance Related Queries ::

// :: Post -> Raise Query (employee submits attendance-related correction request)
export const raiseAttendanceQueryController = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { category, query_message, attendance_date } = req.body;

    const rawOrg =
      req.org_id ??
      (req.body?.org_id != null && req.body.org_id !== ""
        ? req.body.org_id
        : null);
    const org_id = Number(rawOrg);

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "org_id is required" });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ message: "category is required" });
    }
    if (!ATTENDANCE_QUERY_CATEGORIES.includes(String(category).trim())) {
      return res.status(400).json({
        message:
          "category must be forget_punch_in, forget_punch_out, or late_punch_in",
      });
    }
    const messageTrimmed =
      query_message != null ? String(query_message).trim() : "";
    if (!messageTrimmed) {
      return res.status(400).json({ message: "query_message is required" });
    }

    const dateNorm = parseDateOnly(attendance_date);
    if (!dateNorm) {
      return res
        .status(400)
        .json({ message: "attendance_date is required (YYYY-MM-DD)" });
    }

    const [orgRows] = await db
      .promise()
      .query("SELECT id FROM apt_organizations WHERE id = ?", [org_id]);
    if (orgRows.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const [memberRows] = await db
      .promise()
      .query("SELECT 1 FROM apt_org_members WHERE user_id = ? AND org_id = ?", [
        user_id,
        org_id,
      ]);
    if (memberRows.length === 0) {
      return res.status(403).json({
        message: "User is not a member of this organization",
      });
    }

    let team_id = null;
    const [teamRows] = await db.promise().query(
      `
      SELECT team_id
      FROM team_members
      WHERE user_id = ?
        AND org_id = ?
        AND leave_date IS NULL
      LIMIT 1
      `,
      [user_id, org_id],
    );
    if (teamRows.length > 0 && teamRows[0].team_id != null) {
      team_id = Number(teamRows[0].team_id);
    }

    const [insertResult] = await db.promise().query(
      `
      INSERT INTO attendance_related_queries (
        user_id,
        org_id,
        team_id,
        query_status,
        category,
        query_message,
        attendance_date
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `,
      [
        user_id,
        org_id,
        team_id,
        String(category).trim(),
        messageTrimmed,
        dateNorm,
      ],
    );

    return res.status(201).json({
      message: "Attendance query submitted successfully",
      data: { id: insertResult.insertId },
    });
  } catch (error) {
    console.error("Error in raiseLeaveQueryController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// :: Patch --> Correction In Query Used By Employee
export const updateAttendanceQueryCorrectionController = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { query_id, category, query_message, attendance_date } = req.body;

    const rawOrg =
      req.org_id ??
      (req.body?.org_id != null && req.body.org_id !== ""
        ? req.body.org_id
        : null);
    const org_id = Number(rawOrg);
    const id = Number(query_id ?? req.body?.id);

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "org_id is required" });
    }
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "query_id is required" });
    }

    const wantsCategory = category !== undefined && category !== null;
    const wantsMessage = query_message !== undefined && query_message !== null;
    const wantsDate = attendance_date !== undefined && attendance_date !== null;

    if (!wantsCategory && !wantsMessage && !wantsDate) {
      return res.status(400).json({
        message:
          "Provide at least one of: category, query_message, attendance_date",
      });
    }

    let categoryVal;
    if (wantsCategory) {
      const c = String(category).trim();
      if (!ATTENDANCE_QUERY_CATEGORIES.includes(c)) {
        return res.status(400).json({
          message:
            "category must be forget_punch_in, forget_punch_out, or late_punch_in",
        });
      }
      categoryVal = c;
    }

    let messageVal;
    if (wantsMessage) {
      messageVal = String(query_message).trim();
      if (!messageVal) {
        return res
          .status(400)
          .json({ message: "query_message cannot be empty" });
      }
    }

    let dateVal;
    if (wantsDate) {
      dateVal = parseDateOnly(attendance_date);
      if (!dateVal) {
        return res
          .status(400)
          .json({ message: "attendance_date must be YYYY-MM-DD" });
      }
    }

    const [memberRows] = await db
      .promise()
      .query("SELECT 1 FROM apt_org_members WHERE user_id = ? AND org_id = ?", [
        user_id,
        org_id,
      ]);
    if (memberRows.length === 0) {
      return res.status(403).json({
        message: "User is not a member of this organization",
      });
    }

    const [existing] = await db.promise().query(
      `
      SELECT id, user_id, query_status, category, query_message, attendance_date
      FROM attendance_related_queries
      WHERE id = ? AND org_id = ?
      `,
      [id, org_id],
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: "Query not found" });
    }

    const row = existing[0];
    if (Number(row.user_id) !== Number(user_id)) {
      return res.status(403).json({
        message: "You can only edit your own queries",
      });
    }
    if (String(row.query_status).toLowerCase() !== "pending") {
      return res.status(403).json({
        message:
          "Only pending queries can be edited. This request has already been processed.",
      });
    }

    let team_id = null;
    const [teamRows] = await db.promise().query(
      `
      SELECT team_id
      FROM team_members
      WHERE user_id = ?
        AND org_id = ?
        AND leave_date IS NULL
      LIMIT 1
      `,
      [user_id, org_id],
    );
    if (teamRows.length > 0 && teamRows[0].team_id != null) {
      team_id = Number(teamRows[0].team_id);
    }

    const sets = ["team_id = ?"];
    const params = [team_id];

    if (wantsCategory) {
      sets.push("category = ?");
      params.push(categoryVal);
    }
    if (wantsMessage) {
      sets.push("query_message = ?");
      params.push(messageVal);
    }
    if (wantsDate) {
      sets.push("attendance_date = ?");
      params.push(dateVal);
    }

    params.push(id, org_id, user_id);

    const [upd] = await db.promise().query(
      `
      UPDATE attendance_related_queries
      SET ${sets.join(", ")}
      WHERE id = ?
        AND org_id = ?
        AND user_id = ?
        AND query_status = 'pending'
      `,
      params,
    );

    if (!upd.affectedRows) {
      return res.status(409).json({
        message: "Could not update query. It may have been processed already.",
      });
    }

    return res.status(200).json({
      message: "Attendance query updated successfully",
      data: { id },
    });
  } catch (error) {
    console.error("Error in updateLeaveQueryCorrectionController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const ATTENDANCE_QUERY_STATUS_ADMIN = ["approved", "rejected"];

// :: Patch --> Update Query Status (management: approve / reject attendance-related query)
export const updateAttendanceQueryStatusController = async (req, res) => {
  try {
    const { user_id: action_by_user_id } = req.user;
    const { org_id } = req;
    const {
      employee_id,
      query_id,
      query_status,
      leave_type_id,
      reason,
      team_id,
    } = req.body;
    if (
      !action_by_user_id ||
      !org_id ||
      !employee_id ||
      !query_id ||
      !query_status ||
      !leave_type_id ||
      !reason ||
      !team_id
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (
      ATTENDANCE_QUERY_STATUS_ADMIN.includes(query_status) &&
      query_status === "approved"
    ) {
      // Check If Query Is Exists OR Already Approved
      const [existingQuery] = await db.promise().query(
        `
        SELECT status, leave_type FROM leave_quiry WHERE id = ? AND org_id = ?
        `,
        [query_id, org_id],
      );
      if (existingQuery.length === 0) {
        return res.status(404).json({ message: "Query not found" });
      }
      const existingQueryStatus = existingQuery[0].status;
      const existingLeaveTypeId = existingQuery[0].leave_type;
      if (existingQueryStatus === "approved") {
        return res.status(400).json({ message: "Query is already approved" });
      }

      // Get the Type Of Leave
      const [leaveType] = await db.promise().query(
        `
        SELECT leave_type_name FROM leave_types WHERE id = ? AND org_id = ?
        `,
        [leave_type_id, org_id],
      );
      if (leaveType.length === 0) {
        return res.status(404).json({ message: "Leave type not found" });
      }
      const leaveTypeName = leaveType[0].leave_type_name;
      if (leaveTypeName !== existingLeaveTypeId) {
        return res.status(400).json({ message: "Leave type mismatch" });
      }
      // Transaction Start
      const transaction = await db.promise().transaction(async (tx) => {
        // Update the Query Status To Approved
        const [updateQueryResult] = await tx.query(
          `
          UPDATE leave_quiry SET (status, approved_by, reason, updated_at) VALUES (?, ?, ?, ?) WHERE id = ? AND org_id = ?
        `,
          [query_id, org_id, "approved", action_by_user_id, reason, new Date()],
        );
        if (!updateQueryResult.affectedRows) {
          await tx.rollback();
          return res
            .status(400)
            .json({ message: "Failed to update query status" });
        }
        // Update the leave_balance and employee_leave_balance
        const [update_employee_leave_type_balance] = await tx.query(
          `
          UPDATE employee_leave_balance SET used_leaves = used_leaves + 1, remaining_leaves = remaining_leaves - 1 WHERE user_id = ? AND org_id = ? AND leave_type_id = ?
          `,
          [employee_id, org_id, leave_type_id],
        );
        if (!update_employee_leave_type_balance.affectedRows) {
          await tx.rollback();
          return res
            .status(400)
            .json({ message: "Failed to update employee leave balance" });
        }

        // Update the main leave_balance
        const [update_leave_balance] = await tx.query(
          `
          UPDATE leave_balance SET used_leaves = used_leaves + 1, remaining_leaves = remaining_leaves - 1 WHERE user_id = ? AND org_id = ?
          `,
          [employee_id, org_id],
        );
        if (!update_leave_balance.affectedRows) {
          await tx.rollback();
          return res
            .status(400)
            .json({ message: "Failed to update leave balance" });
        }
        // Save the Activity Log
        const [save_activity_log] = await tx.query(
          `
          INSERT INTO management_activity_log (org_id, activity_type, activity_overview, performed_by, performed_by_name) VALUES (?, ?, ?, ?, ?)
        `,
          [
            org_id,
            "APPROVE_LEAVE_QUERY",
            `Approved leave query for employee ${employee_id} with leave type ${leave_type_id}`,
            action_by_user_id,
            action_by_user_name,
          ],
        );
        if (!save_activity_log.affectedRows) {
          await tx.rollback();
          return res
            .status(400)
            .json({ message: "Failed to save activity log" });
        }
        // Commit the transaction
        await tx.commit();
        return res
          .status(200)
          .json({ message: "Leave query approved successfully" });
      });
      if (!transaction) {
        return res
          .status(400)
          .json({ message: "Failed to approve leave query" });
      }
    }
  } catch (error) {
    console.error("Error in updateAttendanceQueryStatusController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// :: Get -> Get all attendance-related queries (org-wide, or scoped to team_id)
export const getAllAttendanceQueriesController = async (req, res) => {
  try {
    const { user_id } = req.user;
    const rawOrg =
      req.org_id ??
      (req.query?.org_id != null && req.query.org_id !== ""
        ? req.query.org_id
        : null);
    const org_id = Number(rawOrg);

    const { query_status, category, query_message, attendance_date, team_id } =
      req.query;

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const [memberRows] = await db
      .promise()
      .query("SELECT 1 FROM apt_org_members WHERE user_id = ? AND org_id = ?", [
        user_id,
        org_id,
      ]);
    if (memberRows.length === 0) {
      return res.status(403).json({
        message: "User is not a member of this organization",
      });
    }

    let sql = `
      SELECT 
    attendance_related_queries.*,
    apt_users.user_name AS approved_by_name

FROM attendance_related_queries

LEFT JOIN apt_users 
ON attendance_related_queries.approved_by = apt_users.id

WHERE attendance_related_queries.org_id = ?
    `;
    const params = [org_id];

    const teamIdRaw =
      team_id != null && String(team_id).trim() !== ""
        ? Number(team_id)
        : Number.NaN;
    if (Number.isFinite(teamIdRaw)) {
      const [teamRows] = await db
        .promise()
        .query("SELECT id FROM org_teams WHERE id = ? AND org_id = ?", [
          teamIdRaw,
          org_id,
        ]);
      if (teamRows.length === 0) {
        return res.status(404).json({
          message: "Team not found in this organization",
        });
      }
      sql += " AND team_id = ?";
      params.push(teamIdRaw);
    }

    if (query_status != null && String(query_status).trim() !== "") {
      const s = String(query_status).toLowerCase();
      if (!ATTENDANCE_QUERY_STATUSES.includes(s)) {
        return res.status(400).json({
          message: "query_status must be pending, approved, or rejected",
        });
      }
      sql += " AND query_status = ?";
      params.push(s);
    }

    if (category != null && String(category).trim() !== "") {
      const c = String(category).trim();
      if (!ATTENDANCE_QUERY_CATEGORIES.includes(c)) {
        return res.status(400).json({
          message:
            "category must be forget_punch_in, forget_punch_out, or late_punch_in",
        });
      }
      sql += " AND category = ?";
      params.push(c);
    }

    if (attendance_date != null && String(attendance_date).trim() !== "") {
      const d = parseDateOnly(attendance_date);
      if (!d) {
        return res.status(400).json({
          message: "Invalid attendance_date (use YYYY-MM-DD)",
        });
      }
      sql += " AND attendance_date = ?";
      params.push(d);
    }

    if (query_message != null && String(query_message).trim() !== "") {
      sql += " AND query_message LIKE ?";
      params.push(`%${String(query_message).trim()}%`);
    }

    sql += " ORDER BY created_at DESC";

    const [queries] = await db.promise().query(sql, params);

    return res.status(200).json({
      message: "Queries fetched successfully",
      data: queries,
      count: queries.length,
    });
  } catch (error) {
    console.error("Error in getAllAttendanceQueriesController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// :: Get -> Current user's attendance-related queries for an organization
export const getMyAttendanceQueriesController = async (req, res) => {
  try {
    const { user_id } = req.user;
    const input = {
      ...req.query,
      ...(req.body && typeof req.body === "object" ? req.body : {}),
    };
    const rawOrg =
      req.org_id ??
      (input.org_id != null && input.org_id !== "" ? input.org_id : null);
    const org_id = Number(rawOrg);

    const { query_status, category, query_message, attendance_date, team_id } =
      input;

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "org_id is required" });
    }

    const [memberRows] = await db
      .promise()
      .query("SELECT 1 FROM apt_org_members WHERE user_id = ? AND org_id = ?", [
        user_id,
        org_id,
      ]);
    if (memberRows.length === 0) {
      return res.status(403).json({
        message: "User is not a member of this organization",
      });
    }

    let sql = `
      SELECT *
      FROM attendance_related_queries
      WHERE org_id = ?
        AND user_id = ?
    `;
    const params = [org_id, user_id];

    const teamIdRaw =
      team_id != null && String(team_id).trim() !== ""
        ? Number(team_id)
        : Number.NaN;
    if (Number.isFinite(teamIdRaw)) {
      const [teamRows] = await db
        .promise()
        .query("SELECT id FROM org_teams WHERE id = ? AND org_id = ?", [
          teamIdRaw,
          org_id,
        ]);
      if (teamRows.length === 0) {
        return res.status(404).json({
          message: "Team not found in this organization",
        });
      }
      sql += " AND team_id = ?";
      params.push(teamIdRaw);
    }

    if (query_status != null && String(query_status).trim() !== "") {
      const s = String(query_status).toLowerCase();
      if (!ATTENDANCE_QUERY_STATUSES.includes(s)) {
        return res.status(400).json({
          message: "query_status must be pending, approved, or rejected",
        });
      }
      sql += " AND query_status = ?";
      params.push(s);
    }

    if (category != null && String(category).trim() !== "") {
      const c = String(category).trim();
      if (!ATTENDANCE_QUERY_CATEGORIES.includes(c)) {
        return res.status(400).json({
          message:
            "category must be forget_punch_in, forget_punch_out, or late_punch_in",
        });
      }
      sql += " AND category = ?";
      params.push(c);
    }

    if (attendance_date != null && String(attendance_date).trim() !== "") {
      const d = parseDateOnly(attendance_date);
      if (!d) {
        return res.status(400).json({
          message: "Invalid attendance_date (use YYYY-MM-DD)",
        });
      }
      sql += " AND attendance_date = ?";
      params.push(d);
    }

    if (query_message != null && String(query_message).trim() !== "") {
      sql += " AND query_message LIKE ?";
      params.push(`%${String(query_message).trim()}%`);
    }

    sql += " ORDER BY created_at DESC";

    const [queries] = await db.promise().query(sql, params);

    return res.status(200).json({
      message: "Your attendance queries fetched successfully",
      data: queries,
      count: queries.length,
    });
  } catch (error) {
    console.error("Error in getMyAttendanceQueriesController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function getActivityPerformerName(user_id) {
  const [[row]] = await db
    .promise()
    .query("SELECT user_name FROM apt_users WHERE id = ?", [user_id]);
  return row?.user_name ?? `User #${user_id}`;
}

export const create_leave_type_controller = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req;

    if (!user_id || !org_id) {
      return res
        .status(400)
        .json({ message: "User ID and organization ID are required" });
    }

    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "organization ID is required" });
    }

    const leave_type_name = String(req.body.leave_type_name ?? "").trim();
    if (!leave_type_name) {
      return res.status(400).json({ message: "leave_type_name is required" });
    }

    const [leave_type_rows] = await db.promise().query(
      "SELECT id FROM leave_types WHERE leave_type_name = ? AND org_id = ?",
      [leave_type_name, org_id],
    );
    if (leave_type_rows.length > 0) {
      return res.status(400).json({ message: "Leave type already exists" });
    }

    const [insert_leave_type_result] = await db.promise().query(
      "INSERT INTO leave_types (leave_type_name, org_id) VALUES (?, ?)",
      [leave_type_name, org_id],
    );
    if (!insert_leave_type_result.affectedRows) {
      return res.status(400).json({ message: "Failed to create leave type" });
    }

    const performer_name = await getActivityPerformerName(user_id);
    const [save_activity_log] = await db.promise().query(
      `INSERT INTO management_activity_log
        (org_id, activity_type, activity_overview, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "CREATE_LEAVE_TYPE",
        `Created leave type '${leave_type_name}'`,
        user_id,
        performer_name,
      ],
    );
    if (!save_activity_log.affectedRows) {
      return res.status(400).json({ message: "Failed to save activity log" });
    }

    return res.status(201).json({
      message: "Leave type created successfully",
      data: { leave_type_id: insert_leave_type_result.insertId, leave_type_name },
    });
  } catch (error) {
    console.log("Error in create_leave_type_controller: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const update_leave_type_controller = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req;

    if (!user_id || !org_id) {
      return res
        .status(400)
        .json({ message: "User ID and organization ID are required" });
    }
    if (!Number.isFinite(org_id)) {
      return res.status(400).json({ message: "organization ID is required" });
    }

    const leave_type_id = Number(req.body.leave_type_id);
    const leave_type_name = String(req.body.leave_type_name ?? "").trim();
    if (!Number.isFinite(leave_type_id)) {
      return res.status(400).json({ message: "leave_type_id is required" });
    }
    if (!leave_type_name) {
      return res.status(400).json({ message: "leave_type_name is required" });
    }

    const [leave_type_rows] = await db.promise().query(
      "SELECT id, leave_type_name FROM leave_types WHERE id = ? AND org_id = ?",
      [leave_type_id, org_id],
    );
    if (leave_type_rows.length === 0) {
      return res.status(404).json({ message: "Leave type not found" });
    }

    const previousName = leave_type_rows[0].leave_type_name;

    const [duplicateRows] = await db.promise().query(
      "SELECT id FROM leave_types WHERE leave_type_name = ? AND org_id = ? AND id <> ?",
      [leave_type_name, org_id, leave_type_id],
    );
    if (duplicateRows.length > 0) {
      return res.status(400).json({ message: "Leave type name already in use" });
    }

    const [update_leave_type_result] = await db.promise().query(
      "UPDATE leave_types SET leave_type_name = ? WHERE id = ? AND org_id = ?",
      [leave_type_name, leave_type_id, org_id],
    );
    if (!update_leave_type_result.affectedRows) {
      return res.status(400).json({ message: "Failed to update leave type" });
    }

    const performer_name = await getActivityPerformerName(user_id);
    const [save_activity_log] = await db.promise().query(
      `INSERT INTO management_activity_log
        (org_id, activity_type, activity_overview, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "UPDATE_LEAVE_TYPE",
        `Updated leave type from '${previousName}' to '${leave_type_name}'`,
        user_id,
        performer_name,
      ],
    );
    if (!save_activity_log.affectedRows) {
      return res.status(400).json({ message: "Failed to save activity log" });
    }

    return res.status(200).json({
      message: "Leave type updated successfully",
      data: { leave_type_id, leave_type_name },
    });
  } catch (error) {
    console.log("Error in update_leave_type_controller: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const create_employee_leave_balance_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: action_by_user_id } = req.user;
    const { org_id } = req;

    const { employee_id, leave_type_id, total_leaves } = req.body;

    // --------------------------------------------------
    // VALIDATIONS
    // --------------------------------------------------

    if (!action_by_user_id) {
      return res.status(400).json({
        success: false,
        message: "Action user id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "Employee id is required",
      });
    }

    if (!leave_type_id) {
      return res.status(400).json({
        success: false,
        message: "Leave type id is required",
      });
    }

    if (total_leaves === undefined || total_leaves === null) {
      return res.status(400).json({
        success: false,
        message: "Total leaves is required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // --------------------------------------------------
    // CHECK ACTION USER MEMBERSHIP
    // --------------------------------------------------

    const [actionMember] = await connection.query(
      `
      SELECT id
      FROM apt_org_members
      WHERE user_id = ?
      AND org_id = ?
      `,
      [action_by_user_id, org_id],
    );

    if (actionMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // --------------------------------------------------
    // CHECK EMPLOYEE MEMBERSHIP
    // --------------------------------------------------

    const [employeeInfo] = await connection.query(
      `
      SELECT id
      FROM apt_org_members
      WHERE user_id = ?
      AND org_id = ?
      `,
      [employee_id, org_id],
    );

    if (employeeInfo.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // --------------------------------------------------
    // CHECK LEAVE TYPE
    // --------------------------------------------------

    const [leaveType] = await connection.query(
      `
      SELECT *
      FROM leave_types
      WHERE id = ?
      AND org_id = ?
      `,
      [leave_type_id, org_id],
    );

    if (leaveType.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Leave type not found",
      });
    }

    // --------------------------------------------------
    // CHECK EXISTING BALANCE
    // --------------------------------------------------

    const [existingBalance] = await connection.query(
      `
        SELECT id
        FROM employee_leave_balance
        WHERE user_id = ?
        AND org_id = ?
        AND leave_type_id = ?
        `,
      [employee_id, org_id, leave_type_id],
    );

    if (existingBalance.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Leave balance already assigned",
      });
    }

    // --------------------------------------------------
    // INSERT LEAVE BALANCE
    // --------------------------------------------------

    const [insertResult] = await connection.query(
      `
        INSERT INTO employee_leave_balance
        (
          user_id,
          org_id,
          leave_type_id,
          total_leaves,
          used_leaves,
          remaining_leaves
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      [employee_id, org_id, leave_type_id, total_leaves, 0, total_leaves],
    );

    if (insertResult.affectedRows < 1) {
      throw new Error("Failed to create leave balance");
    }

    const [[actionUser]] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [action_by_user_id],
    );
    const [[employeeUser]] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ?",
      [employee_id],
    );

    const performedByName =
      actionUser?.user_name ?? `User #${action_by_user_id}`;
    const employeeName = employeeUser?.user_name ?? `User #${employee_id}`;
    const leaveTypeName =
      leaveType[0].leave_type_name ?? `Leave type #${leave_type_id}`;

    const overview = `Assigned ${total_leaves} day(s) of '${leaveTypeName}' leave balance to ${employeeName}`;

    const [activityResult] = await connection.query(
      `INSERT INTO management_activity_log
        (org_id, activity_type, activity_overview, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        org_id,
        "ASSIGN_LEAVE_BALANCE",
        overview,
        action_by_user_id,
        performedByName,
      ],
    );

    if (!activityResult.affectedRows) {
      throw new Error("Failed to save management activity log");
    }

    // --------------------------------------------------
    // COMMIT
    // --------------------------------------------------

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Employee leave balance created successfully",
      data: {
        leave_balance_id: insertResult.insertId,
        employee_id,
        leave_type_id,
        total_leaves,
        used_leaves: 0,
        remaining_leaves: total_leaves,
      },
    });
  } catch (error) {
    console.error("create_employee_leave_balance_controller:", error);

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_leave_types_controller = async (req, res) => {
  try {
    const { org_id } = req;
    if (!org_id) {
      return res.status(400).json({ message: "Organization ID is required" });
    }
    const [leave_types] = await db.promise().query(
      `SELECT id, leave_type_name, org_id
       FROM leave_types
       WHERE org_id = ?
       ORDER BY leave_type_name ASC, id ASC`,
      [org_id],
    );
    return res.status(200).json({
      success: true,
      message:
        leave_types.length === 0
          ? "No leave types found"
          : "Leave types fetched successfully",
      data: leave_types,
    });
  } catch (error) {
    console.error("get_all_leave_types_controller: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};