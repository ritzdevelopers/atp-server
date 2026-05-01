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


const router = Router();


// Company IP Address Routes
router.post("/create-new-ip-address", user_validation_middleware, user_authorization("admin", "hr"), addCompanyIPAddressController);
router.get("/get-ip-addresses", user_validation_middleware, user_authorization("admin", "hr"),  getAllIPAddressesController);
router.patch("/update-ip-address", user_validation_middleware, user_authorization("admin", "hr"), updateCompanyIPLabelController);
router.delete("/delete-ip-address", user_validation_middleware, user_authorization("admin", "hr"), deleteCompanyIPAddressController);


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