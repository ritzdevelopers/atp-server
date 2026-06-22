import cron from "node-cron";
import { pool } from "../db/connect.js";

cron.schedule("0 0 1 * *", async () => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const [atp_orgs] = await connection.query(
      `SELECT id FROM apt_organizations`,
    );
    if (atp_orgs.length === 0) {
      const date = new Date();
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const seconds = date.getSeconds();
      const milliseconds = date.getMilliseconds();
      const dateString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
      console.log(`No organizations found on ${dateString}`);
      await connection.rollback();
      return res.status(404).json({ message: "No organizations found" });
    } 
    for (const {id: org_id} of atp_orgs) { 
      const [org_active_members] = await connection.query(`SELECT user_id FROM apt_org_members WHERE org_id = ? AND is_active = 1`, [org_id]);
      if (org_active_members.length === 0) {
        console.log(`No active members found for organization ${org_id}`);
        continue;
      } 
      for (const {user_id} of org_active_members) {
        //  const 
      }
    }
    //  user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, last_leave_update
    //  user_id, org_id, leave_type_id, total_leaves, remaining_leaves, used_leaves
  } catch (error) {
    console.error("Error in auto leave assign: ", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
});
