import { pool } from "../../db/connect.js";
import { isEmployeeExists } from "../../helper/employee_checker.js";

const VALID_REQUEST_TYPES = ["check_in", "check_out", "both"];
const REVIEWABLE_REG_STATUSES = ["approved", "rejected"];

function toDbNullable(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function dateToLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDateYmd(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dateToLocalYmd(value);
  }
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const parsed = new Date(`${str}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return str;
}

function todayYmd() {
  return dateToLocalYmd(new Date());
}

function normalizeTime(value) {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(str)) return `${str}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) return str;
  return null;
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateRegularizationInfo(info) {
  if (!info || typeof info !== "object") {
    return { success: false, message: "regularization_info is required" };
  }

  const request_type = String(info.request_type ?? "")
    .trim()
    .toLowerCase();
  if (!VALID_REQUEST_TYPES.includes(request_type)) {
    return {
      success: false,
      message: "request_type must be check_in, check_out, or both",
    };
  }

  const action_date = normalizeDateYmd(info.action_date);
  if (!action_date) {
    return {
      success: false,
      message: "action_date is required and must be YYYY-MM-DD",
    };
  }

  if (action_date > todayYmd()) {
    return {
      success: false,
      message: "action_date cannot be in the future",
    };
  }

  const reason = String(info.reason ?? "").trim();
  if (!reason) {
    return { success: false, message: "reason is required" };
  }

  const reporting_manager = Number(info.reporting_manager);
  if (!Number.isInteger(reporting_manager) || reporting_manager <= 0) {
    return {
      success: false,
      message: "reporting_manager is required and must be a valid user id",
    };
  }

  const check_in_time = normalizeTime(info.check_in_time);
  const check_out_time = normalizeTime(info.check_out_time);

  if (request_type === "check_in") {
    if (!check_in_time) {
      return {
        success: false,
        message: "check_in_time is required for check_in regularization",
      };
    }
    if (check_out_time) {
      return {
        success: false,
        message: "check_out_time must be empty for check_in regularization",
      };
    }
  }

  if (request_type === "check_out") {
    if (!check_out_time) {
      return {
        success: false,
        message: "check_out_time is required for check_out regularization",
      };
    }
    if (check_in_time) {
      return {
        success: false,
        message: "check_in_time must be empty for check_out regularization",
      };
    }
  }

  if (request_type === "both") {
    if (!check_in_time || !check_out_time) {
      return {
        success: false,
        message:
          "check_in_time and check_out_time are required for both regularization",
      };
    }
    if (parseTimeToMinutes(check_out_time) <= parseTimeToMinutes(check_in_time)) {
      return {
        success: false,
        message: "check_out_time must be after check_in_time",
      };
    }
  }

  return {
    success: true,
    data: {
      request_type,
      action_date,
      reason,
      reporting_manager,
      check_in_time,
      check_out_time,
    },
  };
}

async function rollbackAndRespond(connection, res, status, message) {
  if (connection) await connection.rollback();
  return res.status(status).json({ message });
}

/**
 * Same-day rules:
 * - Allow check_in + check_out as separate requests on one date
 * - Reject duplicate of the same request_type
 * - Reject any new request if an existing row is request_type = both
 * - Reject request_type = both if any request already exists for that date
 * - Reject if both check_in and check_out already exist separately
 * Only pending/approved rows block; rejected rows can be re-applied.
 */
function validateDuplicateRegularization(existingRows, newRequestType) {
  const activeRows = existingRows.filter(
    (row) => String(row.reg_status ?? "pending").toLowerCase() !== "rejected",
  );

  if (activeRows.length === 0) {
    return { success: true };
  }

  const existingTypes = activeRows.map((row) =>
    String(row.request_type).trim().toLowerCase(),
  );

  if (existingTypes.includes("both")) {
    return {
      success: false,
      message:
        "A full-day (both) regularization already exists for this date",
    };
  }

  if (newRequestType === "both") {
    return {
      success: false,
      message:
        "Cannot apply both check-in and check-out when another regularization already exists for this date",
    };
  }

  if (existingTypes.includes(newRequestType)) {
    const label =
      newRequestType === "check_in"
        ? "check-in"
        : newRequestType === "check_out"
          ? "check-out"
          : newRequestType;
    return {
      success: false,
      message: `Already applied for ${label} regularization on this date`,
    };
  }

  const hasCheckIn = existingTypes.includes("check_in");
  const hasCheckOut = existingTypes.includes("check_out");

  if (hasCheckIn && hasCheckOut) {
    return {
      success: false,
      message:
        "Check-in and check-out regularization already applied for this date",
    };
  }

  if (newRequestType === "check_in" && hasCheckOut) {
    return { success: true };
  }

  if (newRequestType === "check_out" && hasCheckIn) {
    return { success: true };
  }

  return { success: true };
}

function validateRegularizationReview(body) {
  const reg_status = String(body?.reg_status ?? "").trim().toLowerCase();
  if (!REVIEWABLE_REG_STATUSES.includes(reg_status)) {
    return {
      success: false,
      message: "reg_status must be approved or rejected",
    };
  }

  const review_comment =
    body?.review_comment != null && String(body.review_comment).trim() !== ""
      ? String(body.review_comment).trim()
      : null;

  if (reg_status === "rejected" && !review_comment) {
    return {
      success: false,
      message: "review_comment is required when rejecting a request",
    };
  }

  return {
    success: true,
    data: { reg_status, review_comment },
  };
}

function pushUniqueReportingManager(managers, seen, manager) {
  const key = String(manager.user_id);
  if (seen.has(key)) return;
  seen.add(key);
  managers.push(manager);
}

async function fetchTeamLeaderReportingManagers(connection, user_id, org_id) {
  const [rows] = await connection.query(
    `SELECT DISTINCT
      team_leader.id AS user_id,
      team_leader.user_name AS user_name,
      team_leader.user_email AS user_email,
      rom.emp_code AS emp_code,
      ot.id AS team_id,
      ot.team_name AS team_name
    FROM team_members tm
    INNER JOIN org_teams ot
      ON ot.id = tm.team_id AND ot.org_id = tm.org_id
    INNER JOIN apt_users team_leader
      ON team_leader.id = ot.admin_id
    INNER JOIN apt_org_members rom
      ON rom.user_id = team_leader.id
      AND rom.org_id = tm.org_id
      AND rom.is_active = 1
    WHERE tm.user_id = ?
      AND tm.org_id = ?
      AND tm.leave_date IS NULL
      AND team_leader.id <> ?
    ORDER BY team_leader.user_name ASC, ot.team_name ASC`,
    [user_id, org_id, user_id],
  );

  const managers = [];
  const seen = new Set();
  const teamNamesByUser = new Map();

  for (const row of rows) {
    const uid = Number(row.user_id);
    if (!Number.isInteger(uid) || uid <= 0) continue;

    if (row.team_name) {
      const names = teamNamesByUser.get(uid) ?? [];
      if (!names.includes(row.team_name)) {
        names.push(row.team_name);
        teamNamesByUser.set(uid, names);
      }
    }

    if (seen.has(String(uid))) continue;

    pushUniqueReportingManager(managers, seen, {
      user_id: uid,
      user_name: row.user_name,
      user_email: row.user_email ?? null,
      emp_code: row.emp_code ?? null,
      role: "reporting_manager",
      team_id: row.team_id ?? null,
      team_name: row.team_name ?? null,
      team_names: teamNamesByUser.get(uid) ?? [],
    });
  }

  for (const manager of managers) {
    const names = teamNamesByUser.get(manager.user_id) ?? [];
    manager.team_names = names;
    if (names.length > 0) {
      manager.team_name = names.join(", ");
    }
  }

  return managers;
}

async function fetchHrAdminReportingManagers(connection, org_id, user_id) {
  const managers = [];
  const seen = new Set();

  const [adminRows] = await connection.query(
    `SELECT
      admin_user.id AS user_id,
      admin_user.user_name AS user_name,
      admin_user.user_email AS user_email,
      om.emp_code AS emp_code
    FROM apt_organizations org
    INNER JOIN apt_users admin_user ON admin_user.id = org.owner_id
    INNER JOIN apt_org_members om
      ON om.user_id = admin_user.id AND om.org_id = org.id AND om.is_active = 1
    INNER JOIN apt_user_roles aur
      ON aur.user_id = admin_user.id AND aur.org_id = org.id
    INNER JOIN apt_roles ar
      ON ar.id = aur.role_id AND ar.org_id = org.id AND ar.role_name = 'admin'
    WHERE org.id = ?
      AND admin_user.id <> ?`,
    [org_id, user_id],
  );

  for (const row of adminRows) {
    pushUniqueReportingManager(managers, seen, {
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email ?? null,
      emp_code: row.emp_code ?? null,
      role: "admin",
      team_id: null,
      team_name: null,
      team_names: [],
    });
  }

  const [hrRows] = await connection.query(
    `SELECT
      hr_user.id AS user_id,
      hr_user.user_name AS user_name,
      hr_user.user_email AS user_email,
      om.emp_code AS emp_code
    FROM apt_user_roles aur
    INNER JOIN apt_roles ar
      ON ar.id = aur.role_id AND ar.org_id = aur.org_id AND ar.role_name = 'hr'
    INNER JOIN apt_users hr_user ON hr_user.id = aur.user_id
    INNER JOIN apt_org_members om
      ON om.user_id = hr_user.id AND om.org_id = aur.org_id AND om.is_active = 1
    WHERE aur.org_id = ?
      AND hr_user.id <> ?`,
    [org_id, user_id],
  );

  for (const row of hrRows) {
    pushUniqueReportingManager(managers, seen, {
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email ?? null,
      emp_code: row.emp_code ?? null,
      role: "hr",
      team_id: null,
      team_name: null,
      team_names: [],
    });
  }

  return managers.sort((a, b) =>
    String(a.user_name ?? "").localeCompare(String(b.user_name ?? "")),
  );
}

export async function fetchReportingManager(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [teamRows] = await connection.query(
      `SELECT id
       FROM team_members
       WHERE user_id = ? AND org_id = ? AND leave_date IS NULL
       LIMIT 1`,
      [user_id, org_id],
    );

    let data;
    let source;

    if (teamRows.length > 0) {
      data = await fetchTeamLeaderReportingManagers(connection, user_id, org_id);
      source = "team_leaders";
    } else {
      data = await fetchHrAdminReportingManagers(connection, org_id, user_id);
      source = "hr_admin";
    }

    return res.status(200).json({
      message:
        data.length > 0
          ? "Reporting managers fetched"
          : "No reporting managers available",
      source,
      data,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

async function fetchActiveRegularizationBalance(connection, user_id, org_id) { 
  
  const [rows] = await connection.query(
    `SELECT id, balance, used,
      DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from,
      DATE_FORMAT(valid_to, '%Y-%m-%d') AS valid_to,
      assigned_by, created_at, updated_at
     FROM regularization_balance
     WHERE user_id = ? AND org_id = ?
     LIMIT 1`,
    [user_id, org_id],
  );

  if (rows.length === 0) {
    return {
      is_available: false,
      balance: 0,
      used: 0,
      remaining: 0,
      valid_from: null,
      valid_to: null,
    };
  }

  const row = rows[0];
  const today = todayYmd();
  const valid_from = normalizeDateYmd(row.valid_from);
  const valid_to = normalizeDateYmd(row.valid_to);
  const balance = Number(row.balance);
  const used = Number(row.used);
  const remaining = Math.max(0, balance - used);

  const periodActive =
    valid_from &&
    valid_to &&
    valid_from <= today &&
    valid_to >= today;
  const hasQuota = balance > 0 && used < balance;
  const is_available = Boolean(periodActive && hasQuota);

  return {
    is_available,
    balance,
    used,
    remaining: is_available ? remaining : 0,
    valid_from,
    valid_to,
    assigned_by: row.assigned_by ?? null,
  };
}

export async function getRegularizationBalance(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const balanceInfo = await fetchActiveRegularizationBalance(
      connection,
      user_id,
      org_id,
    );

    return res.status(200).json({
      message: balanceInfo.is_available
        ? "Regularization balance fetched"
        : "No regularization balance available for this month",
      data: balanceInfo,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function applyForRegularization(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const fieldValidation = validateRegularizationInfo(req.body?.regularization_info);
    if (!fieldValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        fieldValidation.message,
      );
    }

    const {
      request_type,
      check_in_time,
      check_out_time,
      action_date,
      reporting_manager,
      reason,
    } = fieldValidation.data;

    if (Number(reporting_manager) === Number(user_id)) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "You cannot assign yourself as reporting manager",
      );
    }

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Reporting manager not found",
      );
    }

    const [existing_regularization] = await connection.query(
      `SELECT id, request_type, reg_status
       FROM regularization
       WHERE user_id = ? AND org_id = ? AND action_date = ?`,
      [user_id, org_id, action_date],
    );

    const duplicateValidation = validateDuplicateRegularization(
      existing_regularization,
      request_type,
    );
    if (!duplicateValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        duplicateValidation.message,
      );
    }

    const balanceInfo = await fetchActiveRegularizationBalance(
      connection,
      user_id,
      org_id,
    );

    if (!balanceInfo.is_available) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "No regularization balance available for this month",
      );
    }

    const [reg_balance_rows] = await connection.query(
      `SELECT id, balance, used
       FROM regularization_balance
       WHERE user_id = ? AND org_id = ?
       LIMIT 1`,
      [user_id, org_id],
    );
    const reg_balance = reg_balance_rows[0];

    const [insertResult] = await connection.query(
      `INSERT INTO regularization
        (request_type, check_in_time, check_out_time, action_date, user_id, org_id, reporting_manager, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request_type,
        check_in_time,
        check_out_time,
        action_date,
        user_id,
        org_id,
        reporting_manager,
        reason,
      ],
    );

    const [balanceUpdate] = await connection.query(
      `UPDATE regularization_balance
       SET used = used + 1
       WHERE id = ? AND user_id = ? AND org_id = ? AND used < balance`,
      [reg_balance.id, user_id, org_id],
    );

    if (balanceUpdate.affectedRows === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "No regularization balance available for this month",
      );
    }

    await connection.commit();

    return res.status(201).json({
      message: "Regularization request submitted successfully",
      regularization_id: insertResult.insertId,
      balance_remaining: Number(reg_balance.balance) - Number(reg_balance.used) - 1,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

function formatTimeValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 8);
  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }
  return String(value);
}

function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dateToLocalYmd(value);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return str.slice(0, 10);
}

function parseRegularizationId(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

const REGULARIZATION_SELECT_SQL = `
  SELECT
    r.id,
    r.request_type,
    r.check_in_time,
    r.check_out_time,
    DATE_FORMAT(r.action_date, '%Y-%m-%d') AS action_date,
    r.user_id,
    r.org_id,
    r.reporting_manager,
    rm.user_name AS reporting_manager_name,
    rm.user_email AS reporting_manager_email,
    rom.emp_code AS reporting_manager_code,
    r.reason,
    r.reg_status,
    r.review_comment,
    r.approved_by,
    ab.user_name AS approved_by_name,
    r.approved_at,
    r.created_at,
    r.updated_at
  FROM regularization r
  LEFT JOIN apt_users rm
    ON rm.id = r.reporting_manager
  LEFT JOIN apt_org_members rom
    ON rom.user_id = r.reporting_manager AND rom.org_id = r.org_id
  LEFT JOIN apt_users ab
    ON ab.id = r.approved_by
`;

function mapRegularizationRow(row) {
  return {
    id: row.id,
    request_type: row.request_type,
    check_in_time: formatTimeValue(row.check_in_time),
    check_out_time: formatTimeValue(row.check_out_time),
    action_date: formatDateValue(row.action_date),
    user_id: row.user_id,
    org_id: row.org_id,
    reporting_manager: row.reporting_manager,
    reporting_manager_name: row.reporting_manager_name ?? null,
    reporting_manager_email: row.reporting_manager_email ?? null,
    reporting_manager_code: row.reporting_manager_code ?? null,
    reason: row.reason,
    reg_status: row.reg_status,
    review_comment: row.review_comment ?? null,
    approved_by: row.approved_by ?? null,
    approved_by_name: row.approved_by_name ?? null,
    approved_at: row.approved_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const REGULARIZATION_MANAGER_SELECT_SQL = `
  SELECT
    r.id,
    r.request_type,
    r.check_in_time,
    r.check_out_time,
    DATE_FORMAT(r.action_date, '%Y-%m-%d') AS action_date,
    r.user_id,
    r.org_id,
    r.reporting_manager,
    rm.user_name AS reporting_manager_name,
    rm.user_email AS reporting_manager_email,
    rom.emp_code AS reporting_manager_code,
    r.reason,
    r.reg_status,
    r.review_comment,
    r.approved_by,
    ab.user_name AS approved_by_name,
    r.approved_at,
    r.created_at,
    r.updated_at,
    emp.user_name AS employee_name,
    emp.user_email AS employee_email,
    eom.emp_code AS employee_code,
    eom.emp_code AS emp_code,
    ear.role_name AS employee_role_name,
    ot.id AS team_id,
    ot.team_name,
    ot.admin_id AS team_leader_id,
    team_leader.user_name AS team_leader_name,
    rb.balance AS regularization_balance,
    rb.used AS regularization_used
  FROM regularization r
  INNER JOIN apt_users emp
    ON emp.id = r.user_id
  LEFT JOIN apt_org_members eom
    ON eom.user_id = r.user_id AND eom.org_id = r.org_id AND eom.is_active = 1
  LEFT JOIN apt_user_roles eaur
    ON eaur.user_id = r.user_id AND eaur.org_id = r.org_id
  LEFT JOIN apt_roles ear
    ON ear.id = eaur.role_id AND ear.org_id = r.org_id
  LEFT JOIN (
    SELECT user_id, org_id, MIN(team_id) AS team_id
    FROM team_members
    WHERE leave_date IS NULL
    GROUP BY user_id, org_id
  ) tm
    ON tm.user_id = r.user_id AND tm.org_id = r.org_id
  LEFT JOIN org_teams ot
    ON ot.id = tm.team_id AND ot.org_id = r.org_id
  LEFT JOIN apt_users team_leader
    ON team_leader.id = ot.admin_id
  LEFT JOIN apt_users rm
    ON rm.id = r.reporting_manager
  LEFT JOIN apt_org_members rom
    ON rom.user_id = r.reporting_manager AND rom.org_id = r.org_id
  LEFT JOIN apt_users ab
    ON ab.id = r.approved_by
  LEFT JOIN regularization_balance rb
    ON rb.user_id = r.user_id AND rb.org_id = r.org_id
`;

function mapRegularizationManagerRow(row) {
  return {
    ...mapRegularizationRow(row),
    employee_name: row.employee_name ?? null,
    employee_email: row.employee_email ?? null,
    employee_code: row.employee_code ?? null,
    emp_code: row.emp_code ?? null,
    employee_role_name: row.employee_role_name ?? null,
    team_id: row.team_id ?? null,
    team_name: row.team_name ?? null,
    team_leader_id: row.team_leader_id ?? null,
    team_leader_name: row.team_leader_name ?? null,
    regularization_balance:
      row.regularization_balance != null
        ? Number(row.regularization_balance)
        : null,
    regularization_used:
      row.regularization_used != null ? Number(row.regularization_used) : null,
  };
}

async function restoreRegularizationBalance(connection, user_id, org_id) {
  const [balanceUpdate] = await connection.query(
    `UPDATE regularization_balance
     SET used = used - 1
     WHERE user_id = ? AND org_id = ? AND used > 0`,
    [user_id, org_id],
  );
  return balanceUpdate.affectedRows > 0;
}


export async function updateRegularization(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const regularizationId = parseRegularizationId(req.params.id);
    if (!regularizationId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid regularization ID is required",
      );
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const [existingRows] = await connection.query(
      `SELECT id, request_type, action_date, reg_status
       FROM regularization
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [regularizationId, user_id, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Regularization request not found",
      );
    }

    const existing = existingRows[0];

    if (String(existing.reg_status).toLowerCase() !== "pending") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending regularization requests can be updated",
      );
    }

    const fieldValidation = validateRegularizationInfo(req.body?.regularization_info);
    if (!fieldValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        fieldValidation.message,
      );
    }

    const {
      request_type,
      check_in_time,
      check_out_time,
      action_date,
      reporting_manager,
      reason,
    } = fieldValidation.data;

    if (Number(reporting_manager) === Number(user_id)) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "You cannot assign yourself as reporting manager",
      );
    }

    if (!(await isEmployeeExists(connection, reporting_manager, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Reporting manager not found",
      );
    }

    const [sameDateRows] = await connection.query(
      `SELECT id, request_type, reg_status
       FROM regularization
       WHERE user_id = ? AND org_id = ? AND action_date = ? AND id <> ?`,
      [user_id, org_id, action_date, regularizationId],
    );

    const duplicateValidation = validateDuplicateRegularization(
      sameDateRows,
      request_type,
    );
    if (!duplicateValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        duplicateValidation.message,
      );
    }

    const [updateResult] = await connection.query(
      `UPDATE regularization
       SET request_type = ?, check_in_time = ?, check_out_time = ?,
           action_date = ?, reporting_manager = ?, reason = ?
       WHERE id = ? AND user_id = ? AND org_id = ? AND reg_status = 'pending'`,
      [
        request_type,
        check_in_time,
        check_out_time,
        action_date,
        reporting_manager,
        reason,
        regularizationId,
        user_id,
        org_id,
      ],
    );

    if (!updateResult.affectedRows) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Failed to update regularization request",
      );
    }

    await connection.commit();

    const [updatedRows] = await connection.query(
      `${REGULARIZATION_SELECT_SQL}
       WHERE r.id = ? AND r.user_id = ? AND r.org_id = ?
       LIMIT 1`,
      [regularizationId, user_id, org_id],
    );

    return res.status(200).json({
      message: "Regularization request updated successfully",
      regularization_id: regularizationId,
      result: mapRegularizationRow(updatedRows[0]),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function deleteRegularization(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const regularizationId = parseRegularizationId(req.params.id);
    if (!regularizationId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid regularization ID is required",
      );
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const [existingRows] = await connection.query(
      `SELECT id, reg_status
       FROM regularization
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [regularizationId, user_id, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Regularization request not found",
      );
    }

    const { reg_status } = existingRows[0];
    const status = String(reg_status).toLowerCase();

    if (status === "approved") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Approved regularization requests cannot be deleted",
      );
    }

    if (status !== "pending" && status !== "rejected") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending or rejected regularization requests can be deleted",
      );
    }

    const [deleteResult] = await connection.query(
      `DELETE FROM regularization
       WHERE id = ? AND user_id = ? AND org_id = ? AND reg_status IN ('pending', 'rejected')`,
      [regularizationId, user_id, org_id],
    );

    if (!deleteResult.affectedRows) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Failed to delete regularization request",
      );
    }

    await restoreRegularizationBalance(connection, user_id, org_id);

    await connection.commit();

    return res.status(200).json({
      message: "Regularization request deleted successfully",
      regularization_id: regularizationId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getRegularization(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const regularizationId = parseRegularizationId(req.params.id);
    if (!regularizationId) {
      return res.status(400).json({ message: "Valid regularization ID is required" });
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [rows] = await connection.query(
      `${REGULARIZATION_SELECT_SQL}
       WHERE r.id = ? AND r.user_id = ? AND r.org_id = ?
       LIMIT 1`,
      [regularizationId, user_id, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Regularization request not found" });
    }

    return res.status(200).json({
      result: mapRegularizationRow(rows[0]),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getMyRegularization(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const { reg_status, request_type, action_date } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const filters = ["r.user_id = ?", "r.org_id = ?"];
    const params = [user_id, org_id];

    if (reg_status != null && String(reg_status).trim() !== "") {
      const status = String(reg_status).trim().toLowerCase();
      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({
          message: "reg_status must be pending, approved, or rejected",
        });
      }
      filters.push("r.reg_status = ?");
      params.push(status);
    }

    if (request_type != null && String(request_type).trim() !== "") {
      const type = String(request_type).trim().toLowerCase();
      if (!VALID_REQUEST_TYPES.includes(type)) {
        return res.status(400).json({
          message: "request_type must be check_in, check_out, or both",
        });
      }
      filters.push("r.request_type = ?");
      params.push(type);
    }

    if (action_date != null && String(action_date).trim() !== "") {
      const date = normalizeDateYmd(action_date);
      if (!date) {
        return res.status(400).json({
          message: "action_date must be YYYY-MM-DD",
        });
      }
      filters.push("r.action_date = ?");
      params.push(date);
    }

    const [rows] = await connection.query(
      `${REGULARIZATION_SELECT_SQL}
       WHERE ${filters.join(" AND ")}
       ORDER BY r.created_at DESC`,
      params,
    );

    return res.status(200).json({
      result: rows.map(mapRegularizationRow),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getAllRegularizationRequests(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const { user_id } = req.user;
    const org_id = req.org_id;
    const {
      reg_status,
      request_type,
      action_date,
      employee_id,
      is_ascending: isAscendingQuery,
    } = req.query;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const filters = ["r.reporting_manager = ?", "r.org_id = ?"];
    const params = [user_id, org_id];

    if (reg_status != null && String(reg_status).trim() !== "") {
      const status = String(reg_status).trim().toLowerCase();
      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({
          message: "reg_status must be pending, approved, or rejected",
        });
      }
      filters.push("r.reg_status = ?");
      params.push(status);
    }

    if (request_type != null && String(request_type).trim() !== "") {
      const type = String(request_type).trim().toLowerCase();
      if (!VALID_REQUEST_TYPES.includes(type)) {
        return res.status(400).json({
          message: "request_type must be check_in, check_out, or both",
        });
      }
      filters.push("r.request_type = ?");
      params.push(type);
    }

    if (action_date != null && String(action_date).trim() !== "") {
      const date = normalizeDateYmd(action_date);
      if (!date) {
        return res.status(400).json({
          message: "action_date must be YYYY-MM-DD",
        });
      }
      filters.push("r.action_date = ?");
      params.push(date);
    }

    if (employee_id != null && String(employee_id).trim() !== "") {
      const applicantId = Number(employee_id);
      if (!Number.isInteger(applicantId) || applicantId <= 0) {
        return res.status(400).json({
          message: "employee_id must be a valid user id",
        });
      }
      filters.push("r.user_id = ?");
      params.push(applicantId);
    }

    const sortDirection =
      String(isAscendingQuery).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [rows] = await connection.query(
      `${REGULARIZATION_MANAGER_SELECT_SQL}
       WHERE ${filters.join(" AND ")}
       ORDER BY r.created_at ${sortDirection}`,
      params,
    );

    return res.status(200).json({
      result: rows.map(mapRegularizationManagerRow),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getRegularizationRequest(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();

    const regularizationId = parseRegularizationId(req.params.id);
    if (!regularizationId) {
      return res.status(400).json({ message: "Valid regularization ID is required" });
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [rows] = await connection.query(
      `${REGULARIZATION_MANAGER_SELECT_SQL}
       WHERE r.id = ? AND r.reporting_manager = ? AND r.org_id = ?
       LIMIT 1`,
      [regularizationId, user_id, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "Regularization request not found",
      });
    }

    return res.status(200).json({
      result: mapRegularizationManagerRow(rows[0]),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function updateRegularizationRequest(req, res) {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const regularizationId = parseRegularizationId(req.params.id);
    if (!regularizationId) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Valid regularization ID is required",
      );
    }

    const { user_id } = req.user;
    const org_id = req.org_id;

    if (!(await isEmployeeExists(connection, user_id, org_id))) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Employee not found",
      );
    }

    const reviewValidation = validateRegularizationReview(req.body);
    if (!reviewValidation.success) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        reviewValidation.message,
      );
    }

    const { reg_status, review_comment } = reviewValidation.data;

    const [existingRows] = await connection.query(
      `SELECT id, user_id, org_id, reporting_manager, reg_status
       FROM regularization
       WHERE id = ? AND org_id = ?
       LIMIT 1`,
      [regularizationId, org_id],
    );

    if (existingRows.length === 0) {
      return await rollbackAndRespond(
        connection,
        res,
        404,
        "Regularization request not found",
      );
    }

    const existing = existingRows[0];

    if (Number(existing.reporting_manager) !== Number(user_id)) {
      return await rollbackAndRespond(
        connection,
        res,
        403,
        "Only the assigned reporting manager can review this request",
      );
    }

    if (String(existing.reg_status).toLowerCase() !== "pending") {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Only pending regularization requests can be reviewed",
      );
    }

    const [updateResult] = await connection.query(
      `UPDATE regularization
       SET reg_status = ?, review_comment = ?, approved_by = ?, approved_at = NOW()
       WHERE id = ? AND org_id = ? AND reporting_manager = ? AND reg_status = 'pending'`,
      [
        reg_status,
        review_comment,
        user_id,
        regularizationId,
        org_id,
        user_id,
      ],
    );

    if (!updateResult.affectedRows) {
      return await rollbackAndRespond(
        connection,
        res,
        400,
        "Failed to update regularization request",
      );
    }

    if (reg_status === "rejected") {
      await restoreRegularizationBalance(
        connection,
        existing.user_id,
        org_id,
      );
    }

    await connection.commit();

    const [updatedRows] = await connection.query(
      `${REGULARIZATION_MANAGER_SELECT_SQL}
       WHERE r.id = ? AND r.reporting_manager = ? AND r.org_id = ?
       LIMIT 1`,
      [regularizationId, user_id, org_id],
    );

    return res.status(200).json({
      message:
        reg_status === "approved"
          ? "Regularization request approved successfully"
          : "Regularization request rejected successfully",
      regularization_id: regularizationId,
      result: mapRegularizationManagerRow(updatedRows[0]),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection) connection.release();
  }
}