import { Router } from "express";
import { create_feature_controller, assign_features_to_an_organization_controller, get_all_the_organizations_controller, get_all_the_features_controller } from "../controllers/atp.features.controller.js"; 
const router = Router();

// Create Features
router.post("/create-feature", create_feature_controller);

// Assign Features To An Organization
router.post("/assign-features-to-an-organization", assign_features_to_an_organization_controller);

// Get All Organizations
router.get("/get-all-organizations", get_all_the_organizations_controller);

// Get All Features
router.get("/get-all-features", get_all_the_features_controller);

export default router;