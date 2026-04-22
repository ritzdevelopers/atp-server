import db from "../db/connect.js";

export const create_organization_controller = async (req, res) => {
  try {
    const {org_name, owner_id, org_email, org_phone} = req.body;
    if(!org_name || !owner_id || !org_email || !org_phone) { 
        console.log("All fields are required");
        return res.status(400).json({ message: "All fields are required" });
    }
     
    // First Check Is User Exists ::
    const [user] = await db.promise().query("SELECT * FROM apt_users WHERE id = ?", [owner_id]);
    if(user.length === 0) {
        console.log("User not found");
        return res.status(404).json({ message: "User not found" });
    }

     // First Create Organization In Database ::
     const create_organization_query = "INSERT INTO apt_organizations (org_name, owner_id, org_email, org_phone) VALUES (?, ?, ?, ?)";
     const [result] = await db.promise().query(create_organization_query, [org_name, owner_id, org_email, org_phone]);
     if(result.affectedRows === 0) {
        console.log("Failed to create organization");
        return res.status(500).json({ message: "Failed to create organization" });
     }
    
    // Create Role and Assign Organization ID  To User Role ::
    const create_admin_role_query = "INSERT INTO apt_roles (role_name, orgId) VALUES (?, ?)";
    const [admin_role] = await db.promise().query(create_admin_role_query, ["admin", result.insertId]);
    if(admin_role.affectedRows === 0) {
        console.log("Failed to create admin role");
        return res.status(500).json({ message: "Failed to create admin role" });
    }

    // Extract Role ID and User ID ::
    const role_id = admin_role.insertId;
    const user_id = owner_id;

    // Insert Into apt_user_roles table with role_id and user_id ::
    const insert_user_role_query = "INSERT INTO apt_user_roles (role_id, user_id) VALUES (?, ?)";
    const [user_role] = await db.promise().query(insert_user_role_query, [role_id, user_id]);
    if(user_role.affectedRows === 0) {
        console.log("Failed to insert user role");
        return res.status(500).json({ message: "Failed to insert user role" });
    }

    // Update User Organization ID In User Table ::
    const update_user_organization_id_query = "UPDATE apt_users SET orgId = ? WHERE id = ?";
    const [updated_user] = await db.promise().query(update_user_organization_id_query, [result.insertId, user_id]);
    if(updated_user.affectedRows === 0) {
        console.log("Failed to update user organization id");
        return res.status(500).json({ message: "Failed to update user organization id" });
    }

    // Return Success Response ::
    return res.status(201).json({ message: "Organization created successfully"});
  } catch (error) {
    console.log("Error creating organization: ", error);
    return res.status(500).json({ message: "Error creating organization" });
  }
};
