import { Router } from "express";
import { create_new_sub_feature_controller, update_sub_feature_controller, get_all_sub_features_controller } from "../../controllers/super_admin/sub.feature.controller.js";
const router = Router();

router.post("/create-new-sub-feature", create_new_sub_feature_controller);
router.patch("/update-sub-feature", update_sub_feature_controller);
router.get("/get-all-sub-features", get_all_sub_features_controller );




export default router;