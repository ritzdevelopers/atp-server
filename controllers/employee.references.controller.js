import { pool } from "../db/connect.js";

const INSERT_ACTIVITY_SQL = `INSERT INTO apt_user_activity_logs
  (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query) {
  const pageRaw = query?.page ?? query?.p;
  const limitRaw = query?.limit ?? query?.per_page;

  let page = Number(pageRaw);
  let limit = Number(limitRaw);

  if (!Number.isFinite(page) || page < 1) page = DEFAULT_PAGE;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * @returns {Promise<{ status: number, body: object } | null>}
 */
async function validateOrgAccess(performed_by, orgIdRaw) {
  if (!performed_by) {
    return {
      status: 401,
      body: { success: false, message: "Unauthorized" },
    };
  }
  if (isBlank(orgIdRaw)) {
    return {
      status: 400,
      body: { success: false, message: "org_id is required" },
    };
  }

  const org_id = String(orgIdRaw).trim();

  const [orgRows] = await pool.promise().query(
    "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
    [org_id],
  );
  if (!orgRows.length) {
    return {
      status: 404,
      body: { success: false, message: "Organization not found" },
    };
  }

  const [actorMember] = await pool.promise().query(
    "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
    [performed_by, org_id],
  );
  if (!actorMember.length) {
    return {
      status: 403,
      body: {
        success: false,
        message: "You are not a member of this organization",
      },
    };
  }

  return null;
}

/** Employee must exist and belong to org. */
async function assertUserIsOrgMember(userId, org_id, label) {
  const [uRows] = await pool.promise().query(
    "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (!uRows.length) {
    return {
      status: 404,
      body: { success: false, message: `${label} user not found` },
    };
  }

  const [mRows] = await pool.promise().query(
    "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
    [userId, org_id],
  );
  if (!mRows.length) {
    return {
      status: 404,
      body: {
        success: false,
        message: `${label} is not a member of this organization`,
      },
    };
  }

  return null;
}

async function assertDesignationRoleForOrg(roleId, org_id) {
  const [roleRows] = await pool.promise().query(
    "SELECT id FROM apt_roles WHERE id = ? AND org_id = ? LIMIT 1",
    [roleId, org_id],
  );
  if (!roleRows.length) {
    return {
      status: 400,
      body: {
        success: false,
        message:
          "referred_by_designation_id must be a role defined for this organization",
      },
    };
  }
  return null;
}

function normalizeOptionalName(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/**
 * GET `/management-employees?org_id=&page=&limit=`
 *
 * Returns organization members from `apt_org_members` + user profile (`apt_users`)
 * with assigned roles from `apt_user_roles` joined to `apt_roles` for this org.
 */
export const get_all_management_employees_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();
    const { page, limit, offset } = parsePagination(req.query);

    const [[countRow]] = await pool.promise().query(
      `SELECT COUNT(*) AS total FROM apt_org_members WHERE org_id = ?`,
      [org_id],
    );
    const total = Number(countRow?.total ?? 0);
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    const [pageMembers] = await pool.promise().query(
      `SELECT om.user_id AS user_id
       FROM apt_org_members om
       INNER JOIN apt_users u ON u.id = om.user_id
       WHERE om.org_id = ?
       ORDER BY u.user_name ASC
       LIMIT ? OFFSET ?`,
      [org_id, limit, offset],
    );

    const pageUserIds = pageMembers.map((r) => r.user_id);

    if (pageUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "OK",
        data: [],
        pagination: {
          page,
          limit,
          total,
          total_pages,
          has_next: total_pages > 0 && page < total_pages,
          has_prev: page > 1,
        },
      });
    }

    const placeholders = pageUserIds.map(() => "?").join(",");

    const [rows] = await pool.promise().query(
      `SELECT
          u.id AS user_id,
          u.user_name,
          u.user_email,
          u.user_phone,
          om.id AS org_member_id,
          om.created_at AS org_member_since,
          aur.id AS user_role_assignment_id,
          aur.role_id,
          aur.updated_at AS role_assigned_updated_at,
          r.role_name,
          r.created_at AS role_created_at
        FROM apt_org_members om
        INNER JOIN apt_users u ON u.id = om.user_id
        LEFT JOIN apt_user_roles aur
          ON aur.user_id = u.id AND aur.org_id = om.org_id
        LEFT JOIN apt_roles r
          ON r.id = aur.role_id AND r.org_id = om.org_id
        WHERE om.org_id = ?
          AND u.id IN (${placeholders})
        ORDER BY u.user_name ASC, r.role_name ASC`,
      [org_id, ...pageUserIds],
    );

    const byUser = new Map();

    for (const row of rows) {
      let entry = byUser.get(row.user_id);
      if (!entry) {
        entry = {
          user_id: row.user_id,
          user_name: row.user_name,
          user_email: row.user_email,
          user_phone: row.user_phone,
          org_member_id: row.org_member_id,
          org_member_since: row.org_member_since,
          roles: [],
        };
        byUser.set(row.user_id, entry);
      }

      if (row.role_id != null && row.role_name != null) {
        entry.roles.push({
          user_role_assignment_id: row.user_role_assignment_id,
          role_id: row.role_id,
          role_name: row.role_name,
          role_created_at: row.role_created_at,
          assignment_updated_at: row.role_assigned_updated_at,
        });
      }
    }

    /** Preserve pagination sort order */
    const employees = pageUserIds
      .map((id) => byUser.get(id))
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      message: "OK",
      data: employees,
      pagination: {
        page,
        limit,
        total,
        total_pages,
        has_next: total_pages > 0 && page < total_pages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("get_all_management_employees_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading employees with roles",
    });
  }
};
/**
 * POST JSON: org_id, employee_id, referred_by_id,
 * optional referred_by_name, referred_by_designation_id.
 * UNIQUE(employee_id, org_id) — one reference row per employee per org.
 */
export const add_employee_reference_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;
    const employee_id = req.body?.employee_id;
    const referred_by_id = req.body?.referred_by_id;
    const referred_by_name = normalizeOptionalName(req.body?.referred_by_name);
    let designationRaw = req.body?.referred_by_designation_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    if (isBlank(referred_by_id)) {
      return res.status(400).json({
        success: false,
        message: "referred_by_id is required",
      });
    }

    if (String(employee_id).trim() === String(referred_by_id).trim()) {
      return res.status(400).json({
        success: false,
        message: "employee_id and referred_by_id must be different users",
      });
    }

    if (referred_by_name != null && referred_by_name.length > 200) {
      return res.status(400).json({
        success: false,
        message: "referred_by_name must be at most 200 characters",
      });
    }

    let referred_by_designation_id = null;
    if (!isBlank(designationRaw)) {
      referred_by_designation_id = Number(designationRaw);
      if (!Number.isFinite(referred_by_designation_id)) {
        return res.status(400).json({
          success: false,
          message: "referred_by_designation_id must be a valid numeric role id",
        });
      }
      const roleErr = await assertDesignationRoleForOrg(
        referred_by_designation_id,
        org_id,
      );
      if (roleErr) return res.status(roleErr.status).json(roleErr.body);
    }

    const empErr = await assertUserIsOrgMember(
      employee_id,
      org_id,
      "Employee",
    );
    if (empErr) return res.status(empErr.status).json(empErr.body);

    const refErr = await assertUserIsOrgMember(
      referred_by_id,
      org_id,
      "Referrer",
    );
    if (refErr) return res.status(refErr.status).json(refErr.body);

    const [existing] = await pool.promise().query(
      `SELECT id FROM employee_references WHERE employee_id = ? AND org_id = ? LIMIT 1`,
      [employee_id, org_id],
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "A reference already exists for this employee in this organization; use update instead.",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [insertResult] = await connection.query(
        `INSERT INTO employee_references
          (employee_id, org_id, referred_by_id, referred_by_name, referred_by_designation_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          employee_id,
          org_id,
          referred_by_id,
          referred_by_name,
          referred_by_designation_id,
        ],
      );

      if (!insertResult.affectedRows) {
        throw Object.assign(new Error("Failed to save employee reference"), {
          statusCode: 400,
        });
      }

      const newRow = {
        id: insertResult.insertId,
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        referred_by_id: Number(referred_by_id),
        referred_by_name,
        referred_by_designation_id,
      };

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        employee_id,
        org_id,
        "ADD_EMPLOYEE_REFERENCE",
        null,
        JSON.stringify(newRow),
        "Employee reference added",
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Employee reference saved successfully",
        data: newRow,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    const statusCode =
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("add_employee_reference_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error saving employee reference"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

/**
 * PATCH JSON: org_id required.
 * Locate row by `id` OR by `employee_id` (within org).
 * Updatable: referred_by_id, referred_by_name, referred_by_designation_id (omit = unchanged).
 */
export const update_employee_reference_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;
    const referenceIdRaw = req.body?.id;
    const employeeLookupId = req.body?.employee_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(referenceIdRaw) && isBlank(employeeLookupId)) {
      return res.status(400).json({
        success: false,
        message: "Provide id (reference row id) or employee_id to identify the record",
      });
    }

    let existingRows;
    if (!isBlank(referenceIdRaw)) {
      const [rows] = await pool.promise().query(
        `SELECT id, employee_id, org_id, referred_by_id, referred_by_name, referred_by_designation_id
         FROM employee_references WHERE id = ? AND org_id = ? LIMIT 1`,
        [referenceIdRaw, org_id],
      );
      existingRows = rows;
    } else {
      const [rows] = await pool.promise().query(
        `SELECT id, employee_id, org_id, referred_by_id, referred_by_name, referred_by_designation_id
         FROM employee_references WHERE employee_id = ? AND org_id = ? LIMIT 1`,
        [employeeLookupId, org_id],
      );
      existingRows = rows;
    }

    if (!existingRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee reference not found",
      });
    }

    const existing = existingRows[0];
    const rowId = existing.id;

    let referred_by_id =
      req.body?.referred_by_id !== undefined
        ? req.body.referred_by_id
        : existing.referred_by_id;

    let referred_by_name =
      req.body?.referred_by_name !== undefined
        ? normalizeOptionalName(req.body.referred_by_name)
        : existing.referred_by_name == null
          ? null
          : String(existing.referred_by_name).trim();

    let referred_by_designation_id =
      req.body?.referred_by_designation_id !== undefined
        ? isBlank(req.body.referred_by_designation_id)
          ? null
          : Number(req.body.referred_by_designation_id)
        : existing.referred_by_designation_id;

    if (isBlank(referred_by_id)) {
      return res.status(400).json({
        success: false,
        message: "referred_by_id cannot be empty",
      });
    }

    if (
      String(existing.employee_id).trim() === String(referred_by_id).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "referred_by_id cannot be the same as the employee being referenced",
      });
    }

    if (referred_by_name != null && referred_by_name.length > 200) {
      return res.status(400).json({
        success: false,
        message: "referred_by_name must be at most 200 characters",
      });
    }

    if (
      referred_by_designation_id != null &&
      !Number.isFinite(Number(referred_by_designation_id))
    ) {
      return res.status(400).json({
        success: false,
        message: "referred_by_designation_id must be numeric or null",
      });
    }

    if (referred_by_designation_id != null) {
      const roleErr = await assertDesignationRoleForOrg(
        referred_by_designation_id,
        org_id,
      );
      if (roleErr) return res.status(roleErr.status).json(roleErr.body);
    }

    const refErr = await assertUserIsOrgMember(
      referred_by_id,
      org_id,
      "Referrer",
    );
    if (refErr) return res.status(refErr.status).json(refErr.body);

    const oldSnapshot = {
      id: existing.id,
      employee_id: existing.employee_id,
      org_id: existing.org_id,
      referred_by_id: existing.referred_by_id,
      referred_by_name: existing.referred_by_name,
      referred_by_designation_id: existing.referred_by_designation_id,
    };

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [updResult] = await connection.query(
        `UPDATE employee_references SET
           referred_by_id = ?,
           referred_by_name = ?,
           referred_by_designation_id = ?
         WHERE id = ? AND org_id = ?`,
        [
          referred_by_id,
          referred_by_name,
          referred_by_designation_id,
          rowId,
          org_id,
        ],
      );

      if (!updResult.affectedRows) {
        throw Object.assign(new Error("Failed to update employee reference"), {
          statusCode: 400,
        });
      }

      const newSnapshot = {
        id: rowId,
        employee_id: existing.employee_id,
        org_id: Number(org_id),
        referred_by_id: Number(referred_by_id),
        referred_by_name,
        referred_by_designation_id,
      };

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        existing.employee_id,
        org_id,
        "UPDATE_EMPLOYEE_REFERENCE",
        JSON.stringify(oldSnapshot),
        JSON.stringify(newSnapshot),
        "Employee reference updated",
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,
        message: "Employee reference updated successfully",
        data: newSnapshot,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    const statusCode =
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("update_employee_reference_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error updating employee reference"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

/** GET `/list?org_id=&page=&limit=` */
export const get_all_employee_references_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();
    const { page, limit, offset } = parsePagination(req.query);

    const [[countRow]] = await pool.promise().query(
      `SELECT COUNT(*) AS total FROM employee_references WHERE org_id = ?`,
      [org_id],
    );
    const total = Number(countRow?.total ?? 0);
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, referred_by_id, referred_by_name,
              referred_by_designation_id, created_at, updated_at
       FROM employee_references WHERE org_id = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [org_id, limit, offset],
    );

    return res.status(200).json({
      success: true,
      message: "OK",
      data: Array.isArray(rows) ? rows : [],
      pagination: {
        page,
        limit,
        total,
        total_pages,
        has_next: total_pages > 0 && page < total_pages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("get_all_employee_references_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading employee references",
    });
  }
};

