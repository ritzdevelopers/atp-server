import { pool } from "../db/connect.js";

export const mapUsers = async (req, res) => {
  let connection = null;
  try {
    const { emp_info } = req.body;
    const org_id = req.org_id;

    if (!Array.isArray(emp_info) || emp_info.length === 0) {
      return res.status(400).json({
        success: false,
        message: "emp_info must be a non-empty array",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    for (const emp of emp_info) {
      const emp_code = String(emp?.emp_code ?? "").trim();
      const user_id = Number(emp?.user_id);

      if (!emp_code || !Number.isFinite(user_id)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Each item needs a valid user_id and emp_code",
        });
      }

      const [result] = await connection.query(
        `UPDATE apt_org_members
         SET emp_code = ?
         WHERE user_id = ? AND org_id = ?`,
        [emp_code, user_id, org_id],
      );

      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Could not map user_id ${user_id} in this organization`,
        });
      }
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Users mapped successfully",
    });
  } catch (error) {
    console.error("mapUsers:", error);
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({
      success: false,
      message: "Failed to map users",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getUsersForMapping = async (req, res) => {
  try {
    const org_id = req.org_id;

    const [rows] = await pool.promise().query(
      `SELECT
         om.id AS org_member_id,
         om.user_id,
         om.org_id,
         om.emp_code,
         om.is_active,
         om.created_at AS member_since,
         u.user_name,
         u.user_email,
         u.user_phone,
         u.user_image
       FROM apt_org_members om
       INNER JOIN apt_users u ON u.id = om.user_id
       WHERE om.org_id = ? AND om.is_active = 1
       ORDER BY u.user_name ASC`,
      [org_id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getUsersForMapping:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get users for mapping",
    });
  }
};
