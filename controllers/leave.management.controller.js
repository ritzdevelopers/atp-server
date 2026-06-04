import db, { pool } from "../db/connect.js";
import calculateLeaveBalanceCount from "../helper/calculate_leave_balance_count.js";
import { isEmployeeExists } from "../helper/employee_checker.js";
import activity_tracker from "../helper/activity_tracking.js";
import check_team_lead from "../helper/check_team_lead.js";

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
export const updateAttendanceQueryStatusController = async (req, res) => {
  let connection = null;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "User not found" });
    }
    // -> id, user_id, org_id, team_id, category, query_message, attendance_date, approved_by, approved_by_name, admin_response, resolved_at
    const { employee_id, query_id, admin_response, updated_query_status, team_id } =
      req.body;
    if (!employee_id || !query_id || !admin_response || !updated_query_status) {
      await connection.rollback();
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "Employee not found" });
    }

    const [attendance_query_info] = await connection.query(
      `
      SELECT query_status FROM attendance_related_queries WHERE id = ? AND org_id = ? AND user_id = ?
      `,
      [query_id, org_id, employee_id],
    );
    if (attendance_query_info.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Query not found" });
    }
    const query_status = attendance_query_info[0].query_status;
    if (query_status === "approved" || query_status === "rejected") {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Query has already been processed" });
    }
    if (!ATTENDANCE_QUERY_STATUS_ADMIN.includes(updated_query_status)) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid status" });
    }
    const [approved_by_info] = await connection.query(
      `
      SELECT id, user_name FROM apt_users WHERE id = ?
      `,
      [action_user_id],
    );
    if (approved_by_info.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "User not found" });
    }
    // If team_id provided then only team lead and hr can process the query otherwise only hr can process ::
    if(!team_id || team_id === null) {  
      if(!await user_role_checker(connection, action_user_id, org_id, "hr")) {
        await connection.rollback();
        return res.status(400).json({ message: "You are not authorized to process this query" });
      }
    }
    // Check If The User Is The Team Lead ::
    if(!(await check_team_lead(connection, employee_id, action_user_id, org_id, team_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "You are not authorized to process this query" });
    }
    const approved_by_id = approved_by_info[0].id;
    const user_name = approved_by_info[0].user_name;

    const [update_attendance_query_status] = await connection.query(
      `
      UPDATE attendance_related_queries 
      SET query_status = ?, approved_by = ?, approved_by_name = ?, admin_response = ?, resolved_at = NOW()
      WHERE id = ? AND org_id = ? AND user_id = ?
      `,
      [
        updated_query_status,
        approved_by_id,
        user_name,
        admin_response,
        query_id,
        org_id,
        employee_id,
      ],
    );
    if (!update_attendance_query_status.affectedRows) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Failed to update attendance query status" });
    }

    // Save Activity Log ::
    await activity_tracker(connection, action_user_id, user_name, `Updated attendance query status to ${updated_query_status}`, org_id, "attendance_query_status_updated");
    // Commit The Transaction ::
    await connection.commit();
    return res.status(200).json({
      message: "Attendance query status updated successfully",
      success: true,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.log("Error in updateAttendanceQueryStatusController: ", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// :: Patch --> Update Query Status (management: approve / reject leave-related query)
export const updateLeaveQueryStatusController = async (req, res) => {
  console.log("updateLeaveQueryStatusController");
  let connection = null;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "User not found" });
    }
    const [action_user_info] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [action_user_id],
    );

    const ac_user_name = action_user_info[0].user_name;

    const { query_id, query_status: updated_status, team_id } = req.body;

    // If team_id provided then only team lead and hr can process the query otherwise only hr can process ::
    if(!team_id || team_id === null) {  
      if(!await user_role_checker(connection, action_user_id, org_id, "hr")) {
        await connection.rollback();
        return res.status(400).json({ message: "You are not authorized to process this query" });
      }
    }

    if (!ATTENDANCE_QUERY_STATUS_ADMIN.includes(updated_status)) {
      console.log("Invalid status", updated_status);
      await connection.rollback();
      return res.status(400).json({ message: "Invalid status" });
    }

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    const [leave_query_info] = await connection.query(
      `
      SELECT leave_type_id, 
      start_date,
      end_date,
      status,
      user_id
      FROM leave_quiry
      WHERE id = ? AND org_id = ?
      `,
      [query_id, org_id],
    );
    if (leave_query_info.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Query not found" });
    }
    const start_date = leave_query_info[0].start_date;
    const end_date = leave_query_info[0].end_date;
    const status = leave_query_info[0].status;
    const leave_type_id = leave_query_info[0].leave_type_id;
    const employee_id = leave_query_info[0].user_id;

    if (status === "approved" || status === "rejected") {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Query has already been processed" });
    }
    // Check If The User Is The Team Lead ::
    if(!(await check_team_lead(connection, employee_id, action_user_id, org_id, team_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "You are not authorized to process this query" });
    }
    if (updated_status === "rejected") {
      // Update Leave Query Status ::
      const [update_leave_query_status] = await connection.query(
        `
        UPDATE leave_quiry
        SET status = 'rejected', rejected_by = ?
        WHERE id = ? AND org_id = ?
        `,
        [action_user_id, query_id, org_id],
      );
      if (!update_leave_query_status.affectedRows) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to update leave query status" });
      }
      // Commit The Transaction ::
      await connection.commit();
      return res.status(200).json({
        message: "Leave query rejected successfully",
        success: true,
      });
    }
    const total_days_leave =
      Math.ceil(
        (new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24),
      ) + 1;

    // Get The Leave Type Information ::
    const [leave_balance_info] = await connection.query(
      `
      SELECT remaining_leaves, used_leaves
      FROM employee_leave_balance
      WHERE org_id = ? AND leave_type_id = ? 
      AND user_id = ?
      `,
      [org_id, leave_type_id, employee_id],
    );

    if (leave_balance_info.length > 0) {
      const remaining_leave_balance = leave_balance_info[0].remaining_leaves;
      const used_leave_balance = leave_balance_info[0].used_leaves;
      if (remaining_leave_balance < total_days_leave) {
        await connection.rollback();
        return res.status(400).json({ message: "Insufficient leave balance" });
      }
      let new_remaining_leaves = remaining_leave_balance - total_days_leave;
      let new_used_leaves = used_leave_balance + total_days_leave;
      // Deduct The Leave Balance From Employee Leave Balance ::
      const [update_leave_balance_result] = await connection.query(
        `
        UPDATE employee_leave_balance
        SET remaining_leaves = ?, used_leaves = ?
        WHERE org_id = ? AND leave_type_id = ? 
        AND user_id = ?
        `,
        [
          new_remaining_leaves,
          new_used_leaves,
          org_id,
          leave_type_id,
          employee_id,
        ],
      );
      if (!update_leave_balance_result.affectedRows) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to deduct leave balance" });
      }
      // Fetch Previous Used Leaves and Remaining Leaves ::
      const [previous_leave_balance_info] = await connection.query(
        `
        SELECT used_leaves, remaining_leaves
        FROM leave_balance
        WHERE org_id = ?
        AND user_id = ? AND year = ? AND month = ?
        `,
        [org_id, employee_id, year, month],
      );
      if (
        !previous_leave_balance_info.length ||
        previous_leave_balance_info.length === 0
      ) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to fetch previous leave balance" });
      }
      const previous_used_all_leaves =
        previous_leave_balance_info[0].used_leaves;
      const previous_remaining_all_leaves =
        previous_leave_balance_info[0].remaining_leaves;

      let new_used_all_leaves = previous_used_all_leaves + total_days_leave;
      let new_remaining_all_leaves =
        previous_remaining_all_leaves - total_days_leave;

      // Deduct The Leave Balance From Employee Leave Balance
      const [update_leave_query_result] = await connection.query(
        `
        UPDATE leave_balance
        SET used_leaves = ?, 
        remaining_leaves = ?
        WHERE org_id = ? 
        AND user_id = ? AND year = ? AND month = ?
        `,
        [
          new_used_all_leaves,
          new_remaining_all_leaves,
          org_id,
          employee_id,
          year,
          month,
        ],
      );
      if (!update_leave_query_result.affectedRows) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to update leave balance" });
      }
      // Update The Leave Query Status ::
      const [update_leave_query_status] = await connection.query(
        `
        UPDATE leave_quiry
        SET status = 'approved', approved_by = ?
        WHERE id = ? AND org_id = ? AND user_id = ?
        `,
        [action_user_id, query_id, org_id, employee_id],
      );
      if (!update_leave_query_status.affectedRows) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to update leave query status" });
      }
      // Save The Activity Log ::

      // Commit The Transaction ::
      await connection.commit();

      return res.status(200).json({
        message: "Leave query approved successfully",
        success: true,
      });
    } else {
      // Update Leave Query Status ::
      const [update_leave_query_status] = await connection.query(
        `
        UPDATE leave_quiry
        SET status = 'approved', approved_by = ?
        WHERE id = ? AND org_id = ? AND user_id = ?
        `,
        [action_user_id, query_id, org_id, employee_id],
      );
      if (!update_leave_query_status.affectedRows) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to update leave query status" });
      }
      // Save The Activity Log ::
      // Commit The Transaction ::
      await connection.commit();
      return res.status(200).json({
        message: "Leave query approved successfully",
        success: true,
      });
    }
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error in updateLeaveQueryStatusController:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};
export const updateAtendanceRelatedQueryStatusController = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "User not found" });
    }
    const [action_user_info] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [action_user_id],
    );
    const ac_user_name = action_user_info[0].user_name;
    const { query_id, query_status: updated_status, admin_response } = req.body;
    // Check if Already Approved Or Rejected So Return ::
    const [attendance_query_info] = await connection.query(
      `
      SELECT query_status, user_id
      FROM attendance_related_queries
      WHERE id = ? AND org_id = ?
      `,
      [query_id, org_id],
    );
    if (attendance_query_info.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Query not found" });
    }
    const query_status = attendance_query_info[0].query_status;
    const employee_id = attendance_query_info[0].user_id;
    if (query_status === "approved" || query_status === "rejected") {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Query has already been processed" });
    }
    // Update The Attendance Related Query Status ::
    const [update_attendance_related_query_status] = await connection.query(
      `
      UPDATE attendance_related_queries
      SET query_status = ?
      WHERE id = ? AND org_id = ?
      `,
      [updated_status, query_id, org_id],
    );
    if (!update_attendance_related_query_status.affectedRows) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Failed to update attendance related query status" });
    }
    // Save Activity Log ::

    // Commit The Transaction ::
    await connection.commit();
    return res.status(200).json({
      message: "Attendance related query status updated successfully",
      success: true,
    });
  } catch (error) {
    if (connection) connection.rollback();
    console.error(
      "Error in updateAtendanceRelatedQueryStatusController: ",
      error,
    );
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
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

    const [leave_type_rows] = await db
      .promise()
      .query(
        "SELECT id FROM leave_types WHERE leave_type_name = ? AND org_id = ?",
        [leave_type_name, org_id],
      );
    if (leave_type_rows.length > 0) {
      return res.status(400).json({ message: "Leave type already exists" });
    }

    const [insert_leave_type_result] = await db
      .promise()
      .query(
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
      data: {
        leave_type_id: insert_leave_type_result.insertId,
        leave_type_name,
      },
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

    const [leave_type_rows] = await db
      .promise()
      .query(
        "SELECT id, leave_type_name FROM leave_types WHERE id = ? AND org_id = ?",
        [leave_type_id, org_id],
      );
    if (leave_type_rows.length === 0) {
      return res.status(404).json({ message: "Leave type not found" });
    }

    const previousName = leave_type_rows[0].leave_type_name;

    const [duplicateRows] = await db
      .promise()
      .query(
        "SELECT id FROM leave_types WHERE leave_type_name = ? AND org_id = ? AND id <> ?",
        [leave_type_name, org_id, leave_type_id],
      );
    if (duplicateRows.length > 0) {
      return res
        .status(400)
        .json({ message: "Leave type name already in use" });
    }

    const [update_leave_type_result] = await db
      .promise()
      .query(
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
    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "User is not an employee" });
    }

    let { leave_type_id, total_leaves, employee_id } = req.body;
    employee_id = Number(employee_id);
    leave_type_id = Number(leave_type_id);
    total_leaves = Number(total_leaves);
    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(400).json({ message: "Employee not found" });
    }
    if (!Number.isFinite(leave_type_id) || !Number.isFinite(total_leaves)) {
      return res.status(400).json({ message: "Invalid Credentials" });
    }

    // Check if Leave Type Exists ::
    const [leaveType] = await connection.query(
      `
      SELECT id
      FROM leave_types
      WHERE id = ?
      AND org_id = ?
      `,
      [leave_type_id, org_id],
    );

    if (leaveType.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        message: "Leave type not found",
      });
    }
    const [existingEmployeeLeave] = await connection.query(
      `
      SELECT id
      FROM employee_leave_balance
      WHERE user_id = ?
      AND org_id = ?
      AND leave_type_id = ?
      `,
      [employee_id, org_id, leave_type_id],
    );

    if (existingEmployeeLeave.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        message: "Leave balance already assigned for this leave type",
      });
    }

    let year = new Date().getFullYear();
    let month = new Date().getMonth() + 1; //last_leave_update
    const [existing_leave_balance] = await connection.query(
      `
      SELECT total_leaves, used_leaves
      FROM leave_balance
      WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?
      `,
      [employee_id, org_id, year, month],
    );

    // Insert Employee Leave Balance ::
    const [insert_employee_leave_balance] = await connection.query(
      `
      INSERT INTO employee_leave_balance
      (user_id, org_id, leave_type_id, total_leaves, used_leaves, remaining_leaves)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [employee_id, org_id, leave_type_id, total_leaves, 0, total_leaves],
    );

    if (
      !insert_employee_leave_balance ||
      insert_employee_leave_balance.affectedRows < 1
    ) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Failed to insert employee leave balance" });
    }

    if (existing_leave_balance.length > 0) {
      let previous_total_leaves = Number(
        existing_leave_balance[0].total_leaves,
      );
      let previous_used_leaves = Number(existing_leave_balance[0].used_leaves);

      let new_total_leaves = previous_total_leaves + total_leaves;
      let new_remaining_leaves = new_total_leaves - previous_used_leaves;

      const [update_leave_balance] = await connection.query(
        `
      UPDATE leave_balance
      SET total_leaves = ? , remaining_leaves = ?
      WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?
      `,
        [
          new_total_leaves,
          new_remaining_leaves,
          employee_id,
          org_id,
          year,
          month,
        ],
      );
      if (!update_leave_balance || update_leave_balance.affectedRows < 1) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to update leave balance" });
      }
    } else {
      // Create Fresh Leave Balance For The User
      let f_total_leaves = total_leaves;
      let f_used_leaves = 0;
      let f_remaining_leaves = total_leaves;
      const [create_fresh_leave_balance] = await connection.query(
        `
        INSERT INTO leave_balance
        (user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, last_leave_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          employee_id,
          org_id,
          year,
          month,
          f_total_leaves,
          f_used_leaves,
          f_remaining_leaves,
          new Date(),
        ],
      );
      if (
        !create_fresh_leave_balance ||
        create_fresh_leave_balance.affectedRows < 1
      ) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Failed to create fresh leave balance" });
      }
    }

    // Insert Activity Log ::
    const [action_user_name] = await connection.query(
      `
      SELECT user_name FROM apt_users WHERE id = ?
      `,
      [action_user_id],
    );
    if (!action_user_name || action_user_name.length < 1) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "Failed to get action user name" });
    }

    const activity_query = `INSERT INTO management_activity_log
    (org_id, activity_type, activity_overview, performed_by, performed_by_name)
   VALUES (?, ?, ?, ?, ?)`;
    const [save_activity_log] = await connection.query(activity_query, [
      org_id,
      "CREATE_EMPLOYEE_LEAVE_BALANCE",
      `Created employee leave balance for user ${employee_id} with leave type ${leave_type_id} and total leaves ${total_leaves}`,
      action_user_id,
      action_user_name[0].user_name,
    ]);
    if (!save_activity_log || save_activity_log.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({ message: "Failed to save activity log" });
    }

    await connection.commit();
    return res
      .status(200)
      .json({ message: "Employee leave balance created successfully" });
  } catch (error) {
    console.log("Error in create_employee_leave_balance_controller: ", error);

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      message: "Internal server error",
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
