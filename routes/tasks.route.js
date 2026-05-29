import { Router } from "express";
import { get_all_tasks, create_tasks, update_task, delete_task } from "../controllers/tasks.management.controller.js";
const router = Router();

router.get("/get-all-tasks", get_all_tasks);
router.post("/create-task", create_tasks);
router.put("/update-task", update_task);
router.delete("/delete-task", delete_task);

export default router;