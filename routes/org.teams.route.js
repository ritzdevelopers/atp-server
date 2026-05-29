import express from "express";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import {
  create_org_team_controller,
  update_org_team_controller,
  add_member_to_org_team_controller,
  remove_member_from_org_team_controller,
  get_all_org_team_members_controller,
  get_single_org_team_controller,
  get_single_org_team_member_controller,
  get_team_activity_feed_controller,
  get_team_member_exit_process_reports_controller,
} from "../controllers/org_team.controller.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
const router = express.Router();

router.post(
  "/create-team",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  create_org_team_controller,
);
router.post(
  "/add-member-to-team",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  add_member_to_org_team_controller,
);
router.post(
  "/remove-member-from-team",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  remove_member_from_org_team_controller,
);
router.patch(
  "/update-team",
  user_validation_middleware,
  req_sender_auth,
  user_feature_access_checker("employee-management"),
  update_org_team_controller,
);
router.get(
  "/get-my-team",
  user_validation_middleware,
  req_sender_auth,
  get_single_org_team_member_controller,
);
router.get(
  "/get-team/:team_id",
  user_validation_middleware,
  req_sender_auth, 
  get_single_org_team_controller,
);
router.get(
  "/team-activity/:team_id",
  user_validation_middleware,
  req_sender_auth, 
  get_team_activity_feed_controller,
);
router.get(
  "/exit-process-report/:employee_id",
  user_validation_middleware,
  req_sender_auth, 
  get_team_member_exit_process_reports_controller,
);
router.get(
  "/get-all-teams",
  user_validation_middleware,
  req_sender_auth, 
  get_all_org_team_members_controller,
);

export default router;
