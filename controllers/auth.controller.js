import db from "../db/connect.js";

export const get_user_controller = async (req, res) => {
  try {
    const req_user = req.user;
    const user_id = Number(req_user?.user_id);
    const user_email = String(req_user?.user_email || "").trim();
    const user_role_name = String(req_user?.user_role_name || "").trim().toLowerCase();

    if (!user_id || !user_email || !user_role_name) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Unauthorized",
        success: false,
      });
    }

    if (user_role_name === "admin") {
      // Admin details + all owned organizations (same business logic, optimized via JOIN)
      const [adminRows] = await db.promise().query(
        `
          SELECT
            u.id,
            u.user_name,
            u.user_email,
            u.user_phone,
            u.created_at,
            o.id AS org_id,
            o.owner_id,
            o.org_name,
            o.org_email,
            o.org_phone,
            o.created_at AS org_created_at
          FROM apt_users u
          INNER JOIN apt_organizations o ON o.owner_id = u.id
          WHERE u.id = ? AND u.user_email = ?
          ORDER BY o.id ASC
        `,
        [user_id, user_email],
      );

      if (!adminRows.length) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Unauthorized",
          success: false,
        });
      }

      const first = adminRows[0];
      const admin_details = {
        id: first.id,
        user_name: first.user_name,
        user_email: first.user_email,
        user_phone: first.user_phone,
        created_at: first.created_at,
      };

      const org_details = adminRows.map((row) => ({
        id: row.org_id,
        owner_id: row.owner_id,
        org_name: row.org_name,
        org_email: row.org_email,
        org_phone: row.org_phone,
        created_at: row.org_created_at,
      }));

      return res.status(200).json({
        admin_details,
        org_details,
        success: true,
        role: user_role_name,
        message: "Admin Details Fetched Successfully",
      });
    } else {
      // HR/Manager/Employee details + organization + role (via joins)
      const [rows] = await db.promise().query(
        `
          SELECT
            u.id,
            u.user_name,
            u.user_email,
            u.user_phone,
            u.created_at,
            o.id AS org_id,
            o.org_email,
            o.org_name,
            o.created_at AS org_created_at,
            r.role_name
          FROM apt_users u
          INNER JOIN apt_org_members m ON m.user_id = u.id
          INNER JOIN apt_organizations o ON o.id = m.org_id
          INNER JOIN apt_user_roles ur ON ur.user_id = u.id AND ur.org_id = o.id
          INNER JOIN apt_roles r ON r.id = ur.role_id
          WHERE u.id = ? AND u.user_email = ?
          ORDER BY m.org_id ASC
          LIMIT 1
        `,
        [user_id, user_email],
      );

      if (!rows.length) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Unauthorized",
          success: false,
        });
      }

      const row = rows[0];
      const user_details = {
        id: row.id,
        user_name: row.user_name,
        user_email: row.user_email,
        user_phone: row.user_phone,
        created_at: row.created_at,
      };

      const org_details = {
        id: row.org_id,
        org_email: row.org_email,
        org_name: row.org_name,
        created_at: row.org_created_at,
      };

      return res.status(200).json({
        user_details,
        org_details,
        success: true,
        role: row.role_name,
        message: "HR/Manager Details Fetched Successfully",
      });
    }
  } catch (error) {
    console.error("Error in get_user_controller:", error);
    return res.status(500).json({
      error: "Error in get_user_controller",
      message: "Try Again Later Or Login Again",
      success: false,
    });
  }
};
