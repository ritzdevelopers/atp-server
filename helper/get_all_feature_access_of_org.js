import db from "../db/connect.js";

async function get_all_feature_access_of_org(org_id) {
  try {
    const fetch_all_feature_access_query =
      "SELECT feature_id FROM apt_org_feature_access WHERE org_id = ?";
    const [feature_access_ids] = await db
      .promise()
      .query(fetch_all_feature_access_query, [org_id]);
    if (feature_access_ids.length === 0) {
      return {
        success: false,
        message: "No feature access found",
        data: [],
      };
    }

    // Get All Features From apt_features table
    const fetch_all_features_query = "SELECT * FROM apt_features WHERE id IN (?)";
    const [features] = await db
      .promise()
      .query(fetch_all_features_query, [
        feature_access_ids.map((feature) => feature.feature_id),
      ]);
    if (features.length === 0) {
      return {
        success: false,
        message: "No features found",
        data: [],
      };
    }

    return {
      success: true,
      message: "All feature access of org fetched successfully",
      features_ids: feature_access_ids,
      features: features,
    };
  } catch (error) {
    console.log("Error getting all feature access of org: ", error);
    return {
      success: false,
      message: "Error getting all feature access of org",
      data: null,
    };
  }
}
export default get_all_feature_access_of_org;
