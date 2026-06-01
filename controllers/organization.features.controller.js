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
    console.log("req_user: ", req_user);
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
    const query =
      "select * from apt_role_features where role_id = ? and feature_id = ? and org_id = ?";
    const [role_feature] = await db
      .promise()
      .query(query, [req_user.user_role_id, feature_id, org_id]);
    if (!role_feature || role_feature.length === 0) {
      return res.status(400).json({
        error: "Role feature not found",
        message: "Role feature not found",
        success: false,
      });
    }

    // Validate The Organization ID ::
    const query1 = "select * from apt_organizations where id = ?";
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

    const [feature_assigned] = await db
      .promise()
      .query(query4, [user_id, feature_id, org_id]);

    if (feature_assigned.length > 0) {
      return res.status(400).json({
        error: "Feature already assigned",
        message: "Feature already assigned",
        success: false,
      });
    }

    // Assign The Feature To The User :: apt_role_features
    const query5 =
      "insert into apt_user_feature_overrides (user_id, feature_id, org_id, is_allowed) values (?, ?, ?, ?)";
    const [feature_assigned_result] = await db
      .promise()
      .query(query5, [user_id, feature_id, org_id, 1]);
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

// Get All Roles Of The Organization ::
export const get_all_roles_of_organization_controller = async (req, res) => {
  try {
    const req_user = req.user;
    if (!req_user || req_user.user_role_name !== "admin") {
      return res.status(400).json({
        error: "Unauthorized Access",
        message: "Unauthorized Access",
        success: false,
      });
    }
    const org_id = Number(req.query?.org_id ?? req.body?.org_id);
    if (!org_id) {
      return res.status(400).json({
        error: "Organization ID is required",
        message: "Organization ID is required",
        success: false,
      });
    }
    // Get All Roles Of The Organization :: apt_roles
    const query = "select * from apt_roles where org_id = ?";
    const [roles] = await db.promise().query(query, [org_id]);
    if (!roles || roles.length === 0) {
      return res.status(400).json({
        error: "No roles found",
        message: "No roles found",
        success: false,
      });
    }
    return res.status(200).json({
      roles,
      success: true,
      message: "Roles fetched successfully",
    });
  } catch (error) {
    console.log("Error in get_all_roles_of_organization_controller: ", error);
    return res.status(500).json({
      error: "Error in get_all_roles_of_organization_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};

// Assign The Feature To The Role ::
export const assign_feature_to_role_controller = async (req, res) => {
  try {
    // ==============================
    // AUTH CHECK
    // ==============================
    const req_user = req.user;

    if (!req_user) {
      return res.status(401).json({
        error: "Unauthorized Access",
        message: "Please login first",
        success: false,
      });
    }

    if (req_user.user_role_name !== "admin") {
      return res.status(403).json({
        error: "Forbidden Access",
        message: "Only admin can assign features to roles",
        success: false,
      });
    }

    // ==============================
    // BODY VALIDATION
    // ==============================
    const { org_id, role_id, feature_id } = req.body;

    if (!org_id || !role_id || !feature_id) {
      return res.status(400).json({
        error: "Invalid Credentials",
        message: "org_id, role_id and feature_id are required",
        success: false,
      });
    }

    // ==============================
    // VALIDATE ORGANIZATION
    // Ensure admin owns this organization
    // ==============================
    const orgQuery = `
      SELECT id, owner_id
      FROM apt_organizations
      WHERE id = ? AND owner_id = ?
    `;

    const [organization] = await db
      .promise()
      .query(orgQuery, [org_id, req_user.user_id]);

    if (organization.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Invalid organization access",
        success: false,
      });
    }

    // ==============================
    // VALIDATE ROLE
    // ==============================
    const roleQuery = `
      SELECT id, role_name
      FROM apt_roles
      WHERE id = ? AND org_id = ?
    `;

    const [role] = await db.promise().query(roleQuery, [role_id, org_id]);

    if (role.length === 0) {
      return res.status(404).json({
        error: "Role not found",
        message: "Role does not exist in this organization",
        success: false,
      });
    }

    // ==============================
    // VALIDATE FEATURE ACCESS
    // Ensure organization owns this feature
    // ==============================
    const featureQuery = `
      SELECT feature_id
      FROM apt_org_feature_access
      WHERE org_id = ? AND feature_id = ?
    `;

    const [feature] = await db
      .promise()
      .query(featureQuery, [org_id, feature_id]);

    if (feature.length === 0) {
      return res.status(404).json({
        error: "Feature not found",
        message: "Organization does not have access to this feature",
        success: false,
      });
    }

    // ==============================
    // CHECK DUPLICATE ASSIGNMENT
    // ==============================
    const duplicateQuery = `
      SELECT id
      FROM apt_role_features
      WHERE role_id = ? AND feature_id = ? AND org_id = ?
    `;

    const [alreadyAssigned] = await db
      .promise()
      .query(duplicateQuery, [role_id, feature_id, org_id]);

    if (alreadyAssigned.length > 0) {
      return res.status(400).json({
        error: "Feature already assigned",
        message: "This feature is already assigned to the role",
        success: false,
      });
    }

    // ==============================
    // ASSIGN FEATURE TO ROLE
    // ==============================
    const insertQuery = `
      INSERT INTO apt_role_features
      (role_id, feature_id, org_id)
      VALUES (?, ?, ?)
    `;

    const [insertResult] = await db
      .promise()
      .query(insertQuery, [role_id, feature_id, org_id]);

    if (insertResult.affectedRows === 0) {
      return res.status(500).json({
        error: "Assignment Failed",
        message: "Failed to assign feature to role",
        success: false,
      });
    }

    // ==============================
    // SUCCESS RESPONSE
    // ==============================
    return res.status(200).json({
      success: true,
      message: "Feature assigned to role successfully",
      data: {
        org_id,
        role_id,
        feature_id,
      },
    });
  } catch (error) {
    console.log("Error in assign_feature_to_role_controller:", error);

    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
};

// Remove The Feature Of The Role :: Delete Request
export const update_feature_of_role_controller = async (req, res) => {
  try {
    // ==============================
    // AUTH CHECK
    // ==============================
    const req_user = req.user;

    if (!req_user) {
      return res.status(401).json({
        error: "Unauthorized Access",
        message: "Please login first",
        success: false,
      });
    }

    if (req_user.user_role_name !== "admin") {
      return res.status(403).json({
        error: "Forbidden Access",
        message: "Only admin can update role features",
        success: false,
      });
    }

    // ==============================
    // BODY VALIDATION
    // ==============================
    const { org_id, role_id, feature_id, is_allowed } = req.body;

    if (!org_id || !role_id || !feature_id || typeof is_allowed !== "number") {
      return res.status(400).json({
        error: "Invalid Credentials",
        message: "org_id, role_id, feature_id and is_allowed are required",
        success: false,
      });
    }

    // ==============================
    // VALIDATE ORGANIZATION
    // ==============================
    const orgQuery = `
      SELECT id
      FROM apt_organizations
      WHERE id = ? AND owner_id = ?
    `;

    const [organization] = await db
      .promise()
      .query(orgQuery, [org_id, req_user.user_id]);

    if (organization.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Invalid organization access",
        success: false,
      });
    }

    // ==============================
    // VALIDATE ROLE
    // ==============================
    const roleQuery = `
      SELECT id, role_name
      FROM apt_roles
      WHERE id = ? AND org_id = ?
    `;

    const [role] = await db.promise().query(roleQuery, [role_id, org_id]);

    if (role.length === 0) {
      return res.status(404).json({
        error: "Role not found",
        message: "Role does not exist in this organization",
        success: false,
      });
    }

    if (String(role[0].role_name || "").toLowerCase() === "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Cannot remove feature access from the admin role",
        success: false,
      });
    }

    // ==============================
    // VALIDATE FEATURE
    // ==============================
    const featureQuery = `
      SELECT id
      FROM apt_features
      WHERE id = ?
    `;

    const [feature] = await db.promise().query(featureQuery, [feature_id]);

    if (feature.length === 0) {
      return res.status(404).json({
        error: "Feature not found",
        message: "Feature does not exist",
        success: false,
      });
    }

    // ==============================
    // VALIDATE ROLE-FEATURE MAPPING
    // ==============================
    const mappingQuery = `
      SELECT id
      FROM apt_role_features
      WHERE role_id = ? AND feature_id = ? AND org_id = ?
    `;

    const [mapping] = await db
      .promise()
      .query(mappingQuery, [role_id, feature_id, org_id]);

    if (mapping.length === 0) {
      return res.status(404).json({
        error: "Role feature mapping not found",
        message: "This feature is not assigned to the role",
        success: false,
      });
    }

    // ==============================
    // Remove FEATURE ACCESS
    // ==============================
    const remove_feature_from_role_query = `
      DELETE FROM apt_role_features
      WHERE role_id = ? AND feature_id = ? AND org_id = ?
    `;
    const [remove_feature_from_role_result] = await db
      .promise()
      .query(remove_feature_from_role_query, [role_id, feature_id, org_id]);
    if (remove_feature_from_role_result.affectedRows === 0) {
      return res.status(400).json({
        error: "Failed to remove feature from role",
        message: "Failed to remove feature from role",
        success: false,
      });
    }
    return res.status(200).json({
      success: true,
      message: "Feature removed from role successfully",
    });
  } catch (error) {
    console.log("Error in update_feature_of_role_controller:", error);

    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
};

