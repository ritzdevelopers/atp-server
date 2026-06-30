import {
  canReachBiometricSqlHost,
  isCloudDeployment,
  isLocalBridgeMode,
} from "../../config/biometricSyncGate.js";
import getMssqlPool from "../../db/connect_mssql.js";

/**
 * Central biometric data-source rules for local office server vs cloud production.
 */

export { isCloudDeployment, isLocalBridgeMode };

/** True when this process may open a direct TCP connection to BIOMETRIC_DB_HOST. */
export function shouldUseDirectBiometricSql() {
  const source = String(
    process.env.BIOMETRIC_MANAGE_ATTENDANCE_SOURCE || "",
  ).toLowerCase();
  if (source === "mysql") return false;
  if (source === "sql" || source === "mssql") return true;
  if (isCloudDeployment()) return false;
  return canReachBiometricSqlHost().allowed;
}

/** Production / cloud should read synced MySQL (or office bridge when online). */
export function shouldPreferMysqlBiometric() {
  const source = String(
    process.env.BIOMETRIC_MANAGE_ATTENDANCE_SOURCE || "",
  ).toLowerCase();
  if (source === "mysql") return true;
  if (source === "sql" || source === "mssql") return false;
  if (isCloudDeployment()) return true;
  return !shouldUseDirectBiometricSql();
}

/** Safe pool access — returns null instead of throwing when SQL is unreachable. */
export async function tryGetMssqlPool() {
  if (!shouldUseDirectBiometricSql()) return null;

  const reach = canReachBiometricSqlHost();
  if (!reach.allowed) return null;

  try {
    return await getMssqlPool();
  } catch (error) {
    console.warn("[biometric] direct SQL unavailable:", error.message);
    return null;
  }
}

export function biometricUnavailableError() {
  const err = new Error("Biometric SQL Server is not reachable in this environment");
  err.code = "BIOMETRIC_UNAVAILABLE";
  return err;
}
