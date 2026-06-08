import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import {
  assign_dashboard_to_employee,
  get_all_assigned_dashboards_to_employee,
  update_dashboard_from_employee,
} from "../controllers/dashboard/dashboard.controller.js";

const router = Router();

router.get(
  "/get-all-assigned-dashboards",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  get_all_assigned_dashboards_to_employee,
);

router.post(
  "/assign-dashboard-to-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  assign_dashboard_to_employee,
);

router.patch(
  "/update-dashboard-from-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  update_dashboard_from_employee,
);

export default router;
