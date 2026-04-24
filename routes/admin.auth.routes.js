import { Router } from "express";
import { 
  user_login_controller
} from "../controllers/user.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js"; 
import { get_user_controller } from "../controllers/auth.controller.js";
import { get_organization_controller } from "../controllers/organization.controller.js";
import user_authorization from "../middlewares/user_authorization.js";

const router = Router();

router.post("/login", user_login_controller); // :: Tested and Working Fine ::


router.get("/get-me", user_validation_middleware, get_user_controller);

router.get("/get-organization", user_validation_middleware, user_authorization("admin", "hr"), get_organization_controller);

export default router;
