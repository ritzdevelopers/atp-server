import { pool as db } from "../db/connect.js";
import features_overrides from "../helper/features_overrides.js";
import get_all_feature_access_of_org from "../helper/get_all_feature_access_of_org.js";
import user_role_feature_access_checkpoint from "../helper/user_role_feature_access_checkpoint.js";
import get_organization_address_helper from "../helper/get_organization_address.js";
import { isEmployeeExists } from "../helper/employee_checker.js";
import errorHandling from "../utils/error.handling.js";

export const create_organization_controller = async (req, res) => {
  const {
    organization_name,
    owner_id,
    organization_email,
    organization_phone,
  } = req.body;

  if (
    !organization_name ||
    !owner_id ||
    !organization_email ||
    !organization_phone
  ) {
    console.log("All fields are required");
    return res.status(400).json({ message: "All fields are required" });
  }

  let connection;
  try {
    connection = await db.promise().getConnection();

    // Check If User Exists ::
    const [user] = await connection.query(
      "SELECT * FROM apt_users WHERE id = ?",
      [owner_id],
    );
    if (user.length === 0) {
      // console.log("User not found");
      return res.status(404).json({
        error: "User not found",
        message: "Register First",
        success: false,
      });
    }

    // Check If Organization Already Exists ::
    const [organization] = await connection.query(
      "SELECT * FROM apt_organizations WHERE org_name = ? OR org_email = ?",
      [organization_name, organization_email],
    );
    if (organization.length > 0) {
      console.log("Organization already exists");
      return res.status(400).json({
        error: "Organization already exists",
        message: "Organization already exists with this name or email",
        success: false,
      });
    }

    await connection.beginTransaction();

    try {
      // Create Organization ::
      const create_organization_query =
        "INSERT INTO apt_organizations (org_name, owner_id, org_email, org_phone) VALUES (?, ?, ?, ?)";
      const values = [
        organization_name,
        owner_id,
        organization_email,
        organization_phone,
      ];
      const [result] = await connection.query(
        create_organization_query,
        values,
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(500).json({
          error: "Failed to create organization",
          message: "Try Again Later",
          success: false,
        });
      }

      const org_id = result.insertId;

      // Create Admin Role ::
      const create_admin_role_query =
        "INSERT INTO apt_roles (role_name, org_id) VALUES (?, ?)";
      const values2 = ["admin", org_id];
      const [admin_role] = await connection.query(
        create_admin_role_query,
        values2,
      );

      if (admin_role.affectedRows === 0) {
        await connection.rollback();
        return res.status(500).json({
          error: "Failed to create admin role",
          message: "Try Again Later",
          success: false,
        });
      }

      const role_id = admin_role.insertId;

      // Insert User Role ::
      const insert_user_role_query =
        "INSERT INTO apt_user_roles (role_id, user_id, org_id) VALUES (?, ?, ?)";
      const values3 = [role_id, owner_id, org_id];
      const [user_role] = await connection.query(
        insert_user_role_query,
        values3,
      );
      if (user_role.affectedRows === 0) {
        await connection.rollback();
        return res.status(500).json({
          error: "Failed to insert user role",
          message: "Try Again Later",
          success: false,
        });
      }

      // Insert Org Members ::
      const insert_org_members_query =
        "INSERT INTO apt_org_members (user_id, org_id) VALUES (?, ?)";
      const values4 = [owner_id, org_id];
      const [org_members] = await connection.query(
        insert_org_members_query,
        values4,
      );

      if (org_members.affectedRows === 0) {
        await connection.rollback();
        return res.status(500).json({
          error: "Failed to insert org members",
          message: "Try Again Later",
          success: false,
        });
      }

      // Commit Transaction ::
      await connection.commit();
      return res.status(201).json({
        message: "Organization created successfully",
        success: true,
        data: {
          organization_id: org_id,
          organization_name: organization_name,
        },
      });
    } catch (txError) {
      // Rollback Transaction ::
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback error: ", rollbackErr);
      }
      console.log("Transaction error: ", txError);
      return res.status(500).json({
        error: "Transaction error",
        message: "Try Again Later",
        success: false,
      });
    }
  } catch (error) {
    // Rollback Transaction ::
    console.log("Error creating organization: ", error);
    return res.status(500).json({
      error: "Error creating organization",
      message: "Try Again Later",
      success: false,
    });
  } finally {
    // Release Connection ::
    if (connection != null) {
      try {
        connection.release();
      } catch (releaseErr) {
        console.error("Connection release error: ", releaseErr);
      }
    }
  }
};

