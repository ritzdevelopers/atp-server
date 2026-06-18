import { Router } from "express";
import {
  create_new_group,
  get_all_groups_where_i_am_participant,
  get_my_group_chat,
  edit_group_information,
  add_new_members_to_group,
  add_new_group_admin,
  remove_group_admin,
  remove_members_from_group,
  inactive_group,
  get_org_users_for_chat,
} from "../../controllers/chats/group/group_chat.controller.js";
import {
  delete_my_messages,
  get_my_all_chats,
  get_my_single_chat,
} from "../../controllers/chats/my/my_chat.controller.js";
import user_validation_middleware from "../../middlewares/user_validation_middleware.js";
import req_sender_auth from "../../middlewares/req_sender_auth.js";
import user_membership_checker from "../../middlewares/user_membership_checker.js";

const router = Router();

router.use(
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
);

// Org users for chat (name, email, profile only)
router.get("/get-org-users-for-chat", get_org_users_for_chat);

// Individual private chats
router.get("/get-my-all-chats", get_my_all_chats);
router.get("/get-my-single-chat/:chat_id", get_my_single_chat);
router.delete("/delete-my-messages/:chat_id", delete_my_messages);

// Create New Group
router.post("/create-new-group", create_new_group);

// Get All Groups Where I am Participant
router.get("/get-all-groups", get_all_groups_where_i_am_participant);

// Get Single Chat Of Group
router.get("/get-my-group-chat/:group_id", get_my_group_chat);

// Edit Group Information *Patch
router.patch("/edit-group-information/:group_id", edit_group_information);

// Add New Members To Group
router.post("/add-new-members-to-group/:group_id", add_new_members_to_group);

// Add / Remove Group Admin
router.post("/add-new-group-admin/:group_id", add_new_group_admin);
router.delete("/remove-group-admin/:group_id", remove_group_admin);

// Remove Members From Group
router.delete("/remove-members-from-group/:group_id", remove_members_from_group);

// Activate / Deactivate Group
router.patch("/inactive-group/:group_id", inactive_group);

export default router;
