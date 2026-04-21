import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";

const router = Router();

// Get All Users Route *Except Admin* :: It Will Be Used By HR Only
router.get("/get-all-users", user_validation_middleware, user_authorization("hr"), get_all_users_controller);


// Add New User Route :: It Will Be Used By HR Only
router.post("/add-new-user", user_validation_middleware, user_authorization("hr"), add_new_user_controller);


// Update User Role Route :: It Will Be Used By HR Only
router.patch("/update-user-role", user_validation_middleware, user_authorization("hr"), update_user_role_controller);

// Update User Name or Email or Phone or Password Route :: It Will Be Used By HR Only
router.patch("/update-user-name-email-phone-password", user_validation_middleware, user_authorization("hr"), update_user_name_email_phone_password_controller);

// Delete User Route :: It Will Be Used By HR Only
router.delete("/delete-user", user_validation_middleware, user_authorization("hr"), delete_user_controller);

export default router;
