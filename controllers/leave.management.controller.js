import db from "../db/connect.js";

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
  const { user_id } = req.user || {};

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
    connection = await db.promise().getConnection();
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
      "UPDATE leave_quiry SET status = ? WHERE id = ? AND org_id = ?",
      [status, leave_id, org_id],
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
