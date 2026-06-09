import { Router } from "express";
import {
  create_user_role_controller,
  update_user_role_controller,
  delete_user_role_controller,
  get_all_user_roles_controller,
} from "../controllers/user.roles.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
const router = Router();

router.post(
  "/create-user-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-roles-management", "create-new-role", "create"),
  create_user_role_controller,
);
router.patch(
  "/update-user-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-roles-management", "manage-roles", "update"),
  update_user_role_controller,
);
router.delete(
  "/delete-user-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-roles-management", "manage-roles", "delete"),
  delete_user_role_controller,
);
router.post(
  "/get-all-user-roles",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,

  employee_feature_checker("employees-roles-management", "manage-roles", "read"),

  get_all_user_roles_controller,
);

export default router;
