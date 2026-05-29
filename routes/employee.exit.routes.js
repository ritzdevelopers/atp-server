import express from "express";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import {
  correction_in_employee_exit_process,
  create_employee_exit_process,
  create_employee_exit_process_handover_query,
  exit_cancelled,
  exit_completed,
  exit_in_process,
  get_all_employee_exit_processes,
  get_employee_exit_process,
  get_my_exit_process,
  get_all_assets_for_handover_of_an_employee,
  update_employee_exit_process_handover_query,
  update_asset_handover_status,
} from "../controllers/employee.exit.controller.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
const router = express.Router();

router.post(
  "/create-employee-exit-process",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  create_employee_exit_process,
);

router.get(
  "/get-all-employee-exit-processes",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  get_all_employee_exit_processes,
);

router.get(
  "/get-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  get_employee_exit_process,
);

router.get(
  "/get-my-exit-process",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  get_my_exit_process,
);

router.get(
  "/assets-for-handover/:user_id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  get_all_assets_for_handover_of_an_employee,
);

router.patch(
  "/correction-in-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  correction_in_employee_exit_process,
);

router.post(
  "/exit-in-process/:exit_process_id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  exit_in_process,
);

router.post(
  "/exit-completed/:exit_process_id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  exit_completed,
);

router.post(
  "/exit-cancelled/:exit_process_id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  exit_cancelled,
);

router.post(
  "/create-employee-exit-process-handover-query",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  create_employee_exit_process_handover_query,
);

router.patch(
  "/employee-exit-process/:employee_exit_process_id/handover-query/:employee_id/:id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
    update_employee_exit_process_handover_query,
);

router.patch(
  "/asset-handover-status/:asset_id",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  update_asset_handover_status,
);

export default router;
