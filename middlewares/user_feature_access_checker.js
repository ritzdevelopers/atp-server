
import db from "../db/connect.js";

const user_feature_access_checker = (feature_value) => {

  return async (req, res, next) => {

    try {

      const req_user = req.user;
      // Validate User
      if (!req_user || !req_user.user_id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized Access",
        });
      }

      const user_id = req_user.user_id;
      const user_role = req_user.user_role_name;
      // If User Role Is Admin, Allow Access To All Features
      if (user_role === "admin") {
        return next();
      }


      // Check Requested Feature Access
      const featureAccessQuery = `
        SELECT 
          apt_org_members.org_id,

          apt_features.id as feature_id,
          apt_features.feature_name,
          apt_features.feature_val,

          apt_role_features.role_id,

          apt_user_feature_overrides.is_allowed

        FROM apt_org_members

        INNER JOIN apt_user_roles
          ON apt_user_roles.user_id = apt_org_members.user_id
          AND apt_user_roles.org_id = apt_org_members.org_id

        INNER JOIN apt_role_features
          ON apt_role_features.role_id = apt_user_roles.role_id
          AND apt_role_features.org_id = apt_org_members.org_id

        INNER JOIN apt_features
          ON apt_features.id = apt_role_features.feature_id

        LEFT JOIN apt_user_feature_overrides
          ON apt_user_feature_overrides.user_id = apt_org_members.user_id
          AND apt_user_feature_overrides.feature_id = apt_features.id
          AND apt_user_feature_overrides.org_id = apt_org_members.org_id

        WHERE apt_org_members.user_id = ?
        AND apt_features.feature_val = ?
      `;

      const [featureRows] = await db.promise().query(
        featureAccessQuery,
        [user_id, feature_value]
      );
      // console.log("featureRows", featureRows);
      // Feature Not Found In Role
      if (!featureRows || featureRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Feature Access Denied",
        });
      }

      const feature = featureRows[0];

      // Feature Denied By Override
      if (feature.is_allowed === 0) {
        return res.status(403).json({
          success: false,
          message: "Feature Access Denied By Override",
        });
      }

      // Get Total Accessible Features
      const totalFeaturesQuery = `
        SELECT 
          apt_org_members.org_id,

          apt_features.id as feature_id,
          apt_features.feature_name,
          apt_features.feature_val,

          apt_user_feature_overrides.is_allowed

        FROM apt_org_members

        INNER JOIN apt_user_roles
          ON apt_user_roles.user_id = apt_org_members.user_id
          AND apt_user_roles.org_id = apt_org_members.org_id

        INNER JOIN apt_role_features
          ON apt_role_features.role_id = apt_user_roles.role_id
          AND apt_role_features.org_id = apt_org_members.org_id

        INNER JOIN apt_features
          ON apt_features.id = apt_role_features.feature_id

        LEFT JOIN apt_user_feature_overrides
          ON apt_user_feature_overrides.user_id = apt_org_members.user_id
          AND apt_user_feature_overrides.feature_id = apt_features.id
          AND apt_user_feature_overrides.org_id = apt_org_members.org_id

        WHERE apt_org_members.user_id = ?
      `;

      const [totalFeaturesRows] = await db.promise().query(
        totalFeaturesQuery,
        [user_id]
      );

      // Filter Accessible Features
      const accessible_features = totalFeaturesRows
        .filter((feature) => feature.is_allowed !== 0)
        .map((feature) => ({
          feature_id: feature.feature_id,
          feature_name: feature.feature_name,
          feature_val: feature.feature_val,
        }));
      // console.log("accessible_features", totalFeaturesRows); 
      // Remove Duplicate Features
      const unique_features = accessible_features.filter(
        (feature, index, self) =>
          index ===
          self.findIndex(
            (f) => Number(f.feature_id) === Number(feature.feature_id)
          )
      );

      // Attach Data To Request
      req.feature_access = {
        status: true,
        message: "Feature Access Granted",

        organization_id: feature.org_id,

        current_feature: {
          feature_id: feature.feature_id,
          feature_name: feature.feature_name,
          feature_val: feature.feature_val,
        },

        total_features_accessible: unique_features.length,

        accessible_features: unique_features,
      };

      // Optional Direct Access
      req.org_id = feature.org_id;

      next();

    } catch (error) {

      console.log(
        "Error in user_feature_access_checker:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  };
};

export default user_feature_access_checker;