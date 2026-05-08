import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import { getAttendanceHistoryOfEmployeeController, get_all_users_with_attendance_history, get_single_user_with_attendance_history } from "../controllers/attendance.history.controller.js";

const router = Router();

router.get("/get-attendance-history-of-employee", user_validation_middleware, getAttendanceHistoryOfEmployeeController);

router.get("/get-all-users-with-attendance-history", user_validation_middleware, get_all_users_with_attendance_history);

router.get("/get-single-user-with-attendance-history", user_validation_middleware, get_single_user_with_attendance_history);


export default router;