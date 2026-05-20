import express from "express";

const router = express.Router();

import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

import {
  add_employee_reference_controller,
  update_employee_reference_controller,
  get_all_employee_references_controller,
  get_employee_reference_for_user_controller,
  get_single_employee_reference_controller,
  delete_employee_reference_controller,
  get_all_management_employees_controller,
} from "../controllers/employee.references.controller.js";

router.get(
  "/management-employees",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_all_management_employees_controller,
);

router.get(
  "/list",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_all_employee_references_controller,
);

router.get(
  "/by-employee/:employee_user_id",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_employee_reference_for_user_controller,
);

router.get(
  "/detail/:reference_id",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_single_employee_reference_controller,
);

router.delete(
  "/detail/:reference_id",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  delete_employee_reference_controller,
);

router.patch(
  "/update",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  update_employee_reference_controller,
);

router.post(
  "/add",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  add_employee_reference_controller,
);

export default router;
