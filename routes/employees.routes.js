import { Router } from "express";   
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import {
  getEmployeesFullInformationController,
  getMyAssignedLeaveBalancesController,
  updateImageAndNameOfEmployeeController,
} from "../controllers/employees.controller.js";
import {
  getMyAttendanceQueriesController,
  raiseAttendanceQueryController,
  updateAttendanceQueryCorrectionController,
} from "../controllers/leave.management.controller.js";
import {
  addAttendanceLogController,
  getMyLeaveQueriesController,
  leaveQueryController,
  markAttendanceController,
  markCheckOutAttendanceController,
} from "../controllers/attendance.controller.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
const router = Router();

// Get Employees Full Information ::
router.get("/get-employees-full-information", user_validation_middleware, req_sender_auth, user_membership_checker, getEmployeesFullInformationController);

router.get(
  "/my-assigned-leave-balances",
  user_validation_middleware,
  getMyAssignedLeaveBalancesController,
);

// Update Image and Name Of Employee ::
router.patch("/update-image-and-name-of-employee", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "manage-employee", "update"), updateImageAndNameOfEmployeeController);

// Mark Attendance *Check In Of Employee ::
router.post("/mark-attendance-check-in", user_validation_middleware, req_sender_auth, user_membership_checker, markAttendanceController);

// Mark Attendance *Check Out Of Employee ::
router.post("/mark-attendance-check-out", user_validation_middleware, req_sender_auth, user_membership_checker, markCheckOutAttendanceController);

// ENTRY/EXIT log (e.g. stepped out briefly) for today's attendance row
router.post("/add-attendance-log", user_validation_middleware, req_sender_auth, user_membership_checker, addAttendanceLogController);

// Get Attendance History Of Employee ::

// Apply For Leave ::
router.post("/apply-for-leave", user_validation_middleware, req_sender_auth, user_membership_checker, leaveQueryController);

// My leave request history (current user, per org) ::
router.post(
  "/my-leave-queries", user_validation_middleware, req_sender_auth, user_membership_checker,  getMyLeaveQueriesController,
);
router.get(
  "/my-leave-queries", user_validation_middleware, req_sender_auth, user_membership_checker,  getMyLeaveQueriesController,
);

// Attendance-related queries (punch corrections, etc.) — saved to attendance_related_queries
router.post(
  "/raise-attendance-query", user_validation_middleware, req_sender_auth, user_membership_checker,  raiseAttendanceQueryController,
);

router.patch(
  "/correct-attendance-query", user_validation_middleware, req_sender_auth, user_membership_checker,  updateAttendanceQueryCorrectionController,
);

router.get(
  "/my-attendance-queries", user_validation_middleware, req_sender_auth, user_membership_checker,  getMyAttendanceQueriesController,
);
router.post(
  "/my-attendance-queries", user_validation_middleware, req_sender_auth, user_membership_checker,  getMyAttendanceQueriesController,
);


export default router;