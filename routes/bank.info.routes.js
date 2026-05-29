import express from "express";

const router = express.Router();

import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";

import { create_bank_info_controller, update_bank_info_controller } from "../controllers/bank_info.controller.js";

router.post(
  "/create",
  user_validation_middleware,
  user_feature_access_checker("employee-management"),
  create_bank_info_controller,
);

router.patch(
  "/update",
  user_validation_middleware,
  user_feature_access_checker("employee-management"),
  update_bank_info_controller,
);

export default router;
