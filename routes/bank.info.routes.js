import express from "express";

const router = express.Router();

import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";

import { create_bank_info_controller, update_bank_info_controller } from "../controllers/bank_info.controller.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";

router.post(
  "/create",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "create"),
  create_bank_info_controller,
);

router.patch(
  "/update",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_bank_info_controller,
);

export default router;
