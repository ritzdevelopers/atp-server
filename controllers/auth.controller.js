import db from "../db/connect.js";

export const get_user_controller = async (req, res) => {
  try {
    const req_user = req.user;
    if (!req_user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Unauthorized",
        success: false,
      });
    }
    const user_id = req_user.user_id;

    const user_role = req_user.user_role_name;

    if (user_role === "admin") {
      // Fetch All The User Registered Organizations Details ::
      const [org_details] = await db
        .promise()
        .query("SELECT * FROM apt_organizations WHERE owner_id  = ?", [user_id]);
      return res.status(200).json({
        message: "User fetched successfully",
        success: true,
        data: {
          org_details: org_details,
          user_role: user_role,
        },
      });
    } else {
      // Fetch User org_id From apt_org_members Table ::
      const [org_id] = await db
        .promise()
        .query("SELECT org_id FROM apt_org_members WHERE user_id = ?", [
          user_id,
        ]);

      if (org_id.length === 0) {
        return res.status(404).json({
          error: "Organization not found",
          message: "You are not a member of any organization",
          success: false,
        });
      }
      const org_id_value = org_id[0].org_id;
      //  Using Join Method Fetch The Organization Details and User Role Details ::
      const query = `
SELECT 
  u.id,
  u.user_name,
  u.user_email,
  org.id AS org_id,
  org.org_name,
  ur.role_id,
  r.role_name
FROM apt_users u
JOIN apt_user_roles ur ON ur.user_id = u.id
JOIN apt_organizations org ON org.id = ur.org_id
JOIN apt_roles r ON r.id = ur.role_id
WHERE u.id = ? AND org.id = ?
`;
      const [user_details] = await db
        .promise()
        .query(query, [user_id, org_id_value]);
      if (user_details.length === 0) {
        return res.status(404).json({
          error: "User not found",
          message: "You are not a member of any organization",
          success: false,
        });
      }
      return res.status(200).json({
        message: "User fetched successfully",
        success: true,
        data: user_details[0],
      });
    }
  } catch (error) {
    console.log("Error in get_user_controller: ", error);
    return res.status(500).json({
      error: "Error in get_user_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};