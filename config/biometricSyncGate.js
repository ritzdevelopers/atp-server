/**
 * Central switch for in-app biometric / eSSL SQL Server sync.
 * On Render (cloud), use BIOMETRIC_LOCAL_BRIDGE_URL to pull from the office PC
 * when attendance-sync-agent is running. Direct LAN SQL is not reachable.
 */

import { isLocalBridgeMode, isLocalBridgeOnline } from "../services/biometric/localBiometricBridge.js";

function isPrivateOrLocalHost(host) {
  const value = String(host || "").trim().toLowerCase();
  if (!value) return false;
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  const match172 = value.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function isBiometricSqlConfigured() {
  const host = String(process.env.BIOMETRIC_DB_HOST || "").trim();
  const user = String(process.env.BIOMETRIC_DB_USER || "").trim();
  return Boolean(host && user);
}

export function isBiometricSyncEnabledFlag() {
  return String(process.env.BIOMETRIC_SYNC_ENABLED || "false") === "true";
}

export function isInAppBiometricSyncAllowed() {
  return String(process.env.BIOMETRIC_RUN_SYNC_IN_APP || "true") === "true";
}

export function isCloudDeployment() {
  return (
    String(process.env.RENDER || "").toLowerCase() === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.FLY_APP_NAME) ||
    Boolean(process.env.VERCEL)
  );
}

export { isLocalBridgeMode };

/**
 * @returns {{ allowed: boolean; reason: string; mode?: "direct" | "bridge" }}
 */
export function getInAppBiometricSyncDecision() {
  if (!isBiometricSyncEnabledFlag()) {
    return {
      allowed: false,
      reason: "BIOMETRIC_SYNC_ENABLED is not true",
    };
  }

  if (!isInAppBiometricSyncAllowed()) {
    return {
      allowed: false,
      reason: "BIOMETRIC_RUN_SYNC_IN_APP is not true (use attendance-sync-agent worker)",
    };
  }

  if (isLocalBridgeMode()) {
    return {
      allowed: true,
      mode: "bridge",
      reason: `production bridge mode (${process.env.BIOMETRIC_LOCAL_BRIDGE_URL})`,
    };
  }

  if (!isBiometricSqlConfigured()) {
    return {
      allowed: false,
      reason: "BIOMETRIC_DB_HOST / BIOMETRIC_DB_USER not configured",
    };
  }

  const host = process.env.BIOMETRIC_DB_HOST;
  if (isCloudDeployment() && isPrivateOrLocalHost(host)) {
    return {
      allowed: false,
      reason: `BIOMETRIC_DB_HOST (${host}) is private — set BIOMETRIC_LOCAL_BRIDGE_URL to your office PC tunnel URL`,
    };
  }

  return { allowed: true, mode: "direct", reason: "ok" };
}

/** Whether a TCP connection to BIOMETRIC_DB_HOST should even be attempted. */
export function canReachBiometricSqlHost() {
  if (isLocalBridgeMode()) {
    return {
      allowed: false,
      reason: "direct SQL disabled in production bridge mode",
    };
  }

  if (!isBiometricSqlConfigured()) {
    return {
      allowed: false,
      reason: "BIOMETRIC_DB_HOST / BIOMETRIC_DB_USER not configured",
    };
  }

  const host = process.env.BIOMETRIC_DB_HOST;
  if (isCloudDeployment() && isPrivateOrLocalHost(host)) {
    return {
      allowed: false,
      reason: `BIOMETRIC_DB_HOST (${host}) is a private/LAN address and cannot be reached from cloud hosting`,
    };
  }

  return { allowed: true, reason: "ok" };
}

export function shouldRunInAppBiometricSync() {
  return getInAppBiometricSyncDecision().allowed;
}

/** Check if production can sync right now (bridge online or direct SQL). */
export async function canRunBiometricSyncNow() {
  const decision = getInAppBiometricSyncDecision();
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (decision.mode === "bridge") {
    const online = await isLocalBridgeOnline();
    if (!online) {
      return {
        ok: false,
        reason: "Local biometric bridge is offline",
      };
    }
    return { ok: true, mode: "bridge" };
  }

  const reach = canReachBiometricSqlHost();
  return { ok: reach.allowed, mode: "direct", reason: reach.reason };
}
