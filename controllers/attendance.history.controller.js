import db from "../db/connect.js";

async function fetchSingleUserAttendanceRows(employee_id, org_id, { date, month, year }) {
  const now = new Date();
  const hasDateFilter = date !== undefined && date !== null && String(date).trim() !== "";
  const resolvedDate = hasDateFilter ? Number(date) : null;
  const resolvedMonth = Number(month) || now.getMonth() + 1;
  const resolvedYear = Number(year) || now.getFullYear();

  const queryValues = [employee_id, org_id];
  let dateFilterSql = "";
  if (resolvedDate) {
    dateFilterSql = "AND DAY(user_info.attendance_date) = ?";
    queryValues.push(resolvedDate);
  }
  queryValues.push(resolvedMonth, resolvedYear);

  const query = `
    SELECT
      user_info.user_id,
      user_info.user_name,
      user_info.user_email,
      COALESCE(apt_roles.role_name, user_info.user_role_name) AS user_role_name,
      user_info.id AS attendance_id,
      DATE_FORMAT(user_info.attendance_date, '%Y-%m-%d') AS attendance_date,
      DATE_FORMAT(user_info.check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
      DATE_FORMAT(user_info.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
      user_info.attendance_status,
      COALESCE(user_info.working_time, user_info.working_hours, 0) AS working_time,
      apt_users.user_phone,
      apt_users.created_at AS joining_date
    FROM attendance AS user_info
    INNER JOIN apt_users ON user_info.user_id = apt_users.id
    LEFT JOIN apt_user_roles
      ON apt_user_roles.user_id = apt_users.id
      AND apt_user_roles.org_id = user_info.org_id
    LEFT JOIN apt_roles
      ON apt_roles.id = apt_user_roles.role_id
      AND apt_roles.org_id = user_info.org_id
    WHERE user_info.user_id = ?
      AND user_info.org_id = ?
      ${dateFilterSql}
      AND MONTH(user_info.attendance_date) = ?
      AND YEAR(user_info.attendance_date) = ?
    ORDER BY user_info.attendance_date DESC
  `;

  const [result] = await db.promise().query(query, queryValues);

  if (result.length === 0) {
    const [profileRows] = await db.promise().query(
      `
        SELECT
          apt_users.id AS user_id,
          apt_users.user_name,
          apt_users.user_email,
          apt_users.user_phone,
          apt_users.created_at AS joining_date,
          COALESCE(apt_roles.role_name, '') AS user_role_name
        FROM apt_users
        INNER JOIN apt_org_members
          ON apt_org_members.user_id = apt_users.id
          AND apt_org_members.org_id = ?
        LEFT JOIN apt_user_roles
          ON apt_user_roles.user_id = apt_users.id
          AND apt_user_roles.org_id = ?
        LEFT JOIN apt_roles
          ON apt_roles.id = apt_user_roles.role_id
          AND apt_roles.org_id = ?
        WHERE apt_users.id = ?
        LIMIT 1
      `,
      [org_id, org_id, org_id, employee_id],
    );

    return profileRows;
  }

  return result;
}

async function assertTeamLeaderCanViewMember(user_id, org_id, team_id, employee_id) {
  const [teamRows] = await db.promise().query(
    `SELECT admin_id FROM org_teams WHERE id = ? AND org_id = ? LIMIT 1`,
    [team_id, org_id],
  );
  if (teamRows.length === 0) {
    return { ok: false, status: 404, message: "Team not found" };
  }
  if (Number(teamRows[0].admin_id) !== Number(user_id)) {
    return { ok: false, status: 403, message: "Only the team reporting manager can view member attendance" };
  }

  const [memberRows] = await db.promise().query(
    `
      SELECT id
      FROM team_members
      WHERE team_id = ?
        AND user_id = ?
        AND leave_date IS NULL
      LIMIT 1
    `,
    [team_id, employee_id],
  );
  if (memberRows.length === 0) {
    return { ok: false, status: 404, message: "Employee is not an active member of this team" };
  }

  const [employeeRows] = await db.promise().query(
    `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
    [employee_id, org_id],
  );
  if (employeeRows.length === 0) {
    return { ok: false, status: 404, message: "Employee not found" };
  }

  return { ok: true };
}

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
        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
        DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
        DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        attendance_status AS status,
        COALESCE(working_time, working_hours, 0) AS working_time
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
    const query = `
    SELECT 
      user_info.user_id AS user_id,
      user_info.user_name,
      user_info.user_email,
      COALESCE(apt_roles.role_name, user_info.user_role_name) AS user_role_name,
      user_info.id AS attendance_id,
      DATE_FORMAT(user_info.attendance_date, '%Y-%m-%d') AS attendance_date,
      DATE_FORMAT(user_info.check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
      DATE_FORMAT(user_info.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
      user_info.attendance_status,
      COALESCE(user_info.working_time, user_info.working_hours, 0) AS working_time,
      apt_users.created_at AS joining_date
    FROM attendance AS user_info
    INNER JOIN apt_users 
      ON user_info.user_id = apt_users.id
    LEFT JOIN apt_user_roles
      ON apt_user_roles.user_id = apt_users.id
      AND apt_user_roles.org_id = user_info.org_id
    LEFT JOIN apt_roles
      ON apt_roles.id = apt_user_roles.role_id
      AND apt_roles.org_id = user_info.org_id
    WHERE user_info.user_id IN (?)
      AND user_info.org_id = ?
    ORDER BY user_info.attendance_date DESC
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
    // Validate Employee -> apt_org_members
    const fetch_employee_query = "SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?";
    const [employee_result] = await db.promise().query(fetch_employee_query, [employee_id, org_id]);
    if (employee_result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }
    const now = new Date();
    const hasDateFilter = date !== undefined && date !== null && String(date).trim() !== "";
    const resolvedDate = hasDateFilter ? Number(date) : null;
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const resolvedYear = Number(year) || now.getFullYear();

    const result = await fetchSingleUserAttendanceRows(employee_id, org_id, {
      date: resolvedDate,
      month: resolvedMonth,
      year: resolvedYear,
    });

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

export const get_team_member_attendance_history = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id, employee_id, team_id, date, month, year } = req.query;

    if (!user_id || !org_id || !employee_id || !team_id) {
      return res.status(400).json({
        success: false,
        message: "org_id, team_id, and employee_id are required",
      });
    }

    const [orgMemberRows] = await db.promise().query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
      [user_id, org_id],
    );
    if (orgMemberRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization member not found",
      });
    }

    const access = await assertTeamLeaderCanViewMember(
      user_id,
      org_id,
      team_id,
      employee_id,
    );
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const now = new Date();
    const hasDateFilter = date !== undefined && date !== null && String(date).trim() !== "";
    const resolvedDate = hasDateFilter ? Number(date) : null;
    const resolvedMonth = Number(month) || now.getMonth() + 1;
    const resolvedYear = Number(year) || now.getFullYear();

    const result = await fetchSingleUserAttendanceRows(employee_id, org_id, {
      date: resolvedDate,
      month: resolvedMonth,
      year: resolvedYear,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.log("Error in get_team_member_attendance_history:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch team member attendance history",
    });
  }
};