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
  userUnassignShiftController,
  getUserShiftsController,
  addHolidayController,
  getAllHolidaysController,
  updateHolidayController,
  deleteHolidayController,
} from "../controllers/attendance.controller.js";
import { assign_ip_address_to_user_controller, unassign_ip_address_from_user_controller } from "../controllers/user.controller.js";
import req_sender_auth from "../middlewares/req_sender_auth.js";
import user_membership_checker from "../middlewares/user_membership_checker.js";
import user_feature_access_checker from "../middlewares/user_feature_access_checker.js";
import employee_feature_checker from "../middlewares/employee_feature_checker.js";
const router = Router();


// Company IP Address Routes
router.post("/create-new-ip-address", user_validation_middleware,  req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", 
  "create-new-ip-address", 
"create"), addCompanyIPAddressController);


router.get("/get-ip-addresses", user_validation_middleware,  req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", "manage-ip-addresses", "read"),  getAllIPAddressesController);
router.patch("/update-ip-address", user_validation_middleware,  req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", "manage-ip-addresses", "read"), updateCompanyIPLabelController);
router.delete("/delete-ip-address", user_validation_middleware,  req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", "manage-ip-addresses", "delete"), deleteCompanyIPAddressController);

// User IP Address Routes
router.post("/assign-ip-address-to-user", user_validation_middleware,  req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", "assign-ip-address-to-employee", "create"), assign_ip_address_to_user_controller);
router.delete("/unassign-ip-address-from-user", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-ip-addresses-management", "unassign-ip-address-from-employee", "update"),  unassign_ip_address_from_user_controller);  


// Company shifts
router.get("/get-company-shifts", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "manage-shifts", "read"), getAllShiftsController);
router.post("/create-company-shifts", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "create-new-shift", "create"), createCompanyWorkShiftsController);
router.patch("/update-company-shift", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "manage-shifts", "update"), updateCompanyShiftController);
router.delete("/delete-company-shift", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "manage-shifts", "delete"), deleteCompanyShiftController);

router.post("/assign-user-shift", user_validation_middleware, req_sender_auth, user_membership_checker, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "assign-employee", "create"), userAssignShiftController);
router.delete("/unassign-user-shift", user_validation_middleware, req_sender_auth, user_membership_checker, req_sender_auth, user_membership_checker, employee_feature_checker("company-shift-management", "un-assign-employee", "update"), userUnassignShiftController);
router.get("/get-user-shifts", user_validation_middleware, req_sender_auth, user_membership_checker, getUserShiftsController);
// Company holidays
router.get("/get-company-holidays", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-holiday-management", "manage-holidays", "read"), getAllHolidaysController);
router.post("/create-company-holiday", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-holiday-management", "manage-holidays", "create"), addHolidayController);
router.patch("/update-company-holiday", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-holiday-management", "manage-holidays", "update"), updateHolidayController);
router.delete("/delete-company-holiday", user_validation_middleware, req_sender_auth, user_membership_checker, employee_feature_checker("company-holiday-management", "manage-holidays", "delete"), deleteHolidayController);

export default router;