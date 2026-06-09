import express from "express";

const router = express.Router();

import upload from "../middlewares/multer.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import {
  uploadEmployeeDocumentsController,
  updateEmployeeDocumentsController,
  deleteEmployeeDocumentsController,
  getSingleUserAllDocumentsController,
} from "../controllers/employee.documents.controller.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";

router.post(
  "/upload-document",
  user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "manage-employee", "create"), upload.any(),
  uploadEmployeeDocumentsController
);

router.patch(
  "/update-document",
  user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "manage-employee", "update"),
  upload.single("file"),
  updateEmployeeDocumentsController
);

router.delete(
  "/delete-documents",
  user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "manage-employee", "delete"),
  deleteEmployeeDocumentsController
);

router.get(
  "/user/:user_id/documents",
  user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("employee-management", "manage-employee", "read"),
  getSingleUserAllDocumentsController,
);

export default router;