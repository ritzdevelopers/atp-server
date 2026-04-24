import db from "../db/connect.js";
async function features_overrides(single_feature_id, org_id, user_id) {
    try {
        if(!single_feature_id || !org_id || !user_id){
            return {
                success: false,
                message: "Feature id and org id are required",
                over_ride_data: null,
            }
        }
        
        // Check If User Have Any Overrides ::
        const fetch_user_overrides_query = "SELECT is_allowed FROM apt_user_feature_overrides WHERE feature_id = ? AND org_id = ? AND user_id = ?";
        const [user_overrides] = await db.promise().query(fetch_user_overrides_query, [single_feature_id, org_id, user_id]);

        if(user_overrides.length === 0){
            return {
                success: true,
                message: "User have no overrides",
                over_ride_data: [],
            }
        }

        return {
            success: true,
            message: "User have overrides",
            over_ride_data: user_overrides,
        }
    } catch (error) {
        return {
            success: false,
            message: "Error in features_overrides",
            over_ride_data: null,
        }
    }
 }

export default features_overrides;