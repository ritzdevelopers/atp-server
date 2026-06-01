import db from "../db/connect.js";

export const getEmployeesFullInformationController = async (req, res) => {
  try {
    const user = req.user;
    const org_id = req.query?.org_id ?? req.body?.org_id;

    if (!user?.user_id || !org_id) {
      return res.status(400).json({ message: "user_id and org_id are required" });
    }

    // 1. Check Org
    const [org] = await db
      .promise()
      .query("SELECT * FROM apt_organizations WHERE id = ?", [org_id]);

    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // 2. Owner
    const [owner] = await db
      .promise()
      .query("SELECT user_name, user_email FROM apt_users WHERE id = ?", [
        org[0].owner_id,
      ]);

    // 3. Membership check
    const [member] = await db
      .promise()
      .query("SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ?", [
        user.user_id,
        org_id,
      ]);

    if (member.length === 0) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // 4. USER BASIC INFO (NO attendance join)
    const [userInfo] = await db.promise().query(
      `
      SELECT apt_users.*,

      user_shifts.shift_id as user_shift_id,
      shifts.shift_name as user_shift_name,
      shifts.start_time as user_shift_start_time,
      shifts.end_time as user_shift_end_time,
      shifts.late_after as mark_attendance_late_after,
      shifts.is_night_shift as is_night_shift,

      leave_balance.total_leaves,
      leave_balance.used_leaves,
      leave_balance.remaining_leaves,

      apt_user_roles.role_id as user_role_id,
      apt_roles.role_name as user_role_name

      FROM apt_users

      LEFT JOIN user_shifts ON apt_users.id = user_shifts.user_id
      LEFT JOIN shifts ON user_shifts.shift_id = shifts.id
      LEFT JOIN leave_balance ON apt_users.id = leave_balance.user_id
      INNER JOIN apt_user_roles ON apt_user_roles.user_id = apt_users.id
      INNER JOIN apt_roles ON apt_user_roles.role_id = apt_roles.id

      WHERE apt_users.id = ?
      `,
      [user.user_id]
    );

    if (userInfo.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // 5. Per leave-type balances (employee_leave_balance + leave_types)
    const [employeeLeaveBalances] = await db.promise().query(
      `
      SELECT
        emp_lev_bal.id,
        emp_lev_bal.user_id,
        emp_lev_bal.org_id,
        emp_lev_bal.leave_type_id,
        emp_lev_bal.total_leaves,
        emp_lev_bal.used_leaves,
        emp_lev_bal.remaining_leaves,
        leave_types.leave_type_name
      FROM employee_leave_balance AS emp_lev_bal
      LEFT JOIN leave_types
        ON emp_lev_bal.leave_type_id = leave_types.id
        AND emp_lev_bal.org_id = leave_types.org_id
      WHERE emp_lev_bal.user_id = ? AND emp_lev_bal.org_id = ?
      ORDER BY leave_types.leave_type_name ASC, emp_lev_bal.leave_type_id ASC
      `,
      [user.user_id, org_id],
    );

    const leave_summary = employeeLeaveBalances.reduce(
      (acc, row) => ({
        total_leaves: acc.total_leaves + Number(row.total_leaves || 0),
        used_leaves: acc.used_leaves + Number(row.used_leaves || 0),
        remaining_leaves:
          acc.remaining_leaves + Number(row.remaining_leaves || 0),
      }),
      { total_leaves: 0, used_leaves: 0, remaining_leaves: 0 },
    );

    // 6. FULL ATTENDANCE HISTORY
    const [attendanceHistory] = await db.promise().query(
      `
      SELECT 
        id,
        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
        DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
        DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
        attendance_status,
        working_time
      FROM attendance
      WHERE user_id = ? AND org_id = ?
      ORDER BY attendance_date DESC
      `,
      [user.user_id, org_id]
    );

    // 7. RESPONSE
    return res.status(200).json({
      message: "Employee full info fetched",
      owner: owner[0],
      organization: org[0],
      employee: userInfo[0],
      leave_summary,
      employee_leave_balances: employeeLeaveBalances,
      attendance_history: attendanceHistory,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateImageAndNameOfEmployeeController = async (req, res) => {
  try {
    const user = req.user;
    const { org_id, new_img, new_name } = req.body;

    if (!user?.user_id || !org_id) {
      return res
        .status(400)
        .json({ message: "user_id and org_id are required" });
    }

    // Check Org Exists
    const [org] = await db
      .promise()
      .query("SELECT * FROM organizations WHERE id = ?", [org_id]);
    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // Check Is User Valid Member of Org
    const [member] = await db
      .promise()
      .query("SELECT * FROM org_members WHERE user_id = ? AND org_id = ?", [
        user.user_id,
        org_id,
      ]);
    if (member.length === 0) {
      return res.status(403).json({ message: "Forbidden" });
    }

    let field_name = [];
    let field_value = [];
    if (new_img) {
      field_name.push("user_image");
      field_value.push(new_img);
    }
    if (new_name) {
      field_name.push("user_name");
      field_value.push(new_name);
    }

    if (field_name.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // Update Image and Name of Employee
    const [updatedEmployee] = await db
      .promise()
      .query("UPDATE apt_users SET ? WHERE id = ?", [
        field_name,
        field_value,
        user.user_id,
      ]);
    if (updatedEmployee.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Return The Response
    return res
      .status(200)
      .json({
        message: "Image and name updated successfully",
        employee: updatedEmployee[0],
      });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
