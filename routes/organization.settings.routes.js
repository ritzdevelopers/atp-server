import { Router } from "express";
import user_validation_middleware from "../middlewares/user_validation_middleware.js";
import user_authorization from "../middlewares/user_authorization.js";
import {
  addCompanyIPAddressController,
  getAllIPAddressesController,
  updateCompanyIPLabelController,
  deleteCompanyIPAddressController,
  createCompanyWorkShiftsController,
  getAllShiftsController,
  updateCompanyShiftController,
  deleteCompanyShiftController,
  userAssignShiftController,
  addHolidayController,
  getAllHolidaysController,
  updateHolidayController,
  deleteHolidayController,
} from "../controllers/attendance.controller.js";
import { assign_ip_address_to_user_controller, unassign_ip_address_from_user_controller } from "../controllers/user.controller.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";


const router = Router();


// Company IP Address Routes
router.post("/create-new-ip-address", user_validation_middleware, user_authorization("admin", "hr"), addCompanyIPAddressController);
router.get("/get-ip-addresses", user_validation_middleware, user_authorization("admin", "hr"),  getAllIPAddressesController);
router.patch("/update-ip-address", user_validation_middleware, user_authorization("admin", "hr"), updateCompanyIPLabelController);
router.delete("/delete-ip-address", user_validation_middleware, user_authorization("admin", "hr"), deleteCompanyIPAddressController);

// User IP Address Routes
router.post("/assign-ip-address-to-user", user_validation_middleware, user_authorization("admin", "hr"), req_sender_auth, assign_ip_address_to_user_controller);
router.delete("/unassign-ip-address-from-user", user_validation_middleware, user_authorization("admin", "hr"), req_sender_auth, unassign_ip_address_from_user_controller);  


// Company shifts
router.get("/get-company-shifts", user_validation_middleware, user_authorization("admin", "hr"), getAllShiftsController);
router.post("/create-company-shifts", user_validation_middleware, user_authorization("admin", "hr"), createCompanyWorkShiftsController);
router.patch("/update-company-shift", user_validation_middleware, user_authorization("admin", "hr"), updateCompanyShiftController);
router.delete("/delete-company-shift", user_validation_middleware, user_authorization("admin", "hr"), deleteCompanyShiftController);
router.post("/assign-user-shift", user_validation_middleware, user_authorization("admin", "hr"), userAssignShiftController);

// Company holidays
router.get("/get-company-holidays", user_validation_middleware, user_authorization("admin", "hr"), getAllHolidaysController);
router.post("/create-company-holiday", user_validation_middleware, user_authorization("admin", "hr"), addHolidayController);
router.patch("/update-company-holiday", user_validation_middleware, user_authorization("admin", "hr"), updateHolidayController);
router.delete("/delete-company-holiday", user_validation_middleware, user_authorization("admin", "hr"), deleteHolidayController);

export default router;