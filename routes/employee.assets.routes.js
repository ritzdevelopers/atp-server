import express from "express";

const router = express.Router();

import upload from "../middlewares/multer.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import {
  add_assets_controller,
  update_assets_controller_using_patch,
  return_assets_of_employee_controller_using_patch,
  get_all_assets_controller,
  get_assets_by_user_controller,
  get_single_asset_controller,
  get_handover_assets_assigned_to_me,
} from "../controllers/asssets.controller.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";

router.get(
  "/list",
  user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "employee-assets-management", "read"), get_all_assets_controller,
);

router.get(
  "/by-employee/:employee_user_id", user_validation_middleware, req_sender_auth, user_membership_checker,  get_assets_by_user_controller,
);

router.get(
  "/detail/:asset_id", user_validation_middleware, req_sender_auth, user_membership_checker, get_single_asset_controller,
);

router.patch("/return", user_validation_middleware, req_sender_auth, user_membership_checker, return_assets_of_employee_controller_using_patch,
);

router.patch(
  "/update", user_validation_middleware, req_sender_auth, user_membership_checker, upload.any(), update_assets_controller_using_patch,
);

router.post("/add", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "employee-assets-management", "create"), upload.any(), add_assets_controller,
);

router.get("/handover-assigned-to-me", user_validation_middleware, req_sender_auth, user_membership_checker, req_sender_auth, user_membership_checker, get_handover_assets_assigned_to_me,
);

export default router;
