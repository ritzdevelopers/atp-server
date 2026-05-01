import { Router } from "express";   
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import { getEmployeesFullInformationController, updateImageAndNameOfEmployeeController } from "../controllers/employees.controller.js";
import { leaveQueryController, markAttendanceController, markCheckOutAttendanceController } from "../controllers/attendance.controller.js";

const router = Router();

// Get Employees Full Information ::
router.get("/get-employees-full-information", user_validation_middleware, getEmployeesFullInformationController);

// Update Image and Name Of Employee ::
router.patch("/update-image-and-name-of-employee", user_validation_middleware, updateImageAndNameOfEmployeeController);

// Mark Attendance *Check In Of Employee ::
router.post("/mark-attendance-check-in", user_validation_middleware, markAttendanceController);

// Mark Attendance *Check Out Of Employee ::
router.post("/mark-attendance-check-out", user_validation_middleware, markCheckOutAttendanceController);

// Get Attendance History Of Employee ::

// Apply For Leave ::
router.post("/apply-for-leave", user_validation_middleware, leaveQueryController);

export default router;