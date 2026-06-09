import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker.js";
import errorHandling from "../../utils/error.handling.js";

const ALLOWED_DASHBOARD_TYPES = ["management", "employee"];

async function canManageEmployeeDashboards(connection, user_id, org_id) {
  const [ownerRows] = await connection.query(
    "SELECT id FROM apt_organizations WHERE id = ? AND owner_id = ?",
    [org_id, user_id],
  );
  if (ownerRows.length > 0) return true;

  const [managementRows] = await connection.query(
    `
    SELECT id
    FROM dashboard_management
    WHERE employee_id = ?
      AND org_id = ?
      AND dashboard_type = 'management'
    `,
    [user_id, org_id],
  );
  return managementRows.length > 0;
}

function isValidDashboardType(dashboard_type) {
  return (
    typeof dashboard_type === "string" &&
    ALLOWED_DASHBOARD_TYPES.includes(dashboard_type.trim().toLowerCase())
  );
}

export const get_all_assigned_dashboards_to_employee = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { org_id } = req;
    const { user_id } = req.user;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    if (!(await canManageEmployeeDashboards(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Access Denied",
        new Error("Only management users can view dashboard assignments"),
        403,
      );
    }

    const [rows] = await connection.query(
      `
      SELECT
        u.id AS employee_id,
        u.user_image AS employee_profile_image,
        u.user_name AS employee_name,
        u.created_at AS employee_joining_date,
        COALESCE(dm.dashboard_type, 'employee') AS dashboard_type,
        dm.created_at AS dashboard_assigned_at,
        dm.updated_at AS dashboard_updated_at
      FROM apt_org_members om
      INNER JOIN apt_organizations org
        ON org.id = om.org_id
      INNER JOIN apt_users u
        ON u.id = om.user_id
      LEFT JOIN dashboard_management dm
        ON dm.employee_id = om.user_id
        AND dm.org_id = om.org_id
      WHERE om.org_id = ?
        AND om.is_active = 1
        AND u.id <> org.owner_id
      ORDER BY u.user_name ASC, u.id ASC
      `,
      [org_id],
    );

    return res.status(200).json({
      success: true,
      message: "Employee dashboard assignments fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.log("Error in get_all_assigned_dashboards_to_employee: ", error);
    return errorHandling(
      connection,
      res,
      false,
      "Internal Server Error",
      error,
      500,
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const assign_dashboard_to_employee = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { org_id } = req;
    const { user_id } = req.user;
    const { employee_id, dashboard_type } = req.body;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    if (!(await canManageEmployeeDashboards(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Access Denied",
        new Error("Only management users can assign dashboards"),
        403,
      );
    }

    if (!employee_id || !isValidDashboardType(dashboard_type)) {
      return errorHandling(
        connection,
        res,
        false,
        "Invalid Credentials",
        new Error("employee_id and dashboard_type are required"),
        400,
      );
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
      );
    }

    const normalizedType = dashboard_type.trim().toLowerCase();

    const [existing] = await connection.query(
      `
      SELECT id, dashboard_type
      FROM dashboard_management
      WHERE employee_id = ?
        AND org_id = ?
      `,
      [employee_id, org_id],
    );

    if (existing.length > 0) {
      return errorHandling(
        connection,
        res,
        false,
        "Dashboard Already Assigned",
        new Error(
          "Dashboard already assigned to this employee. Use update dashboard API instead.",
        ),
        409,
      );
    }

    const [insertResult] = await connection.query(
      `
      INSERT INTO dashboard_management (employee_id, org_id, dashboard_type)
      VALUES (?, ?, ?)
      `,
      [employee_id, org_id, normalizedType],
    );

    return res.status(201).json({
      success: true,
      message: "Dashboard assigned to employee successfully",
      data: {
        id: insertResult.insertId,
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        dashboard_type: normalizedType,
      },
    });
  } catch (error) {
    console.log("Error in assign_dashboard_to_employee: ", error);
    return errorHandling(
      connection,
      res,
      false,
      "Internal Server Error",
      error,
      500,
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_dashboard_from_employee = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { org_id } = req;
    const { user_id } = req.user;
    const { employee_id, dashboard_type } = req.body;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    if (!(await canManageEmployeeDashboards(connection, user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Access Denied",
        new Error("Only management users can update dashboards"),
        403,
      );
    }

    if (!employee_id || !isValidDashboardType(dashboard_type)) {
      return errorHandling(
        connection,
        res,
        false,
        "Invalid Credentials",
        new Error("employee_id and dashboard_type are required"),
        400,
      );
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
      );
    }

    const normalizedType = dashboard_type.trim().toLowerCase();

    const [updateResult] = await connection.query(
      `
      UPDATE dashboard_management
      SET dashboard_type = ?
      WHERE employee_id = ?
        AND org_id = ?
      `,
      [normalizedType, employee_id, org_id],
    );

    if (!updateResult.affectedRows) {
      return errorHandling(
        connection,
        res,
        false,
        "Dashboard Assignment Not Found",
        new Error(
          "No dashboard assignment found for this employee. Use assign dashboard API first.",
        ),
        404,
      );
    }

    const [updatedRows] = await connection.query(
      `
      SELECT
        id,
        employee_id,
        org_id,
        dashboard_type,
        created_at,
        updated_at
      FROM dashboard_management
      WHERE employee_id = ?
        AND org_id = ?
      `,
      [employee_id, org_id],
    );

    return res.status(200).json({
      success: true,
      message: "Employee dashboard updated successfully",
      data: updatedRows[0] ?? null,
    });
  } catch (error) {
    console.log("Error in update_dashboard_from_employee: ", error);
    return errorHandling(
      connection,
      res,
      false,
      "Internal Server Error",
      error,
      500,
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
