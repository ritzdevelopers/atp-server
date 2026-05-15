import db from "../db/connect.js";

const req_sender_auth = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    if (!user_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check User Exists
    const [userResult] = await db
      .promise()
      .query("SELECT * FROM apt_users WHERE id = ?", [user_id]);
    if (userResult.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    // Check Is User Valid Member Of The Organization
    const [orgResult] = await db
      .promise()
      .query("SELECT org_id from apt_org_members WHERE user_id = ?", [user_id]);
    if (orgResult.length === 0) {
      return res
        .status(404)
        .json({ message: "User is not a member of any organization" });
    }

    const org_id = orgResult[0].org_id;

    // Check Is Organization Valid
    const [orgCheckResult] = await db
      .promise()
      .query("SELECT * FROM apt_organizations WHERE id = ?", [org_id]);
    if (orgCheckResult.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }
    req.org_id = org_id;

    next();
  } catch (error) {
    console.error("Error authorizing request sender: ", error);
    return res
      .status(500)
      .json({ message: "Error authorizing request sender" });
  }
};

export default req_sender_auth;