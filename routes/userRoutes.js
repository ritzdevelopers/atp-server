import { Router } from "express";
import { user_register_controller } from "../controllers/user.controller";

const router = Router();

// Create HR Route :: It Will Be Used By Admin Only
router.post("/create-hr", user_validation_middleware, user_authorization("admin"), user_register_controller);

// Create Employee Route :: It Will Be Used By HR And Admin Only
router.post("/create-employee", user_validation_middleware, user_authorization("hr", "admin"), user_register_controller);

// Get All Users Route :: It Will Be Used By Admin Only
router.get("/get-all-users", user_validation_middleware, user_authorization("admin"), get_all_users_controller);

// Get All Users Except Admin Route :: It Will Be Used By HR Only
router.get("/get-all-users-except-admin", user_validation_middleware, user_authorization("hr"), get_all_users_except_admin_controller);



export default router;