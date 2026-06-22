import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import {
  create_leave_type_controller,
  update_leave_type_controller,
  get_all_leave_types_controller,
  create_employee_leave_balance_controller,
  leave_onboard_controller,
} from "../controllers/leave.management.controller.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";

const router = Router();

router.get(
  "/get-leave-types",
  user_validation_middleware, req_sender_auth, user_membership_checker,
  employee_feature_checker("company-leave-management", "manage-leave-types", "read"),
  get_all_leave_types_controller,
);

router.post(
  "/create-leave-type",
  user_validation_middleware, req_sender_auth, user_membership_checker, 
  employee_feature_checker("company-leave-management", "manage-leave-types", "create"),
  create_leave_type_controller,
);

router.patch(
  "/update-leave-type",
  user_validation_middleware, req_sender_auth, user_membership_checker,
  employee_feature_checker("company-leave-management", "manage-leave-types", "update"),
  update_leave_type_controller,
);

router.get(
  "/employee-leave-types",
  user_validation_middleware, req_sender_auth, user_membership_checker,
  employee_feature_checker("employee-management", "manage-leave-types", "read"),
  get_all_leave_types_controller,
);

/** Org members (e.g. user dashboard) — read leave types without admin feature flags */
router.get(
  "/org-leave-types",
  user_validation_middleware, req_sender_auth, user_membership_checker,
  get_all_leave_types_controller,
);

router.post(
  "/create-employee-leave-balance",
  user_validation_middleware, req_sender_auth, user_membership_checker,
  employee_feature_checker("employee-management", "manage-leave-types", "create"),
  create_employee_leave_balance_controller,
);

router.post("/leave-onboard", user_validation_middleware, req_sender_auth, user_membership_checker,
  employee_feature_checker("employee-management", "manage-leave-types", "create"),
  leave_onboard_controller,
);

export default router;
