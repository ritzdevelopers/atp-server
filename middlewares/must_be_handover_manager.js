import { pool } from "../db/connect.js";

/** Ensures the authenticated user is the assigned manager on the handover row. */
export default async function must_be_handover_manager(req, res, next) {
  try {
    const { user_id } = req.user ?? {};
    const { org_id } = req;
    const handoverQueryId = req.params?.id;

    if (!user_id || !org_id || !handoverQueryId) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover update request",
      });
    }

    const [rows] = await pool.promise().query(
      `
      SELECT manager_id
      FROM handover_query
      WHERE id = ?
      AND org_id = ?
      `,
      [handoverQueryId, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Handover query not found",
      });
    }

    if (Number(rows[0].manager_id) !== Number(user_id)) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned as the manager for this handover",
      });
    }

    next();
  } catch (error) {
    console.error("must_be_handover_manager:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
