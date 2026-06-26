import express from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import {
  getBiometricStatusController,
  listBiometricMappingsController,
  saveBiometricMappingController,
  deleteBiometricMappingController,
  syncBiometricNowController,
  biometricWebhookController,
  biometricWebhookBatchController,
  getLivePunchesController,
  getMyLiveAttendanceController,
  getLiveCursorController,
  getBiometricManageAttendanceController,
} from "../controllers/biometric.controller.js";

const router = express.Router();

router.post("/webhook", biometricWebhookController);
router.post("/webhook/batch", biometricWebhookBatchController);

router.get(
  "/status",
  user_validation_middleware,
  req_sender_auth,
  getBiometricStatusController,
);

router.get(
  "/mappings",
  user_validation_middleware,
  req_sender_auth,
  listBiometricMappingsController,
);

router.post(
  "/mappings",
  user_validation_middleware,
  req_sender_auth,
  saveBiometricMappingController,
);

router.delete(
  "/mappings/:id",
  user_validation_middleware,
  req_sender_auth,
  deleteBiometricMappingController,
);

router.post(
  "/sync-now",
  user_validation_middleware,
  req_sender_auth,
  syncBiometricNowController,
);

router.get(
  "/live-punches",
  user_validation_middleware,
  req_sender_auth,
  getLivePunchesController,
);

router.get(
  "/my-live-attendance",
  user_validation_middleware,
  req_sender_auth,
  getMyLiveAttendanceController,
);

router.get(
  "/live-cursor",
  user_validation_middleware,
  req_sender_auth,
  getLiveCursorController,
);

router.get(
  "/manage-attendance",
  user_validation_middleware,
  req_sender_auth,
  getBiometricManageAttendanceController,
);

export default router;
