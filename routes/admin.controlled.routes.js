import { Router } from "express";
import {
  get_all_users_controller,
  update_user_name_email_phone_password_controller,
  update_user_role_controller,
  user_register_controller,
  add_user_address_controller,
  update_user_address_controller,
  get_single_user_address_controller,
  add_user_external_information_controller,
  update_user_external_information_controller,
  delete_user_external_information_controller,
  get_single_employee_controller,
  update_my_profile_image_controller,
  create_user_background_verification_controller,
  update_user_reference_controller,
  update_employee_background_verification_status_controller,
} from "../controllers/user.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js"; 
import {
  getAllAttendanceQueriesController,
  getAllLeavesController,
  updateAttendanceQueryStatusController,
  updateLeaveQueryStatusController,
  updateLeaveStatusController,
} from "../controllers/leave.management.controller.js";
import {
  assignPaidLeavesController,
  leaveResponseController,
} from "../controllers/attendance.controller.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import upload from "../middlewares/multer.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
const router = Router();

// Create Employee Route :: It Will Be Used By Admin Only
router.post(
  "/create-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "create"),
  user_register_controller,
);

// Get All Users Route :: It Will Be Used By Admin Only
router.get(
  "/get-all-users",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_all_users_controller,
);

// Get Single Employee Route :: used by management only
router.get(
  "/get-single-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "read"),
  get_single_employee_controller,
);

// Update User Role Route :: It Will Be Used By Admin Only
router.patch(
  "/update-user-role",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employees-roles-management",
    "manage-roles",
    "update",
  ),
  update_user_role_controller,
);

// Update User name or email or phone or password Route :: It Will Be Used By Admin Only
router.patch(
  "/update-user-name-email-phone-password",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_user_name_email_phone_password_controller,
);

router.patch(
  "/update-my-profile-image",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  upload.single("file"),
  update_my_profile_image_controller,
);

// Delete User Route :: It Will Be Used By Admin Only
// router.delete(
//   "/delete-user",
//   user_validation_middleware,
//   user_authorization("admin"),
//   delete_user_controller,
// );

// Add User Address Route :: It Will Be Used By Admin And HR
router.post(
  "/add-user-address",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "add"),
  add_user_address_controller,
);

router.patch(
  "/update-user-address",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_user_address_controller,
);

router.get(
  "/get-user-address/:org_id/:user_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  get_single_user_address_controller,
);

// Leave Management Routes ::

router.get(
  "/get-all-leaves",
  user_validation_middleware,
  employee_feature_checker(
    "employee-management",
    "employee-leave-management",
    "read",
  ),
  getAllLeavesController,
);

router.patch(
  "/update-leave-status",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employee-management",
    "employee-leave-management",
    "update",
  ),
  updateLeaveStatusController,
);

/** List attendance-related queries for an org (optional team_id and filters). */
router.get(
  "/get-all-attendance-queries",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "company-holiday-management",
    "manage-attendances",
    "read",
  ),
  getAllAttendanceQueriesController,
);

/** Approve or reject attendance-related query (attendance_related_queries). */
router.patch(
  "/update-leave-query-status",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "company-holiday-management",
    "manage-attendances",
    "update",
  ),
  updateLeaveQueryStatusController,
);

// Use By Manager Only To Update The Attendance Query Status
router.post(
  "/update-attendance-query-status",
  user_validation_middleware,
  req_sender_auth,
  employee_feature_checker(
    "company-holiday-management",
    "manage-attendances",
    "update",
  ),
  updateAttendanceQueryStatusController,
);
/** Approve or reject a pending leave request (admin, HR, manager). */
router.post(
  "/respond-to-leave",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "company-holiday-management",
    "manage-attendances",
    "update",
  ),
  leaveResponseController,
);

// Assign Leaves To The Users ::

router.post(
  "/assign-leaves-to-users",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "employee-management",
    "employee-leave-management",
    "create",
  ),
  assignPaidLeavesController,
);

// User External Information Routes ::

router.post(
  "/add-user-external-information",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "add"),
  add_user_external_information_controller,
);

router.patch(
  "/update-user-external-information",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_user_external_information_controller,
);

router.delete(
  "/delete-user-external-information",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "delete"),
  delete_user_external_information_controller,
);


// Employee Background Verfication Routes ::

router.post(
  "/create-user-background-verification",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "create"),
  create_user_background_verification_controller,
);

router.patch(
  "/update-user-background-verification",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_user_reference_controller,
);

router.patch(
  "/update-employee-background-verification-status",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker("employee-management", "manage-employee", "update"),
  update_employee_background_verification_status_controller,
);

export default router;