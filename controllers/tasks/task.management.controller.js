import { pool } from "../../db/connect.js";
import activity_tracker from "../../helper/activity_tracking.js";
import {
  getEmployeeName,
  isEmployeeExists,
  isTeamExists,
} from "../../helper/employee_checker.js";
import errorHandling from "../../utils/error.handling.js";

const ALLOWED_TASK_PRIORITIES = ["high", "medium", "low"];
const ALLOWED_TASK_STATUSES = [
  "pending",
  "received",
  "in-progress",
  "delay",
  "completed",
];
const EMPLOYEE_UPDATABLE_TASK_STATUSES = [
  "received",
  "in-progress",
  "delay",
  "completed",
];

const EMPLOYEE_TASK_STATUS_TRANSITIONS = {
  pending: ["received", "in-progress", "delay", "completed"],
  received: ["in-progress", "completed"],
  "in-progress": ["delay", "completed"],
  delay: ["in-progress", "completed"],
  completed: [],
};

const ALLOWED_COMPLETE_STATUSES = ["pending", "approved", "rejected"];
const MANAGER_PATCHABLE_COMPLETE_FIELDS = ["complete_status", "manager_remarks"];
const MANAGER_SETTABLE_COMPLETE_STATUSES = ["approved", "rejected"];

const TASK_LIST_SORT_COLUMNS = {
  id: "et.id",
  task_title: "et.task_title",
  task_status: "et.task_status",
  task_priority: "et.task_priority",
  complete_status: "et.complete_status",
  employee_id: "et.employee_id",
  assigned_by_id: "et.assigned_by",
  assigned_by: "et.assigned_by",
  reporting_manager_id: "et.reporting_manager",
  reporting_manager: "et.reporting_manager",
  task_start_date: "et.task_start_date",
  task_deadline: "et.task_deadline",
  employee_completed_at: "et.employee_completed_at",
  created_at: "et.created_at",
  updated_at: "et.updated_at",
};

function normalizeSortDirection(is_ascending, sort) {
  const raw = is_ascending ?? sort ?? "DESC";
  return String(raw).trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function normalizeSortBy(sort_by) {
  const key = String(sort_by || "created_at")
    .trim()
    .toLowerCase();
  return TASK_LIST_SORT_COLUMNS[key] ? key : "created_at";
}

function appendDateFilter(column, value, filters, params) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    filters.push(`DATE(${column}) = DATE(?)`);
    params.push(raw);
    return;
  }
  filters.push(`${column} = ?`);
  params.push(raw);
}

function appendDateFromFilter(column, value, filters, params) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return;
  }
  filters.push(`DATE(${column}) >= DATE(?)`);
  params.push(String(value).trim());
}

function appendDateToFilter(column, value, filters, params) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return;
  }
  filters.push(`DATE(${column}) <= DATE(?)`);
  params.push(String(value).trim());
}

function buildTaskListMeta(query, sortKey, sortDirection, total, extra = {}) {
  return {
    total,
    sort_by: sortKey,
    sort_direction: sortDirection,
    filters: {
      task_status: query.task_status ?? null,
      task_priority: query.task_priority ?? null,
      reporting_manager_id: query.reporting_manager_id ?? null,
      assigned_by_id: query.assigned_by_id ?? null,
      employee_id: query.employee_id ?? null,
      complete_status: query.complete_status ?? null,
      task_start_date: query.task_start_date ?? null,
      task_deadline: query.task_deadline ?? null,
      start_date: query.start_date ?? null,
      end_date: query.end_date ?? null,
      employee_completed_at: query.employee_completed_at ?? null,
    },
    ...extra,
  };
}

function buildEmployeeTasksListQuery(org_id, query = {}, options = {}) {
  const {
    task_status,
    task_priority,
    reporting_manager_id,
    assigned_by_id,
    employee_id,
    complete_status,
    task_start_date,
    task_deadline,
    start_date,
    end_date,
    task_complete_status,
    employee_completed_at,
    sort_by,
    is_ascending,
    sort,
  } = query;
  const resolvedCompleteStatus = complete_status ?? task_complete_status;
  const { scopedAssignedById, scopedReportingManagerId, scopedEmployeeId } =
    options;

  const filters = ["et.org_id = ?"];
  const params = [org_id];

  if (task_status) {
    const normalized = normalizeTaskStatus(task_status);
    if (!normalized) {
      throw createTaskValidationError(
        "task_status must be one of: pending, received, in-progress, delay, completed",
      );
    }
    filters.push("et.task_status = ?");
    params.push(normalized);
  }

  if (task_priority) {
    const normalized = normalizeTaskPriority(task_priority);
    if (!normalized) {
      throw createTaskValidationError(
        "task_priority must be one of: high, medium, low",
      );
    }
    filters.push("et.task_priority = ?");
    params.push(normalized);
  }

  if (resolvedCompleteStatus) {
    const normalized = normalizeCompleteStatus(resolvedCompleteStatus);
    if (!normalized) {
      throw createTaskValidationError(
        "complete_status must be one of: pending, approved, rejected",
      );
    }
    filters.push("et.complete_status = ?");
    params.push(normalized);
  }

  if (scopedEmployeeId) {
    filters.push("et.employee_id = ?");
    params.push(Number(scopedEmployeeId));
  } else if (employee_id) {
    filters.push("et.employee_id = ?");
    params.push(Number(employee_id));
  }

  if (scopedAssignedById) {
    filters.push("et.assigned_by = ?");
    params.push(Number(scopedAssignedById));
  } else if (assigned_by_id) {
    filters.push("et.assigned_by = ?");
    params.push(Number(assigned_by_id));
  }

  if (scopedReportingManagerId) {
    filters.push("et.reporting_manager = ?");
    params.push(Number(scopedReportingManagerId));
  } else if (reporting_manager_id) {
    filters.push("et.reporting_manager = ?");
    params.push(Number(reporting_manager_id));
  }

  appendDateFilter("et.task_start_date", task_start_date, filters, params);
  appendDateFilter("et.task_deadline", task_deadline, filters, params);
  appendDateFromFilter("et.task_start_date", start_date, filters, params);
  appendDateToFilter("et.task_deadline", end_date, filters, params);
  appendDateFilter(
    "et.employee_completed_at",
    employee_completed_at,
    filters,
    params,
  );

  const sortKey = normalizeSortBy(sort_by);
  const sortColumn = TASK_LIST_SORT_COLUMNS[sortKey];
  const sortDirection = normalizeSortDirection(is_ascending, sort);

  const sql = `
    SELECT
      et.id AS task_id,
      et.employee_id,
      et.org_id,
      et.team_id,
      et.assigned_by AS assigned_by_id,
      et.reporting_manager AS reporting_manager_id,
      et.task_title,
      et.task_description,
      et.task_priority,
      et.task_status,
      et.complete_status,
      et.task_start_date,
      et.task_deadline,
      et.employee_completed_at,
      et.manager_remarks,
      et.created_at,
      et.updated_at,
      employee.user_name AS employee_name,
      employee.user_image AS employee_profile_image,
      assigner.user_name AS assigned_by_name,
      assigner.user_image AS assigned_by_profile_image,
      manager.user_name AS reporting_manager_name,
      manager.user_image AS reporting_manager_profile_image
    FROM employee_tasks et
    INNER JOIN apt_users employee
      ON employee.id = et.employee_id
    INNER JOIN apt_users assigner
      ON assigner.id = et.assigned_by
    INNER JOIN apt_users manager
      ON manager.id = et.reporting_manager
    WHERE ${filters.join(" AND ")}
    ORDER BY ${sortColumn} ${sortDirection}, et.id ${sortDirection}
  `;

  return { sql, params, sortKey, sortDirection };
}

