import express from "express";
import { markAttendanceController, markCheckOutAttendanceController } from "../controllers/attendance.controller.js"; 
import  user_validation_middleware   from "../middlewares/user_validation_middleware.js";
const router = express.Router();

router.post("/check-in", user_validation_middleware, markAttendanceController);
router.post("/check-out", user_validation_middleware, markCheckOutAttendanceController);
export default router;