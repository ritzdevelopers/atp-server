import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker.js";
import {
  is_organization_contains_this_feature,
  is_organization_contains_this_sub_feature,
} from "../../helper/feature_checker.js";
import errorHandling from "../../utils/error.handling.js";

const ALLOWED_PERMISSIONS = ["create", "read", "update", "delete"];

export const assign_features_to_employee_controller = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const { employee_id, feature_info } = req.body;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
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
    if (!Array.isArray(feature_info) || feature_info.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "Invalid Credentials",
        new Error("Invalid Request"),
        400,
      );
    }

    for (let feature of feature_info) {
      const { parent_feature_id, access_permission, sub_features_info } =
        feature;
      if (
        !(await is_organization_contains_this_feature(
          connection,
          org_id,
          parent_feature_id,
        ))
      ) {
        return errorHandling(
          connection,
          res,
          false,
          "Feature Not Found",
          new Error("Feature Not Found"),
          404,
        );
      }
      const is_access_permission_valid = access_permission ? 1 : 0;
      await connection.query(
        `
            INSERT INTO org_employee_feature_access
            (employee_id, org_id, feature_id, access_permission)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE access_permission = VALUES(access_permission)
            `,
        [employee_id, org_id, parent_feature_id, is_access_permission_valid],
      );

      const subFeatures = Array.isArray(sub_features_info) ? sub_features_info : [];
      for (let sub_feature of subFeatures) {
        const {
          sub_feature_id,
          access_sub_permission,
          feature_access,
        } = sub_feature;
        if (
          !(await is_organization_contains_this_sub_feature(
            connection,
            org_id,
            sub_feature_id,
            parent_feature_id,
          ))
        ) {
          return errorHandling(
            connection,
            res,
            false,
            "Sub Feature Not Found",
            new Error("Sub Feature Not Found"),
            404,
          );
        }
        const is_access_sub_permission_valid =
          access_sub_permission === undefined || access_sub_permission === null
            ? 1
            : access_sub_permission
              ? 1
              : 0;

        const [existingAccess] = await connection.query(
          `
            SELECT feature_access
            FROM org_employee_sub_features_access
            WHERE employee_id = ?
              AND sub_feature_id = ?
              AND feature_id = ?
              AND org_id = ?
          `,
          [
            employee_id,
            sub_feature_id,
            parent_feature_id,
            org_id,
          ],
        );

        const oldPermissions =
          existingAccess[0]?.feature_access?.split("-").filter(Boolean) || [];
        const newPermissions =
          feature_access?.split("-").filter(Boolean) || [];

        const uniquePermissions = [
          ...new Set([...oldPermissions, ...newPermissions]),
        ].filter((permission) => ALLOWED_PERMISSIONS.includes(permission));

        const finalFeatureAccess = uniquePermissions.join("-");

        await connection.query(
          `
            INSERT INTO org_employee_sub_features_access
            SET
              employee_id = ?,
              sub_feature_id = ?,
              access_permission = ?,
              feature_id = ?,
              org_id = ?,
              feature_access = ?
            ON DUPLICATE KEY UPDATE
              access_permission = VALUES(access_permission),
              feature_access = VALUES(feature_access)
          `,
          [
            employee_id,
            sub_feature_id,
            is_access_sub_permission_valid,
            parent_feature_id,
            org_id,
            finalFeatureAccess,
          ],
        );
      }
    }
    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Features Assigned To Employee Successfully",
      data: null,
    });
  } catch (error) {
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const remove_features_from_employee_controller = async (req, res) => {
    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        const {user_id: action_user_id} = req.user;
        if (!(await isEmployeeExists(connection, action_user_id))) {
            return errorHandling(
                connection,
                false,
                "Employee Not Found",
                new Error("Employee Not Found"),
                404,
            );
        }
        const {org_id} = req;
        const {employee_id, feature_id} = req.body;
        if (!(await isEmployeeExists(connection, employee_id))) {
            return errorHandling(
                connection,
                false,
                "Employee Not Found",
                new Error("Employee Not Found"),
                404,
            );
        }
        if (
            !(await is_organization_contains_this_feature(
                connection,
                org_id,
                feature_id,
            ))
        ) {
            return errorHandling(connection, false, "Feature Not Found", new Error("Feature Not Found"), 404);
        }
        // Get all sub features of this parent feature assigned to the employee
        const [sub_features_result] = await connection.query(`
            SELECT sub_feature_id
            FROM org_employee_sub_features_access
            WHERE employee_id = ?
              AND feature_id = ?
              AND org_id = ?
              AND access_permission = 1
            `, [employee_id, feature_id, org_id]);
        if (sub_features_result.length === 0) {
            return errorHandling(connection, false, "No Sub Features Found", new Error("No Sub Features Found"), 404);
        }

        const [sub_feature_result] = await connection.query(`
            UPDATE org_employee_sub_features_access
            SET access_permission = 0, feature_access = ''
            WHERE employee_id = ?
              AND feature_id = ?
              AND org_id = ?
        `, [employee_id, feature_id, org_id]);
        if (sub_feature_result.affectedRows === 0) {
            return errorHandling(connection, false, "Failed To Remove Sub Feature From Employee", new Error("Failed To Remove Sub Feature From Employee"), 400);
        }
        const [feature_result] = await connection.query(`
            UPDATE org_employee_feature_access SET access_permission = 0 WHERE employee_id = ? AND feature_id = ? AND org_id = ?
        `, [employee_id, feature_id, org_id]);
        if (feature_result.affectedRows === 0) {
            return errorHandling(connection, false, "Failed To Remove Feature From Employee", new Error("Failed To Remove Feature From Employee"), 400);
        }
        await connection.commit();
        return res.status(200).json({
            success: true,
            message: "Features Removed From Employee Successfully",
            data: null,
        });
    } catch (error) {
        if(connection) { 
            return errorHandling(connection, false, "Internal Server Error", error, 500);
        }
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            data: null,
        });
    } finally {
        if(connection) { 
            connection.release();
        }
    }
}