function normalizeCompleteStatus(complete_status) {
  if (complete_status === undefined || complete_status === null) {
    return null;
  }
  const normalized = String(complete_status).trim().toLowerCase();
  return ALLOWED_COMPLETE_STATUSES.includes(normalized) ? normalized : null;
}

function completeStatusFieldLabel(index) {
  return index === undefined ? "" : `Task review #${index + 1}: `;
}

function getSentCompleteStatusPatchFields(body) {
  return MANAGER_PATCHABLE_COMPLETE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
}

function normalizeTaskStatus(task_status) {
  if (task_status === undefined || task_status === null) {
    return null;
  }
  const normalized = String(task_status).trim().toLowerCase();
  return ALLOWED_TASK_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeTaskPriority(task_priority) {
  if (
    task_priority === undefined ||
    task_priority === null ||
    String(task_priority).trim() === ""
  ) {
    return "medium";
  }
  const normalized = String(task_priority).trim().toLowerCase();
  return ALLOWED_TASK_PRIORITIES.includes(normalized) ? normalized : null;
}

function createTaskValidationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function taskFieldLabel(index) {
  return index === undefined ? "" : `Task #${index + 1}: `;
}

async function resolveEmployeeName(connection, userId, org_id, nameCache) {
  const cacheKey = String(userId);
  if (nameCache.has(cacheKey)) {
    return nameCache.get(cacheKey);
  }
  const { name } = await getEmployeeName(connection, userId, org_id);
  nameCache.set(cacheKey, name);
  return name;
}

async function validateAndResolveTaskInput(
  connection,
  taskInput,
  assigned_by,
  org_id,
  index,
) {
  const prefix = taskFieldLabel(index);
  const {
    employee_id,
    team_id,
    reporting_manager,
    task_title,
    task_description,
    task_start_date,
    task_deadline,
    task_priority,
  } = taskInput;

  if (!employee_id) {
    throw createTaskValidationError(`${prefix}employee_id is required`);
  }
  if (!task_title || String(task_title).trim() === "") {
    throw createTaskValidationError(`${prefix}task_title is required`);
  }
  if (!task_start_date) {
    throw createTaskValidationError(`${prefix}task_start_date is required`);
  }
  if (!task_deadline) {
    throw createTaskValidationError(`${prefix}task_deadline is required`);
  }

  const resolvedPriority = normalizeTaskPriority(task_priority);
  if (!resolvedPriority) {
    throw createTaskValidationError(
      `${prefix}Task Priority Must Be One Of: high, medium, low`,
    );
  }

  if (!(await isEmployeeExists(connection, employee_id, org_id))) {
    throw createTaskValidationError(`${prefix}Employee Not Found !`, 404);
  }

  const resolvedTeamId = team_id ?? null;
  const resolvedReportingManager = resolvedTeamId
    ? reporting_manager
    : assigned_by;

  if (resolvedTeamId && !reporting_manager) {
    throw createTaskValidationError(
      `${prefix}reporting_manager is required when team_id is provided`,
    );
  }

  if (
    resolvedTeamId &&
    !(await isEmployeeExists(connection, reporting_manager, org_id))
  ) {
    throw createTaskValidationError(
      `${prefix}Reporting Manager Not Found !`,
      404,
    );
  }

  if (new Date(task_deadline) < new Date(task_start_date)) {
    throw createTaskValidationError(
      `${prefix}Task Deadline Cannot Be Less Than Task Start Date !`,
    );
  }

  if (new Date(task_deadline) < new Date()) {
    throw createTaskValidationError(
      `${prefix}Task Deadline Cannot Be Less Than Current Date !`,
    );
  }

  if (resolvedTeamId) {
    if (
      !(await isTeamExists(
        connection,
        employee_id,
        org_id,
        resolvedTeamId,
        reporting_manager,
      ))
    ) {
      throw createTaskValidationError(
        `${prefix}Employee Not Found In The Team !`,
        404,
      );
    }
  }

  return {
    employee_id,
    task_title,
    task_description,
    task_start_date,
    task_deadline,
    resolvedTeamId,
    resolvedReportingManager,
    resolvedPriority,
  };
}

async function insertEmployeeTaskWithActivity(
  connection,
  {
    employee_id,
    resolvedTeamId,
    resolvedReportingManager,
    task_title,
    task_description,
    resolvedPriority,
    task_start_date,
    task_deadline,
    assigned_by,
    org_id,
  },
  nameCache,
) {
  const [task] = await connection.query(
    `
    INSERT INTO employee_tasks (
      employee_id,
      team_id,
      reporting_manager,
      task_title,
      task_description,
      task_priority,
      task_start_date,
      task_deadline,
      assigned_by,
      org_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      employee_id,
      resolvedTeamId,
      resolvedReportingManager,
      task_title,
      task_description,
      resolvedPriority,
      task_start_date,
      task_deadline,
      assigned_by,
      org_id,
    ],
  );

  if (task.affectedRows === 0) {
    throw createTaskValidationError("Failed To Create Task !", 500);
  }

  const assigned_by_name = await resolveEmployeeName(
    connection,
    assigned_by,
    org_id,
    nameCache,
  );
  const employee_name = await resolveEmployeeName(
    connection,
    employee_id,
    org_id,
    nameCache,
  );
  const reporting_manager_name = await resolveEmployeeName(
    connection,
    resolvedReportingManager,
    org_id,
    nameCache,
  );

  await activity_tracker(
    connection,
    assigned_by,
    assigned_by_name,
    `Created A New Task And Assigned To The Employee ${employee_name} And The Task Is ${task_title} Reported To The Reporting Manager ${reporting_manager_name}`,
    org_id,
    "TASK_CREATED_AND_ASSIGNED",
  );

  return task.insertId;
}

const PATCHABLE_TASK_FIELDS = [
  "employee_id",
  "team_id",
  "reporting_manager",
  "task_title",
  "task_description",
  "task_start_date",
  "task_deadline",
  "task_priority",
];

const FORBIDDEN_TASK_UPDATE_FIELDS = [
  "task_status",
  "complete_status",
  "employee_completed_at",
  "manager_remarks",
  "assigned_by",
  "org_id",
];

function getSentPatchFields(body) {
  return PATCHABLE_TASK_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
}

function mergeTaskPatchPayload(existingTask, taskPayload, sentFields) {
  const merged = {
    employee_id: existingTask.employee_id,
    team_id: existingTask.team_id,
    reporting_manager: existingTask.reporting_manager,
    task_title: existingTask.task_title,
    task_description: existingTask.task_description,
    task_start_date: existingTask.task_start_date,
    task_deadline: existingTask.task_deadline,
    task_priority: existingTask.task_priority,
  };

  for (const field of sentFields) {
    if (field === "team_id") {
      merged.team_id = taskPayload.team_id ?? null;
    } else {
      merged[field] = taskPayload[field];
    }
  }

  return merged;
}

async function validateAndResolveTaskPatchInput(
  connection,
  taskPayload,
  existingTask,
  assigned_by,
  org_id,
) {
  const sentFields = getSentPatchFields(taskPayload);
  if (sentFields.length === 0) {
    throw createTaskValidationError("At least one updatable field is required");
  }

  const merged = mergeTaskPatchPayload(existingTask, taskPayload, sentFields);

  if (sentFields.includes("task_title")) {
    if (!merged.task_title || String(merged.task_title).trim() === "") {
      throw createTaskValidationError("task_title cannot be empty");
    }
  }

  if (sentFields.includes("task_priority")) {
    const normalized = normalizeTaskPriority(merged.task_priority);
    if (!normalized) {
      throw createTaskValidationError(
        "Task Priority Must Be One Of: high, medium, low",
      );
    }
    merged.task_priority = normalized;
  }

  if (sentFields.includes("employee_id")) {
    if (!(await isEmployeeExists(connection, merged.employee_id, org_id))) {
      throw createTaskValidationError("Employee Not Found !", 404);
    }
  }

  const resolvedTeamId = merged.team_id ?? null;
  const teamIdSent = sentFields.includes("team_id");
  const reportingManagerSent = sentFields.includes("reporting_manager");

  let resolvedReportingManager;
  if (!resolvedTeamId) {
    resolvedReportingManager = assigned_by;
  } else if (reportingManagerSent) {
    resolvedReportingManager = merged.reporting_manager;
  } else if (
    teamIdSent &&
    Number(existingTask.team_id || 0) !== Number(resolvedTeamId)
  ) {
    throw createTaskValidationError(
      "reporting_manager is required when team_id is changed",
    );
  } else {
    resolvedReportingManager = merged.reporting_manager;
  }

  if (
    (reportingManagerSent || teamIdSent) &&
    resolvedTeamId &&
    !(await isEmployeeExists(connection, resolvedReportingManager, org_id))
  ) {
    throw createTaskValidationError("Reporting Manager Not Found !", 404);
  }

  if (
    sentFields.includes("task_start_date") ||
    sentFields.includes("task_deadline")
  ) {
    if (new Date(merged.task_deadline) < new Date(merged.task_start_date)) {
      throw createTaskValidationError(
        "Task Deadline Cannot Be Less Than Task Start Date !",
      );
    }
  }

  if (sentFields.includes("task_deadline")) {
    if (new Date(merged.task_deadline) < new Date()) {
      throw createTaskValidationError(
        "Task Deadline Cannot Be Less Than Current Date !",
      );
    }
  }

  if (
    resolvedTeamId &&
    (sentFields.includes("employee_id") ||
      sentFields.includes("team_id") ||
      sentFields.includes("reporting_manager"))
  ) {
    if (
      !(await isTeamExists(
        connection,
        merged.employee_id,
        org_id,
        resolvedTeamId,
        resolvedReportingManager,
      ))
    ) {
      throw createTaskValidationError("Employee Not Found In The Team !", 404);
    }
  }

  const updatedFields = new Set(sentFields);
  if (teamIdSent) {
    updatedFields.add("reporting_manager");
  }

  return {
    employee_id: merged.employee_id,
    task_title: merged.task_title,
    task_description: merged.task_description,
    task_start_date: merged.task_start_date,
    task_deadline: merged.task_deadline,
    resolvedTeamId,
    resolvedReportingManager,
    resolvedPriority: merged.task_priority,
    updatedFields: [...updatedFields],
  };
}

function assertNoForbiddenTaskUpdateFields(body) {
  for (const field of FORBIDDEN_TASK_UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      throw createTaskValidationError(
        `${field} cannot be updated through this endpoint`,
      );
    }
  }
}

async function isOrgOwner(connection, org_id, user_id) {
  const [rows] = await connection.query(
    `SELECT id FROM apt_organizations WHERE id = ? AND owner_id = ?`,
    [org_id, user_id],
  );
  return rows.length > 0;
}

function canViewSingleTaskInformation(task, action_user_id, isOwner) {
  if (isOwner) return true;
  if (Number(task.employee_id) === Number(action_user_id)) return true;
  if (Number(task.assigned_by_id) === Number(action_user_id)) return true;
  if (Number(task.reporting_manager_id) === Number(action_user_id)) return true;
  return false;
}

async function fetchSingleTaskInformation(
  connection,
  task_id,
  org_id,
  employee_id,
) {
  const filters = ["et.id = ?", "et.org_id = ?"];
  const params = [task_id, org_id];

  if (employee_id) {
    filters.push("et.employee_id = ?");
    params.push(Number(employee_id));
  }

  const [rows] = await connection.query(
    `
    SELECT
      et.id AS task_id,
      et.employee_id,
      et.org_id,
      et.team_id,
      et.assigned_by AS assigned_by_id,
      et.reporting_manager AS reporting_manager_id,
      et.task_title,
      et.task_description,
      et.task_priority,
      et.task_status,
      et.complete_status,
      et.task_start_date,
      et.task_deadline,
      et.employee_completed_at,
      et.manager_remarks,
      et.created_at,
      et.updated_at,
      employee.user_name AS employee_name,
      employee.user_image AS employee_profile_image,
      assigner.user_name AS assigned_by_name,
      assigner.user_image AS assigned_by_profile_image,
      manager.user_name AS reporting_manager_name,
      manager.user_image AS reporting_manager_profile_image
    FROM employee_tasks et
    INNER JOIN apt_users employee
      ON employee.id = et.employee_id
    INNER JOIN apt_users assigner
      ON assigner.id = et.assigned_by
    INNER JOIN apt_users manager
      ON manager.id = et.reporting_manager
    WHERE ${filters.join(" AND ")}
    LIMIT 1
    `,
    params,
  );

  if (!rows.length) {
    throw createTaskValidationError("Task Not Found !", 404);
  }

  return rows[0];
}

async function getTaskAssignedToEmployee(
  connection,
  task_id,
  org_id,
  employee_id,
) {
  if (!(await isEmployeeExists(connection, employee_id, org_id))) {
    throw createTaskValidationError("Unauthorized", 401);
  }

  const [rows] = await connection.query(
    `
    SELECT
      id,
      employee_id,
      task_status,
      complete_status,
      task_start_date,
      task_deadline,
      employee_completed_at
    FROM employee_tasks
    WHERE id = ? AND org_id = ? AND employee_id = ?
    `,
    [task_id, org_id, employee_id],
  );

  if (!rows.length) {
    throw createTaskValidationError("Task Not Found !", 404);
  }

  return rows[0];
}

function validateEmployeeTaskStatusTransition(existingStatus, nextStatus) {
  if (existingStatus === nextStatus) {
    throw createTaskValidationError(
      `Task is already marked as ${nextStatus}`,
      400,
    );
  }

  const allowedNextStatuses =
    EMPLOYEE_TASK_STATUS_TRANSITIONS[existingStatus] || [];

  if (!allowedNextStatuses.includes(nextStatus)) {
    throw createTaskValidationError(
      `Cannot change task status from ${existingStatus} to ${nextStatus}`,
      400,
    );
  }
}

async function getTaskOwnedByCreator(connection, task_id, org_id, creator_id) {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      employee_id,
      team_id,
      reporting_manager,
      task_title,
      task_description,
      task_priority,
      task_status,
      complete_status,
      task_start_date,
      task_deadline,
      assigned_by,
      org_id
    FROM employee_tasks
    WHERE id = ? AND org_id = ?
    `,
    [task_id, org_id],
  );

  if (!rows.length) {
    throw createTaskValidationError("Task Not Found !", 404);
  }

  const task = rows[0];
  if (Number(task.assigned_by) !== Number(creator_id)) {
    throw createTaskValidationError(
      "Only the task creator can update this task",
      403,
    );
  }

  if (task.task_status === "completed") {
    throw createTaskValidationError(
      "Completed tasks cannot be updated through this endpoint",
      400,
    );
  }

  if (task.complete_status !== "pending") {
    throw createTaskValidationError(
      "Tasks with manager review status cannot be updated through this endpoint",
      400,
    );
  }

  return task;
}

function normalizeTaskIds(task_ids, task_id) {
  const rawIds = Array.isArray(task_ids)
    ? task_ids
    : task_id !== undefined && task_id !== null
      ? [task_id]
      : [];

  const uniqueIds = [
    ...new Set(
      rawIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  return uniqueIds;
}

async function deleteTasksOwnedByCreator(
  connection,
  taskIds,
  creator_id,
  org_id,
  nameCache,
) {
  const placeholders = taskIds.map(() => "?").join(", ");
  const [tasks] = await connection.query(
    `
    SELECT
      id,
      employee_id,
      task_title,
      task_status,
      complete_status,
      assigned_by
    FROM employee_tasks
    WHERE id IN (${placeholders}) AND org_id = ?
    `,
    [...taskIds, org_id],
  );

  if (tasks.length !== taskIds.length) {
    const foundIds = new Set(tasks.map((task) => Number(task.id)));
    const missingIds = taskIds.filter((id) => !foundIds.has(id));
    throw createTaskValidationError(
      `Task(s) not found: ${missingIds.join(", ")}`,
      404,
    );
  }

  for (const task of tasks) {
    if (Number(task.assigned_by) !== Number(creator_id)) {
      throw createTaskValidationError(
        `Only the task creator can delete task #${task.id}`,
        403,
      );
    }

    if (task.complete_status !== "pending") {
      throw createTaskValidationError(
        `Task #${task.id} cannot be deleted after manager review`,
        400,
      );
    }
  }

  const [deleteResult] = await connection.query(
    `
    DELETE FROM employee_tasks
    WHERE id IN (${placeholders}) AND org_id = ? AND assigned_by = ?
    `,
    [...taskIds, org_id, creator_id],
  );

  if (deleteResult.affectedRows !== taskIds.length) {
    throw createTaskValidationError("Failed To Delete Task(s) !", 500);
  }

  const creator_name = await resolveEmployeeName(
    connection,
    creator_id,
    org_id,
    nameCache,
  );

  for (const task of tasks) {
    const employee_name = await resolveEmployeeName(
      connection,
      task.employee_id,
      org_id,
      nameCache,
    );

    await activity_tracker(
      connection,
      creator_id,
      creator_name,
      `Deleted task #${task.id} titled "${task.task_title}" assigned to employee ${employee_name}`,
      org_id,
      "TASK_DELETED",
    );
  }

  return tasks.map((task) => ({
    task_id: task.id,
    task_title: task.task_title,
    employee_id: task.employee_id,
  }));
}

async function getTaskForCompleteStatusReview(
  connection,
  task_id,
  org_id,
  action_user_id,
) {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      employee_id,
      assigned_by,
      reporting_manager,
      task_title,
      task_status,
      complete_status,
      employee_completed_at,
      manager_remarks
    FROM employee_tasks
    WHERE id = ? AND org_id = ?
    `,
    [task_id, org_id],
  );

  if (!rows.length) {
    throw createTaskValidationError("Task Not Found !", 404);
  }

  const task = rows[0];
  const isCreator = Number(task.assigned_by) === Number(action_user_id);
  const isReportingManager =
    Number(task.reporting_manager) === Number(action_user_id);

  if (!isCreator && !isReportingManager) {
    throw createTaskValidationError(
      "Only the task creator or reporting manager can review this task",
      403,
    );
  }

  return task;
}

function compareDateTimeValues(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

async function validateAndResolveCompleteStatusPatch(
  patchPayload,
  existingTask,
  index,
) {
  const prefix = completeStatusFieldLabel(index);
  const sentFields = getSentCompleteStatusPatchFields(patchPayload);

  if (sentFields.length === 0) {
    throw createTaskValidationError(
      `${prefix}At least one of complete_status or manager_remarks is required`,
    );
  }

  if (!patchPayload.task_id) {
    throw createTaskValidationError(`${prefix}task_id is required`);
  }

  if (!patchPayload.employee_id) {
    throw createTaskValidationError(`${prefix}employee_id is required`);
  }

  if (
    Number(existingTask.employee_id) !== Number(patchPayload.employee_id)
  ) {
    throw createTaskValidationError(
      `${prefix}employee_id does not match the assigned task employee`,
      400,
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(patchPayload, "employee_completed_at")
  ) {
    if (
      !compareDateTimeValues(
        existingTask.employee_completed_at,
        patchPayload.employee_completed_at,
      )
    ) {
      throw createTaskValidationError(
        `${prefix}employee_completed_at does not match task records`,
        400,
      );
    }
  }

  const merged = {
    complete_status: existingTask.complete_status,
    manager_remarks: existingTask.manager_remarks,
  };

  for (const field of sentFields) {
    merged[field] = patchPayload[field];
  }

  if (sentFields.includes("complete_status")) {
    const normalizedStatus = normalizeCompleteStatus(merged.complete_status);
    if (!normalizedStatus) {
      throw createTaskValidationError(
        `${prefix}complete_status must be one of: pending, approved, rejected`,
      );
    }

    if (!MANAGER_SETTABLE_COMPLETE_STATUSES.includes(normalizedStatus)) {
      throw createTaskValidationError(
        `${prefix}complete_status must be approved or rejected`,
      );
    }

    if (existingTask.complete_status === normalizedStatus) {
      throw createTaskValidationError(
        `${prefix}Task complete_status is already ${normalizedStatus}`,
        400,
      );
    }

    if (existingTask.complete_status !== "pending") {
      throw createTaskValidationError(
        `${prefix}Task complete_status has already been reviewed`,
        400,
      );
    }

    if (existingTask.task_status !== "completed") {
      throw createTaskValidationError(
        `${prefix}Task must be completed by the employee before review`,
        400,
      );
    }

    if (!existingTask.employee_completed_at) {
      throw createTaskValidationError(
        `${prefix}employee_completed_at is required before review`,
        400,
      );
    }

    merged.complete_status = normalizedStatus;
  }

  if (sentFields.includes("manager_remarks")) {
    const remarks = merged.manager_remarks;
    merged.manager_remarks =
      remarks === undefined || remarks === null
        ? null
        : String(remarks).trim() || null;
  }

  return {
    updatedFields: sentFields,
    complete_status: merged.complete_status,
    manager_remarks: merged.manager_remarks,
  };
}

function buildCompleteStatusActivityOverview(
  existingTask,
  resolvedPatch,
  employee_name,
  reviewer_name,
) {
  const changes = [];

  if (
    resolvedPatch.updatedFields.includes("complete_status") &&
    existingTask.complete_status !== resolvedPatch.complete_status
  ) {
    changes.push(
      `complete_status changed from ${existingTask.complete_status} to ${resolvedPatch.complete_status}`,
    );
  }

  if (resolvedPatch.complete_status === "rejected") {
    changes.push("task_status reset from completed to pending");
  }

  if (resolvedPatch.updatedFields.includes("manager_remarks")) {
    const oldRemarks = existingTask.manager_remarks || "none";
    const newRemarks = resolvedPatch.manager_remarks || "none";
    if (oldRemarks !== newRemarks) {
      changes.push(`manager_remarks updated from "${oldRemarks}" to "${newRemarks}"`);
    }
  }

  const changeSummary =
    changes.length > 0 ? changes.join("; ") : "no field changes detected";

  return `Reviewed task #${existingTask.id} titled "${existingTask.task_title}" for employee ${employee_name} by ${reviewer_name}. ${changeSummary}`;
}

async function patchTaskCompleteStatusWithActivity(
  connection,
  task_id,
  existingTask,
  resolvedPatch,
  action_user_id,
  org_id,
  nameCache,
) {
  const valueByField = {
    complete_status: resolvedPatch.complete_status,
    manager_remarks: resolvedPatch.manager_remarks,
  };

  const setParts = resolvedPatch.updatedFields.map((field) => `${field} = ?`);
  const values = resolvedPatch.updatedFields.map((field) => valueByField[field]);

  const isRejected = resolvedPatch.complete_status === "rejected";
  if (isRejected) {
    setParts.push("task_status = ?", "employee_completed_at = ?");
    values.push("pending", null);
  }

  const [result] = await connection.query(
    `
    UPDATE employee_tasks
    SET ${setParts.join(", ")}
    WHERE id = ? AND org_id = ?
    `,
    [...values, task_id, org_id],
  );

  if (result.affectedRows === 0) {
    const [rows] = await connection.query(
      `SELECT id FROM employee_tasks WHERE id = ? AND org_id = ?`,
      [task_id, org_id],
    );
    if (!rows.length) {
      throw createTaskValidationError("Failed To Update Task Complete Status !", 500);
    }
  }

  const reviewer_name = await resolveEmployeeName(
    connection,
    action_user_id,
    org_id,
    nameCache,
  );
  const employee_name = await resolveEmployeeName(
    connection,
    existingTask.employee_id,
    org_id,
    nameCache,
  );

  await activity_tracker(
    connection,
    action_user_id,
    reviewer_name,
    buildCompleteStatusActivityOverview(
      existingTask,
      resolvedPatch,
      employee_name,
      reviewer_name,
    ),
    org_id,
    "TASK_COMPLETE_STATUS_UPDATED",
  );

  return {
    task_id: Number(task_id),
    employee_id: existingTask.employee_id,
    complete_status: resolvedPatch.complete_status,
    manager_remarks: resolvedPatch.manager_remarks,
    task_status: isRejected ? "pending" : existingTask.task_status,
  };
}

function formatTaskDateForLog(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function buildTaskUpdateActivityOverview(
  existingTask,
  resolvedTask,
  employee_name,
  updatedFields,
) {
  const changes = [];
  const shouldLog = (field) => updatedFields.includes(field);

  if (
    shouldLog("employee_id") &&
    Number(existingTask.employee_id) !== Number(resolvedTask.employee_id)
  ) {
    changes.push(
      `employee changed from ${existingTask.employee_id} to ${resolvedTask.employee_id}`,
    );
  }
  if (
    shouldLog("team_id") &&
    Number(existingTask.team_id || 0) !==
      Number(resolvedTask.resolvedTeamId || 0)
  ) {
    changes.push(
      `team changed from ${existingTask.team_id ?? "none"} to ${resolvedTask.resolvedTeamId ?? "none"}`,
    );
  }
  if (
    shouldLog("reporting_manager") &&
    Number(existingTask.reporting_manager) !==
      Number(resolvedTask.resolvedReportingManager)
  ) {
    changes.push(
      `reporting manager changed from ${existingTask.reporting_manager} to ${resolvedTask.resolvedReportingManager}`,
    );
  }
  if (
    shouldLog("task_title") &&
    existingTask.task_title !== resolvedTask.task_title
  ) {
    changes.push(
      `title changed from "${existingTask.task_title}" to "${resolvedTask.task_title}"`,
    );
  }
  if (
    shouldLog("task_description") &&
    (existingTask.task_description || "") !==
      (resolvedTask.task_description || "")
  ) {
    changes.push("description updated");
  }
  if (
    shouldLog("task_priority") &&
    existingTask.task_priority !== resolvedTask.resolvedPriority
  ) {
    changes.push(
      `priority changed from ${existingTask.task_priority} to ${resolvedTask.resolvedPriority}`,
    );
  }
  if (
    shouldLog("task_start_date") &&
    formatTaskDateForLog(existingTask.task_start_date) !==
      formatTaskDateForLog(resolvedTask.task_start_date)
  ) {
    changes.push(
      `start date changed from ${formatTaskDateForLog(existingTask.task_start_date)} to ${formatTaskDateForLog(resolvedTask.task_start_date)}`,
    );
  }
  if (
    shouldLog("task_deadline") &&
    formatTaskDateForLog(existingTask.task_deadline) !==
      formatTaskDateForLog(resolvedTask.task_deadline)
  ) {
    changes.push(
      `deadline changed from ${formatTaskDateForLog(existingTask.task_deadline)} to ${formatTaskDateForLog(resolvedTask.task_deadline)}`,
    );
  }

  const changeSummary =
    changes.length > 0 ? changes.join("; ") : "no field changes detected";

  return `Updated task #${existingTask.id} for employee ${employee_name} (${resolvedTask.task_title}). ${changeSummary}`;
}

async function updateEmployeeTaskWithActivity(
  connection,
  task_id,
  existingTask,
  resolvedTask,
  updatedFields,
  updated_by,
  org_id,
  nameCache,
) {
  const valueByField = {
    employee_id: resolvedTask.employee_id,
    team_id: resolvedTask.resolvedTeamId,
    reporting_manager: resolvedTask.resolvedReportingManager,
    task_title: resolvedTask.task_title,
    task_description: resolvedTask.task_description ?? null,
    task_priority: resolvedTask.resolvedPriority,
    task_start_date: resolvedTask.task_start_date,
    task_deadline: resolvedTask.task_deadline,
  };

  const setClause = updatedFields.map((field) => `${field} = ?`).join(", ");
  const values = [
    ...updatedFields.map((field) => valueByField[field]),
    task_id,
    org_id,
    updated_by,
  ];

  const [result] = await connection.query(
    `
    UPDATE employee_tasks
    SET ${setClause}
    WHERE id = ? AND org_id = ? AND assigned_by = ?
    `,
    values,
  );

  if (result.affectedRows === 0) {
    const [rows] = await connection.query(
      `
      SELECT id
      FROM employee_tasks
      WHERE id = ? AND org_id = ? AND assigned_by = ?
      `,
      [task_id, org_id, updated_by],
    );
    if (!rows.length) {
      throw createTaskValidationError("Failed To Update Task !", 500);
    }
  }

  const updated_by_name = await resolveEmployeeName(
    connection,
    updated_by,
    org_id,
    nameCache,
  );
  const employee_name = await resolveEmployeeName(
    connection,
    resolvedTask.employee_id,
    org_id,
    nameCache,
  );

  await activity_tracker(
    connection,
    updated_by,
    updated_by_name,
    buildTaskUpdateActivityOverview(
      existingTask,
      resolvedTask,
      employee_name,
      updatedFields,
    ),
    org_id,
    "TASK_INFORMATION_UPDATED",
  );

  return task_id;
}

export const create_and_assign_task_to_employee = async (req, res) => {
  // Used By Task Creator Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: assigned_by } = req.user;
    const { org_id } = req;

    const resolvedTask = await validateAndResolveTaskInput(
      connection,
      req.body,
      assigned_by,
      org_id,
    );

    const task_id = await insertEmployeeTaskWithActivity(
      connection,
      { ...resolvedTask, assigned_by, org_id },
      new Map(),
    );

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Task Created And Assigned To The Employee Successfully !",
      data: { task_id },
    });
  } catch (error) {
    console.log("Error in create_and_assign_task_to_employee: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Create And Assign Task To Employee !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Failed To Create And Assign Task To Employee !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Create Tasks In Bulk ::
export const create_tasks_in_bulk = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: assigned_by } = req.user;
    const { org_id } = req;
    const { tasks } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "tasks must be a non-empty array",
        new Error("Invalid tasks payload"),
        400,
      );
    }

    const nameCache = new Map();
    const task_ids = [];

    for (let index = 0; index < tasks.length; index += 1) {
      const resolvedTask = await validateAndResolveTaskInput(
        connection,
        tasks[index],
        assigned_by,
        org_id,
        index,
      );

      const task_id = await insertEmployeeTaskWithActivity(
        connection,
        { ...resolvedTask, assigned_by, org_id },
        nameCache,
      );

      task_ids.push(task_id);
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: `${task_ids.length} Task(s) Created And Assigned Successfully !`,
      data: {
        created_count: task_ids.length,
        task_ids,
      },
    });
  } catch (error) {
    console.log("Error in create_tasks_in_bulk: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Create Tasks In Bulk !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Create Tasks In Bulk !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_task_information = async (req, res) => {
  // Used By Task Creator Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: updated_by } = req.user;
    const { org_id } = req;
    const { task_id, id: taskIdAlt, ...taskPayload } = req.body;
    const resolvedTaskId = task_id ?? taskIdAlt;

    assertNoForbiddenTaskUpdateFields(req.body);

    if (!resolvedTaskId) {
      return errorHandling(
        connection,
        res,
        false,
        "task_id is required",
        new Error("task_id is required"),
        400,
      );
    }

    const existingTask = await getTaskOwnedByCreator(
      connection,
      resolvedTaskId,
      org_id,
      updated_by,
    );

    const { updatedFields, ...resolvedTask } =
      await validateAndResolveTaskPatchInput(
        connection,
        taskPayload,
        existingTask,
        updated_by,
        org_id,
      );

    await updateEmployeeTaskWithActivity(
      connection,
      resolvedTaskId,
      existingTask,
      resolvedTask,
      updatedFields,
      updated_by,
      org_id,
      new Map(),
    );

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Task Information Updated Successfully !",
      data: { task_id: Number(resolvedTaskId) },
    });
  } catch (error) {
    console.log("Error in update_task_information: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Update Task Information !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Update Task Information !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_task_status = async (req, res) => {
  // Used By Assigned Task Employee Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: employee_id } = req.user;
    const { org_id } = req;
    const { task_status, task_id, id: taskIdAlt } = req.body;
    const resolvedTaskId = task_id ?? taskIdAlt;

    if (!resolvedTaskId) {
      return errorHandling(
        connection,
        res,
        false,
        "task_id is required",
        new Error("task_id is required"),
        400,
      );
    }

    const normalizedStatus = normalizeTaskStatus(task_status);
    if (!normalizedStatus) {
      return errorHandling(
        connection,
        res,
        false,
        "task_status must be one of: pending, received, in-progress, delay, completed",
        new Error("Invalid task_status"),
        400,
      );
    }

    if (!EMPLOYEE_UPDATABLE_TASK_STATUSES.includes(normalizedStatus)) {
      return errorHandling(
        connection,
        res,
        false,
        "Employees can only set task_status to: received, in-progress, delay, completed",
        new Error("Invalid task_status for employee"),
        400,
      );
    }

    const existingTask = await getTaskAssignedToEmployee(
      connection,
      resolvedTaskId,
      org_id,
      employee_id,
    );

    if (
      existingTask.complete_status !== "pending" &&
      existingTask.complete_status !== "rejected"
    ) {
      return errorHandling(
        connection,
        res,
        false,
        "Task status cannot be updated after manager review",
        new Error("Task already reviewed by manager"),
        400,
      );
    }

    if (normalizedStatus === existingTask.task_status) {
      await connection.rollback();
      return res.status(200).json({
        success: true,
        message: "Task status is already up to date",
        data: {
          task_id: Number(resolvedTaskId),
          task_status: normalizedStatus,
          unchanged: true,
        },
      });
    }

    if (normalizedStatus === "received") {
      if (existingTask.task_status !== "pending") {
        await connection.rollback();
        return res.status(200).json({
          success: true,
          message: "Task already received",
          data: {
            task_id: Number(resolvedTaskId),
            task_status: existingTask.task_status,
            unchanged: true,
          },
        });
      }
    } else {
      validateEmployeeTaskStatusTransition(
        existingTask.task_status,
        normalizedStatus,
      );
    }

    if (
      normalizedStatus === "in-progress" &&
      existingTask.task_start_date &&
      new Date() < new Date(existingTask.task_start_date)
    ) {
      return errorHandling(
        connection,
        res,
        false,
        "Task cannot be started before the task start date",
        new Error("Task start date not reached"),
        400,
      );
    }

    const employeeCompletedAt =
      normalizedStatus === "completed" ? new Date() : null;
    const nextCompleteStatus =
      normalizedStatus === "completed" ? "pending" : existingTask.complete_status;

    const [result] = await connection.query(
      `
      UPDATE employee_tasks
      SET
        task_status = ?,
        employee_completed_at = ?,
        complete_status = ?
      WHERE id = ? AND org_id = ? AND employee_id = ?
      `,
      [
        normalizedStatus,
        employeeCompletedAt,
        nextCompleteStatus,
        resolvedTaskId,
        org_id,
        employee_id,
      ],
    );

    if (result.affectedRows === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "Failed To Update Task Status !",
        new Error("Failed To Update Task Status"),
        500,
      );
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Task Status Updated Successfully !",
      data: {
        task_id: Number(resolvedTaskId),
        task_status: normalizedStatus,
        employee_completed_at: employeeCompletedAt,
      },
    });
  } catch (error) {
    console.log("Error in update_task_status: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Update Task Status !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Update Task Status !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const delete_task = async (req, res) => {
  // Used By Task Creator Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: creator_id } = req.user;
    const { org_id } = req;
    const { task_ids, task_id } = req.body;

    if (!(await isEmployeeExists(connection, creator_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const normalizedTaskIds = normalizeTaskIds(task_ids, task_id);
    if (normalizedTaskIds.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "task_ids must be a non-empty array of valid task ids",
        new Error("Invalid task_ids"),
        400,
      );
    }

    const deletedTasks = await deleteTasksOwnedByCreator(
      connection,
      normalizedTaskIds,
      creator_id,
      org_id,
      new Map(),
    );

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: `${deletedTasks.length} Task(s) Deleted Successfully !`,
      data: {
        deleted_count: deletedTasks.length,
        deleted_tasks: deletedTasks,
      },
    });
  } catch (error) {
    console.log("Error in delete_task: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Delete Task(s) !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Delete Task(s) !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_task_complete_status = async (req, res) => {
  // Used By Task Creator and Reporting Manager Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const { task_info_status } = req.body;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const reviewItems = Array.isArray(task_info_status)
      ? task_info_status
      : task_info_status
        ? [task_info_status]
        : [];

    if (reviewItems.length === 0) {
      return errorHandling(
        connection,
        res,
        false,
        "task_info_status must be a non-empty array",
        new Error("Invalid task_info_status"),
        400,
      );
    }

    const nameCache = new Map();
    const updatedTasks = [];

    for (let index = 0; index < reviewItems.length; index += 1) {
      const item = reviewItems[index];
      const taskId = item?.task_id ?? item?.id;

      if (!taskId) {
        throw createTaskValidationError(
          `${completeStatusFieldLabel(index)}task_id is required`,
        );
      }

      const existingTask = await getTaskForCompleteStatusReview(
        connection,
        taskId,
        org_id,
        action_user_id,
      );

      const resolvedPatch = await validateAndResolveCompleteStatusPatch(
        item,
        existingTask,
        index,
      );

      const updatedTask = await patchTaskCompleteStatusWithActivity(
        connection,
        taskId,
        existingTask,
        resolvedPatch,
        action_user_id,
        org_id,
        nameCache,
      );

      updatedTasks.push(updatedTask);
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: `${updatedTasks.length} Task Review(s) Updated Successfully !`,
      data: {
        updated_count: updatedTasks.length,
        updated_tasks: updatedTasks,
      },
    });
  } catch (error) {
    console.log("Error in update_task_complete_status: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Update Task Complete Status !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Update Task Complete Status !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_employees_task_with_filter_queries = async (req, res) => {
  // Used By Super Admin and Feature Access Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const { sql, params, sortKey, sortDirection } = buildEmployeeTasksListQuery(
      org_id,
      req.query,
    );

    const [rows] = await connection.query(sql, params);

    return res.status(200).json({
      success: true,
      message: "Employee Tasks Fetched Successfully !",
      data: rows,
      meta: buildTaskListMeta(req.query, sortKey, sortDirection, rows.length),
    });
  } catch (error) {
    console.log("Error in get_all_employees_task_with_filter_queries: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Fetch Employee Tasks !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Fetch Employee Tasks !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_tasks_created_by_me = async (req, res) => {
  // Used By Task Creator Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const { sql, params, sortKey, sortDirection } = buildEmployeeTasksListQuery(
      org_id,
      req.query,
      { scopedAssignedById: action_user_id },
    );

    const [rows] = await connection.query(sql, params);

    return res.status(200).json({
      success: true,
      message: "Tasks Created By You Fetched Successfully !",
      data: rows,
      meta: buildTaskListMeta(req.query, sortKey, sortDirection, rows.length, {
        created_by_me: action_user_id,
      }),
    });
  } catch (error) {
    console.log("Error in get_all_tasks_created_by_me: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Fetch Tasks Created By You !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Fetch Tasks Created By You !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_tasks_assigned_to_me_as_a_reporting_manager = async (
  req,
  res,
) => {
  // Used By Reporting Manager Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: reporting_manager_id } = req.user;
    const { org_id } = req;

    if (!(await isEmployeeExists(connection, reporting_manager_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const { sql, params, sortKey, sortDirection } = buildEmployeeTasksListQuery(
      org_id,
      req.query,
      { scopedReportingManagerId: reporting_manager_id },
    );

    const [rows] = await connection.query(sql, params);

    return res.status(200).json({
      success: true,
      message: "Tasks Assigned To You As Reporting Manager Fetched Successfully !",
      data: rows,
      meta: buildTaskListMeta(req.query, sortKey, sortDirection, rows.length, {
        reporting_manager_id,
      }),
    });
  } catch (error) {
    console.log(
      "Error in get_all_tasks_assigned_to_me_as_a_reporting_manager: ",
      error,
    );
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message ||
          "Failed To Fetch Tasks Assigned To You As Reporting Manager !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message ||
        "Failed To Fetch Tasks Assigned To You As Reporting Manager !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_single_employee_all_tasks_with_filter_queries = async (
  req,
  res,
) => {
  // Used By Super Admin and Feature Access Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const employee_id = req.query.employee_id ?? req.query.user_id;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    if (!employee_id) {
      return errorHandling(
        connection,
        res,
        false,
        "employee_id is required",
        new Error("employee_id is required"),
        400,
      );
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found !",
        new Error("Employee Not Found"),
        404,
      );
    }

    const { sql, params, sortKey, sortDirection } = buildEmployeeTasksListQuery(
      org_id,
      req.query,
      { scopedEmployeeId: employee_id },
    );

    const [rows] = await connection.query(sql, params);

    return res.status(200).json({
      success: true,
      message: "Employee Tasks Fetched Successfully !",
      data: rows,
      meta: buildTaskListMeta(req.query, sortKey, sortDirection, rows.length, {
        employee_id: Number(employee_id),
      }),
    });
  } catch (error) {
    console.log(
      "Error in get_single_employee_all_tasks_with_filter_queries: ",
      error,
    );
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Fetch Employee Tasks !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Fetch Employee Tasks !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_single_task_information = async (req, res) => {
  // Used By Task Creator, Reporting Manager, Assigned Employee and Organization Owner Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const resolvedTaskId = req.params?.task_id ?? req.query?.task_id;
    const resolvedEmployeeId =
      req.params?.user_id ?? req.query?.employee_id ?? req.query?.user_id;

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    if (!resolvedTaskId) {
      return errorHandling(
        connection,
        res,
        false,
        "task_id is required",
        new Error("task_id is required"),
        400,
      );
    }

    if (!resolvedEmployeeId) {
      return errorHandling(
        connection,
        res,
        false,
        "user_id is required",
        new Error("user_id is required"),
        400,
      );
    }

    if (!(await isEmployeeExists(connection, resolvedEmployeeId, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found !",
        new Error("Employee Not Found"),
        404,
      );
    }

    const task = await fetchSingleTaskInformation(
      connection,
      resolvedTaskId,
      org_id,
      resolvedEmployeeId,
    );

    const owner = await isOrgOwner(connection, org_id, action_user_id);
    if (!canViewSingleTaskInformation(task, action_user_id, owner)) {
      return errorHandling(
        connection,
        res,
        false,
        "Access Denied",
        new Error(
          "Only the assigned employee, task creator, reporting manager, or organization owner can view this task",
        ),
        403,
      );
    }

    return res.status(200).json({
      success: true,
      message: "Task Information Fetched Successfully !",
      data: task,
    });
  } catch (error) {
    console.log("Error in get_single_task_information: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Fetch Task Information !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Fetch Task Information !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_my_all_tasks_with_filter_queries = async (req, res) => {
  // Used By Assigned Employee Only ::
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id: employee_id } = req.user;
    const { org_id } = req;
    const { filter_query } = req.body ?? {};

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      return errorHandling(
        connection,
        res,
        false,
        "Unauthorized",
        new Error("Unauthorized"),
        401,
      );
    }

    const queryFilters = {
      ...req.query,
      ...(filter_query && typeof filter_query === "object" ? filter_query : {}),
    };

    const { sql, params, sortKey, sortDirection } = buildEmployeeTasksListQuery(
      org_id,
      queryFilters,
      { scopedEmployeeId: employee_id },
    );

    const [rows] = await connection.query(sql, params);

    return res.status(200).json({
      success: true,
      message: "My Tasks Fetched Successfully !",
      data: rows,
      meta: buildTaskListMeta(queryFilters, sortKey, sortDirection, rows.length, {
        employee_id: Number(employee_id),
      }),
    });
  } catch (error) {
    console.log("Error in get_my_all_tasks_with_filter_queries: ", error);
    if (connection) {
      return errorHandling(
        connection,
        res,
        false,
        error.message || "Failed To Fetch My Tasks !",
        error,
        error.statusCode || 500,
      );
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed To Fetch My Tasks !",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
