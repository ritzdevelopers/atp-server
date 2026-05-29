import db from "../db/connect.js";

const user_validation_with_organization = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    if (!user_id) {
      return res.status(401).json({
        message: "Unauthorized",
        success: false,
      });
    }

    // Get Organization ID From apt_organization_members
    const query = `SELECT org_id FROM apt_organization_members WHERE user_id = ?`;
    const [rows] = await db.promise().query(query, [user_id]);

    if (rows.length < 0) {
      return res.status(500).json({
        message: "Internal Server Errors",
        error: error.message,
        success: false,
      });
    }
    const org_id = rows[0].org_id;

    if (!org_id) {
      return res.status(401).json({
        message: "Unauthorized",
        success: false,
      });
    }
    // Check If The Organization Is Exists Or Not
    const [organization] = await db
      .prepare()
      .query(`SELECT * FROM apt_organization WHERE id = ?`, [org_id]);

    if (organization.length < 0) {
      return res.status(404).json({
        message: "Organization Not Found",
        success: false,
      });
    }

    req.org_id = org_id;
    req.organization = organization;
    next();
  } catch (error) {
    console.log(
      "Internal Server Errors In User Validation With Organization Middleware",
      error,
    );
    return res.status(500).json({
      message: "Internal Server Errors",
      error: error.message,
      success: false,
    });
  }
};
