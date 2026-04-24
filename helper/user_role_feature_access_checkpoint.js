import db from "../db/connect.js";

async function user_role_feature_access_checkpoint(user_role_id, org_id) {
  try {
    if(!user_role_id || !org_id){
      return {
        success_status: false,
        message_info: "User role id and org id are required",
        data: null,
      };
    }
    
    // Check If User Role Has Access To This Feature ::
    const fetch_user_role_feature_access_query = "SELECT feature_id FROM apt_role_features WHERE role_id = ? AND org_id = ?";
    const [user_role_feature_access_ids] = await db.promise().query(fetch_user_role_feature_access_query, [user_role_id, org_id]);


    if(user_role_feature_access_ids.length === 0){
      return {
        success_status: false,
        message_info: "User role has no access to this feature",
        data: null,
      };
    }
    return {
      success_status: true,
      message_info: "User role has access to this feature",
      data: user_role_feature_access_ids,
    };

  } catch (error) {
    console.log("Error in user_role_feature_access_checkpoint: ", error);
    return {
      success_status: false,
      message_info: "Error in user_role_feature_access_checkpoint",
      data: null,
    };
  }
}

export default user_role_feature_access_checkpoint;
