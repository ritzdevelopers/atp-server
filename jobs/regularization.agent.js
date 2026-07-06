import nodeCron from "node-cron";
import db, { pool } from "../db/connect.js";


nodeCron.schedule("0 0 1 * *", async () => {
  console.log("Regularization agent is running");
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    // 1. Fetch All The Organizations First ::
    // 2. Fetch All The Active Employees For Each Organization ::
    // 3. Fetch Previous Month Regularization Tokens For Each Employee ::
    // 4. Update Previous Regularization Tokens For Each Employee For Current Month To Next Month ::
    // 5. Commit The Transaction ::
    await connection.commit();
    console.log("Regularization agent completed successfully");
  } catch (error) {
    if(connection) await connection.rollback();
    console.error("Error in regularization agent", error);
    return;
  } finally {
    if (connection) connection.release();
  }
});