/** GET `/by-employee/:employee_user_id?org_id=` */
export const get_employee_reference_for_user_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.query?.org_id;
    const employee_user_id = req.params?.employee_user_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(employee_user_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_user_id is required",
      });
    }

    const empErr = await assertUserIsOrgMember(
      employee_user_id,
      org_id,
      "Employee",
    );
    if (empErr) return res.status(empErr.status).json(empErr.body);

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, referred_by_id, referred_by_name,
              referred_by_designation_id, created_at, updated_at
       FROM employee_references
       WHERE employee_id = ? AND org_id = ?
       LIMIT 1`,
      [employee_user_id, org_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No reference record found for this employee",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OK",
      data: rows[0],
    });
  } catch (error) {
    console.error("get_employee_reference_for_user_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading employee reference",
    });
  }
};

/** GET `/detail/:reference_id?org_id=` */
export const get_single_employee_reference_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const reference_id = req.params?.reference_id;
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(reference_id)) {
      return res.status(400).json({
        success: false,
        message: "reference_id is required",
      });
    }

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, referred_by_id, referred_by_name,
              referred_by_designation_id, created_at, updated_at
       FROM employee_references WHERE id = ? AND org_id = ?
       LIMIT 1`,
      [reference_id, org_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee reference not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OK",
      data: rows[0],
    });
  } catch (error) {
    console.error("get_single_employee_reference_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading employee reference",
    });
  }
};

