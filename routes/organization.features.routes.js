import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";

import {
  assign_feature_to_employee_controller,
  assign_feature_to_role_controller,
  get_all_organization_members_with_accessible_features_and_roles_controller,
  get_all_employees_with_accessible_features_controller,
  get_all_roles_of_organization_controller,
  get_organization_features_controller,
  get_role_feature_mappings_controller,
  update_feature_of_employee_controller,
  update_feature_of_role_controller,
} from "../controllers/organization.features.controller.js";
import {
  get_all_employees_with_accessible_features_and_sub_features_info_controller,
  get_organization_features_features_info_controller,
} from "../controllers/organization.controller.js";
import {
  assign__feature_access_to_the_employee,
  assign_features_and_sub_features_to_the_employee,
  assign_features_to_employee_controller,
} from "../controllers/organizations_features/features_managers.controller.js";

import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";

const router = Router();

router.get(
  "/get-organization-features",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-features-management",
    "manage-organization-features",
    "read",
  ),
  get_organization_features_controller,
);

router.get(
  "/get-all-employees-with-accessible-features",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-features-management",
    "get-employee-accessible-features",
    "read",
  ),
  get_all_employees_with_accessible_features_controller,
);

router.post(
  "/assign-feature-to-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-features-management",
    "assign-features-to-the-employee",
    "create",
  ),
  assign_feature_to_employee_controller,
);

router.get(
  "/get-all-roles-of-organization",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-roles-management",
    "manage-roles",
    "read",
  ),
  get_all_roles_of_organization_controller,
);

router.get(
  "/get-role-feature-mappings",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-roles-management",
    "manage-roles",
    "read",
  ),
  get_role_feature_mappings_controller,
);

router.post(
  "/assign-feature-to-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-features-management",
    "assign-features-role-wise",
    "create",
  ),
  assign_feature_to_role_controller,
);

router.patch(
  "/update-feature-of-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-features-management",
    "assign-features-role-wise",
    "update",
  ),
  update_feature_of_role_controller,
);

router.get(
  "/get-all-organization-members-with-accessible-features-and-roles",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-features-management", "get-employee-accessible-features", "read"),
  get_all_organization_members_with_accessible_features_and_roles_controller,
);

router.patch(
  "/update-feature-of-employee",
  user_validation_middleware,
  employee_feature_checker("employees-features-management", "assign-features-to-the-employee", "update"),
  update_feature_of_employee_controller,
);

router.get(
  "/get-organization-features-features-info",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  get_organization_features_features_info_controller,
);

router.get(
  "/get-all-employees-with-accessible-features-and-sub-features-info",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-features-management", "get-employee-accessible-features", "read"),
  get_all_employees_with_accessible_features_and_sub_features_info_controller,
);

router.post(
  "/assign-feature-access-to-the-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-features-management", "assign-features-to-the-employee", "create"),
  assign__feature_access_to_the_employee,
);

router.post(
  "/assign-features-to-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-features-management", "assign-features-to-the-employee", "create"),
  assign_features_to_employee_controller,
);

router.post(
  "/assign-features-and-sub-features-to-the-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employees-features-management", "assign-features-to-the-employee", "create"),
  assign_features_and_sub_features_to_the_employee,
);

export default router;
