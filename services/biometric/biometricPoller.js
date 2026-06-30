import { runBiometricSync } from "./biometricSyncRunner.js";
import {
  getInAppBiometricSyncDecision,
  shouldRunInAppBiometricSync,
} from "../../config/biometricSyncGate.js";

let timer = null;
let backoffMs = 0;
let warnedDisabled = false;

const BASE_INTERVAL = Number(process.env.BIOMETRIC_SYNC_INTERVAL_MS || 5000);
const MAX_BACKOFF = Number(process.env.BIOMETRIC_SYNC_MAX_BACKOFF_MS || 60_000);

async function tick() {
  if (!shouldRunInAppBiometricSync()) return;

  try {
    await runBiometricSync();
    backoffMs = 0;
  } catch (err) {
    console.error("[biometric] poller error:", err.message);
    backoffMs = backoffMs === 0 ? BASE_INTERVAL : Math.min(backoffMs * 2, MAX_BACKOFF);
  }
}

export function startBiometricPoller() {
  const decision = getInAppBiometricSyncDecision();
  if (!decision.allowed) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.log(`[biometric] sync disabled: ${decision.reason}`);
    }
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
