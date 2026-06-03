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
  return_assets_completed_controller,
} from "../controllers/employee.exit.controller.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import must_be_handover_manager from "../middlewares/must_be_handover_manager.js";
import {
  assign_handover_manager,
  update_assigned_handover_manager,
} from "../controllers/handover_management.controller.js";

const router = express.Router();

router.post(
  "/create-employee-exit-process",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  create_employee_exit_process,
);

router.get(
  "/get-all-employee-exit-processes",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  get_all_employee_exit_processes,
);

router.get(
  "/get-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  get_employee_exit_process,
);

router.get(
  "/get-my-exit-process",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  get_my_exit_process,
);

router.get(
  "/assets-for-handover/:user_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  get_all_assets_for_handover_of_an_employee,
);

router.patch(
  "/correction-in-employee-exit-process/:id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  correction_in_employee_exit_process,
);

router.post(
  "/exit-in-process/:exit_process_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  exit_in_process,
);

router.post(
  "/exit-completed/:exit_process_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  exit_completed,
);

router.post(
  "/exit-cancelled/:exit_process_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  exit_cancelled,
);

router.post(
  "/create-employee-exit-process-handover-query",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  create_employee_exit_process_handover_query,
);

router.patch(
  "/employee-exit-process/:employee_exit_process_id/handover-query/:employee_id/:id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
    update_employee_exit_process_handover_query,
);

router.patch(
  "/my-handover-query/:employee_exit_process_id/:employee_id/:id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  must_be_handover_manager,
  update_employee_exit_process_handover_query,
);

router.patch(
  "/asset-handover-status/:asset_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  update_asset_handover_status,
);

router.post(
  "/assign-handover-manager/:exit_process_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  assign_handover_manager,
);

router.patch(
  "/update-assigned-handover-manager/:exit_process_id",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  update_assigned_handover_manager,
);

router.post(
  "/return-assets-completed",
  user_validation_middleware,
  req_sender_auth, user_membership_checker,
  user_feature_access_checker("employee-management"),
  return_assets_completed_controller,
);

export default router;
