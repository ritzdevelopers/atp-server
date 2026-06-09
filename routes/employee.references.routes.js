import express from "express";

const router = express.Router();

import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import {
  add_employee_reference_controller,
  update_employee_reference_controller,
  get_all_employee_references_controller,
  get_employee_reference_for_user_controller,
  get_single_employee_reference_controller,
  delete_employee_reference_controller,
  get_all_management_employees_controller,
} from "../controllers/employee.references.controller.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";

router.get(
  "/management-employees",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_all_management_employees_controller,
);

router.get(
  "/list",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_all_employee_references_controller,
);

router.get(
  "/by-employee/:employee_user_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_employee_reference_for_user_controller,
);

router.get(
  "/detail/:reference_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_single_employee_reference_controller,
);

router.delete(
  "/detail/:reference_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "delete"),
  delete_employee_reference_controller,
);

router.patch(
  "/update",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_employee_reference_controller,
);

router.post(
  "/add",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "create"),
  add_employee_reference_controller,
);

export default router;