export const get_organization_controller = async (req, res) => {
  // Controller Access Val -> get-organization-information
  try {
    const { user_id, user_role_id, user_role_name } = req.user;
    const req_user = req.user;
    console.log("req_user: ", req_user);

    // Fetch Organization From apt_org_members
    const fetch_organization_from_org_members_query =
      "SELECT org_id FROM apt_org_members WHERE user_id = ?";
    const [org_members] = await db
      .promise()
      .query(fetch_organization_from_org_members_query, [user_id]);
    if (org_members.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Organization not found",
        success: false,
      });
    }
    const org_id = org_members[0].org_id;

    if (!user_id && user_role_name !== "admin" && user_role_name !== "hr") {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Unauthorized",
        success: false,
      });
    }
    // Fetch User Info ::
    const fetch_user_info_query = `SELECT id, user_name, user_email, user_phone, created_at FROM apt_users WHERE id = ?`;
    const [user_info] = await db
      .promise()
      .query(fetch_user_info_query, [user_id]);
    if (user_info.length === 0) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
        success: false,
      });
    }

    // Fetch Organization
    const fetch_organization_query = `SELECT apt_organizations.*,  
                                     
                                     apt_users.user_name AS owner_name,
                                     apt_users.user_email AS owner_email,
                                     apt_users.user_phone AS owner_phone
                                     FROM apt_organizations 
                                     INNER JOIN apt_users ON apt_organizations.owner_id = apt_users.id 
                                     WHERE apt_organizations.id = ?`;
    const [organization] = await db
      .promise()
      .query(fetch_organization_query, [org_id]);

    if (organization.length === 0) {
      return res.status(404).json({
        error: "Organization not found",
        message: "Organization not found",
        success: false,
      });
    }

    // Strict Check If Provided Organization ID Is Invalid ::
    if (organization[0].id !== org_id) {
      return res.status(400).json({
        error: "Invalid organization ID",
        message: "Invalid organization ID",
        success: false,
      });
    }

    // Get All Feature Access Of Org ::
    const { success, message, features } =
      await get_all_feature_access_of_org(org_id);
    if (!success) {
      return res.status(500).json({
        error: message,
        message: message,
        success: false,
      });
    }

    // Check How Many Features Assign To This Role ::
    const { success_status, message_info, data } =
      await user_role_feature_access_checkpoint(user_role_id, org_id);
    if (!success_status || data.length === 0) {
      return res.status(403).json({
        error: message_info,
        message: message_info,
        success: success_status,
        data: null,
      });
    }

    // Extra Check If User Role Have Some Limited Features Access ::
    const auth_features = await Promise.all(
      data.map((f_id) => {
        return features_overrides(f_id, org_id, user_id);
      }),
    );

    // Filter Features Which Are Not Overridden ::

    const filtered_features = features.filter((feature) => {
      const override = auth_features.find(
        (auth_feature) => auth_feature.id === feature.id,
      );

      if (override) {
        return override.is_allowed; // true/false
      }

      return true; // default allow
    });

    return res.status(200).json({
      message: "Organization fetched successfully",
      success: true,
      data: {
        organization: {
          ...organization[0],
          owner_info: {
            name: organization[0].owner_name,
            email: organization[0].owner_email,
          },
        },
        features: filtered_features,
        user: {
          ...user_info[0],
          user_role_name: user_role_name,
        },
      },
    });
  } catch (error) {
    console.log("Error getting organization: ", error);
    return res.status(500).json({
      error: "Error getting organization",
      message: "Try Again Later",
      success: false,
    });
  }
};
export const get_org_info_controller = async (req, res) => {
  try {
    const req_user = req.user;
    const user_features_access = req.accessible_features;

    const { user_id, user_role_id, user_email, user_role_name } = req_user;

    // Validate User
    if (!user_id || !user_role_id || !user_email) {
      return res.status(400).json({
        error: "Invalid Credentials",
        message: "Invalid Credentials",
        success: false,
      });
    }

    // Fetch Organization Info
    const fetch_organization_info_query = `
      SELECT 

        apt_users.user_name,
        apt_users.user_email,
        apt_users.user_phone,

        apt_org_members.org_id,

        apt_organizations.org_name,
        apt_organizations.org_email,
        apt_organizations.org_phone,
        apt_organizations.created_at,

        apt_organizations.owner_id,

        owner_user.user_name AS owner_name,
        owner_user.user_email AS owner_email,
        owner_user.user_phone AS owner_phone,
        owner_user.created_at AS owner_created_at

      FROM apt_users

      INNER JOIN apt_org_members 
        ON apt_users.id = apt_org_members.user_id

      INNER JOIN apt_organizations 
        ON apt_org_members.org_id = apt_organizations.id

      INNER JOIN apt_users AS owner_user 
        ON apt_organizations.owner_id = owner_user.id

      WHERE apt_users.id = ?
    `;

    const [organization_info] = await db
      .promise()
      .query(fetch_organization_info_query, [user_id]);

    // Organization Not Found
    if (!organization_info || organization_info.length === 0) {
      return res.status(404).json({
        error: "Organization Not Found",
        message: "Organization Not Found",
        success: false,
      });
    }

    const org = organization_info[0];
    const organization_address = await get_organization_address_helper(org.org_id); 
    return res.status(200).json({
      message: "Organization Info Fetched Successfully",
      success: true,

      data: {
        organization: {
          org_id: org.org_id,
          org_name: org.org_name,
          org_email: org.org_email,
          org_phone: org.org_phone,
          created_at: org.created_at,

          owner_info: {
            owner_id: org.owner_id,
            name: org.owner_name,
            email: org.owner_email,
            phone: org.owner_phone,
            created_at: org.owner_created_at,
          },
        },

        user_info: {
          user_id,
          role_id: user_role_id,
          role_name: user_role_name,

          name: org.user_name,
          email: org.user_email,
          phone: org.user_phone,
          created_at: org.created_at,
        },

        user_features_access,
        organization_address,
      },
    });
  } catch (error) {
    console.log("Error in get_org_info_controller:", error);

    return res.status(500).json({
      error: "Error in get_org_info_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};

export const get_organization_address_controller = async (req, res) => {
  try {
    const { user_id } = req.user;
 
    const { org_id } = req;

    // Get Owner ID
    const [ownerRows] = await db
      .promise()
      .query("SELECT owner_id FROM apt_organizations WHERE id = ?", [org_id]);
    if (!ownerRows || ownerRows.length === 0) {
      return res.status(404).json({
        error: "Organization Not Found",
        message: "Organization Not Found",
        success: false,
      });
    }
 
    const [organization_addresses] = await db
      .promise()
      .query(
        "SELECT * FROM organization_address WHERE org_id = ? ORDER BY created_at DESC, id DESC",
        [org_id],
      );
    const rows = organization_addresses ?? [];
    return res.status(200).json({
      message:
        rows.length === 0
          ? "No organization addresses found"
          : "Organization addresses fetched successfully",
      success: true,
      data: {
        organization_addresses: rows,
        /** @deprecated use organization_addresses */
        organization_address: rows[0] ?? null,
      },
    });
  } catch (error) {
    console.log("Error in get_organization_address_controller: ", error);
    return res.status(500).json({
      error: "Error in get_organization_address_controller",
      message: "Try Again Later",
      success: false,
    });
  }
};

export const create_organization_address_controller = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req;

    // Get Owner ID
    const [ownerRows] = await db
      .promise()
      .query("SELECT owner_id FROM apt_organizations WHERE id = ?", [org_id]); 
    if (!ownerRows || ownerRows.length === 0) {
      return res.status(404).json({
        error: "Organization Not Found",
        message: "Organization Not Found",
        success: false,
      });
    }
    if (ownerRows[0].owner_id !== user_id) {
      return res.status(403).json({
        error: "Unauthorized",
        message: "Unauthorized",
        success: false,
      });
    }
    const { city, state, district, country, zip_code, address_line } = req.body;
    const create_organization_address_query = `
      INSERT INTO organization_address (org_id, org_owner_id, city, state, district, country, zip_code, address_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      org_id,
      ownerRows[0].owner_id,
      city,
      state,
      district,
      country,
      zip_code,
      address_line,
    ];
    const [result] = await db
      .promise()
      .query(create_organization_address_query, values);
    if (!result || result.affectedRows === 0) {
      return res.status(500).json({
        error: "Failed to create organization address",
        message: "Try Again Later",
        success: false,
      });
    }
    return res.status(201).json({
      message: "Organization address created successfully",
      success: true,
      data: {
        organization_address_id: result.insertId,
      },
    });
  } catch (error) {
    console.log("Error in create_organization_address_controller: ", error);
    return res.status(500).json({
      error: "Error in create_organization_address_controller",
      message: "Try Again Later",
      success: false,
    });
  }
};

export const update_organization_address_controller = async (req, res) => {
  try {
    const { user_id } = req.user;
    const { org_id } = req;

    // Get Owner ID
    const [ownerRows] = await db
      .promise()
      .query("SELECT owner_id FROM apt_organizations WHERE id = ?", [org_id]);
    if (!ownerRows || ownerRows.length === 0) {
      return res.status(404).json({ 
        error: "Organization Not Found",
        message: "Organization Not Found",
        success: false,
      });
    }
    if (ownerRows[0].owner_id !== user_id) {
      return res.status(403).json({
        error: "Unauthorized",
        message: "Unauthorized",
        success: false,
      });
    }
    const {city, state, district, country, zip_code, address_line, organization_address_id} = req.body;
    const update_organization_address_query = `
      UPDATE organization_address SET city = ?, state = ?, district = ?, country = ?, zip_code = ?, address_line = ? WHERE org_id = ? AND org_owner_id = ? AND id = ?
    `;
    const values = [city, state, district, country, zip_code, address_line, org_id, ownerRows[0].owner_id, organization_address_id];
    const [result] = await db
      .promise()
      .query(update_organization_address_query, values);
    if (!result || result.affectedRows === 0) {
      return res.status(500).json({
        error: "Failed to update organization address",
        message: "Try Again Later",
        success: false,
      });
    }
    return res.status(200).json({
      message: "Organization address updated successfully",
      success: true,
      data: {
        organization_address_id: result.insertId,
      },
    });
  } catch (error) {
    console.log("Error in update_organization_address_controller: ", error);
    return res.status(500).json({
      error: "Error in update_organization_address_controller",
      message: "Try Again Later",
      success: false,
    });
  }
};

export const get_organization_features_features_info_controller = async (req, res) => {
  let connection;
  try {
    connection = await db.promise().getConnection();

    const { org_id } = req;
    const { user_id } = req.user;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return errorHandling(connection, res, false, "Unauthorized", new Error("Unauthorized"), 401);
    }

    const [organization_exists] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (!organization_exists || organization_exists.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "Organization Not Found",
        new Error("Organization Not Found"),
        404,
      );
    }

    const [owner_result] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ? AND owner_id = ?",
      [org_id, user_id],
    );

    const isOrgOwner = owner_result.length > 0;

    const [rows] = await connection.query(
      isOrgOwner
        ? `
      SELECT
        f.id AS parent_feature_id,
        f.feature_name,
        f.feature_val,
        sf.id,
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
      ORDER BY f.id ASC, sf.id ASC
      `
        : `
      SELECT
        f.id AS parent_feature_id,
        f.feature_name,
        f.feature_val,
        sf.id,
        sf.sub_feature_name,
        sf.sub_feature_path
      FROM org_employee_feature_access efa
      INNER JOIN apt_features f
        ON f.id = efa.feature_id
      INNER JOIN apt_org_feature_access ofa
        ON ofa.org_id = efa.org_id
        AND ofa.feature_id = efa.feature_id
      LEFT JOIN org_employee_sub_features_access esfa
        ON esfa.employee_id = efa.employee_id
        AND esfa.feature_id = efa.feature_id
        AND esfa.org_id = efa.org_id
        AND esfa.access_permission = 1
      LEFT JOIN apt_sub_features sf
        ON sf.id = esfa.sub_feature_id
      LEFT JOIN apt_org_sub_features_access osfa
        ON osfa.org_id = efa.org_id
        AND osfa.parent_feature_id = efa.feature_id
        AND (sf.id IS NULL OR osfa.sub_feature_id = sf.id)
      WHERE efa.employee_id = ?
        AND efa.org_id = ?
        AND efa.access_permission = 1
        AND (sf.id IS NULL OR osfa.sub_feature_id IS NOT NULL)
      ORDER BY f.id ASC, sf.id ASC
      `,
      isOrgOwner ? [org_id] : [user_id, org_id],
    );

    const groupedFeatures = Object.values(
      rows.reduce((acc, curr) => {
        const parentId = curr.parent_feature_id;

        if (!acc[parentId]) {
          acc[parentId] = {
            parent_feature_id: curr.parent_feature_id,
            feature_name: curr.feature_name,
            feature_val: curr.feature_val,
            sub_features: [],
          };
        }

        if (curr.id) {
          acc[parentId].sub_features.push({
            id: curr.id,
            sub_feature_name: curr.sub_feature_name,
            sub_feature_path: curr.sub_feature_path,
          });
        }

        return acc;
      }, {}),
    );

    return res.status(200).json({
      success: true,
      message: "Organization Features Fetched Successfully",
      data: groupedFeatures,
    });
  } catch (error) {
    console.log("Error in get_organization_features_features_info_controller: ", error);
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const ALLOWED_SUB_FEATURE_PERMISSIONS = ["create", "read", "update", "delete"];

function parseSubFeaturePermissions(featureAccess) {
  if (!featureAccess || typeof featureAccess !== "string") return [];
  return [
    ...new Set(
      featureAccess
        .split("-")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => ALLOWED_SUB_FEATURE_PERMISSIONS.includes(p)),
    ),
  ];
}

export const get_all_employees_with_accessible_features_and_sub_features_info_controller =
  async (req, res) => {
    let connection;
    try {
      connection = await db.promise().getConnection();

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

      const [organization_exists] = await connection.query(
        "SELECT id FROM apt_organizations WHERE id = ?",
        [org_id],
      );
      if (!organization_exists || organization_exists.length === 0) {
        return errorHandling(
          connection,
          res,
          false,
          "Organization Not Found",
          new Error("Organization Not Found"),
          404,
        );
      }

      const [rows] = await connection.query(
        `
        SELECT
          u.id AS employee_id,
          u.user_image AS employee_profile_image,
          u.user_name AS employee_name,
          u.created_at AS employee_joining_date,
          f.id AS feature_id,
          f.feature_name,
          f.feature_val AS feature_value,
          sf.id AS sub_feature_id,
          sf.sub_feature_name,
          sf.sub_feature_path AS sub_feature_value,
          esfa.feature_access
        FROM apt_org_members om
        INNER JOIN apt_organizations org
          ON org.id = om.org_id
        INNER JOIN apt_users u
          ON u.id = om.user_id
        LEFT JOIN org_employee_feature_access efa
          ON efa.employee_id = om.user_id
          AND efa.org_id = om.org_id
          AND efa.access_permission = 1
        LEFT JOIN apt_features f
          ON f.id = efa.feature_id
        LEFT JOIN apt_org_feature_access ofa
          ON ofa.org_id = om.org_id
          AND ofa.feature_id = f.id
        LEFT JOIN org_employee_sub_features_access esfa
          ON esfa.employee_id = efa.employee_id
          AND esfa.feature_id = efa.feature_id
          AND esfa.org_id = efa.org_id
          AND esfa.access_permission = 1
        LEFT JOIN apt_sub_features sf
          ON sf.id = esfa.sub_feature_id
        LEFT JOIN apt_org_sub_features_access osfa
          ON osfa.org_id = om.org_id
          AND osfa.sub_feature_id = sf.id
          AND osfa.parent_feature_id = f.id
        WHERE om.org_id = ?
          AND om.is_active = 1
          AND u.id <> org.owner_id
          AND (f.id IS NULL OR ofa.feature_id IS NOT NULL)
          AND (sf.id IS NULL OR osfa.sub_feature_id IS NOT NULL)
        ORDER BY u.id ASC, f.id ASC, sf.id ASC
        `,
        [org_id],
      );

      const employeeMap = {};

      for (const row of rows) {
        const empId = row.employee_id;
        if (!employeeMap[empId]) {
          employeeMap[empId] = {
            employee_id: row.employee_id,
            employee_profile_image: row.employee_profile_image,
            employee_name: row.employee_name,
            employee_joining_date: row.employee_joining_date,
            features_access: {},
          };
        }

        if (!row.feature_id) continue;

        const featureKey = String(row.feature_id);
        if (!employeeMap[empId].features_access[featureKey]) {
          employeeMap[empId].features_access[featureKey] = {
            feature_id: row.feature_id,
            feature_name: row.feature_name,
            feature_value: row.feature_value,
            sub_features: {},
          };
        }

        if (!row.sub_feature_id) continue;

        const subKey = String(row.sub_feature_id);
        if (
          !employeeMap[empId].features_access[featureKey].sub_features[subKey]
        ) {
          employeeMap[empId].features_access[featureKey].sub_features[subKey] = {
            sub_feature_id: row.sub_feature_id,
            sub_feature_name: row.sub_feature_name,
            sub_feature_value: row.sub_feature_value,
            sub_feature_permissions: parseSubFeaturePermissions(row.feature_access),
          };
        }
      }

      const data = Object.values(employeeMap).map((employee) => ({
        employee_id: employee.employee_id,
        employee_profile_image: employee.employee_profile_image,
        employee_name: employee.employee_name,
        employee_joining_date: employee.employee_joining_date,
        features_access: Object.values(employee.features_access).map((feature) => ({
          feature_id: feature.feature_id,
          feature_name: feature.feature_name,
          feature_value: feature.feature_value,
          sub_features: Object.values(feature.sub_features),
        })),
      }));

      return res.status(200).json({
        success: true,
        message: "Employees With Accessible Features Fetched Successfully",
        data,
      });
    } catch (error) {
      console.log(
        "Error in get_all_employees_with_accessible_features_and_sub_features_info_controller: ",
        error,
      );
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