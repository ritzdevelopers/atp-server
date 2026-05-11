import { Router } from "express";
import {
  get_all_users_controller,
  update_user_name_email_phone_password_controller,
  update_user_role_controller,
  user_register_controller,
  delete_user_controller,
  add_user_address_controller,
  update_user_address_controller,
  get_single_user_address_controller,
} from "../controllers/user.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import { getAllLeavesController, updateLeaveStatusController } from "../controllers/leave.management.controller.js";
import { assignPaidLeavesController } from "../controllers/attendance.controller.js";
const router = Router();

// Create Employee Route :: It Will Be Used By Admin Only
router.post(
  "/create-employee",
  user_validation_middleware,
  user_authorization("admin","hr"),
  user_register_controller,
);

// Get All Users Route :: It Will Be Used By Admin Only
router.get(
  "/get-all-users",
  user_validation_middleware, 
  get_all_users_controller,
);

// Update User Role Route :: It Will Be Used By Admin Only
router.patch(
  "/update-user-role",
  user_validation_middleware,
  user_authorization("admin","hr"),
  update_user_role_controller,
);

// Update User name or email or phone or password Route :: It Will Be Used By Admin Only
router.patch(
  "/update-user-name-email-phone-password",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  update_user_name_email_phone_password_controller,
);

// Delete User Route :: It Will Be Used By Admin Only
router.delete(
  "/delete-user",
  user_validation_middleware,
  user_authorization("admin"),
  delete_user_controller,
);

// Add User Address Route :: It Will Be Used By Admin And HR
router.post(
  "/add-user-address",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  add_user_address_controller,
);

router.patch(
  "/update-user-address",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  update_user_address_controller,
);

router.get(
  "/get-user-address/:org_id/:user_id",
  user_validation_middleware,
  get_single_user_address_controller,
);


// Leave Management Routes ::

router.get("/get-all-leaves", user_validation_middleware, getAllLeavesController);
router.patch("/update-leave-status", user_validation_middleware, updateLeaveStatusController);

// Assign Leaves To The Users ::

router.post("/assign-leaves-to-users", user_validation_middleware, assignPaidLeavesController);

export default router;
