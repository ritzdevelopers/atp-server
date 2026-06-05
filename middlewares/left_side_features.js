import { isEmployeeExists } from "../helper/employee_checker.js";
import { pool } from "../db/connect.js";
import errorHandling from "../utils/error.handling.js";

const left_side_features = async (req, res, next) => {
  let connection;

  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_user } = req.user;
    const { org_id } = req;

    // Employee Exists
    if (!(await isEmployeeExists(connection, action_user))) {
      return errorHandling(
        connection,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404
      );
    }

    // Organization Exists
    if (!org_id) {
      return errorHandling(
        connection,
        false,
        "Organization Not Found",
        new Error("Organization Not Found"),
        404
      );
    }

    // Check Admin
    const [admin_result] = await connection.query(
      `
      SELECT id
      FROM apt_organizations
      WHERE id = ?
      AND admin_id = ?
      `,
      [org_id, action_user]
    );

    let features_result = [];

    // ==========================
    // ADMIN
    // ==========================
    if (admin_result.length > 0) {

      const [rows] = await connection.query(
        `
        SELECT

          f.id AS feature_id,
          f.feature_name,
          f.feature_value,

          sf.id AS sub_feature_id,
          sf.sub_feature_name,
          sf.sub_feature_path

        FROM apt_org_feature_access ofa

        INNER JOIN apt_features f
          ON f.id = ofa.feature_id

        LEFT JOIN apt_org_sub_features_access osfa
          ON osfa.org_id = ofa.org_id
          AND osfa.parent_feature_id = ofa.feature_id

        LEFT JOIN apt_sub_features sf
          ON sf.id = osfa.sub_feature_id

        WHERE ofa.org_id = ?
        `,
        [org_id]
      );

      features_result = rows;

    } else {

      // ==========================
      // EMPLOYEE
      // ==========================
      const [rows] = await connection.query(
        `
        SELECT

          f.id AS feature_id,
          f.feature_name,
          f.feature_value,

          sf.id AS sub_feature_id,
          sf.sub_feature_name,
          sf.sub_feature_path

        FROM org_employee_feature_access efa

        INNER JOIN apt_features f
          ON f.id = efa.feature_id

        INNER JOIN org_employee_sub_features_access esfa
          ON esfa.employee_id = efa.employee_id
          AND esfa.feature_id = efa.feature_id
          AND esfa.org_id = efa.org_id

        INNER JOIN apt_sub_features sf
          ON sf.id = esfa.sub_feature_id

        WHERE efa.employee_id = ?
          AND efa.org_id = ?
          AND efa.access_permission = 1
          AND esfa.access_permission = 1
        `,
        [action_user, org_id]
      );

      features_result = rows;
    }

    // ==========================
    // Convert To Nested Structure
    // ==========================

    const featureMap = {};

    for (const row of features_result) {

      if (!featureMap[row.feature_id]) {
        featureMap[row.feature_id] = {
          feature_id: row.feature_id,
          feature_name: row.feature_name,
          feature_value: row.feature_value,
          sub_features: [],
        };
      }

      if (row.sub_feature_id) {
        featureMap[row.feature_id].sub_features.push({
          sub_feature_id: row.sub_feature_id,
          sub_feature_name: row.sub_feature_name,
          sub_feature_path: row.sub_feature_path,
        });
      }
    }

    req.left_side_features = Object.values(featureMap);

    return next();

  } catch (error) {

    return errorHandling(
      connection,
      false,
      "Internal Server Error",
      error,
      500
    );

  } finally {

    if (connection) {
      connection.release();
    }
  }
};

export default left_side_features;