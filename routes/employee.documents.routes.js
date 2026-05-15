import express from "express";

const router = express.Router();

import upload from "../middlewares/multer.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

import {
  uploadEmployeeDocumentsController,
  updateEmployeeDocumentsController,
  deleteEmployeeDocumentsController,
  getSingleUserAllDocumentsController,
} from "../controllers/employee.documents.controller.js";

router.post(
  "/upload-document",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  upload.any(),
  uploadEmployeeDocumentsController
);

router.patch(
  "/update-document",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  upload.single("file"),
  updateEmployeeDocumentsController
);

router.delete(
  "/delete-documents",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  deleteEmployeeDocumentsController
);

router.get(
  "/user/:user_id/documents",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  getSingleUserAllDocumentsController,
);

export default router;