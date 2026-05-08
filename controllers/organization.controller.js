import { pool as db } from "../db/connect.js";
import features_overrides from "../helper/features_overrides.js";
import get_all_feature_access_of_org from "../helper/get_all_feature_access_of_org.js";
import user_role_feature_access_checkpoint from "../helper/user_role_feature_access_checkpoint.js";

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

  // Controller Access Val -> get-organization-information

  try {

    const req_user = req.user;
    const user_features_access = req.feature_access;
    
    // Validate Feature Access
    if (!user_features_access || !user_features_access.status) {
      return res.status(403).json({
        error: "Forbidden Access",
        message: "User Features Access Not Found",
        success: false,
      });
    }

    const {
      user_id,
      user_role_id,
      user_email,
      user_role_name,
    } = req_user;

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
      },
    });

  } catch (error) {

    console.log(
      "Error in get_org_info_controller:",
      error
    );

    return res.status(500).json({
      error: "Error in get_org_info_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};