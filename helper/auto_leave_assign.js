import corn from "node-cron";
import { pool } from "../db/connect.js";

corn.schedule("0 0 1 * *", async () => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    // Get All Organizations ::
    const [organizations] = await connection.query(`
        SELECT id FROM apt_organizations
        WHERE is_active = 1
        `);
    if (organizations.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "No organizations found" });
    }
     
  } catch (error) {
    if (connection) connection.rollback();
    console.error("Error in auto leave assign: ", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
    return res
      .status(200)
      .json({ message: "Auto leave assign completed successfully" });
  }
});
