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
} from "../controllers/org_team.controller.js";

const router = express.Router();

router.post(
  "/create-team",
  user_validation_middleware,
  req_sender_auth,
  create_org_team_controller,
);
router.post(
  "/add-member-to-team",
  user_validation_middleware,
  req_sender_auth,
  add_member_to_org_team_controller,
);
router.post(
  "/remove-member-from-team",
  user_validation_middleware,
  req_sender_auth,
  remove_member_from_org_team_controller,
);
router.patch(
  "/update-team",
  user_validation_middleware,
  req_sender_auth,
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
  "/get-all-teams",
  user_validation_middleware,
  req_sender_auth,
  get_all_org_team_members_controller,
);

export default router;
