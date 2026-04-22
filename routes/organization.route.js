import { Router } from "express";
import { create_organization_controller,
    //  update_organization_controller, delete_organization_controller, get_all_organizations_controller
     }
      from "../controllers/organization.controller.js";

const router = Router();

router.post("/create-organization", create_organization_controller);
// router.put("/update", update_organization_controller);
// router.delete("/delete", delete_organization_controller);
// router.get("/get-all", get_all_organizations_controller);

export default router;