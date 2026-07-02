import { Router } from "express";
import user_validation_middleware from "../../middlewares/user_validation_middleware.js";
import req_sender_auth from "../../middlewares/req_sender_auth.js";
import user_membership_checker from "../../middlewares/user_membership_checker.js";
import {
  applyForRegularization,
  updateRegularization,
  deleteRegularization,
  getRegularization,
  getMyRegularization,
  getAllRegularizationRequests,
  getRegularizationRequest,
  updateRegularizationRequest,
} from "../../controllers/regularization/regularization.controller.js";

const router = Router();

const auth = [
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
];

// ---------------- Used By Employee ---------------- //
router.post("/apply-for-regularization", ...auth, applyForRegularization);
router.patch("/update-regularization/:id", ...auth, updateRegularization);
router.delete("/delete-regularization/:id", ...auth, deleteRegularization);
router.get("/get-regularization/:id", ...auth, getRegularization);
router.get("/get-my-regularization", ...auth, getMyRegularization);

// ---------------- Used By Reporting Manager/HR/Admin ---------------- //
router.get("/get-all-regularization-requests", ...auth, getAllRegularizationRequests);
router.get("/get-regularization-request/:id", ...auth, getRegularizationRequest);
router.patch("/update-regularization-request/:id", ...auth, updateRegularizationRequest);

export default router;
