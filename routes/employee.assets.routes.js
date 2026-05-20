import express from "express";

const router = express.Router();

import upload from "../middlewares/multer.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

import {
  add_assets_controller,
  update_assets_controller_using_patch,
  return_assets_of_employee_controller_using_patch,
  get_all_assets_controller,
  get_assets_by_user_controller,
  get_single_asset_controller,
} from "../controllers/asssets.controller.js";

router.get(
  "/list",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_all_assets_controller,
);

router.get(
  "/by-employee/:employee_user_id",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_assets_by_user_controller,
);

router.get(
  "/detail/:asset_id",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  get_single_asset_controller,
);

router.patch(
  "/return",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  return_assets_of_employee_controller_using_patch,
);

router.patch(
  "/update",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  upload.any(),
  update_assets_controller_using_patch,
);

router.post(
  "/add",
  user_validation_middleware,
  user_authorization("admin", "hr"),
  upload.any(),
  add_assets_controller,
);

export default router;
