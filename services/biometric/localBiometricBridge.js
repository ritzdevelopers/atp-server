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
let healthCheckInFlight = null;

function bridgeBaseUrl() {
  return String(process.env.BIOMETRIC_LOCAL_BRIDGE_URL || "")
    .trim()
    .replace(/\/$/, "");
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
  if (secret) headers["x-bridge-secret"] = secret;
  return headers;
}

function bridgeTimeoutMs() {
  return Number(process.env.BIOMETRIC_LOCAL_BRIDGE_TIMEOUT_MS || 5_000);
}

const OFFICE_BRIDGE_PREFIX = "/api/biometric/office-bridge";

/** Production cloud + office tunnel URL configured → use bridge, not direct LAN SQL. */
export function isLocalBridgeMode() {
  if (!isCloudDeployment()) return false;
  return Boolean(String(process.env.BIOMETRIC_LOCAL_BRIDGE_URL || "").trim());
}

export { isCloudDeployment };

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

  if (healthCheckInFlight) {
    return healthCheckInFlight;
  }

  healthCheckInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());
      const res = await fetch(`${baseUrl}${OFFICE_BRIDGE_PREFIX}/health`, {
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
    } finally {
      healthCheckInFlight = null;
    }
  })();

  return healthCheckInFlight;
}

async function bridgeFetch(path, query = {}) {
  const baseUrl = bridgeBaseUrl();
  if (!baseUrl) {
    const err = new Error("BIOMETRIC_LOCAL_BRIDGE_URL is not configured");
    err.code = "LOCAL_BRIDGE_NOT_CONFIGURED";
    throw err;
  }

  const online = await isLocalBridgeOnline();
  if (!online) {
    const err = new Error(
      "Local office server is offline — waiting for local machine to start",
    );
    err.code = "LOCAL_BRIDGE_OFFLINE";
    throw err;
  }

  const params = new URLSearchParams(query);
  const qs = params.toString();
  const url = `${baseUrl}${OFFICE_BRIDGE_PREFIX}${path}${qs ? `?${qs}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: bridgeHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok || data?.success === false) {
      const err = new Error(data?.message || "Office bridge request failed");
      err.code = "LOCAL_BRIDGE_FETCH_FAILED";
      throw err;
    }
    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error?.code) throw error;
    const err = new Error(error.message || "Office bridge request failed");
    err.code = "LOCAL_BRIDGE_FETCH_FAILED";
    throw err;
  }
}

export async function fetchAttendanceAllFromLocalBridge({
  punchDate,
  fromDate,
  toDate,
} = {}) {
  const data = await bridgeFetch("/attendance-all", {
    punchDate: punchDate || "",
    fromDate: fromDate || "",
    toDate: toDate || "",
  });
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchEmployeeTodayFromLocalBridge(
  employeeCode,
  { shiftEndTime = null } = {},
) {
  const code = encodeURIComponent(String(employeeCode || "").trim());
  const query = shiftEndTime ? { shift_end_time: shiftEndTime } : {};
  const data = await bridgeFetch(`/employee-today/${code}`, query);
  return data.data ?? null;
}
