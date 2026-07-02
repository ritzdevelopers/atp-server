import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import {
  createLeave,
  updateLeave,
  deleteLeave,
  get_my_all_leaves,
  get_single_leave,
  get_leave_reviewers,
  get_leaves_where_i_am_reviewer,
  perform_leave_review,
} from "../controllers/leave_controller/leave.controller.js";

const router = Router();

const auth = [
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
];

router.post("/create-leave", ...auth, createLeave);
router.patch("/update-leave/:id", ...auth, updateLeave);
router.delete("/delete-leave/:id", ...auth, deleteLeave);
router.get("/get-all-leaves", ...auth, get_my_all_leaves);
router.get("/get-leave/:id", ...auth, get_single_leave);
router.get("/get-leave-reviewers", ...auth, get_leave_reviewers);
router.get("/get-leaves-where-i-am-reviewer", ...auth, get_leaves_where_i_am_reviewer);
router.patch("/perform-leave-review", ...auth, perform_leave_review);

export default router;
