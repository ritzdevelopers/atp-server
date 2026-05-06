import db from "../db/connect.js";
export const get_organization_features_controller = async (req, res) => {
  try {
    const org_id = Number(req.query?.org_id ?? req.body?.org_id);
    if (!org_id) {
      return res.status(400).json({
        error: "Organization ID is required",
        message: "Organization ID is required",
        success: false,
      });
    }
    const query1 =
      "select feature_id from apt_org_feature_access where org_id = ?";
    const [feature_ids] = await db.promise().query(query1, [org_id]);
    if (!feature_ids || feature_ids.length === 0) {
      return res.status(400).json({
        error: "No features found",
        message: "No features found",
        success: false,
      });
    }
    const query2 = "select * from apt_features where id in (?)";
    const [features] = await db
      .promise()
      .query(query2, [feature_ids.map((feature) => feature.feature_id)]);
    if (!features || features.length === 0) {
      return res.status(400).json({
        error: "No features found",
        message: "No features found",
        success: false,
      });
    }
    return res.status(200).json({
      features,
      success: true,
      message: "Features fetched successfully",
    });
  } catch (error) {
    console.log("Error in get_organization_features_controller: ", error);
    return res.status(500).json({
      error: "Error in get_organization_features_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};

// Get All The Employees With Their Accessible Features ::
export const get_all_employees_with_accessible_features_controller = async (
  req,
  res,
) => {
  try {
    const org_id = Number(req.query?.org_id ?? req.body?.org_id);
    if (!org_id) {
      return res.status(400).json({
        error: "Organization ID is required",
        message: "Organization ID is required",
        success: false,
      });
    }
    // Validate The Organization ID ::
    const query1 = "select * from apt_organizations where id = ?";
    const [organization] = await db.promise().query(query1, [org_id]);
    if (!organization || organization.length === 0) {
      return res.status(400).json({
        error: "Organization not found",
        message: "Organization not found",
        success: false,
      });
    }

    // Step 1: Fetch all employee-role-feature rows for the organization.
    // NOTE: This raw query still returns one row per feature mapping.
    // We will normalize it into one employee object with a features_access array below.
    const query2 = `
SELECT 
  apt_users.id as user_id,

  apt_users.user_name,
  apt_users.user_email,
  apt_users.user_phone,

  apt_user_roles.role_id as user_role_id,
  apt_roles.role_name as user_role_name,

  apt_role_features.feature_id as feature_id,
  apt_user_feature_overrides.is_allowed as feature_is_allowed,

  apt_features.feature_name as feature_name,
  apt_features.feature_val as feature_val

FROM apt_org_members

INNER JOIN apt_users 
  ON apt_users.id = apt_org_members.user_id

INNER JOIN apt_user_roles 
  ON apt_user_roles.user_id = apt_users.id 
  AND apt_user_roles.org_id = apt_org_members.org_id

INNER JOIN apt_roles 
  ON apt_roles.id = apt_user_roles.role_id 
  AND apt_roles.org_id = apt_org_members.org_id

LEFT JOIN apt_role_features 
  ON apt_role_features.role_id = apt_user_roles.role_id 
  AND apt_role_features.org_id = apt_org_members.org_id

LEFT JOIN apt_features 
  ON apt_features.id = apt_role_features.feature_id

LEFT JOIN apt_user_feature_overrides
  ON apt_user_feature_overrides.user_id = apt_users.id
  AND apt_user_feature_overrides.feature_id = apt_features.id
  AND apt_user_feature_overrides.org_id = apt_org_members.org_id

WHERE apt_org_members.org_id = ?
`;

    // Step 2: Run query and collect raw rows.
    const [rows] = await db.promise().query(query2, [org_id]);
    if (!rows || rows.length === 0) {
      return res.status(400).json({
        error: "No employees found",
        message: "No employees found",
        success: false,
      });
    }

    // Step 3: Group rows by user_id to avoid duplicate employee entries.
    // Output target:
    // {
    //   user_id,
    //   user_name,
    //   user_email,
    //   user_phone,
    //   user_role_id,
    //   user_role_name,
    //   features_access: [{ feature_id, feature_is_allowed, feature_name, feature_val }]
    // }
    const employeeMap = new Map();

    for (const row of rows) {
      // Step 3.1: Build base employee object only once.
      if (!employeeMap.has(row.user_id)) {
        employeeMap.set(row.user_id, {
          user_id: row.user_id,
          user_name: row.user_name,
          user_email: row.user_email,
          user_phone: row.user_phone,
          user_role_id: row.user_role_id,
          user_role_name: row.user_role_name,
          features_access: [],
        });
      }

      // Step 3.2: Prepare feature object for this row.
      const featureObj = {
        feature_id: row.feature_id,
        feature_is_allowed: row.feature_is_allowed,
        feature_name: row.feature_name,
        feature_val: row.feature_val,
      };

      // Step 3.3: Skip empty feature rows created by LEFT JOIN when no feature exists.
      if (!featureObj.feature_id) {
        continue;
      }

      // Step 3.4: Push only unique features per employee.
      const currentEmployee = employeeMap.get(row.user_id);
      const alreadyAdded = currentEmployee.features_access.some(
        (f) => Number(f.feature_id) === Number(featureObj.feature_id),
      );
      if (!alreadyAdded) {
        currentEmployee.features_access.push(featureObj);
      }
    }

    // Step 4: Convert map to array response.
    const employees = Array.from(employeeMap.values());

    // Step 5: Return normalized payload (one employee, many features).
    return res.status(200).json({
      employees,
      success: true,
      message: "Employees fetched successfully",
    });
  } catch (error) {
    console.log(
      "Error in get_all_employees_with_accessible_features_controller: ",
      error,
    );
    return res.status(500).json({
      error: "Error in get_all_employees_with_accessible_features_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};

// Assign The Feature To The Employee ::
export const assign_feature_to_employee_controller = async (req, res) => {
  try {
    const req_user = req.user;
    if (!req_user || req_user.user_role_name !== "admin") {
      return res.status(400).json({
        error: "Unauthorized Access",
        message: "Unauthorized Access",
        success: false,
      });
    }
    const { org_id, user_id, user_role_id, feature_id } = req.body;
    if (!org_id || !user_id || !feature_id || !user_role_id) {
      return res.status(400).json({
        error: "Invalid Credentials",
        message: "Invalid Credentials",
        success: false,
      });
    }
    // Check If req_user has access to the feature :: apt_role_features
    const query = "select * from apt_role_features where role_id = ? and feature_id = ? and org_id = ?";
    const [role_feature] = await db.promise().query(query, [user_role_id, feature_id, org_id]);
    if (!role_feature || role_feature.length === 0) {
      return res.status(400).json({
        error: "Role feature not found",
        message: "Role feature not found",
        success: false,
      });
    }

    // Validate The Organization ID ::
    const query1 =
      "select * from apt_organizations where id = ? and owner_id = ?";
    const [organization] = await db
      .promise()
      .query(query1, [org_id, req_user.id]);
    if (!organization || organization.length === 0) {
      return res.status(400).json({
        error: "Organization not found",
        message: "Organization not found",
        success: false,
      });
    }
    // Check If Organization Has The Feature :: apt_org_feature_access
    const query2 =
      "select * from apt_org_feature_access where org_id = ? and feature_id = ?";
    const [feature] = await db.promise().query(query2, [org_id, feature_id]);
    if (!feature || feature.length === 0) {
      return res.status(400).json({
        error: "Feature not found",
        message: "Feature not found",
        success: false,
      });
    }
    // Check If User Has The Role :: apt_user_roles
    const query3 =
      "select * from apt_user_roles where user_id = ? and role_id = ? and org_id = ?";
    const [role] = await db
      .promise()
      .query(query3, [user_id, user_role_id, org_id]);
    if (!role || role.length === 0) {
      return res.status(400).json({
        error: "Role not found",
        message: "Role not found",
        success: false,
      });
    }

    // Check If User Has Already Assigned The Feature :: apt_role_features so return feature already assigned
    const query4 = `
    select * from apt_user_feature_overrides 
    where user_id = ? and feature_id = ? and org_id = ?
    `;
    
    const [feature_assigned] = await db.promise().query(query4, [user_id, feature_id, org_id]);
    
    if (feature_assigned.length > 0) {
      return res.status(400).json({
        error: "Feature already assigned",
        message: "Feature already assigned",
        success: false,
      });
    }

    // Assign The Feature To The User :: apt_role_features
    const query5 = "insert into apt_user_feature_overrides (user_id, feature_id, org_id, is_allowed) values (?, ?, ?, ?)";
    const [feature_assigned_result] = await db.promise().query(query5, [user_id, feature_id, org_id, 1]);
   if (feature_assigned_result.affectedRows === 0) {
      return res.status(400).json({
        error: "Failed to assign feature",
        message: "Failed to assign feature",
        success: false,
      });
    }
    return res.status(200).json({
      message: "Feature assigned successfully to the user",
      success: true,
    });
  } catch (error) {
    console.log("Error in assign_feature_to_employee_controller: ", error);
    return res.status(500).json({
      error: "Error in assign_feature_to_employee_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};
