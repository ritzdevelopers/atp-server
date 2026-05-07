import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
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

const router = Router();

router.get("/get-organization-features",
    user_validation_middleware,
    user_authorization("admin"),
    get_organization_features_controller);

router.get(
    "/get-all-employees-with-accessible-features",
    user_validation_middleware,
    user_authorization("admin"),
    get_all_employees_with_accessible_features_controller,
);

router.post(
    "/assign-feature-to-employee",
    user_validation_middleware,
    user_authorization("admin"),
    assign_feature_to_employee_controller,
);

router.get(
    "/get-all-roles-of-organization",
    user_validation_middleware,
    user_authorization("admin"),
    get_all_roles_of_organization_controller,
);

router.get(
    "/get-role-feature-mappings",
    user_validation_middleware,
    user_authorization("admin"),
    get_role_feature_mappings_controller,
);

router.post(
    "/assign-feature-to-role",
    user_validation_middleware,
    user_authorization("admin"),
    assign_feature_to_role_controller,
);

router.patch(
    "/update-feature-of-role",
    user_validation_middleware,
    user_authorization("admin"),
    update_feature_of_role_controller,
);

router.get(
    "/get-all-organization-members-with-accessible-features-and-roles",
    user_validation_middleware,
    user_authorization("admin"),
    get_all_organization_members_with_accessible_features_and_roles_controller,
);

router.patch(
    "/update-feature-of-employee",
    user_validation_middleware,
    user_authorization("admin"),
    update_feature_of_employee_controller,
);

export default router;