import express from "express";

const router = express.Router();

import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

import { create_bank_info_controller, update_bank_info_controller } from "../controllers/bank_info.controller.js";

router.post(
  "/create",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  create_bank_info_controller,
);

router.patch(
  "/update",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  update_bank_info_controller,
);

export default router;
