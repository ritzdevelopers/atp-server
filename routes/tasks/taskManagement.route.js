import { Router } from "express";
import user_validation_middleware from "../../middlewares/user_validation_middleware.js";
import req_sender_auth from "../../middlewares/req_sender_auth.js";
import user_membership_checker from "../../middlewares/user_membership_checker.js";
import employee_feature_checker from "../../middlewares/employee_feature_checker.js";
import {
  create_and_assign_task_to_employee,
  create_tasks_in_bulk,
  get_all_employees_task_with_filter_queries,
  get_all_tasks_created_by_me,
  get_all_tasks_assigned_to_me_as_a_reporting_manager,
  get_single_employee_all_tasks_with_filter_queries,
  get_single_task_information,
  get_my_all_tasks_with_filter_queries,
  update_task_information,
  update_task_status,
  update_task_complete_status,
  delete_task,
} from "../../controllers/tasks/task.management.controller.js";

const router = Router();

const manageTasksRead = employee_feature_checker(
  "task-management",
  "manage-employees-tasks",
  "read",
);

const manageTasksUpdate = employee_feature_checker(
  "task-management",
  "manage-employees-tasks",
  "update",
);

const manageTasksDelete = employee_feature_checker(
  "task-management",
  "manage-employees-tasks",
  "delete",
);

router.get(
  "/get-all-employees-tasks",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksRead,
  get_all_employees_task_with_filter_queries,
);

router.get(
  "/get-all-tasks-created-by-me",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksRead,
  get_all_tasks_created_by_me,
);

router.get(
  "/get-all-tasks-assigned-to-me-as-reporting-manager",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksRead,
  get_all_tasks_assigned_to_me_as_a_reporting_manager,
);

router.get(
  "/get-single-employee-tasks",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksRead,
  get_single_employee_all_tasks_with_filter_queries,
);

router.get(
  "/get-single-task-information/:task_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksRead,
  get_single_task_information,
);

router.get(
  "/get-my-tasks",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  get_my_all_tasks_with_filter_queries,
);

router.get(
  "/get-my-task-information/:task_id",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  get_single_task_information,
);

router.patch(
  "/update-task-status",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  update_task_status,
);

router.patch(
  "/update-task-information",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksUpdate,
  update_task_information,
);

router.patch(
  "/update-task-complete-status",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  update_task_complete_status,
);

router.delete(
  "/delete-task",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  manageTasksDelete,
  delete_task,
);

router.post(
  "/create-and-assign-task-to-employee",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "task-management",
    "assign-task-to-employees",
    "create",
  ),
  create_and_assign_task_to_employee,
);

router.post(
  "/create-tasks-in-bulk",
  user_validation_middleware,
  req_sender_auth,
  user_membership_checker,
  employee_feature_checker(
    "task-management",
    "assign-task-to-employees",
    "create",
  ),
  create_tasks_in_bulk,
);

export default router;
