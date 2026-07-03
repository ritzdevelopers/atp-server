import { Router } from "express";
import user_validation_middleware from "../../middlewares/user_validation_middleware.js";
import req_sender_auth from "../../middlewares/req_sender_auth.js";
import user_membership_checker from "../../middlewares/user_membership_checker.js";
import {
  applyForCompOff,
  getSelectedDateAttendanceRecord,
  updateCompOffInfo,
  deleteCompOff,
  getMyAllCompOffs,
  getSingleCompOff,
  getRMAllCompOffs,
  getManagerSingleCompOff,
  updateCompOffStatus,
} from "../../controllers/compoff-management/compoff.controller.js";

const router = Router();

const auth = [
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
];

router.post("/apply-for-comp-off", ...auth, applyForCompOff);
router.get("/get-selected-date-attendance", ...auth, getSelectedDateAttendanceRecord);
router.patch("/update-comp-off-info/:id", ...auth, updateCompOffInfo);
router.delete("/delete-comp-off/:id", ...auth, deleteCompOff);
router.get("/get-my-all-comp-offs", ...auth, getMyAllCompOffs);
router.get("/get-single-comp-off/:id", ...auth, getSingleCompOff);

// Manager Routes ::
router.get("/get-rm-all-comp-offs", ...auth, getRMAllCompOffs);
router.get("/get-manager-single-comp-off/:id", ...auth, getManagerSingleCompOff);
router.patch("/update-comp-off-status/:id", ...auth, updateCompOffStatus);

export default router;
