import db from "../db/connect.js";

const user_membership_checker = async (req, res, next) => {
  try {
    const {org_id} = req;
    const {user_id} = req.user;
    if (!org_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    const [user_membership] = await db.promise().query(`
      SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ? AND is_active = 1
    `, [user_id, org_id]);
    if (user_membership.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export default user_membership_checker;