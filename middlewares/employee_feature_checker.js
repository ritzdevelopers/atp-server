import { isEmployeeExists } from "../helper/employee_checker.js";
import { pool } from "../db/connect.js";
import errorHandling from "../utils/error.handling.js";

const ALLOWED_PERMISSIONS = ["create", "read", "update", "delete"];

function normalizePermission(permission) {
  const normalized = String(permission || "read").trim().toLowerCase();
  return ALLOWED_PERMISSIONS.includes(normalized) ? normalized : "read";
}

function parseFeatureAccessPermissions(featureAccess) {
  if (!featureAccess || typeof featureAccess !== "string") return [];
  return [
    ...new Set(
      featureAccess
        .split("-")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => ALLOWED_PERMISSIONS.includes(p)),
    ),
  ];
}

function hasAssignedPermission(featureAccess, requiredPermission) {
  const granted = parseFeatureAccessPermissions(featureAccess);
  return granted.includes(requiredPermission);
}

const employee_feature_checker = (
  feature_value,
  sub_feature_value,
  feature_permission = "read",
) => {
  const requiredPermission = normalizePermission(feature_permission);
  return async (req, res, next) => {
    let connection;

    try {
      connection = await pool.promise().getConnection();

      const { user_id: action_user } = req.user;
      const { org_id } = req;
      // Employee Exists
      if (!(await isEmployeeExists(connection, action_user, org_id))) {
        return errorHandling(
          connection,
          res,
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
          res,
          false,
          "Organization Not Found",
          new Error("Organization Not Found"),
          404
        );
      }

      // Organization Admin -> Full Access
      const [admin_result] = await connection.query(
        `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        AND owner_id = ?
        `,
        [org_id, action_user]
      );

      if (admin_result.length > 0) {
        return next();
      }

      // Employee Feature + Sub Feature Permission Check
      const [permission_result] = await connection.query(
        `
        SELECT
          emp_feature.access_permission AS parent_access_permission,
          emp_sub_feature.access_permission AS sub_access_permission,
          emp_sub_feature.feature_access,
          features.id AS feature_id,
          features.feature_val AS feature_value,
          sub_features.id AS sub_feature_id,
          sub_features.sub_feature_path
        FROM org_employee_feature_access AS emp_feature
        INNER JOIN apt_features AS features
          ON features.id = emp_feature.feature_id
        INNER JOIN org_employee_sub_features_access AS emp_sub_feature
          ON emp_sub_feature.employee_id = emp_feature.employee_id
          AND emp_sub_feature.feature_id = emp_feature.feature_id
          AND emp_sub_feature.org_id = emp_feature.org_id
        INNER JOIN apt_sub_features AS sub_features
          ON sub_features.id = emp_sub_feature.sub_feature_id
        WHERE emp_feature.employee_id = ?
          AND emp_feature.org_id = ?
          AND emp_feature.access_permission = 1
          AND emp_sub_feature.access_permission = 1
          AND features.feature_val = ?
          AND sub_features.sub_feature_path = ?
        `,
        [
          action_user,
          org_id,
          feature_value,
          sub_feature_value,
        ]
      );
      if (permission_result.length === 0) {
        return errorHandling(
          connection,
          res,
          false,
          "Access Denied",
          new Error("Feature/Sub Feature Not Assigned"),
          403
        );
      }

      const permission = permission_result[0];

      if (
        Number(permission.parent_access_permission) !== 1 ||
        Number(permission.sub_access_permission) !== 1
      ) {
        return errorHandling(
          connection,
          res,
          false,
          "Access Denied",
          new Error("Permission Denied"),
          403,
        );
      }

      const grantedPermissions = parseFeatureAccessPermissions(
        permission.feature_access,
      );

      if (!hasAssignedPermission(permission.feature_access, requiredPermission)) {
        return errorHandling(
          connection,
          res,
          false,
          "Access Denied",
          new Error(
            `Required permission "${requiredPermission}" is not assigned for this sub-feature`,
          ),
          403,
        );
      }

      req.feature_access = {
        feature_id: permission.feature_id,
        feature_value: permission.feature_value,
        sub_feature_id: permission.sub_feature_id,
        sub_feature_path: permission.sub_feature_path,
        required_permission: requiredPermission,
        granted_permissions: grantedPermissions,
      };

      return next();

    } catch (error) {

      return errorHandling(
        connection,
        res,
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
};

export default employee_feature_checker;