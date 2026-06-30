import getMssqlPool from "../db/connect_mssql.js";

/** Shared SQL Server pool for eSSL / AttendanceAll reads. */
export async function biometricDB() {
  return getMssqlPool();
}
