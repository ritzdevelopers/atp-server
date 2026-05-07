import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import { getAttendanceHistoryOfEmployeeController } from "../controllers/attendance.history.controller.js";

const router = Router();

router.get("/get-attendance-history-of-employee", user_validation_middleware, getAttendanceHistoryOfEmployeeController); 


export default router;