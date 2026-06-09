import express from "express";
import { markAttendanceController, markCheckOutAttendanceController } from "../controllers/attendance.controller.js"; 
import  user_validation_middleware   from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
const router = express.Router();

router.post("/check-in", user_validation_middleware, req_sender_auth, user_membership_checker, markAttendanceController);
router.post("/check-out", user_validation_middleware, req_sender_auth, user_membership_checker, markCheckOutAttendanceController);
export default router;