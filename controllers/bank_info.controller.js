import { pool } from "../db/connect.js";

const INSERT_ACTIVITY_SQL = `INSERT INTO apt_user_activity_logs
  (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

/**
 * @returns {Promise<{ status: number, body: object } | null>} Error envelope or null if OK.
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

/** Loose IFSC check (Indian format: 4 letters + 0 + 6 alphanumeric). */
function isLikelyValidIfsc(value) {
  const s = String(value).trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s);
}

/**
 * @param {object} fields Merged / submitted bank fields
 * @returns {string|null} Error message or null if valid
 */
function validateBankRecordFields(fields) {
  const account_holder_name = fields.account_holder_name;
  const account_number = fields.account_number;
  const bank_name = fields.bank_name;
  const bank_branch = fields.bank_branch;
  const ifsc_code = String(fields.ifsc_code ?? "").trim().toUpperCase();
  const uan_number = fields.uan_number;

  if (
    [account_holder_name, account_number, bank_name, bank_branch, ifsc_code].some((x) =>
      isBlank(x),
    )
  ) {
    return "account_holder_name, account_number, bank_name, bank_branch, and ifsc_code are required";
  }

  if (String(account_holder_name).trim().length > 200) {
    return "account_holder_name must be at most 200 characters";
  }
  if (String(account_number).trim().length > 100) {
    return "account_number must be at most 100 characters";
  }
  if (String(bank_name).trim().length > 250 || String(bank_branch).trim().length > 250) {
    return "bank_name and bank_branch must be at most 250 characters each";
  }
  if (ifsc_code.length > 20) {
    return "ifsc_code must be at most 20 characters";
  }
  if (!isLikelyValidIfsc(ifsc_code)) {
    return "ifsc_code must match standard IFSC format (e.g. SBIN0001234)";
  }
  if (uan_number != null && String(uan_number).trim() !== "" && String(uan_number).trim().length > 50) {
    return "uan_number must be at most 50 characters";
  }
  return null;
}

/**
 * POST JSON:
 * - org_id (required)
 * - user_id (required) — employee this bank account belongs to
 * - account_holder_name, account_number, bank_name, bank_branch, ifsc_code (required)
 * - uan_number (optional)
 */
export const create_bank_info_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;
    const targetUserIdRaw = req.body?.user_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(targetUserIdRaw)) {
      return res.status(400).json({
        success: false,
        message: "user_id is required (employee whose bank details are saved)",
      });
    }

    const user_id = String(targetUserIdRaw).trim();

    let account_holder_name = isBlank(req.body?.account_holder_name)
      ? ""
      : String(req.body.account_holder_name).trim();
    let account_number = isBlank(req.body?.account_number)
      ? ""
      : String(req.body.account_number).trim();
    let bank_name = isBlank(req.body?.bank_name) ? "" : String(req.body.bank_name).trim();
    let bank_branch = isBlank(req.body?.bank_branch) ? "" : String(req.body.bank_branch).trim();
    let ifsc_code = isBlank(req.body?.ifsc_code)
      ? ""
      : String(req.body.ifsc_code).trim().toUpperCase();
    const uan_number =
      req.body?.uan_number === undefined || req.body?.uan_number === null
        ? null
        : String(req.body.uan_number).trim() === ""
          ? null
          : String(req.body.uan_number).trim();

    /** Validate The Bank Info Fields */
    const validationErr = validateBankRecordFields({
      account_holder_name,
      account_number,
      bank_name,
      bank_branch,
      ifsc_code,
      uan_number,
    });
    if (validationErr) {
      return res.status(400).json({
        success: false,
        message: validationErr,
      });
    }

    const [targetUserRows] = await pool.promise().query(
      "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
      [user_id],
    );
    if (!targetUserRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee user not found",
      });
    }

    const [targetMemberRows] = await pool.promise().query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
      [user_id, org_id],
    );
    if (!targetMemberRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    /** Then Check If Bank Info Already Exists — UNIQUE(user_id, org_id) */
    const [existingRows] = await pool.promise().query(
      `SELECT id FROM employees_bank_info WHERE user_id = ? AND org_id = ? LIMIT 1`,
      [user_id, org_id],
    );
    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Bank info already exists for this employee in this organization; use update instead.",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [insertResult] = await connection.query(
        `INSERT INTO employees_bank_info
          (account_holder_name, account_number, bank_name, bank_branch, ifsc_code, uan_number, user_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account_holder_name,
          account_number,
          bank_name,
          bank_branch,
          ifsc_code,
          uan_number,
          user_id,
          org_id,
        ],
      );

      if (!insertResult.affectedRows) {
        throw Object.assign(new Error("Failed to save bank info"), {
          statusCode: 400,
        });
      }

      const rowId = insertResult.insertId;
      const payload = {
        id: rowId,
        account_holder_name,
        account_number,
        bank_name,
        bank_branch,
        ifsc_code,
        uan_number,
        user_id: Number(user_id),
        org_id: Number(org_id),
      };

      const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        user_id,
        org_id,
        "ADD_EMPLOYEE_BANK_INFO",
        null,
        JSON.stringify(payload),
        "Employee bank info created",
      ]);

      if (!activityResult || activityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Bank info created successfully",
        data: payload,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("bank_info transaction rollback failed:", rErr),
      );

      /** MySQL duplicate key — defensive */
      if (innerErr && innerErr.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "Bank info already exists for this employee in this organization",
        });
      }

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
      console.error("create_bank_info_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500 ? "Internal server error" : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

 
export const update_bank_info_controller = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;
    const bankRowIdRaw = req.body?.id;
    const targetUserIdRaw = req.body?.user_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(bankRowIdRaw) && isBlank(targetUserIdRaw)) {
      return res.status(400).json({
        success: false,
        message: "Provide id (bank row id) or user_id to identify the record",
      });
    }

    let existingRows;
    if (!isBlank(bankRowIdRaw)) {
      const [rows] = await pool.promise().query(
        `SELECT id, account_holder_name, account_number, bank_name, bank_branch,
                ifsc_code, uan_number, user_id, org_id
         FROM employees_bank_info WHERE id = ? AND org_id = ? LIMIT 1`,
        [bankRowIdRaw, org_id],
      );
      existingRows = rows;
    } else {
      const [rows] = await pool.promise().query(
        `SELECT id, account_holder_name, account_number, bank_name, bank_branch,
                ifsc_code, uan_number, user_id, org_id
         FROM employees_bank_info WHERE user_id = ? AND org_id = ? LIMIT 1`,
        [targetUserIdRaw, org_id],
      );
      existingRows = rows;
    }

    if (!existingRows.length) {
      return res.status(404).json({
        success: false,
        message: "Bank info not found for this organization",
      });
    }

    const existing = existingRows[0];
    const rowPk = existing.id;
    const rowUserId = existing.user_id;

    const account_holder_name =
      req.body.account_holder_name !== undefined
        ? String(req.body.account_holder_name).trim()
        : String(existing.account_holder_name ?? "").trim();

    const account_number =
      req.body.account_number !== undefined
        ? String(req.body.account_number).trim()
        : String(existing.account_number ?? "").trim();

    const bank_name =
      req.body.bank_name !== undefined
        ? String(req.body.bank_name).trim()
        : String(existing.bank_name ?? "").trim();

    const bank_branch =
      req.body.bank_branch !== undefined
        ? String(req.body.bank_branch).trim()
        : String(existing.bank_branch ?? "").trim();

    const ifsc_code =
      req.body.ifsc_code !== undefined
        ? String(req.body.ifsc_code).trim().toUpperCase()
        : String(existing.ifsc_code ?? "").trim().toUpperCase();

    let uan_number;
    if (req.body.uan_number !== undefined) {
      if (req.body.uan_number === null || req.body.uan_number === "") {
        uan_number = null;
      } else {
        uan_number = String(req.body.uan_number).trim();
        if (uan_number === "") uan_number = null;
      }
    } else if (existing.uan_number == null || existing.uan_number === "") {
      uan_number = null;
    } else {
      uan_number = String(existing.uan_number).trim();
    }

    const mergedForValidation = {
      account_holder_name,
      account_number,
      bank_name,
      bank_branch,
      ifsc_code,
      uan_number,
    };

    const validationErr = validateBankRecordFields(mergedForValidation);
    if (validationErr) {
      return res.status(400).json({
        success: false,
        message: validationErr,
      });
    }

    const oldSnapshot = {
      id: rowPk,
      account_holder_name: existing.account_holder_name,
      account_number: existing.account_number,
      bank_name: existing.bank_name,
      bank_branch: existing.bank_branch,
      ifsc_code: existing.ifsc_code,
      uan_number: existing.uan_number,
      user_id: existing.user_id,
      org_id: existing.org_id,
    };

    const newSnapshot = {
      id: rowPk,
      account_holder_name,
      account_number,
      bank_name,
      bank_branch,
      ifsc_code,
      uan_number,
      user_id: Number(rowUserId),
      org_id: Number(org_id),
    };

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [updResult] = await connection.query(
        `UPDATE employees_bank_info SET
           account_holder_name = ?,
           account_number = ?,
           bank_name = ?,
           bank_branch = ?,
           ifsc_code = ?,
           uan_number = ?
         WHERE id = ? AND org_id = ?`,
        [
          account_holder_name,
          account_number,
          bank_name,
          bank_branch,
          ifsc_code,
          uan_number,
          rowPk,
          org_id,
        ],
      );

      if (!updResult.affectedRows) {
        throw Object.assign(new Error("Failed to update bank info"), {
          statusCode: 400,
        });
      }

      const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        rowUserId,
        org_id,
        "UPDATE_EMPLOYEE_BANK_INFO",
        JSON.stringify(oldSnapshot),
        JSON.stringify(newSnapshot),
        "Employee bank info updated",
      ]);

      if (!activityResult || activityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,
        message: "Bank info updated successfully",
        data: newSnapshot,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("bank_info update transaction rollback failed:", rErr),
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
      console.error("update_bank_info_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500 ? "Internal server error" : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

// Get All Bank Info Controller
export const get_single_bank_info_controller = async (req, res) => {};
