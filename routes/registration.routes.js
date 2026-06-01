import { Router } from "express";
import { create_organization_controller, create_organization_address_controller, get_organization_address_controller, update_organization_address_controller } from "../controllers/organization.controller.js";
import { user_register_controller } from "../controllers/registeration.controller.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";

const router = Router();


router.post("/user", user_register_controller);
router.post("/organization", create_organization_controller);
router.post("/add-organization-address", user_validation_middleware, req_sender_auth, create_organization_address_controller);
router.get("/get-organization-address", user_validation_middleware, req_sender_auth, get_organization_address_controller);
router.put("/update-organization-address", user_validation_middleware, req_sender_auth, update_organization_address_controller);
export default router;
