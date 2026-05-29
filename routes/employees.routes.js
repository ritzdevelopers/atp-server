import { Router } from "express";   
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import { getEmployeesFullInformationController, updateImageAndNameOfEmployeeController } from "../controllers/employees.controller.js";
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
const router = Router();

// Get Employees Full Information ::
router.get("/get-employees-full-information", user_validation_middleware, getEmployeesFullInformationController);

// Update Image and Name Of Employee ::
router.patch("/update-image-and-name-of-employee", user_validation_middleware, user_feature_access_checker("employee-management"), updateImageAndNameOfEmployeeController);

// Mark Attendance *Check In Of Employee ::
router.post("/mark-attendance-check-in", user_validation_middleware, markAttendanceController);

// Mark Attendance *Check Out Of Employee ::
router.post("/mark-attendance-check-out", user_validation_middleware, markCheckOutAttendanceController);

// ENTRY/EXIT log (e.g. stepped out briefly) for today's attendance row
router.post("/add-attendance-log", user_validation_middleware, addAttendanceLogController);

// Get Attendance History Of Employee ::

// Apply For Leave ::
router.post("/apply-for-leave", user_validation_middleware, leaveQueryController);

// My leave request history (current user, per org) ::
router.post(
  "/my-leave-queries",
  user_validation_middleware,
  getMyLeaveQueriesController,
);
router.get(
  "/my-leave-queries",
  user_validation_middleware,
  getMyLeaveQueriesController,
);

// Attendance-related queries (punch corrections, etc.) — saved to attendance_related_queries
router.post(
  "/raise-attendance-query",
  user_validation_middleware,
  raiseAttendanceQueryController,
);

router.patch(
  "/correct-attendance-query",
  user_validation_middleware,
  updateAttendanceQueryCorrectionController,
);

router.get(
  "/my-attendance-queries",
  user_validation_middleware,
  getMyAttendanceQueriesController,
);
router.post(
  "/my-attendance-queries",
  user_validation_middleware,
  getMyAttendanceQueriesController,
);

// 

export default router;