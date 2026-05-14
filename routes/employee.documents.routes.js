import express from "express";

const router = express.Router();

import upload from "../middlewares/multer.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

import {
  uploadEmployeeDocumentsController
} from "../controllers/employee.documents.controller.js";

router.post(
  "/upload-document",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  upload.any(),
  uploadEmployeeDocumentsController
);

export default router;