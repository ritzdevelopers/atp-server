function isCloudDeployment() {
  return (
    String(process.env.RENDER || "").toLowerCase() === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.FLY_APP_NAME) ||
    Boolean(process.env.VERCEL)
  );
}

let healthCache = {
  online: false,
  checkedAt: 0,
};

function bridgeBaseUrl() {
  return String(process.env.BIOMETRIC_LOCAL_BRIDGE_URL || "").trim().replace(/\/$/, "");
}

function bridgeSecret() {
  return (
    String(process.env.BIOMETRIC_LOCAL_BRIDGE_SECRET || "").trim() ||
    String(process.env.BIOMETRIC_WEBHOOK_SECRET || "").trim()
  );
}

function bridgeHeaders() {
  const headers = { Accept: "application/json" };
  const secret = bridgeSecret();
  if (secret) {
    headers["x-bridge-secret"] = secret;
  }
  return headers;
}

function bridgeTimeoutMs() {
  return Number(process.env.BIOMETRIC_LOCAL_BRIDGE_TIMEOUT_MS || 12_000);
}

/** Production cloud should pull biometric data through the office PC bridge. */
export function isLocalBridgeMode() {
  if (!isCloudDeployment()) return false;
  return Boolean(bridgeBaseUrl());
}

export function getLocalBridgeUrl() {
  return bridgeBaseUrl();
}

export async function isLocalBridgeOnline({ force = false } = {}) {
  const baseUrl = bridgeBaseUrl();
  if (!baseUrl) return false;

  const ttl = Number(process.env.BIOMETRIC_LOCAL_BRIDGE_HEALTH_TTL_MS || 30_000);
  if (!force && Date.now() - healthCache.checkedAt < ttl) {
    return healthCache.online;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());

    const res = await fetch(`${baseUrl}/bridge/health`, {
      method: "GET",
      headers: bridgeHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      healthCache = { online: false, checkedAt: Date.now() };
      return false;
    }

    const data = await res.json();
    const online = data?.online === true || data?.success === true;
    healthCache = { online, checkedAt: Date.now() };
    return online;
  } catch {
    healthCache = { online: false, checkedAt: Date.now() };
    return false;
  }
}

export async function fetchAttendanceAllFromLocalBridge({
  punchDate,
  fromDate,
  toDate,
} = {}) {
  const baseUrl = bridgeBaseUrl();
  if (!baseUrl) {
    const err = new Error("BIOMETRIC_LOCAL_BRIDGE_URL is not configured");
    err.code = "LOCAL_BRIDGE_NOT_CONFIGURED";
    throw err;
  }

  const online = await isLocalBridgeOnline();
  if (!online) {
    const err = new Error(
      "Local biometric bridge is offline — start attendance-sync-agent on your office PC",
    );
    err.code = "LOCAL_BRIDGE_OFFLINE";
    throw err;
  }

  const params = new URLSearchParams();
  if (punchDate) params.set("punchDate", punchDate);
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());

  try {
    const res = await fetch(`${baseUrl}/bridge/attendance-all?${params.toString()}`, {
      method: "GET",
      headers: bridgeHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok || data?.success === false) {
      const err = new Error(data?.message || "Local bridge attendance fetch failed");
      err.code = "LOCAL_BRIDGE_FETCH_FAILED";
      throw err;
    }

    return Array.isArray(data.rows) ? data.rows : [];
  } catch (error) {
    clearTimeout(timer);
    if (error?.code) throw error;
    const err = new Error(error.message || "Local bridge request failed");
    err.code = "LOCAL_BRIDGE_FETCH_FAILED";
    throw err;
  }
}
