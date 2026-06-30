import { tryGetMssqlPool } from "../services/biometric/biometricConnection.js";

/** Shared SQL Server pool for eSSL / AttendanceAll reads. */
export async function biometricDB() {
  const pool = await tryGetMssqlPool();
  if (!pool) {
    const err = new Error("Direct biometric SQL is not available");
    err.code = "BIOMETRIC_UNAVAILABLE";
    throw err;
  }
  return pool;
}
