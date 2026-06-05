import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker";
import {
  is_organization_contains_this_feature,
  is_organization_contains_this_sub_feature,
} from "../../helper/feature_checker";

export const assign_features_to_employee_controller = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    if (!(await isEmployeeExists(connection, action_user_id))) {
      return errorHandling(
        connection,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
      );
    }
    const { org_id } = req;
    const { employee_id, feature_info } = req.body;
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
      return errorHandling(
        connection,
        false,
        "Feature Not Found",
        new Error("Feature Not Found"),
        404,
      );
    }
    // Give Permission To Employee
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
          false,
          "Feature Not Found",
          new Error("Feature Not Found"),
          404,
        );
      }
      const is_access_permission_valid = access_permission ? 1 : 0;
      const [feature_result] = await connection.query(
        `
            INSERT IGNORE INTO org_employee_feature_access SET employee_id = ?, feature_id = ?, access_permission = ?
            `,
        [employee_id, parent_feature_id, is_access_permission_valid],
      );
      if (feature_result.affectedRows === 0) {
        return errorHandling(
          connection,
          false,
          "Failed To Give Permission To Employee",
          new Error("Failed To Give Permission To Employee"),
          400,
        );
      }
      for (let sub_feature of sub_features_info) {
        const { sub_feature_id, access_sub_permission } = sub_feature;
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
            false,
            "Sub Feature Not Found",
            new Error("Sub Feature Not Found"),
            404,
          );
        }
        const is_access_sub_permission_valid = access_sub_permission ? 1 : 0;
        const [sub_feature_result] = await connection.query(
          `
                INSERT IGNORE INTO org_employee_sub_features_access 
                SET employee_id = ?, sub_feature_id = ?, access_permission = ?, feature_id = , org_id = ?
                `,
          [
            employee_id,
            sub_feature_id,
            is_access_sub_permission_valid,
            parent_feature_id,
            org_id,
          ],
        );
        if (sub_feature_result.affectedRows === 0) {
          return errorHandling(
            connection,
            false,
            "Failed To Give Permission To Employee",
            new Error("Failed To Give Permission To Employee"),
            400,
          );
        }
      }
    }
    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Features Assigned To Employee Successfully",
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
        // Get All Sub Features Of This Feature That Is Assign To This Employee
        const [sub_features_result] = await connection.query(`
            SELECT sub_feature_id FROM org_employee_sub_features_access WHERE employee_id = ? AND feature_id = ? AND org_id = ? AND access_permission = 1
            `, [employee_id, feature_id, org_id]);
        if (sub_features_result.length === 0) {
            return errorHandling(connection, false, "No Sub Features Found", new Error("No Sub Features Found"), 404);
        }
        for (let sub_feature of sub_features_result) {
            const {sub_feature_id} = sub_feature;
            const [sub_feature_result] = await connection.query(`
                UPDATE org_employee_sub_features_access SET access_permission = 0 WHERE employee_id = ? AND sub_feature_id = ? AND org_id = ?
            `, [employee_id, sub_feature_id, org_id]);
            if (sub_feature_result.affectedRows === 0) {
                return errorHandling(connection, false, "Failed To Remove Sub Feature From Employee", new Error("Failed To Remove Sub Feature From Employee"), 400);
            }
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
        const {employee_id, feature_id, sub_feature_id, access_sub_permission} = req.body;
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
        const [sub_feature_result] = await connection.query(`
            UPDATE org_employee_sub_features_access SET access_permission = ? WHERE employee_id = ? AND sub_feature_id = ? AND org_id = ?
        `, [access_sub_permission, employee_id, sub_feature_id, org_id]);
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

