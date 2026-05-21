import express from "express";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import {
  correction_in_employee_exit_process,
  create_employee_exit_process,
  get_all_employee_exit_processes,
  get_employee_exit_process,
} from "../controllers/employee.exit.controller.js";

const router = express.Router();

router.post(
  "/create-employee-exit-process",
  user_validation_middleware,
  req_sender_auth,
  create_employee_exit_process,
);

router.get(
  "/get-all-employee-exit-processes",
  user_validation_middleware,
  req_sender_auth,
  get_all_employee_exit_processes,
);

router.get(
  "/get-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth,
  get_employee_exit_process,
);

router.patch(
  "/correction-in-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth,
  correction_in_employee_exit_process,
);

export default router;
