import { Router } from "express";
import {
  user_register_controller,
  user_login_controller,
  admin_get_me_controller,
} from "../controllers/user.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";

const router = Router();

router.post("/register", user_register_controller); // :: Tested and Working Fine ::
router.post("/login", user_login_controller); // :: Tested and Working Fine ::


router.get(
  "/admin/get-me",
  user_validation_middleware,
  user_authorization("admin"),
  admin_get_me_controller,
);

export default router;