/**
 * DELETE `/detail/:reference_id?org_id=`
 */
export const delete_employee_reference_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const reference_id = req.params?.reference_id;
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(reference_id)) {
      return res.status(400).json({
        success: false,
        message: "reference_id is required",
      });
    }

    const [existingRows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, referred_by_id, referred_by_name, referred_by_designation_id
       FROM employee_references WHERE id = ? AND org_id = ? LIMIT 1`,
      [reference_id, org_id],
    );

    if (!existingRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee reference not found",
      });
    }

    const existing = existingRows[0];

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [delResult] = await connection.query(
        `DELETE FROM employee_references WHERE id = ? AND org_id = ?`,
        [reference_id, org_id],
      );

      if (!delResult.affectedRows) {
        throw Object.assign(new Error("Failed to delete employee reference"), {
          statusCode: 400,
        });
      }

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        existing.employee_id,
        org_id,
        "DELETE_EMPLOYEE_REFERENCE",
        JSON.stringify({
          id: existing.id,
          employee_id: existing.employee_id,
          org_id: existing.org_id,
          referred_by_id: existing.referred_by_id,
          referred_by_name: existing.referred_by_name,
          referred_by_designation_id: existing.referred_by_designation_id,
        }),
        null,
        "Employee reference deleted",
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,
        message: "Employee reference deleted successfully",
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    const statusCode =
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("delete_employee_reference_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error deleting employee reference"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};
