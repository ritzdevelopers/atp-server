import { Router } from "express";
import { mapUsers, getUsersForMapping } from "../controllers/map.users.controller.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";

const router = Router();

router.patch("/map-users", user_validation_middleware, req_sender_auth, mapUsers);
router.get("/get-users-for-mapping", user_validation_middleware, req_sender_auth, getUsersForMapping);

export default router;