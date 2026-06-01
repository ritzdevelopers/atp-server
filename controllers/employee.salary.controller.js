import { pool } from "../db/connect.js";

function parsePositiveInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, message: `${fieldName} must be a positive integer` };
  }
  return { ok: true, value: n };
}

function parseNonNegativeSalary(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: false, message: `${fieldName} is required` };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: `${fieldName} must be a non-negative number` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function computeGrossSalary(basic, hra, special, convey) {
  return Math.round((basic + hra + special + convey) * 100) / 100;
}

function mapSalaryResponse(row, employeeName) {
  const basicSalary = Number(row.basic_salary);
  const houseRentAllowance = Number(row.house_rent_allowance);
  const specialAllowance = Number(row.special_allowance);
  const convey = Number(row.convey);

  return {
    salary_id: row.id,
    employee_id: row.employee_id,
    employee_name: employeeName,
    org_id: row.org_id,
    basic_salary: basicSalary,
    house_rent_allowance: houseRentAllowance,
    special_allowance: specialAllowance,
    convey,
    gross_salary: computeGrossSalary(
      basicSalary,
      houseRentAllowance,
      specialAllowance,
      convey,
    ),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** @param {"body" | "query"} employeeFrom */
function resolveOrgEmployeeContext(req, employeeFrom = "body") {
  const source = employeeFrom === "query" ? req.query : req.body;
  const orgIdRaw = req.org_id ?? source?.org_id;

  const orgIdParsed = parsePositiveInt(orgIdRaw, "org_id");
  if (!orgIdParsed.ok) {
    return { ok: false, status: 400, message: orgIdParsed.message };
  }

  const employeeIdParsed = parsePositiveInt(source?.employee_id, "employee_id");
  if (!employeeIdParsed.ok) {
    return { ok: false, status: 400, message: employeeIdParsed.message };
  }

  const actionByParsed = parsePositiveInt(req.user?.user_id, "action user id");
  if (!actionByParsed.ok) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  return {
    ok: true,
    orgId: orgIdParsed.value,
    employeeId: employeeIdParsed.value,
    actionByUserId: actionByParsed.value,
  };
}

function parseSalaryPayload(body) {
  const basicParsed = parseNonNegativeSalary(body?.basic_salary, "basic_salary");
  if (!basicParsed.ok) return basicParsed;

  const hraParsed = parseNonNegativeSalary(
    body?.house_rent_allowance,
    "house_rent_allowance",
  );
  if (!hraParsed.ok) return hraParsed;

  const specialParsed = parseNonNegativeSalary(
    body?.special_allowance,
    "special_allowance",
  );
  if (!specialParsed.ok) return specialParsed;

  const conveyParsed = parseNonNegativeSalary(body?.convey, "convey");
  if (!conveyParsed.ok) return conveyParsed;

  return {
    ok: true,
    basicSalary: basicParsed.value,
    houseRentAllowance: hraParsed.value,
    specialAllowance: specialParsed.value,
    convey: conveyParsed.value,
  };
}

/** POST — create employee salary (one record per employee per org). */
export const register_employee_salary_controller = async (req, res) => {
  let connection;

  try {
    const ctx = resolveOrgEmployeeContext(req, "body");
    if (!ctx.ok) {
      return res.status(ctx.status).json({ success: false, message: ctx.message });
    }

    const { orgId, employeeId, actionByUserId: actionByUserIdNum } = ctx;

    const salaryParsed = parseSalaryPayload(req.body);
    if (!salaryParsed.ok) {
      return res.status(400).json({ success: false, message: salaryParsed.message });
    }

    const {
      basicSalary,
      houseRentAllowance,
      specialAllowance,
      convey,
    } = salaryParsed;
    const grossSalary = computeGrossSalary(
      basicSalary,
      houseRentAllowance,
      specialAllowance,
      convey,
    );

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [[orgRow]] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
      [orgId],
    );
    if (!orgRow) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [actionMemberRows] = await connection.query(
      `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
      [actionByUserIdNum, orgId],
    );
    if (actionMemberRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const [[employeeRow]] = await connection.query(
      `SELECT u.id, u.user_name
       FROM apt_org_members m
       INNER JOIN apt_users u ON u.id = m.user_id
       WHERE m.user_id = ? AND m.org_id = ?
       LIMIT 1`,
      [employeeId, orgId],
    );
    if (!employeeRow) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    const [existingSalaryRows] = await connection.query(
      `SELECT id FROM employee_salary WHERE employee_id = ? AND org_id = ? LIMIT 1`,
      [employeeId, orgId],
    );
    if (existingSalaryRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Employee salary already exists for this organization",
        data: { existing_salary_id: existingSalaryRows[0].id },
      });
    }

    const [[performerRow]] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ? LIMIT 1",
      [actionByUserIdNum],
    );
    const performerName =
      performerRow?.user_name?.trim() || `User #${actionByUserIdNum}`;

    const employeeName =
      employeeRow.user_name?.trim() || `User #${employeeId}`;

    const [insertResult] = await connection.query(
      `INSERT INTO employee_salary (
        employee_id,
        org_id,
        basic_salary,
        house_rent_allowance,
        special_allowance,
        convey
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        orgId,
        basicSalary,
        houseRentAllowance,
        specialAllowance,
        convey,
      ],
    );

    if (!insertResult?.affectedRows) {
      throw new Error("Failed to create employee salary");
    }

    const salaryId = insertResult.insertId;

    const activityOverview = `Created salary for ${employeeName} (basic ${basicSalary}, HRA ${houseRentAllowance}, special ${specialAllowance}, convey ${convey}; gross ${grossSalary})`;

    const [activityResult] = await connection.query(
      `INSERT INTO management_activity_log (
        org_id,
        activity_type,
        activity_overview,
        performed_by,
        performed_by_name
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        orgId,
        "CREATE_EMPLOYEE_SALARY",
        activityOverview,
        actionByUserIdNum,
        performerName,
      ],
    );

    if (!activityResult?.affectedRows) {
      throw new Error("Failed to save management activity log");
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Employee salary created successfully",
      data: mapSalaryResponse(
        {
          id: salaryId,
          employee_id: employeeId,
          org_id: orgId,
          basic_salary: basicSalary,
          house_rent_allowance: houseRentAllowance,
          special_allowance: specialAllowance,
          convey,
        },
        employeeName,
      ),
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error(
          "register_employee_salary_controller rollback:",
          rollbackErr,
        );
      }
    }

    console.error("register_employee_salary_controller:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Employee salary already exists for this organization",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        process.env.NODE_ENV === "development" && error?.message
          ? error.message
          : "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/** GET — salary for one employee in the org (`employee_id` query param). */
export const get_employee_salary_controller = async (req, res) => {
  try {
    const ctx = resolveOrgEmployeeContext(req, "query");
    if (!ctx.ok) {
      return res.status(ctx.status).json({ success: false, message: ctx.message });
    }

    const { orgId, employeeId, actionByUserId } = ctx;

    const [actionMemberRows] = await pool.promise().query(
      `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
      [actionByUserId, orgId],
    );
    if (actionMemberRows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const [[employeeRow]] = await pool.promise().query(
      `SELECT u.id, u.user_name
       FROM apt_org_members m
       INNER JOIN apt_users u ON u.id = m.user_id
       WHERE m.user_id = ? AND m.org_id = ?
       LIMIT 1`,
      [employeeId, orgId],
    );
    if (!employeeRow) {
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    const [[salaryRow]] = await pool.promise().query(
      `SELECT
        id,
        employee_id,
        org_id,
        basic_salary,
        house_rent_allowance,
        special_allowance,
        convey,
        created_at,
        updated_at
       FROM employee_salary
       WHERE employee_id = ? AND org_id = ?
       LIMIT 1`,
      [employeeId, orgId],
    );

    if (!salaryRow) {
      return res.status(404).json({
        success: false,
        message: "Employee salary not found",
      });
    }

    const employeeName =
      employeeRow.user_name?.trim() || `User #${employeeId}`;

    return res.status(200).json({
      success: true,
      message: "Employee salary fetched successfully",
      data: mapSalaryResponse(salaryRow, employeeName),
    });
  } catch (error) {
    console.error("get_employee_salary_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/** PUT — update salary for one employee (`employee_id` in body). */
export const update_employee_salary_controller = async (req, res) => {
  let connection;

  try {
    const ctx = resolveOrgEmployeeContext(req, "body");
    if (!ctx.ok) {
      return res.status(ctx.status).json({ success: false, message: ctx.message });
    }

    const { orgId, employeeId, actionByUserId: actionByUserIdNum } = ctx;

    const salaryParsed = parseSalaryPayload(req.body);
    if (!salaryParsed.ok) {
      return res.status(400).json({ success: false, message: salaryParsed.message });
    }

    const {
      basicSalary,
      houseRentAllowance,
      specialAllowance,
      convey,
    } = salaryParsed;
    const grossSalary = computeGrossSalary(
      basicSalary,
      houseRentAllowance,
      specialAllowance,
      convey,
    );

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [[orgRow]] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
      [orgId],
    );
    if (!orgRow) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [actionMemberRows] = await connection.query(
      `SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
      [actionByUserIdNum, orgId],
    );
    if (actionMemberRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const [[employeeRow]] = await connection.query(
      `SELECT u.id, u.user_name
       FROM apt_org_members m
       INNER JOIN apt_users u ON u.id = m.user_id
       WHERE m.user_id = ? AND m.org_id = ?
       LIMIT 1`,
      [employeeId, orgId],
    );
    if (!employeeRow) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    const [[existingSalary]] = await connection.query(
      `SELECT
        id,
        basic_salary,
        house_rent_allowance,
        special_allowance,
        convey
       FROM employee_salary
       WHERE employee_id = ? AND org_id = ?
       LIMIT 1`,
      [employeeId, orgId],
    );

    if (!existingSalary) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee salary not found. Create a salary record first.",
      });
    }

    const [[performerRow]] = await connection.query(
      "SELECT user_name FROM apt_users WHERE id = ? LIMIT 1",
      [actionByUserIdNum],
    );
    const performerName =
      performerRow?.user_name?.trim() || `User #${actionByUserIdNum}`;
    const employeeName =
      employeeRow.user_name?.trim() || `User #${employeeId}`;

    const [updateResult] = await connection.query(
      `UPDATE employee_salary
       SET
         basic_salary = ?,
         house_rent_allowance = ?,
         special_allowance = ?,
         convey = ?
       WHERE employee_id = ? AND org_id = ?`,
      [
        basicSalary,
        houseRentAllowance,
        specialAllowance,
        convey,
        employeeId,
        orgId,
      ],
    );

    if (!updateResult?.affectedRows) {
      throw new Error("Failed to update employee salary");
    }

    const prevGross = computeGrossSalary(
      Number(existingSalary.basic_salary),
      Number(existingSalary.house_rent_allowance),
      Number(existingSalary.special_allowance),
      Number(existingSalary.convey),
    );

    const activityOverview = `Updated salary for ${employeeName} (gross ${prevGross} → ${grossSalary}; basic ${basicSalary}, HRA ${houseRentAllowance}, special ${specialAllowance}, convey ${convey})`;

    const [activityResult] = await connection.query(
      `INSERT INTO management_activity_log (
        org_id,
        activity_type,
        activity_overview,
        performed_by,
        performed_by_name
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        orgId,
        "UPDATE_EMPLOYEE_SALARY",
        activityOverview,
        actionByUserIdNum,
        performerName,
      ],
    );

    if (!activityResult?.affectedRows) {
      throw new Error("Failed to save management activity log");
    }

    const [[updatedRow]] = await connection.query(
      `SELECT
        id,
        employee_id,
        org_id,
        basic_salary,
        house_rent_allowance,
        special_allowance,
        convey,
        created_at,
        updated_at
       FROM employee_salary
       WHERE id = ?
       LIMIT 1`,
      [existingSalary.id],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Employee salary updated successfully",
      data: mapSalaryResponse(updatedRow, employeeName),
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("update_employee_salary_controller rollback:", rollbackErr);
      }
    }

    console.error("update_employee_salary_controller:", error);

    return res.status(500).json({
      success: false,
      message:
        process.env.NODE_ENV === "development" && error?.message
          ? error.message
          : "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
