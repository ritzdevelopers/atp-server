import { Router } from "express";
import { create_organization_controller } from "../controllers/organization.controller.js";
import { user_register_controller } from "../controllers/registeration.controller.js";

const router = Router();


router.post("/user", user_register_controller);
router.post("/organization", create_organization_controller);

export default router;