// List features mapped to a role (for admin UI: assign + toggle is_allowed)
export const get_role_feature_mappings_controller = async (req, res) => {
  try {
    const req_user = req.user;
    if (!req_user || req_user.user_role_name !== "admin") {
      return res.status(403).json({
        error: "Unauthorized Access",
        message: "Unauthorized Access",
        success: false,
      });
    }
    const org_id = Number(req.query?.org_id ?? req.body?.org_id);
    const role_id = Number(req.query?.role_id ?? req.body?.role_id);
    if (!org_id || !role_id) {
      return res.status(400).json({
        error: "Invalid request",
        message: "org_id and role_id are required",
        success: false,
      });
    }
    const [organization] = await db
      .promise()
      .query(`SELECT id FROM apt_organizations WHERE id = ? AND owner_id = ?`, [
        org_id,
        req_user.user_id,
      ]);
    if (!organization || organization.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Invalid organization access",
        success: false,
      });
    }
    const [role] = await db
      .promise()
      .query(`SELECT id FROM apt_roles WHERE id = ? AND org_id = ?`, [
        role_id,
        org_id,
      ]);
    if (!role || role.length === 0) {
      return res.status(404).json({
        error: "Role not found",
        message: "Role does not exist in this organization",
        success: false,
      });
    }
    const [rows] = await db.promise().query(
      `SELECT 
        rf.id AS mapping_id,
        rf.role_id,
        rf.feature_id,
        rf.org_id, 
        f.feature_name,
        f.feature_val
      FROM apt_role_features rf
      INNER JOIN apt_features f ON f.id = rf.feature_id
      WHERE rf.role_id = ? AND rf.org_id = ?`,
      [role_id, org_id],
    );
    return res.status(200).json({
      success: true,
      message: "Role features fetched successfully",
      mappings: rows,
    });
  } catch (error) {
    console.log("Error in get_role_feature_mappings_controller: ", error);
    return res.status(500).json({
      error: "Error in get_role_feature_mappings_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};

// Get All The Organization Members With Their Accessible Features and Roles ::

export const get_all_organization_members_with_accessible_features_and_roles_controller =
  async (req, res) => {
      try {
      
      const org_id = Number(req.query?.org_id ?? req.body?.org_id);
      if (!org_id) {
        return res.status(400).json({
          error: "Organization ID is required",
          message: "Organization ID is required",
          success: false,
        });
      }
      const [organization] = await db
        .promise()
        .query(`SELECT id FROM apt_organizations WHERE id = ?`, [org_id]);
      if (!organization || organization.length === 0) {
        return res.status(404).json({
          error: "Organization not found",
          message: "Organization not found",
          success: false,
        });
      }
      const query = `
  SELECT 
    apt_users.id as user_id,

    apt_users.user_name,
    apt_users.user_email,
    apt_users.user_phone,
    apt_users.created_at,

    apt_user_roles.role_id as user_role_id,
    apt_roles.role_name,

    apt_role_features.feature_id as role_feature_id,

    apt_user_feature_overrides.feature_id as override_feature_id,

    apt_features.id as feature_id,
    apt_features.feature_name,
    apt_features.feature_val

FROM apt_org_members

INNER JOIN apt_users 
    ON apt_users.id = apt_org_members.user_id

INNER JOIN apt_user_roles 
    ON apt_user_roles.user_id = apt_users.id 
    AND apt_user_roles.org_id = apt_org_members.org_id

INNER JOIN apt_roles 
    ON apt_roles.id = apt_user_roles.role_id 
    AND apt_roles.org_id = apt_org_members.org_id

INNER JOIN apt_role_features 
    ON apt_role_features.role_id = apt_user_roles.role_id
    AND apt_role_features.org_id = apt_org_members.org_id

INNER JOIN apt_features
    ON apt_features.id = apt_role_features.feature_id

LEFT JOIN apt_user_feature_overrides 
    ON apt_user_feature_overrides.user_id = apt_users.id 
    AND apt_user_feature_overrides.org_id = apt_org_members.org_id 
    AND apt_user_feature_overrides.feature_id = apt_role_features.feature_id
    AND apt_user_feature_overrides.is_allowed = 0

WHERE apt_org_members.org_id = ?
`;
    const [rows] = await db.promise().query(query, [org_id]);

      const usersMap = new Map();

      for (const row of rows) {

        if (!usersMap.has(row.user_id)) {
          usersMap.set(row.user_id, {
            user_id: row.user_id,
            user_name: row.user_name,
            user_email: row.user_email,
            user_phone: row.user_phone,
            created_at: row.created_at,
      
            user_role_id: row.user_role_id,
            role_name: row.role_name,
      
            features: [],
          });
        }
      
        // Skip overridden features
        if (row.override_feature_id) {
          continue;
        }
      
        const currentUser = usersMap.get(row.user_id);
      
        const alreadyAdded = currentUser.features.some(
          (feature) => Number(feature.feature_id) === Number(row.feature_id),
        );
      
        if (!alreadyAdded) {
          currentUser.features.push({
            feature_id: row.feature_id,
            feature_name: row.feature_name,
            feature_val: row.feature_val,
          });
        }
      }

      // Final Array
      const users = Array.from(usersMap.values());

      return res.status(200).json({
        success: true,
        users,
      });
    } catch (error) {
      console.log(
        "Error in get_all_organization_members_with_accessible_features_and_roles_controller: ",
        error,
      );
      return res.status(500).json({
        error:
          "Error in get_all_organization_members_with_accessible_features_and_roles_controller",
        message: "Try Again Later Or Login Again",
        success: false,
      });
    }
};

// Update The Feature Of The Employee :: Patch Request -> apt_user_feature_overrides.is_allowed
export const update_feature_of_employee_controller = async (req, res) => {
  try {
    const req_user = req.user;
    if (!req_user || req_user.user_role_name !== "admin") {
      return res.status(400).json({
        error: "Unauthorized Access",
        message: "Unauthorized Access",
        success: false,
      });
    }
    const { org_id, user_id, feature_id, is_allowed } = req.body;
    if (!org_id || !user_id || !feature_id || ![0, 1].includes(is_allowed)) {
      return res.status(400).json({
        error: "Invalid Credentials",
        message: "Invalid Credentials",
        success: false,
      });
    }
    const [organization] = await db
      .promise()
      .query(`SELECT id FROM apt_organizations WHERE id = ?`, [org_id]);
    if (!organization || organization.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Organization not found",
        success: false,
      });
    }
    const [user] = await db
      .promise()
      .query(`SELECT id FROM apt_users WHERE id = ?`, [user_id]);
    if (!user || user.length === 0) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
        success: false,
      });
    }
    const [targetUserRole] = await db.promise().query(
      `
      SELECT r.role_name
      FROM apt_user_roles ur
      INNER JOIN apt_roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
      WHERE ur.user_id = ? AND ur.org_id = ?
      LIMIT 1
      `,
      [user_id, org_id],
    );
    if (
      !targetUserRole ||
      targetUserRole.length === 0 ||
      String(targetUserRole[0].role_name || "").trim().toLowerCase() === "admin"
    ) {
      return res.status(403).json({
        error: "Forbidden Access",
        message: "Admin feature access cannot be updated",
        success: false,
      });
    }
    const [feature] = await db
      .promise()
      .query(`SELECT id FROM apt_features WHERE id = ?`, [feature_id]);
    if (!feature || feature.length === 0) {
      return res.status(404).json({
        error: "Feature not found",
        message: "Feature not found",
        success: false,
      });
    }

    const query = `
INSERT INTO apt_user_feature_overrides
(user_id, org_id, feature_id, is_allowed)

VALUES (?, ?, ?, ?)

ON DUPLICATE KEY UPDATE
is_allowed = VALUES(is_allowed)
`;
    
    const [update_feature_of_employee_result] = await db.promise().query(query, [
      user_id,
      org_id,
      feature_id,
      is_allowed,
    ]);
    if (update_feature_of_employee_result.affectedRows === 0) {
      return res.status(400).json({
        error: "Failed to update feature of employee",
        message: "Failed to update feature of employee",
        success: false,
      });
    }
    return res.status(200).json({
      success: true,
      message: "Feature updated successfully for the employee",
    });
  } catch (error) {
    console.log("Error in update_feature_of_employee_controller: ", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
};


export const get_accessible_features_controller = async (req, res) => { 
  try {
     // Return All The Accessible Features Of The Organization That Is Coming From Middleware ::
     const accessible_features = req.accessible_features;
     if(!accessible_features || accessible_features.length === 0) {
      return res.status(400).json({
        error: "No Accessible Features Found",
        message: "No Accessible Features Found",
        success: false,
      });
     }
     return res.status(200).json({
      success: true,
      message: "Accessible Features Fetched Successfully",
      accessible_features,
     });
  } catch (error) {
    console.log("Error in get_accessible_features_controller: ", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
}