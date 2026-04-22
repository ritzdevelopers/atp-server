import { Router } from "express";
import { create_user_role_controller, update_user_role_controller, delete_user_role_controller, get_all_user_roles_controller } from "../controllers/user.roles.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
const router = Router();

router.post("/create-user-role", user_validation_middleware, user_authorization("admin", "hr"), create_user_role_controller);
router.patch("/update-user-role", user_validation_middleware, user_authorization("admin", "hr"), update_user_role_controller);
router.delete("/delete-user-role", user_validation_middleware, user_authorization("admin", "hr"), delete_user_role_controller);
router.get("/get-all-user-roles", user_validation_middleware, user_authorization("admin"), get_all_user_roles_controller);

export default router;