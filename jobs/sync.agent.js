import nodeCron from "node-cron";
import {
  DEFAULT_ORG_ID,
  syncTodayAttendance,
} from "../services/sync/attendanceAllSync.js";

export const syncAgent = () => {
  nodeCron.schedule("* * * * *", async () => {
    try {
      console.log("Syncing biometric data...");
      const result = await syncTodayAttendance(DEFAULT_ORG_ID);
      console.log(
        `[syncAgent] today: ${result.synced} synced, ${result.skipped_unmapped} unmapped, ${result.total_essl_rows} eSSL rows`,
      );
    } catch (error) {
      console.error("syncAgent:", error);
    }
  });
};
