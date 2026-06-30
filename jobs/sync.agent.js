import nodeCron from "node-cron";
import {
  DEFAULT_ORG_ID,
  syncTodayAttendance,
} from "../services/sync/attendanceAllSync.js";
import {
  canRunBiometricSyncNow,
  getInAppBiometricSyncDecision,
  isLocalBridgeMode,
} from "../config/biometricSyncGate.js";

let cronTask = null;
let warnedDisabled = false;
let warnedOffline = false;

export const syncAgent = () => {
  const decision = getInAppBiometricSyncDecision();
  if (!decision.allowed) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.log(`[syncAgent] disabled: ${decision.reason}`);
    }
    return;
  }

  if (cronTask) return;

  const modeLabel = isLocalBridgeMode() ? "local bridge" : "direct SQL";
  console.log(`[syncAgent] starting AttendanceAll cron (every minute, ${modeLabel})`);

  cronTask = nodeCron.schedule("* * * * *", async () => {
    const readiness = await canRunBiometricSyncNow();
    if (!readiness.ok) {
      if (readiness.reason?.includes("offline")) {
        if (!warnedOffline) {
          warnedOffline = true;
          console.log(`[syncAgent] waiting: ${readiness.reason}`);
        }
      } else if (!warnedDisabled) {
        warnedDisabled = true;
        console.log(`[syncAgent] skipped: ${readiness.reason}`);
      }
      return;
    }

    warnedOffline = false;

    try {
      console.log(
        `[syncAgent] syncing via ${readiness.mode === "bridge" ? "local office bridge" : "direct SQL"}...`,
      );
      const result = await syncTodayAttendance(DEFAULT_ORG_ID);
      console.log(
        `[syncAgent] today: ${result.synced} synced, ${result.skipped_unmapped} unmapped, ${result.total_essl_rows} eSSL rows`,
      );
    } catch (error) {
      if (
        error?.code === "BIOMETRIC_SYNC_DISABLED" ||
        error?.code === "LOCAL_BRIDGE_OFFLINE"
      ) {
        if (!warnedOffline) {
          warnedOffline = true;
          console.log(`[syncAgent] local bridge offline — will retry when office PC is running`);
        }
        return;
      }
      console.error("syncAgent:", error.message || error);
    }
  });
};

export function stopSyncAgent() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
