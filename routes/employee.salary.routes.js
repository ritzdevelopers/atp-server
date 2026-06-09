import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import {
  register_employee_salary_controller,
  get_employee_salary_controller,
  update_employee_salary_controller,
} from "../controllers/employee.salary.controller.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";

const router = Router();

router.post(
  "/register-employee-salary",
  user_validation_middleware,
   req_sender_auth, user_membership_checker,
  employee_feature_checker("payroll-management", "manage-salary", "create"),
  register_employee_salary_controller,
);

router.get(
  "/get-employee-salary",
  user_validation_middleware,
   req_sender_auth, user_membership_checker,
  employee_feature_checker("payroll-management", "manage-salary", "read"),
  get_employee_salary_controller,
);

router.put(
  "/update-employee-salary",
  user_validation_middleware,
   req_sender_auth, user_membership_checker,
  employee_feature_checker("payroll-management", "manage-salary", "update"),
  update_employee_salary_controller,
);

export default router;
