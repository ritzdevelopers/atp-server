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
    const requestedRaw =
      req.query?.org_id != null && req.query.org_id !== ""
        ? req.query.org_id
        : req.body?.org_id != null && req.body.org_id !== ""
          ? req.body.org_id
          : null;
    const requestedOrg =
      requestedRaw != null ? Number(requestedRaw) : Number.NaN;

    let org_id;

    if (Number.isFinite(requestedOrg)) {
      const [memberOfRequested] = await db.promise().query(
        "SELECT org_id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
        [user_id, requestedOrg],
      );
      if (memberOfRequested.length === 0) {
        return res.status(403).json({
          message: "You are not a member of this organization",
        });
      }
      org_id = requestedOrg;
    } else {
      const [orgResult] = await db
        .promise()
        .query("SELECT org_id FROM apt_org_members WHERE user_id = ?", [
          user_id,
        ]);
      if (orgResult.length === 0) {
        return res
          .status(404)
          .json({ message: "User is not a member of any organization" });
      }
      org_id = orgResult[0].org_id;
    }

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