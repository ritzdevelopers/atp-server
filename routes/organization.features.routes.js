import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import {
    get_all_employees_with_accessible_features_controller,
    get_organization_features_controller,
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

export default router;