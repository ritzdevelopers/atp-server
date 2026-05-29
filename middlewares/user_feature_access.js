import db from "../db/connect.js";

async function user_feature_access(req, res, next) {
  try {
    const { user_id } = req.user;
    const { org_id } = req;

    const [all_org_features] = await db.promise().query(
      `
            SELECT * FROM apt_org_feature_access WHERE org_id = ?
            `,
      [org_id],
    );
    if (!all_org_features || all_org_features.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No features found",
      });
    }

    // Get User Role
    const [user_role] = await db
      .promise()
      .query(
        `SELECT role_id from apt_user_roles WHERE user_id = ? AND org_id = ?`,
        [user_id, org_id],
      );
    if (!user_role || user_role.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No user role found",
      });
    }

    // Get All Features Access Of The User Role  ::
    const [user_role_features] = await db.promise().query(
      `
            SELECT feature_id FROM apt_role_features WHERE role_id = ? and org_id = ?
            `,
      [user_role[0].role_id, org_id],
    );
    if (!user_role_features || user_role_features.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No user role features found",
      });
    }

    // Get All Features Override Of The User Role ::
    const [user_role_features_override] = await db.promise().query(
      `
           SELECT feature_id FROM apt_user_feature_overrides WHERE user_id = ? and org_id = ? and is_allowed = 0
            `,
      [user_id, org_id],
    );
    
    // Filter The Features That Are Not Allowed ::
  let allowed_features = [];


  if(user_role_features_override && user_role_features_override.length > 0){
    const overrideFeatureIds = user_role_features_override.map(
      (f) => f.feature_id,
    );

    allowed_features = user_role_features.filter(
      (feature) => !overrideFeatureIds.includes(feature.feature_id),
    );
  } else {
    allowed_features = user_role_features;
  }
    // Fetch All The Features Val ::
    const [accessible_features] = await db.promise().query(
      `
        SELECT * FROM apt_features WHERE id IN (?)
        `,
      [allowed_features.map((f) => f.feature_id)],
    );
    if (!accessible_features || accessible_features.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No accessible features found",
      });
    }
    req.accessible_features = accessible_features; 
    next();
  } catch (error) {
    console.log("user_feature_access middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}


export default user_feature_access;