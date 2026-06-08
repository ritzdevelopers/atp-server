import { Router } from "express";
import { 
  user_login_controller
} from "../controllers/user.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js"; 
import { get_user_controller } from "../controllers/auth.controller.js";
import { get_org_info_controller, get_organization_controller } from "../controllers/organization.controller.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import { get_accessible_features_controller } from "../controllers/organization.features.controller.js";
import user_feature_access from "../middlewares/user_feature_access.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
import left_side_features from "../middlewares/left_side_features.js";
import { get_left_side_bar_features_controller } from "../controllers/organizations_features/organization.features.controller.js";
const router = Router();

router.post("/login", user_login_controller); // :: Tested and Working Fine ::

router.get("/get-me", user_validation_middleware, get_user_controller);

router.get("/get-organization", user_validation_middleware, req_sender_auth, user_membership_checker, user_feature_access, get_org_info_controller);

router.get("/get-accessible-features", user_validation_middleware, req_sender_auth, user_membership_checker, user_feature_access, (req, res)=>{
  const { accessible_features } = req;
  return res.status(200).json({
    success: true,
    message: "Accessible Features Fetched Successfully",
    accessible_features,
  });
});

// Left Side Bar Feature Access Checker ::
router.get("/get-left-side-bar-features", user_validation_middleware, req_sender_auth, employee_feature_checker("get-organization-info", "get-dashboard"), left_side_features, get_left_side_bar_features_controller)

export default router;