import { runBiometricSync } from "./biometricSyncRunner.js";

let timer = null;
let backoffMs = 0;

const BASE_INTERVAL = Number(process.env.BIOMETRIC_SYNC_INTERVAL_MS || 5000);
const MAX_BACKOFF = Number(process.env.BIOMETRIC_SYNC_MAX_BACKOFF_MS || 60_000);

async function tick() {
  if (String(process.env.BIOMETRIC_SYNC_ENABLED || "false") !== "true") return;

  try {
    await runBiometricSync();
    backoffMs = 0;
  } catch (err) {
    console.error("[biometric] poller error:", err.message);
    backoffMs = backoffMs === 0 ? BASE_INTERVAL : Math.min(backoffMs * 2, MAX_BACKOFF);
  }
}

export function startBiometricPoller() {
  if (String(process.env.BIOMETRIC_SYNC_ENABLED || "false") !== "true") {
    console.log("[biometric] sync disabled (BIOMETRIC_SYNC_ENABLED != true)");
    return;
  }

  if (String(process.env.BIOMETRIC_RUN_SYNC_IN_APP || "true") !== "true") {
    console.log("[biometric] in-app poller disabled (use sync-worker.js)");
    return;
  }

  if (timer) return;

  console.log(`[biometric] starting poller (every ${BASE_INTERVAL}ms)`);

  const schedule = () => {
    const delay = BASE_INTERVAL + backoffMs;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, delay);
  };

  tick().finally(schedule);
}

export function stopBiometricPoller() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