export const update_access_permission_of_sub_features_controller = async (req, res) => { 
    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();


        const {user_id: action_user_id} = req.user;
        if (!(await isEmployeeExists(connection, action_user_id))) {
            return errorHandling(connection, false, "Employee Not Found", new Error("Employee Not Found"), 404);
        }
        const {org_id} = req;
        const {
            employee_id,
            feature_id,
            sub_feature_id,
            access_sub_permission,
            remove_permission,
        } = req.body;
        if (!(await isEmployeeExists(connection, employee_id))) {
            return errorHandling(connection, false, "Employee Not Found", new Error("Employee Not Found"), 404);
        }
        if (
            !(await is_organization_contains_this_feature(
                connection,
                org_id,
                feature_id,
            ))
        ) {
            return errorHandling(connection, false, "Feature Not Found", new Error("Feature Not Found"), 404);
        }
        if (
            !(await is_organization_contains_this_sub_feature(
                connection,
                org_id,
                sub_feature_id,
                feature_id,
            ))
        ) {
            return errorHandling(connection, false, "Sub Feature Not Found", new Error("Sub Feature Not Found"), 404);
        }

        const [existingAccess] = await connection.query(
            `
            SELECT feature_access
            FROM org_employee_sub_features_access
            WHERE employee_id = ?
              AND sub_feature_id = ?
              AND feature_id = ?
              AND org_id = ?
            `,
            [employee_id, sub_feature_id, feature_id, org_id],
        );
        if (existingAccess.length === 0) {
            return errorHandling(
                connection,
                false,
                "Sub Feature Access Not Found",
                new Error("Sub Feature Access Not Found"),
                404,
            );
        }

        const currentPermissions =
            existingAccess[0]?.feature_access?.split("-").filter(Boolean) || [];
        const permissionsToRemove =
            remove_permission?.split("-").filter(Boolean) || [];

        const remainingPermissions = ALLOWED_PERMISSIONS.filter(
            (permission) =>
                currentPermissions.includes(permission) &&
                !permissionsToRemove.includes(permission),
        );

        const finalFeatureAccess = remainingPermissions.join("-");
        const is_access_sub_permission_valid =
            access_sub_permission !== undefined
                ? access_sub_permission
                    ? 1
                    : 0
                : null;

        const [sub_feature_result] = await connection.query(
            `
            UPDATE org_employee_sub_features_access
            SET
              feature_access = ?,
              access_permission = COALESCE(?, access_permission)
            WHERE employee_id = ?
              AND sub_feature_id = ?
              AND org_id = ?
            `,
            [
                finalFeatureAccess,
                is_access_sub_permission_valid,
                employee_id,
                sub_feature_id,
                org_id,
            ],
        );
        if (sub_feature_result.affectedRows === 0) {
            return errorHandling(connection, false, "Failed To Update Access Permission Of Sub Feature", new Error("Failed To Update Access Permission Of Sub Feature"), 400);
        }
        await connection.commit();
        return res.status(200).json({
            success: true,
            message: "Access Permission Of Sub Feature Updated Successfully",
            data: null,
        });
    } catch (error) {
        if(connection) { 
            return errorHandling(connection, false, "Internal Server Error", error, 500);
        }
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            data: null,
        });
    } finally {
        if(connection) { 
            connection.release();
        }
    }
}

export const assign__feature_access_to_the_employee = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { org_id } = req;
    const { user_id: action_user_id } = req.user;
    const { employee_id, features_info } = req.body;

    // features_info = [
    //   {
    //     feature_id: Number,
    //     access_permission: Boolean,
    //   },
    // ]

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
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

    if (!Array.isArray(features_info) || features_info.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "Invalid Credentials",
        new Error("Invalid Request"),
        400,
      );
    }

    for (const feature of features_info) {
      const { feature_id, access_permission } = feature;
      if (!feature_id) {
        return errorHandling(
          connection,
          res,
          false,
          "Invalid Feature Data",
          new Error("Invalid Feature Data"),
          400,
        );
      }

      if (
        !(await is_organization_contains_this_feature(
          connection,
          org_id,
          feature_id,
        ))
      ) {
        return errorHandling(
          connection,
          res,
          false,
          "Feature Not Found",
          new Error("Feature Not Found"),
          404,
        );
      }

      const is_access_permission_valid = access_permission ? 1 : 0;
      await connection.query(
        `
        INSERT INTO org_employee_feature_access
        (employee_id, org_id, feature_id, access_permission)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE access_permission = VALUES(access_permission)
        `,
        [employee_id, org_id, feature_id, is_access_permission_valid],
      );
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Feature Access Assigned To Employee Successfully",
      data: null,
    });
  } catch (error) {
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if (connection) {
      connection.release();
    }
  }
};