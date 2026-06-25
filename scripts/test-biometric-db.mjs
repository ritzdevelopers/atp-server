import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

const config = {
  server: process.env.BIOMETRIC_DB_HOST,
  port: Number(process.env.BIOMETRIC_DB_PORT || 1433),
  database: process.env.BIOMETRIC_DB_NAME,
  user: process.env.BIOMETRIC_DB_USER,
  password: process.env.BIOMETRIC_DB_PASSWORD,
  options: {
    encrypt: String(process.env.BIOMETRIC_DB_ENCRYPT || "false") === "true",
    trustServerCertificate:
      String(process.env.BIOMETRIC_DB_TRUST_CERT || "true") === "true",
  },
  connectionTimeout: 15000,
  requestTimeout: 15000,
};

try {
  const pool = await sql.connect(config);
  console.log("Connected OK to", config.server, config.database);

  const tables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE='BASE TABLE'
    AND (
      TABLE_NAME LIKE 'Attendance%'
      OR TABLE_NAME LIKE 'DeviceLogs%'
      OR TABLE_NAME IN ('CHECKINOUT', 'Employees', 'Devices')
    )
    ORDER BY TABLE_NAME
  `);
  console.log(
    "Relevant tables:",
    tables.recordset.map((r) => r.TABLE_NAME).join(", "),
  );

  for (const name of ["AttendanceAll", "AttendanceLogs", "DeviceLogs"]) {
    try {
      const cols = await pool.request().query(`SELECT TOP 3 * FROM [${name}] ORDER BY 1 DESC`);
      if (cols.recordset.length) {
        console.log(`\nColumns in ${name}:`, Object.keys(cols.recordset[0]).join(", "));
        console.log("Sample rows:", JSON.stringify(cols.recordset, null, 2));
      }
    } catch (e) {
      console.log(`${name}: ${e.message}`);
    }
  }

  const monthly = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'AttendanceAll_%' OR TABLE_NAME LIKE 'DeviceLogs_%'
    ORDER BY TABLE_NAME DESC
  `);
  console.log(
    "\nMonthly tables:",
    monthly.recordset.map((r) => r.TABLE_NAME).slice(0, 10),
  );

  await pool.close();
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
}
