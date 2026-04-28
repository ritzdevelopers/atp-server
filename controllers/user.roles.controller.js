import db from "../db/connect.js";


// :: Tested and Working Fine ::
export const create_user_role_controller = async (req, res) => {
  try {
    const { role_name, organization_id } = req.body; 
    if (!role_name || !organization_id) {
      return res.status(400).json({
        message: "Role name and organization id are required",
      });
    }

    // Check organization
    const [org] = await db
      .promise()
      .query("SELECT * FROM apt_organizations WHERE id = ?", [organization_id]);

    if (org.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }
    // Role WIll Save In lower case in database ::
    const lower_case_role_name = role_name.toLowerCase();


    // Check if role already exists
    const [role] = await db
      .promise()
      .query(
        "SELECT * FROM apt_roles WHERE role_name = ? AND org_id = ?",
        [lower_case_role_name, organization_id],
      );
    if (role.length > 0) {
      return res.status(409).json({ message: "Role already exists" });
    }

    // Insert role
    const [result] = await db
      .promise()
      .query(
        "INSERT INTO apt_roles (role_name, org_id) VALUES (?, ?)",
        [lower_case_role_name, organization_id],
      );

    return res.status(201).json({
      message: "Role created successfully",
      roleId: result.affectedRows,
    });
  } catch (error) {
    console.log("Error creating user role: ", error);
    return res.status(500).json({ message: "Error creating user role" });
  }
};

// :: Tested and Working Fine ::
export const update_user_role_controller = async (req, res) => {
  try {
    const { role_id, role_name, organization_id } = req.body;

    if (!role_id || !role_name || !organization_id) {
      return res.status(400).json({
        message: "Role id, role name and organization id are required",
      });
    }
    // Role WIll Save In lower case in database ::
    const lower_case_role_name = role_name.toLowerCase();

    const [result] = await db
      .promise()
      .query(
        "UPDATE apt_roles SET role_name = ? WHERE id = ? AND org_id = ?",
        [lower_case_role_name, role_id, organization_id],
      );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.status(200).json({
      message: "Role updated successfully",
      updatedRows: result.affectedRows,
    });
  } catch (error) {
    console.log("Error updating user role: ", error);
    return res.status(500).json({ message: "Error updating user role" });
  }
};

// :: Tested and Working Fine ::
export const delete_user_role_controller = async (req, res) => {
  try {
    const { role_id, organization_id } = req.body;

    if (!role_id || !organization_id) {
      return res.status(400).json({
        message: "Role id and organization id are required",
      });
    }

    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const [result] = await db
      .promise()
      .query("DELETE FROM apt_roles WHERE id = ? AND org_id = ?", [
        role_id,
        organization_id,
      ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.status(200).json({
      message: "Role deleted successfully",
      deletedRows: result.affectedRows,
    });
  } catch (error) {
    console.log("Error deleting user role: ", error);
    return res.status(500).json({ message: "Error deleting user role" });
  }
};

// :: Tested and Working Fine ::
export const get_all_user_roles_controller = async (req, res) => {
  try {
    const organization_id = req.body.organization_id ?? req.query.organization_id;
    if (!organization_id) {
      return res.status(400).json({ message: "Organization id is required" });
    }
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (user.user_role_name !== "admin" && user.user_role_name !== "hr") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const [roles] = await db.promise().query(
      `SELECT * FROM apt_roles
       WHERE org_id = ?
         AND LOWER(TRIM(role_name)) != ?`,
      [organization_id, "admin"],
    );
    return res
      .status(200)
      .json({ message: "User roles fetched successfully", data: roles });
  } catch (error) {
    console.log("Error getting all user roles: ", error);
    return res.status(500).json({ message: "Error getting all user roles" });
  }
};
