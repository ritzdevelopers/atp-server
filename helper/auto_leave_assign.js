import cron from "node-cron";
import db from "./db/connect.js";

cron.schedule("0 0 1 * *", async () => {
  console.log("Running Monthly Leave Assignment Job...");

  try {
    const connection = await db.promise().getConnection();

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // 1. Get all users
    const [users] = await connection.query(
      "SELECT user_id, org_id FROM apt_org_members"
    );

    for (let user of users) {
      // 2. Check if already assigned this month
      const [existing] = await connection.query(
        `SELECT id FROM leave_balance 
         WHERE user_id = ? AND org_id = ? AND year = ? AND month = ?`,
        [user.user_id, user.org_id, year, month]
      );

      if (existing.length === 0) {
        // 3. Insert new leave balance
        await connection.query(
          `INSERT INTO leave_balance 
          (user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, last_leave_update)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          [user.user_id, user.org_id, year, month, 2, 0, 2]
        );
      }
    }

    connection.release();
    console.log("Leaves assigned successfully");

  } catch (error) {
    console.error("CRON ERROR:", error);
  }
});