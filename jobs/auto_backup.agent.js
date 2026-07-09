import nodeCron from "node-cron";
import { pool } from "../db/connect.js";
import { biometricDB } from "../config/essl.config.js";
import sql from "mssql";

// Run backup job every day at 12:00 PM
nodeCron.schedule("0 12 * * *", async () => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const biometric_connection = await biometricDB();
    console.log("Backup Job Started");

    const [last_backup] = await connection.query(
      "SELECT MAX(last_backup_date) as last_backup_date FROM backup_logs",
    );
    const last_backup_date = last_backup[0]?.last_backup_date;

    const end_date = new Date();
    const isFirstBackup = !last_backup_date;
    const start_date = isFirstBackup
      ? new Date("2026-06-01")
      : new Date(last_backup_date);

    const punchFilter = isFirstBackup
      ? "PunchDate >= @start_date AND PunchDate <= @end_date"
      : "PunchDate > @start_date AND PunchDate <= @end_date";

    const attendanceResult = await biometric_connection
      .request()
      .input("start_date", sql.DateTime, start_date)
      .input("end_date", sql.DateTime, end_date)
      .query(`
        SELECT * FROM AttendanceAll
        WHERE ${punchFilter}
        ORDER BY PunchDate ASC
      `);

    const recordset = attendanceResult.recordset;

    if (recordset.length === 0) {
      await connection.commit();
      console.log("Backup Job Completed — no new records");
      return;
    }

    const rows = recordset.map((row) => [
      row.EMP_CODE,
      row.PunchDate,
      row.UpdateFlag,
      row.MachinID,
      row.UpdatedOn,
    ]);

    await connection.query(
      `
      INSERT INTO attendance_all_backup
      (EMP_CODE, PunchDate, UpdateFlag, MachinID, UpdatedOn)
      VALUES ?
      `,
      [rows],
    );

    const lastPunch = recordset[recordset.length - 1]?.PunchDate;

    await connection.query(
      `
      INSERT INTO backup_logs (last_backup_date)
      VALUES (?)
      `,
      [lastPunch],
    );

    await connection.commit();
    console.log(
      isFirstBackup ? "First Backup Completed" : "Backup Job Completed",
    );
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Error rolling back transaction:", rollbackError);
      }
    }
    console.error("Error in auto backup:", error);
  } finally {
    if (connection) {
      try {
        await connection.release();
      } catch (releaseError) {
        console.error("Error releasing connection:", releaseError);
      }
    }
  }
});
