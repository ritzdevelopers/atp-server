import db from "../db/connect.js";

export const getAttendanceHistoryOfEmployeeController = async (req, res) => {
  try {
    const { user_id } = req.user || {};
    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { month, year, status, page = 1, limit = 10, sort = "DESC" } =
      req.query;

    const orderDir = String(sort).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 10));

    let query = `
      SELECT 
        id AS attendance_id,
        attendance_date AS date,
        check_in,
        check_out,
        attendance_status AS status,
        working_time
      FROM attendance
      WHERE user_id = ?
    `;

    const values = [user_id];

    if (month && year) {
      query += ` AND MONTH(attendance_date) = ? AND YEAR(attendance_date) = ?`;
      values.push(month, year);
    }

    if (status) {
      query += ` AND attendance_status = ?`;
      values.push(status);
    }

    query += ` ORDER BY attendance_date ${orderDir}`;

    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT ? OFFSET ?`;

    values.push(limitNum, offset);

    const [rows] = await db.promise().query(query, values);

    res.status(200).json({
      success: true,
      page: pageNum,
      limit: limitNum,
      data: rows,
    });
  } catch (error) {
    console.log("Error in getAttendanceHistoryOfEmployeeController:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch attendance history",
    });
  }
};

export const get_all_users_with_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req.query;

    if (!user_id || !org_id) {
      return res.status(400).json({
        success: false,
        message: "User ID and Organization ID are required",
      });
    }
    // Validate Req User -> apt_org_members
    const fetch_org_member_query =
      "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [org_member_result] = await db
      .promise()
      .query(fetch_org_member_query, [user_id, org_id]);
    if (org_member_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }
    // Fetch All Users With Attendance History ->
    const fetch_all_users_id =
      "SELECT user_id FROM apt_org_members WHERE org_id = ?";
    const [all_users_id_result] = await db
      .promise()
      .query(fetch_all_users_id, [org_id]);
    if (all_users_id_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No users found in the organization",
      });
    }
    // Get user_name, email, phone and attendance history
    const query = `
    SELECT 
      user_info.user_name,
      user_info.user_email,
      user_info.user_role_name,
      user_info.user_id AS user_id,
      user_info.attendance_date,
      user_info.check_in,
      user_info.check_out,
      user_info.attendance_status,
      user_info.working_time,
  
      apt_users.created_at AS joining_date
  
    FROM attendance AS user_info
  
    INNER JOIN apt_users 
      ON user_info.user_id = apt_users.id
  
    WHERE user_info.user_id IN (?)
    AND user_info.org_id = ?
  `;
    const [result] = await db
      .promise()
      .query(query, [all_users_id_result.map((item) => item.user_id), org_id]);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.log("Error in get_all_users_with_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch all users with attendance history",
    });
  }
};

export const get_single_user_with_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id, employee_id, date, month, year } = req.query;

    if (!user_id || !org_id || !employee_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid Credentials",
      });
    }
    // Validate Req User -> apt_org_members
    const fetch_org_member_query = "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [org_member_result] = await db.promise().query(fetch_org_member_query, [user_id, org_id]);
    if (org_member_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }
    // Validate Employee -> apt_users
    const fetch_employee_query = "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [employee_result] = await db.promise().query(fetch_employee_query, [employee_id, org_id]);
    if (employee_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }
    const now = new Date();
    const resolvedDate = Number(date) || now.getDate();
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const resolvedYear = Number(year) || now.getFullYear();

    // Get user_name, email, phone and attendance history
    const query = `
    SELECT 
      user_info.user_name,
      user_info.user_email,
      user_info.user_role_name,
      user_info.id AS user_id,
      user_info.attendance_date,
      user_info.check_in,
      user_info.check_out,
      user_info.attendance_status,
      user_info.working_time,
      apt_users.created_at AS joining_date
    FROM attendance AS user_info
    INNER JOIN apt_users ON user_info.user_id = apt_users.id
    WHERE user_info.user_id = ? 
      AND user_info.org_id = ?
      AND DAY(user_info.attendance_date) = ?
      AND MONTH(user_info.attendance_date) = ?
      AND YEAR(user_info.attendance_date) = ?
    `;
    const [result] = await db
      .promise()
      .query(query, [employee_id, org_id, resolvedDate, resolvedMonth, resolvedYear]);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) { 
    console.log("Error in get_single_user_with_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch single user with attendance history",
    });
  }
};