import { pool } from "../db/connect.js";
import exit_confirmation from "../utils/exit_confirmation.js";
import exit_process_handler from "../utils/exit_in_process.js";

const EXIT_PROCESS_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "in_progress",
];

const EXIT_PROCESS_ACTIONS = ["resignation", "termination"];

const INSERT_ACTIVITY_SQL = `
  INSERT INTO apt_user_activity_logs
  (
    performed_by,
    affected_user_id,
    org_id,
    action_type,
    old_value,
    new_value,
    action_reason
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const create_employee_exit_process = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;
    const { org_id } = req;

    const {
      user_id: employee_id,
      team_id,
      action_type,
      action_reason,
      application_status,
      exit_date,
      last_working_day,
      response_message,
    } = req.body;

    // ---------------- VALIDATIONS ----------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!employee_id || !action_type || !action_reason) {
      return res.status(400).json({
        success: false,
        message: "employee_id, action_type and action_reason are required",
      });
    }

    const normalizedActionType = String(action_type).trim().toLowerCase();

    if (!EXIT_PROCESS_ACTIONS.includes(normalizedActionType)) {
      return res.status(400).json({
        success: false,
        message: "action_type must be resignation or termination",
      });
    }

    const normalizedStatus = application_status
      ? String(application_status).trim().toLowerCase()
      : "pending";

    if (!EXIT_PROCESS_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message:
          "application_status must be pending, approved, rejected or in_progress",
      });
    }

    // ---------------- DATE VALIDATION ----------------

    if (
      exit_date &&
      last_working_day &&
      new Date(last_working_day) > new Date(exit_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "last_working_day cannot be after exit_date",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // Check if action performer is organization member
    // ---------------------------------------------------

    const [actionUserMember] = await connection.query(
      `
      SELECT id
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, action_performed_by_id],
    );

    if (actionUserMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Action performer is not a member of this organization",
      });
    }
    // Get user name of action performer from apt_users
    const [actionUser] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [action_performed_by_id],
    );
    const action_performed_by_name = actionUser[0].user_name;

    // ---------------------------------------------------
    // Check organization exists
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
      SELECT id
      FROM apt_organizations
      WHERE id = ?
      `,
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // Check employee exists
    // ---------------------------------------------------

    const [employee] = await connection.query(
      `
      SELECT id, user_name, user_email
      FROM apt_users
      WHERE id = ?
      `,
      [employee_id],
    );

    if (employee.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const employee_name = employee[0].user_name;

    // ---------------------------------------------------
    // Check employee organization membership
    // ---------------------------------------------------

    const [employeeMember] = await connection.query(
      `
      SELECT id
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, employee_id],
    );

    if (employeeMember.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // Check team validity
    // ---------------------------------------------------

    if (team_id) {
      const [team] = await connection.query(
        `
        SELECT id
        FROM org_teams
        WHERE id = ?
        AND org_id = ?
        `,
        [team_id, org_id],
      );

      if (team.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Team not found",
        });
      }
    }

    // ---------------------------------------------------
    // Prevent duplicate active exit process
    // ---------------------------------------------------

    const [existingExitProcess] = await connection.query(
      `
      SELECT id
      FROM employee_exit_process
      WHERE employee_id = ?
      AND org_id = ?
      AND application_status IN ('pending', 'in_progress')
      `,
      [employee_id, org_id],
    );

    if (existingExitProcess.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Employee already has an active exit process",
      });
    }

    // ---------------------------------------------------
    // Create employee exit process
    // ---------------------------------------------------

    const [insertResult] = await connection.query(
      `
      INSERT INTO employee_exit_process
      (
        employee_id,
        org_id,
        team_id,
        action_type,
        action_reason,
        application_status,
        exit_date,
        last_working_day,
        action_performed_by,
        response_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        employee_id,
        org_id,
        team_id || null,
        normalizedActionType,
        action_reason,
        normalizedStatus,
        exit_date || null,
        last_working_day || null,
        action_performed_by_id,
        response_message || null,
      ],
    );

    if (insertResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to create employee exit process",
      });
    }

    // ---------------------------------------------------
    // Save activity log
    // ---------------------------------------------------

    const activityPayload = {
      exit_process_id: insertResult.insertId,
      employee_id,
      org_id,
      team_id: team_id || null,
      action_type: normalizedActionType,
      action_reason,
      application_status: normalizedStatus,
      exit_date: exit_date || null,
      last_working_day: last_working_day || null,
      response_message: response_message || null,
    };

    const is_resignation =
      Number(employee_id) === Number(action_performed_by_id);

    const activity_reason = `
      Employee exit process ${
        is_resignation ? "resignation" : "termination"
      } created for employee ${employee_name}
      ${is_resignation ? "by" : "for"} ${action_performed_by_name}
    `;

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      employee_id,
      org_id,
      "CREATE_EMPLOYEE_EXIT_PROCESS",
      null,
      JSON.stringify(activityPayload),
      activity_reason.trim(),
    ]);

    if (activityResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // Commit transaction
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // Return response
    // ---------------------------------------------------

    return res.status(201).json({
      success: true,
      message: "Employee exit process created successfully",
      data: {
        id: insertResult.insertId,
        employee_id,
        org_id,
        team_id: team_id || null,
        action_type: normalizedActionType,
        application_status: normalizedStatus,
        exit_date: exit_date || null,
        last_working_day: last_working_day || null,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error in create_employee_exit_process:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const exit_in_process = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;

    const { org_id } = req;

    const { exit_process_id } = req.params;

    const { assets_handover_data, application_status } = req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "Exit process id is required",
      });
    }

    if (!assets_handover_data || !Array.isArray(assets_handover_data)) {
      return res.status(400).json({
        success: false,
        message: "assets_handover_data must be an array",
      });
    }

    if (application_status !== "in_progress") {
      return res.status(400).json({
        success: false,
        message: "application_status must be in_progress",
      });
    }

    // ---------------------------------------------------
    // DB CONNECTION
    // ---------------------------------------------------

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION PERFORMER MEMBERSHIP
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
        SELECT *
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // GET ACTION USER NAME
    // ---------------------------------------------------

    const [actionUserName] = await connection.query(
      `
        SELECT user_name
        FROM apt_users
        WHERE id = ?
        `,
      [action_performed_by_id],
    );

    if (actionUserName.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Action performer not found",
      });
    }

    const action_user_name = actionUserName[0].user_name;

    // ---------------------------------------------------
    // CHECK EXIT PROCESS EXISTS
    // ---------------------------------------------------

    const [exitProcess] = await connection.query(
      `
        SELECT *
        FROM employee_exit_process
        WHERE id = ?
        AND org_id = ?
        `,
      [exit_process_id, org_id],
    );

    if (exitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Exit process not found",
      });
    }

    const existingExitProcess = exitProcess[0];

    const employee_id = existingExitProcess.employee_id;

    const normalizedExistingExitStatus = String(
      existingExitProcess.application_status ?? "",
    )
      .trim()
      .toLowerCase();

    if (
      normalizedExistingExitStatus !== "pending" &&
      normalizedExistingExitStatus !== "in_progress"
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Asset handovers can only be submitted when exit is pending or in progress",
      });
    }

    // ---------------------------------------------------
    // CALL EXIT PROCESS HANDLER (exit_in_process.js)
    // ---------------------------------------------------

    const processResponse = await exit_process_handler(
      employee_id,
      org_id,
      assets_handover_data,
    );

    if (!processResponse.success) {
      await connection.rollback();

      return res.status(processResponse.status || 400).json({
        success: false,
        message: processResponse.message,
        data: processResponse.data,
      });
    }

    const alreadyInProgress = normalizedExistingExitStatus === "in_progress";

    // ---------------------------------------------------
    // UPDATE APPLICATION STATUS (pending → in_progress first time only)
    // ---------------------------------------------------

    if (!alreadyInProgress) {
      const [updateResult] = await connection.query(
        `
        UPDATE employee_exit_process
        SET
          application_status = ?
        WHERE id = ?
        `,
        [application_status, exit_process_id],
      );

      if (updateResult.affectedRows < 1) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Failed to update application status",
        });
      }
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const activityPayload = {
      exit_process_id,
      employee_id,
      org_id,
      application_status,
      assets_handover_data,
      already_in_progress: alreadyInProgress,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      employee_id,
      org_id,
      alreadyInProgress
        ? "EMPLOYEE_EXIT_ASSET_HANDOVER_IN_PROGRESS"
        : "UPDATE_EMPLOYEE_EXIT_PROCESS_APPLICATION_STATUS",
      JSON.stringify(existingExitProcess),
      JSON.stringify(activityPayload),
      alreadyInProgress
        ? `Employee exit assets handed over (${assets_handover_data.length} asset(s)) by ${action_user_name} while in progress`
        : `Employee exit process application status updated to ${application_status} by ${action_user_name}`,
    ]);

    if (activityResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: alreadyInProgress
        ? "Asset handover recorded successfully"
        : "Employee exit process moved to in_progress successfully",
      data: {
        exit_process_id,
        employee_id,
        application_status: alreadyInProgress
          ? existingExitProcess.application_status
          : application_status,
        assets_handover_data,
      },
    });
  } catch (error) {
    console.error("Error in exit_in_process:", error);

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const exit_completed = async (req, res) => {
  let connection;

  try {
    connection = await pool.promise().getConnection();

    const { user_id: action_performed_by_id } = req.user;

    const { org_id } = req;

    const { exit_process_id } = req.params;

    const { application_status, employee_id, response_message } = req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "Exit process id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "Employee id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "Employee id is required",
      });
    }

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION PERFORMER MEMBERSHIP
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
      SELECT *
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // GET ACTION USER NAME
    // ---------------------------------------------------

    const [actionUserName] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [action_performed_by_id],
    );

    if (actionUserName.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Action performer not found",
      });
    }

    const action_user_name = actionUserName[0].user_name;

    // ---------------------------------------------------
    // CHECK EMPLOYEE EXISTS
    // ---------------------------------------------------

    const [employee] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [employee_id],
    );

    if (employee.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const employee_name = employee[0].user_name;

    // ---------------------------------------------------
    // CHECK EMPLOYEE MEMBERSHIP
    // ---------------------------------------------------

    const [validMember] = await connection.query(
      `
      SELECT *
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, employee_id],
    );

    if (validMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // CHECK EXIT PROCESS
    // ---------------------------------------------------

    const [exitProcess] = await connection.query(
      `
      SELECT *
      FROM employee_exit_process
      WHERE id = ?
      AND org_id = ?
      AND employee_id = ?
      `,
      [exit_process_id, org_id, employee_id],
    );

    if (exitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Exit process not found",
      });
    }

    const exitProcessData = exitProcess[0];

    const allowedExitAppStatuses = [
      "pending",
      "approved",
      "rejected",
      "in_progress",
    ];

    const normalizedAppStatus = String(
      application_status ?? "",
    )
      .trim()
      .toLowerCase();

    if (!allowedExitAppStatuses.includes(normalizedAppStatus)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `application_status must be one of: ${allowedExitAppStatuses.join(", ")}`,
      });
    }

    // ---------------------------------------------------
    // PREVENT DUPLICATE COMPLETION
    // ---------------------------------------------------

    if (exitProcessData.application_status === "approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Exit process already completed",
      });
    }

    // ---------------------------------------------------
    // CHECK EXIT CONFIRMATION
    // ---------------------------------------------------

    const result = await exit_confirmation(employee_id, org_id);

    if (!result.success) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: result.message,
        data: result.data || null,
      });
    }

    // ---------------------------------------------------
    // UPDATE APPLICATION STATUS
    // ---------------------------------------------------

    const [updateResult] = await connection.query(
      `
      UPDATE employee_exit_process
      SET
        application_status = ?,
        resolved_at = NOW(),
        response_message = ?,
        response_by_id = ?
      WHERE id = ?
      AND org_id = ?
      AND employee_id = ?
      `,
      [
        normalizedAppStatus,
        response_message,
        action_performed_by_id,
        exit_process_id,
        org_id,
        employee_id,
      ],
    );

    const [updateIsActiveStatusOfOrgMember] = await connection.query(`
      UPDATE apt_org_members
      SET is_active = 0
      WHERE org_id = ?
      AND user_id = ?
      `, [org_id, employee_id]);

    if (updateIsActiveStatusOfOrgMember.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update is active status of org member",
      });
    }

    if (updateResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update application status",
      });
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const updatedPayload = {
      exit_process_id,
      employee_id,
      org_id,
      application_status: normalizedAppStatus,
      response_message,
      response_by: action_performed_by_id,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      employee_id,
      org_id,
      "EXIT_CONFIRMATION",
      JSON.stringify(exitProcessData),
      JSON.stringify(updatedPayload),
      `Exit process completed by ${action_user_name} for employee ${employee_name}`,
    ]);

    if (activityResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Exit process completed successfully",
      data: updatedPayload,
    });
  } catch (error) {
    console.error("Error in exit_completed:", error);

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const exit_cancelled = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;

    const { org_id } = req;

    const { exit_process_id } = req.params;

    const { application_status, employee_id, response_message } = req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "Exit process id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "Employee id is required",
      });
    }

    if (!application_status) {
      return res.status(400).json({
        success: false,
        message: "Application status is required",
      });
    }

    if (!response_message) {
      return res.status(400).json({
        success: false,
        message: "Response message is required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION USER MEMBERSHIP
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
      SELECT *
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // GET ACTION USER NAME
    // ---------------------------------------------------

    const [actionUserName] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [action_performed_by_id],
    );

    if (actionUserName.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Action performer not found",
      });
    }

    const action_user_name = actionUserName[0].user_name;

    // ---------------------------------------------------
    // CHECK EMPLOYEE
    // ---------------------------------------------------

    const [employee] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [employee_id],
    );

    if (employee.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const employee_name = employee[0].user_name;

    // ---------------------------------------------------
    // CHECK EMPLOYEE MEMBERSHIP
    // ---------------------------------------------------

    const [validMember] = await connection.query(
      `
      SELECT *
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, employee_id],
    );

    if (validMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // CHECK EXIT PROCESS
    // ---------------------------------------------------

    const [exitProcess] = await connection.query(
      `
      SELECT *
      FROM employee_exit_process
      WHERE id = ?
      AND org_id = ?
      AND employee_id = ?
      `,
      [exit_process_id, org_id, employee_id],
    );

    if (exitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Exit process not found",
      });
    }

    const exitProcessData = exitProcess[0];

    // ---------------------------------------------------
    // UPDATE APPLICATION STATUS
    // ---------------------------------------------------

    const [updateResult] = await connection.query(
      `
      UPDATE employee_exit_process
      SET
        application_status = ?,
        resolved_at = NOW(),
        response_message = ?,
        response_by_id = ?
      WHERE id = ?
      AND org_id = ?
      AND employee_id = ?
      `,
      [
        application_status,
        response_message,
        action_performed_by_id,
        exit_process_id,
        org_id,
        employee_id,
      ],
    );

    if (updateResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update application status",
      });
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const updatedPayload = {
      exit_process_id,
      employee_id,
      org_id,
      application_status,
      response_message,
      response_by: action_performed_by_id,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      employee_id,
      org_id,
      "EXIT_CANCELLED",
      JSON.stringify(exitProcessData),
      JSON.stringify(updatedPayload),
      `Exit process cancelled by ${action_user_name} for employee ${employee_name}`,
    ]);

    if (activityResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Exit process cancelled successfully",
      data: updatedPayload,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error in exit_cancelled:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const correction_in_employee_exit_process = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;
    const { org_id } = req;
    const { id: exit_process_id } = req.params;

    const { action_reason, exit_date, last_working_day, response_message } =
      req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "Exit process id is required",
      });
    }

    // PATCH VALIDATION
    const hasPatchData =
      action_reason !== undefined ||
      exit_date !== undefined ||
      last_working_day !== undefined ||
      response_message !== undefined;

    if (!hasPatchData) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update",
      });
    }

    // Date validation
    if (exit_date && last_working_day) {
      const exitDateObj = new Date(exit_date);
      const lastWorkingObj = new Date(last_working_day);

      if (exitDateObj < lastWorkingObj) {
        return res.status(400).json({
          success: false,
          message:
            "exit_date must be greater than or equal to last_working_day",
        });
      }
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION USER MEMBERSHIP
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
          SELECT *
          FROM apt_org_members
          WHERE org_id = ?
          AND user_id = ?
        `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }
    // Get user name of action performer from apt_users
    const [actionUserName] = await connection.query(
      `
      SELECT user_name
      FROM apt_users
      WHERE id = ?
      `,
      [actionUser[0].user_id],
    );
    if (actionUserName.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Action performer not found",
      });
    }
    const action_user_name = actionUserName[0].user_name;

    // ---------------------------------------------------
    // CHECK ORGANIZATION
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
          SELECT id
          FROM apt_organizations
          WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // CHECK EXIT PROCESS
    // ---------------------------------------------------

    const [existingExitProcess] = await connection.query(
      `
          SELECT *
          FROM employee_exit_process
          WHERE id = ?
          AND org_id = ?
        `,
      [exit_process_id, org_id],
    );

    if (existingExitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee exit process not found",
      });
    }

    const previousData = existingExitProcess[0];

    // ---------------------------------------------------
    // PREPARE PATCH VALUES
    // ---------------------------------------------------

    const updated_action_reason =
      action_reason !== undefined ? action_reason : previousData.action_reason;

    const updated_exit_date =
      exit_date !== undefined ? exit_date : previousData.exit_date;

    const updated_last_working_day =
      last_working_day !== undefined
        ? last_working_day
        : previousData.last_working_day;

    const updated_response_message =
      response_message !== undefined
        ? response_message
        : previousData.response_message;

    // ---------------------------------------------------
    // FINAL DATE VALIDATION
    // ---------------------------------------------------

    if (updated_exit_date && updated_last_working_day) {
      const exitDateObj = new Date(updated_exit_date);
      const lastWorkingObj = new Date(updated_last_working_day);

      if (exitDateObj < lastWorkingObj) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "exit_date must be greater than or equal to last_working_day",
        });
      }
    }

    // ---------------------------------------------------
    // UPDATE EXIT PROCESS
    // ---------------------------------------------------

    const [updateResult] = await connection.query(
      `
          UPDATE employee_exit_process
          SET
            action_reason = ?,
            exit_date = ?,
            last_working_day = ?,
            response_message = ?
          WHERE id = ?
          AND org_id = ?
        `,
      [
        updated_action_reason,
        updated_exit_date,
        updated_last_working_day,
        updated_response_message,
        exit_process_id,
        org_id,
      ],
    );

    if (!updateResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update employee exit process",
      });
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const updatedPayload = {
      id: previousData.id,
      employee_id: previousData.employee_id,
      org_id: previousData.org_id,
      action_reason: updated_action_reason,
      exit_date: updated_exit_date,
      last_working_day: updated_last_working_day,
      response_message: updated_response_message,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      previousData.employee_id,
      org_id,
      "CORRECTION_IN_EMPLOYEE_EXIT_PROCESS",
      JSON.stringify(previousData),
      JSON.stringify(updatedPayload),
      `Employee exit process corrected by ${action_user_name}`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Employee exit process corrected successfully",
      data: updatedPayload,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error in correction_in_employee_exit_process:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const delete_employee_exit_process = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;
    const { org_id } = req;
    const { id: exit_process_id } = req.params;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "Exit process id is required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION USER MEMBERSHIP
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
          SELECT id, user_name
          FROM apt_org_members
          WHERE org_id = ?
          AND user_id = ?
        `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const action_user_name = actionUser[0].user_name;

    // ---------------------------------------------------
    // CHECK ORGANIZATION
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
          SELECT id
          FROM apt_organizations
          WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // CHECK EXIT PROCESS
    // ---------------------------------------------------

    const [exitProcess] = await connection.query(
      `
          SELECT *
          FROM employee_exit_process
          WHERE id = ?
          AND org_id = ?
        `,
      [exit_process_id, org_id],
    );

    if (exitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee exit process not found",
      });
    }

    const exitProcessData = exitProcess[0];

    // ---------------------------------------------------
    // CHECK OWNER OF EXIT PROCESS
    // ---------------------------------------------------

    if (
      Number(exitProcessData.action_performed_by) !==
      Number(action_performed_by_id)
    ) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You can only delete exit processes created by you",
      });
    }

    // ---------------------------------------------------
    // CHECK STATUS
    // ---------------------------------------------------

    const allowedStatuses = ["pending", "in_progress"];

    if (
      !allowedStatuses.includes(
        String(exitProcessData.application_status).toLowerCase(),
      )
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only pending or in_progress exit processes can be deleted",
      });
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_performed_by_id,
      exitProcessData.employee_id,
      org_id,
      "DELETE_EMPLOYEE_EXIT_PROCESS",
      JSON.stringify(exitProcessData),
      null,
      `Employee exit process deleted by ${action_user_name}`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // DELETE EXIT PROCESS
    // ---------------------------------------------------

    const [deleteResult] = await connection.query(
      `
          DELETE FROM employee_exit_process
          WHERE id = ?
          AND org_id = ?
        `,
      [exit_process_id, org_id],
    );

    if (!deleteResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to delete employee exit process",
      });
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Employee exit process deleted successfully",
      data: {
        deleted_exit_process_id: exit_process_id,
        employee_id: exitProcessData.employee_id,
        application_status: exitProcessData.application_status,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error in delete_employee_exit_process:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_employee_exit_process = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;

    const { org_id } = req;

    const { id: exit_process_id, employee_id } = req.params;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!exit_process_id && !employee_id) {
      return res.status(400).json({
        success: false,
        message: "exit_process_id or employee_id is required",
      });
    }

    connection = await pool.promise().getConnection();

    // ---------------------------------------------------
    // Check If action_performed_by_id is valid org member
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
      `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // Check If Organization Exists
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
      `,
      [org_id],
    );

    if (organization.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // Fetch Employee Exit Process + Assets + Handover Queries
    // ---------------------------------------------------

    let query = `
      SELECT
        eep.id,
        eep.employee_id,
        eep.org_id,
        eep.team_id,
        eep.action_type,
        eep.action_reason,
        eep.application_status,
        eep.exit_date,
        eep.last_working_day,
        eep.action_performed_by,
        eep.response_by_id,
        eep.response_message,
        eep.resolved_at,
        eep.created_at,
        eep.updated_at,

        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        emp.user_phone AS employee_phone,

        ot.team_name,

        ap.user_name AS action_performed_by_name,

        rp.user_name AS response_by_name,

        eua.id AS employee_asset_id,
        eua.asset_name AS employee_asset_name,
        eua.asset_summary AS employee_asset_summary,
        eua.asset_type AS employee_asset_type,
        eua.asset_image_url AS employee_asset_image_url,
        eua.is_returned,
        eua.returned_to_id,
        eua.handover_date_time,

        returned_user.user_name AS returned_to_name,

        hq.id AS handover_query_id,
        hq.asset_id,
        hq.custom_task_name,
        hq.manager_id,
        hq.handover_status,
        hq.remarks,
        hq.handover_date,
        hq.created_at AS handover_created_at,
        hq.updated_at AS handover_updated_at,

        manager.user_name AS manager_name,

        ea.asset_name,
        ea.asset_summary,
        ea.asset_type,
        ea.asset_image_url

      FROM employee_exit_process eep

      LEFT JOIN apt_users emp
      ON eep.employee_id = emp.id

      LEFT JOIN org_teams ot
      ON eep.team_id = ot.id

      LEFT JOIN apt_users ap
      ON eep.action_performed_by = ap.id

      LEFT JOIN apt_users rp
      ON eep.response_by_id = rp.id

      LEFT JOIN employee_assets eua
      ON eep.employee_id = eua.employee_id
      AND eep.org_id = eua.org_id

      LEFT JOIN apt_users returned_user
      ON eua.returned_to_id = returned_user.id

      LEFT JOIN handover_query hq
      ON eep.id = hq.employee_exit_process_id

      LEFT JOIN apt_users manager
      ON hq.manager_id = manager.id

      LEFT JOIN employee_assets ea
      ON hq.asset_id = ea.id
    `;

    let values = [];

    if (exit_process_id) {
      query += `
        WHERE eep.id = ?
        AND eep.org_id = ?
      `;

      values = [exit_process_id, org_id];
    } else {
      query += `
        WHERE eep.employee_id = ?
        AND eep.org_id = ?
      `;

      values = [employee_id, org_id];
    }

    query += ` ORDER BY hq.id DESC`;

    const [rows] = await connection.query(query, values);

    // ---------------------------------------------------
    // Check If Exit Process Exists
    // ---------------------------------------------------

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee exit process not found",
      });
    }

    // ---------------------------------------------------
    // FORMAT RESPONSE
    // ---------------------------------------------------

    const firstRow = rows[0];

    // ---------------------------------------------------
    // EMPLOYEE ASSETS
    // ---------------------------------------------------

    const assetMap = new Map();

    rows.forEach((row) => {
      if (row.employee_asset_id && !assetMap.has(row.employee_asset_id)) {
        assetMap.set(row.employee_asset_id, {
          id: row.employee_asset_id,

          asset_name: row.employee_asset_name,

          asset_summary: row.employee_asset_summary,

          asset_type: row.employee_asset_type,

          asset_image_url: row.employee_asset_image_url,

          is_returned: row.is_returned,

          returned_to_id: row.returned_to_id,

          returned_to_name: row.returned_to_name,

          handover_date_time: row.handover_date_time,
        });
      }
    });

    const employee_assets = Array.from(assetMap.values());

    // ---------------------------------------------------
    // HANDOVER QUERIES
    // ---------------------------------------------------

    const handoverMap = new Map();

    rows.forEach((row) => {
      if (row.handover_query_id && !handoverMap.has(row.handover_query_id)) {
        handoverMap.set(row.handover_query_id, {
          handover_query_id: row.handover_query_id,

          asset_id: row.asset_id,

          asset_name: row.asset_name,

          asset_summary: row.asset_summary,

          asset_type: row.asset_type,

          asset_image_url: row.asset_image_url,

          custom_task_name: row.custom_task_name,

          manager_id: row.manager_id,

          manager_name: row.manager_name,

          handover_status: row.handover_status,

          remarks: row.remarks,

          handover_date: row.handover_date,

          created_at: row.handover_created_at,

          updated_at: row.handover_updated_at,
        });
      }
    });

    const handover_queries = Array.from(handoverMap.values());

    // ---------------------------------------------------
    // FINAL RESPONSE
    // ---------------------------------------------------

    const formattedResponse = {
      id: firstRow.id,

      employee_id: firstRow.employee_id,

      employee_name: firstRow.employee_name,

      employee_email: firstRow.employee_email,

      employee_phone: firstRow.employee_phone,

      org_id: firstRow.org_id,

      team_id: firstRow.team_id,

      team_name: firstRow.team_name,

      action_type: firstRow.action_type,

      action_reason: firstRow.action_reason,

      application_status: firstRow.application_status,

      exit_date: firstRow.exit_date,

      last_working_day: firstRow.last_working_day,

      action_performed_by: firstRow.action_performed_by,

      action_performed_by_name: firstRow.action_performed_by_name,

      response_by_id: firstRow.response_by_id,

      response_by_name: firstRow.response_by_name,

      response_message: firstRow.response_message,

      resolved_at: firstRow.resolved_at,

      created_at: firstRow.created_at,

      updated_at: firstRow.updated_at,

      employee_assets,

      handover_queries,
    };

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Employee exit process fetched successfully",
      data: formattedResponse,
    });
  } catch (error) {
    console.error("Error in get_employee_exit_process:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};


export const get_my_exit_process = async (req, res) => {
  let connection;
  
  try {
    const { user_id } = req.user;

    const { org_id } = req;
 

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    connection = await pool.promise().getConnection();

    // ---------------------------------------------------
    // Check If action_performed_by_id is valid org member
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
      `,
      [org_id, user_id],
    );

    if (actionUser.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // Check If Organization Exists
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
      `,
      [org_id],
    );

    if (organization.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [exitPick] = await connection.query(
      `
        SELECT id
        FROM employee_exit_process
        WHERE employee_id = ?
        AND org_id = ?
        ORDER BY
          CASE
            WHEN application_status IN ('pending', 'in_progress') THEN 0
            ELSE 1
          END,
          created_at DESC
        LIMIT 1
      `,
      [user_id, org_id],
    );

    if (exitPick.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee exit process not found",
      });
    }

    const exit_process_id = exitPick[0].id;

    // ---------------------------------------------------
    // Fetch Employee Exit Process + Assets + Handover Queries
    // ---------------------------------------------------

    const query = `
      SELECT
        eep.id,
        eep.employee_id,
        eep.org_id,
        eep.team_id,
        eep.action_type,
        eep.action_reason,
        eep.application_status,
        eep.exit_date,
        eep.last_working_day,
        eep.action_performed_by,
        eep.response_by_id,
        eep.response_message,
        eep.resolved_at,
        eep.created_at,
        eep.updated_at,

        emp.user_name AS employee_name,
        emp.user_email AS employee_email,
        emp.user_phone AS employee_phone,

        ot.team_name,

        ap.user_name AS action_performed_by_name,

        rp.user_name AS response_by_name,

        eua.id AS employee_asset_id,
        eua.asset_name AS employee_asset_name,
        eua.asset_summary AS employee_asset_summary,
        eua.asset_type AS employee_asset_type,
        eua.asset_image_url AS employee_asset_image_url,
        eua.is_returned,
        eua.returned_to_id,
        eua.handover_date_time,

        returned_user.user_name AS returned_to_name,

        hq.id AS handover_query_id,
        hq.asset_id,
        hq.custom_task_name,
        hq.manager_id,
        hq.handover_status,
        hq.remarks,
        hq.handover_date,
        hq.created_at AS handover_created_at,
        hq.updated_at AS handover_updated_at,

        manager.user_name AS manager_name,

        ea.asset_name,
        ea.asset_summary,
        ea.asset_type,
        ea.asset_image_url

      FROM employee_exit_process eep

      LEFT JOIN apt_users emp
      ON eep.employee_id = emp.id

      LEFT JOIN org_teams ot
      ON eep.team_id = ot.id

      LEFT JOIN apt_users ap
      ON eep.action_performed_by = ap.id

      LEFT JOIN apt_users rp
      ON eep.response_by_id = rp.id

      LEFT JOIN employee_assets eua
      ON eep.employee_id = eua.employee_id
      AND eep.org_id = eua.org_id

      LEFT JOIN apt_users returned_user
      ON eua.returned_to_id = returned_user.id

      LEFT JOIN handover_query hq
      ON eep.id = hq.employee_exit_process_id

      LEFT JOIN apt_users manager
      ON hq.manager_id = manager.id

      LEFT JOIN employee_assets ea
      ON hq.asset_id = ea.id

      WHERE eep.id = ?
      AND eep.org_id = ?

      ORDER BY hq.id DESC
    `;

    const values = [exit_process_id, org_id];

    const [rows] = await connection.query(query, values);

    // ---------------------------------------------------
    // Check If Exit Process Exists
    // ---------------------------------------------------

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee exit process not found",
      });
    }

    // ---------------------------------------------------
    // FORMAT RESPONSE
    // ---------------------------------------------------

    const firstRow = rows[0];

    // ---------------------------------------------------
    // EMPLOYEE ASSETS
    // ---------------------------------------------------

    const assetMap = new Map();

    rows.forEach((row) => {
      if (row.employee_asset_id && !assetMap.has(row.employee_asset_id)) {
        assetMap.set(row.employee_asset_id, {
          id: row.employee_asset_id,

          asset_name: row.employee_asset_name,

          asset_summary: row.employee_asset_summary,

          asset_type: row.employee_asset_type,

          asset_image_url: row.employee_asset_image_url,

          is_returned: row.is_returned,

          returned_to_id: row.returned_to_id,

          returned_to_name: row.returned_to_name,

          handover_date_time: row.handover_date_time,
        });
      }
    });

    const employee_assets = Array.from(assetMap.values());

    // ---------------------------------------------------
    // HANDOVER QUERIES
    // ---------------------------------------------------

    const handoverMap = new Map();

    rows.forEach((row) => {
      if (row.handover_query_id && !handoverMap.has(row.handover_query_id)) {
        handoverMap.set(row.handover_query_id, {
          handover_query_id: row.handover_query_id,

          asset_id: row.asset_id,

          asset_name: row.asset_name,

          asset_summary: row.asset_summary,

          asset_type: row.asset_type,

          asset_image_url: row.asset_image_url,

          custom_task_name: row.custom_task_name,

          manager_id: row.manager_id,

          manager_name: row.manager_name,

          handover_status: row.handover_status,

          remarks: row.remarks,

          handover_date: row.handover_date,

          created_at: row.handover_created_at,

          updated_at: row.handover_updated_at,
        });
      }
    });

    const handover_queries = Array.from(handoverMap.values());

    // ---------------------------------------------------
    // FINAL RESPONSE
    // ---------------------------------------------------

    const formattedResponse = {
      id: firstRow.id,

      employee_id: firstRow.employee_id,

      employee_name: firstRow.employee_name,

      employee_email: firstRow.employee_email,

      employee_phone: firstRow.employee_phone,

      org_id: firstRow.org_id,

      team_id: firstRow.team_id,

      team_name: firstRow.team_name,

      action_type: firstRow.action_type,

      action_reason: firstRow.action_reason,

      application_status: firstRow.application_status,

      exit_date: firstRow.exit_date,

      last_working_day: firstRow.last_working_day,

      action_performed_by: firstRow.action_performed_by,

      action_performed_by_name: firstRow.action_performed_by_name,

      response_by_id: firstRow.response_by_id,

      response_by_name: firstRow.response_by_name,

      response_message: firstRow.response_message,

      resolved_at: firstRow.resolved_at,

      created_at: firstRow.created_at,

      updated_at: firstRow.updated_at,

      employee_assets,

      handover_queries,
    };

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Employee exit process fetched successfully",
      data: formattedResponse,
    });
  } catch (error) {
    console.error("Error in get_my_exit_process:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};


export const get_all_employee_exit_processes = async (req, res) => {
  let connection;

  try {
    const { user_id: action_performed_by_id } = req.user;

    const { org_id } = req;

    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "desc",
      sort_by = "created_at",
      status = "",
      action_type = "",
      employee_id = "",
      team_id = "",
    } = req.query;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_performed_by_id) {
      return res.status(400).json({
        success: false,
        message: "Action performer id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    const validSortOrders = ["asc", "desc"];

    const validSortBy = [
      "created_at",
      "updated_at",
      "exit_date",
      "last_working_day",
    ];

    const validStatuses = ["pending", "approved", "rejected", "in_progress"];

    const validActionTypes = ["resignation", "termination"];

    if (!validSortOrders.includes(String(sort).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "sort must be asc or desc",
      });
    }

    if (!validSortBy.includes(String(sort_by))) {
      return res.status(400).json({
        success: false,
        message:
          "sort_by must be created_at, updated_at, exit_date or last_working_day",
      });
    }

    if (status && !validStatuses.includes(String(status).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "status must be pending, approved, rejected or in_progress",
      });
    }

    if (
      action_type &&
      !validActionTypes.includes(String(action_type).toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "action_type must be resignation or termination",
      });
    }

    const pageNumber = Number(page) || 1;

    const limitNumber = Number(limit) || 10;

    const offset = (pageNumber - 1) * limitNumber;

    connection = await pool.promise().getConnection();

    // ---------------------------------------------------
    // Check If action_performed_by_id is valid
    // ---------------------------------------------------

    const [actionUser] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, action_performed_by_id],
    );

    if (actionUser.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // Check If Organization id is valid
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // BUILD FILTERS
    // ---------------------------------------------------

    let whereClause = ` WHERE eep.org_id = ? `;

    const values = [org_id];

    // SEARCH FILTER

    if (search) {
      whereClause += `
          AND (
            au.user_name LIKE ?
            OR au.user_email LIKE ?
            OR eep.action_reason LIKE ?
            OR ot.team_name LIKE ?
          )
        `;

      const searchValue = `%${search}%`;

      values.push(searchValue, searchValue, searchValue, searchValue);
    }

    // STATUS FILTER

    if (status) {
      whereClause += ` AND eep.application_status = ? `;
      values.push(String(status).toLowerCase());
    }

    // ACTION TYPE FILTER

    if (action_type) {
      whereClause += ` AND eep.action_type = ? `;
      values.push(String(action_type).toLowerCase());
    }

    // EMPLOYEE FILTER

    if (employee_id) {
      whereClause += ` AND eep.employee_id = ? `;
      values.push(employee_id);
    }

    // TEAM FILTER

    if (team_id) {
      whereClause += ` AND eep.team_id = ? `;
      values.push(team_id);
    }

    // ---------------------------------------------------
    // TOTAL COUNT QUERY
    // ---------------------------------------------------

    const countQuery = `
        SELECT COUNT(*) AS total
  
        FROM employee_exit_process eep
  
        LEFT JOIN apt_users au
        ON eep.employee_id = au.id
  
        LEFT JOIN org_teams ot
        ON eep.team_id = ot.id
  
        ${whereClause}
      `;

    const [countRows] = await connection.query(countQuery, values);

    const total_records = countRows[0].total;

    const total_pages = Math.ceil(total_records / limitNumber);

    // ---------------------------------------------------
    // MAIN QUERY
    // ---------------------------------------------------

    const query = `
        SELECT
  
          eep.id,
          eep.employee_id,
          eep.org_id,
          eep.team_id,
          eep.action_type,
          eep.action_reason,
          eep.application_status,
          eep.exit_date,
          eep.last_working_day,
          eep.action_performed_by,
          eep.response_by_id,
          eep.response_message,
          eep.resolved_at,
          eep.created_at,
          eep.updated_at,
  
          au.user_name AS employee_name,
          au.user_email AS employee_email,
          au.user_phone AS employee_phone,
  
          ot.team_name,
  
          creator.user_name AS action_performed_by_name,
  
          responder.user_name AS response_by_name,
  
          (
            SELECT COUNT(*)
            FROM handover_query hq
            WHERE hq.employee_exit_process_id = eep.id
          ) AS total_handover_queries
  
        FROM employee_exit_process eep
  
        LEFT JOIN apt_users au
        ON eep.employee_id = au.id
  
        LEFT JOIN org_teams ot
        ON eep.team_id = ot.id
  
        LEFT JOIN apt_users creator
        ON eep.action_performed_by = creator.id
  
        LEFT JOIN apt_users responder
        ON eep.response_by_id = responder.id
  
        ${whereClause}
  
        ORDER BY eep.${sort_by} ${String(sort).toUpperCase()}
  
        LIMIT ?
        OFFSET ?
      `;

    const finalValues = [...values, limitNumber, offset];

    const [rows] = await connection.query(query, finalValues);

    // ---------------------------------------------------
    // FORMAT RESPONSE
    // ---------------------------------------------------

    const formattedData = rows.map((item) => ({
      id: item.id,

      employee_id: item.employee_id,

      employee_name: item.employee_name,

      employee_email: item.employee_email,

      employee_phone: item.employee_phone,

      org_id: item.org_id,

      team_id: item.team_id,

      team_name: item.team_name,

      action_type: item.action_type,

      action_reason: item.action_reason,

      application_status: item.application_status,

      exit_date: item.exit_date,

      last_working_day: item.last_working_day,

      action_performed_by: item.action_performed_by,

      action_performed_by_name: item.action_performed_by_name,

      response_by_id: item.response_by_id,

      response_by_name: item.response_by_name,

      response_message: item.response_message,

      resolved_at: item.resolved_at,

      total_handover_queries: item.total_handover_queries,

      created_at: item.created_at,

      updated_at: item.updated_at,
    }));

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Employee exit processes fetched successfully",

      pagination: {
        total_records,
        total_pages,
        current_page: pageNumber,
        limit: limitNumber,
      },

      filters: {
        search,
        status,
        action_type,
        employee_id,
        sort,
        sort_by,
      },

      data: formattedData,
    });
  } catch (error) {
    console.log("Error in get_all_employee_exit_processes:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ---------------------- Employee Exit Process Handover Queries ----------------------

const HANDOVER_STATUSES = [
  "pending",
  "handover_completed",
  "damaged",
  "missing",
];

export const create_employee_exit_process_handover_query = async (req, res) => {
  let connection;

  try {
    const { user_id: manager_id } = req.user;

    const { org_id } = req;

    const {
      employee_exit_process_id,
      employee_id,
      team_id,
      asset_id,
      custom_task_name,
      handover_status,
      remarks,
      handover_date,
    } = req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!manager_id) {
      return res.status(400).json({
        success: false,
        message: "Manager id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!employee_exit_process_id) {
      return res.status(400).json({
        success: false,
        message: "employee_exit_process_id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    if (!asset_id && !custom_task_name) {
      return res.status(400).json({
        success: false,
        message: "Either asset_id or custom_task_name is required",
      });
    }

    if (
      handover_status &&
      !HANDOVER_STATUSES.includes(String(handover_status).toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message:
          "handover_status must be pending, handover_completed, damaged or missing",
      });
    }

    if (custom_task_name && String(custom_task_name).trim().length > 250) {
      return res.status(400).json({
        success: false,
        message: "custom_task_name must be less than 250 characters",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // Check If Organization id is valid
    // ---------------------------------------------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------------------------------------------
    // Check If manager id is valid member of the organization
    // ---------------------------------------------------

    const [manager] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, manager_id],
    );

    if (manager.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Manager is not a member of this organization",
      });
    }
    const [managerMember] = await connection.query(
      `
        SELECT user_name
        FROM apt_users
        WHERE id = ?
        `,
      [manager_id],
    );

    if (managerMember.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Manager is not a member of this organization",
      });
    }
    const manager_name = managerMember[0].user_name;
    // ---------------------------------------------------
    // Check If employee_exit_process_id is valid
    // ---------------------------------------------------

    const [exitProcess] = await connection.query(
      `
        SELECT
          id, 
          application_status
        FROM employee_exit_process
        WHERE id = ?
        AND org_id = ?
        AND employee_id = ?
        `,
      [employee_exit_process_id, org_id, employee_id],
    );

    if (exitProcess.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Employee exit process not found or employee does not belong to the exit process",
      });
    }

    const application_status = exitProcess[0].application_status;

    // ---------------------------------------------------
    // Check If employee_id is valid
    // ---------------------------------------------------

    const [employee] = await connection.query(
      `
        SELECT
          id,
          user_name,
          user_email
        FROM apt_users
        WHERE id = ?
        `,
      [employee_id],
    );

    if (employee.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const employee_name = employee[0].user_name;

    // ---------------------------------------------------
    // Check employee belongs to organization
    // ---------------------------------------------------

    const [employeeMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, employee_id],
    );

    if (employeeMember.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // Check If Team id is valid
    // ---------------------------------------------------

    if (team_id) {
      const [team] = await connection.query(
        `
          SELECT id, team_name
          FROM org_teams
          WHERE id = ?
          AND org_id = ?
          `,
        [team_id, org_id],
      );

      if (team.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Team not found",
        });
      }
    }

    // ---------------------------------------------------
    // If asset_id is provided, check asset validity
    // ---------------------------------------------------

    let asset_name = null;

    if (asset_id) {
      const [asset] = await connection.query(
        `
          SELECT
            id,
            asset_name
          FROM employee_assets
          WHERE id = ?
          AND employee_id = ?
          AND org_id = ?
          `,
        [asset_id, employee_id, org_id],
      );

      if (asset.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Asset not found",
        });
      }

      asset_name = asset[0].asset_name;
    }

    // ---------------------------------------------------
    // Duplicate query check
    // ---------------------------------------------------

    if (asset_id) {
      const [existingAssetQuery] = await connection.query(
        `
          SELECT id
          FROM handover_query
          WHERE employee_exit_process_id = ?
          AND asset_id = ?
          `,
        [employee_exit_process_id, asset_id],
      );

      if (existingAssetQuery.length > 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Handover query already exists for this asset",
        });
      }
    }

    // ---------------------------------------------------
    // Create handover query
    // ---------------------------------------------------

    const normalizedStatus = handover_status
      ? String(handover_status).toLowerCase()
      : "pending";

    const [insertResult] = await connection.query(
      `
        INSERT INTO handover_query
        (
          employee_exit_process_id,
          employee_id,
          org_id,
          team_id,
          asset_id,
          custom_task_name,
          manager_id,
          handover_status,
          remarks,
          handover_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      [
        employee_exit_process_id,
        employee_id,
        org_id,
        team_id || null,
        asset_id || null,
        custom_task_name || null,
        manager_id,
        normalizedStatus,
        remarks || null,
        handover_date || null,
      ],
    );

    if (!insertResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to create handover query",
      });
    }

    // ---------------------------------------------------
    // Save activity log
    // ---------------------------------------------------

    const activityPayload = {
      handover_query_id: insertResult.insertId,
      employee_exit_process_id,
      employee_id,
      team_id: team_id || null,
      asset_id: asset_id || null,
      asset_name,
      custom_task_name: custom_task_name || null,
      handover_status: normalizedStatus,
      remarks: remarks || null,
      handover_date: handover_date || null,
    };

    const taskName = asset_name || custom_task_name || "custom task";

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      manager_id,
      employee_id,
      org_id,
      "CREATE_EMPLOYEE_EXIT_PROCESS_HANDOVER_QUERY",
      null,
      JSON.stringify(activityPayload),
      `Handover query created for ${employee_name} regarding ${taskName} by ${manager_name}`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RETURN RESPONSE
    // ---------------------------------------------------

    return res.status(201).json({
      success: true,
      message: "Employee exit process handover query created successfully",
      data: {
        id: insertResult.insertId,
        employee_exit_process_id,
        employee_id,
        org_id,
        team_id: team_id || null,
        asset_id: asset_id || null,
        asset_name,
        custom_task_name: custom_task_name || null,
        manager_id,
        handover_status: normalizedStatus,
        remarks: remarks || null,
        handover_date: handover_date || null,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.log("Error in create_employee_exit_process_handover_query:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_employee_exit_process_handover_query = async (req, res) => {
  let connection;
  const INSERT_ACTIVITY_SQL = `
    INSERT INTO apt_user_activity_logs
    ( 
      performed_by,
      affected_user_id,
      org_id,
      action_type,
      old_value,
      new_value,
      action_reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
  try {
    const { user_id: manager_id } = req.user;

    const { org_id } = req;

    const {
      id: handover_query_id,
      employee_exit_process_id,
      employee_id,
    } = req.params;

    const { handover_status, remarks, handover_date, custom_task_name } =
      req.body;

    // ---------------- VALIDATIONS ----------------

    if (!manager_id) {
      return res.status(400).json({
        success: false,
        message: "Manager id is required",
      });
    }

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!handover_query_id) {
      return res.status(400).json({
        success: false,
        message: "handover_query_id is required",
      });
    }

    if (handover_status) {
      const normalizedStatus = String(handover_status).toLowerCase();

      if (!HANDOVER_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message:
            "handover_status must be pending, handover_completed, damaged or missing",
        });
      }
    }

    if (custom_task_name && String(custom_task_name).trim().length > 250) {
      return res.status(400).json({
        success: false,
        message: "custom_task_name must be less than 250 characters",
      });
    }

    if (remarks && String(remarks).length > 1000) {
      return res.status(400).json({
        success: false,
        message: "remarks must be less than 1000 characters",
      });
    }

    if (handover_date && isNaN(new Date(handover_date).getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid handover_date",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------- CHECK ORGANIZATION ----------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------- CHECK MANAGER MEMBERSHIP ----------------

    const [managerMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, manager_id],
    );

    if (managerMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Manager is not member of this organization",
      });
    }

    const [managerUserRows] = await connection.query(
      `
        SELECT user_name
        FROM apt_users
        WHERE id = ?
        `,
      [manager_id],
    );
    const manager_name = managerUserRows?.[0]?.user_name ?? "Manager";

    // ---------------- CHECK HANDOVER QUERY ----------------

    const [existingHandover] = await connection.query(
      `
        SELECT *
        FROM handover_query
        WHERE id = ?
        AND org_id = ?
        AND employee_exit_process_id = ?
        AND employee_id = ?
        `,
      [handover_query_id, org_id, employee_exit_process_id, employee_id],
    );

    if (existingHandover.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Handover query not found",
      });
    }

    const oldData = existingHandover[0];

    // ---------------- PREPARE PATCH DATA ----------------

    const updatedStatus = handover_status
      ? String(handover_status).toLowerCase()
      : oldData.handover_status;

    const updatedRemarks = remarks !== undefined ? remarks : oldData.remarks;

    const updatedHandoverDate =
      handover_date !== undefined ? handover_date : oldData.handover_date;

    const updatedTaskName =
      custom_task_name !== undefined
        ? custom_task_name
        : oldData.custom_task_name;

    // ---------------- UPDATE QUERY ----------------

    const [updateResult] = await connection.query(
      `
        UPDATE handover_query
        SET
          handover_status = ?,
          remarks = ?,
          handover_date = ?,
          custom_task_name = ?
        WHERE id = ?
        `,
      [
        updatedStatus,
        updatedRemarks,
        updatedHandoverDate,
        updatedTaskName,
        handover_query_id,
      ],
    );

    if (!updateResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update handover query",
      });
    }

    // ---------------- ACTIVITY LOG ----------------

    const newPayload = {
      handover_query_id,
      handover_status: updatedStatus,
      remarks: updatedRemarks,
      handover_date: updatedHandoverDate,
      custom_task_name: updatedTaskName,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      manager_id,
      employee_id,
      org_id,
      "UPDATE_EMPLOYEE_EXIT_HANDOVER_QUERY",
      JSON.stringify(oldData),
      JSON.stringify(newPayload),
      `Handover query updated by ${manager_name}`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    // ---------------- COMMIT ----------------

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Employee exit process handover query updated successfully",
      data: newPayload,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error(
      "Error in update_employee_exit_process_handover_query:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_single_employee_exit_process_handover_query = async (
  req,
  res,
) => {
  let connection;

  try {
    const { org_id } = req;

    const { user_id: manager_id } = req.user;

    const { user_id: employee_id } = req.params;

    // ---------------- VALIDATIONS ----------------

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!manager_id) {
      return res.status(400).json({
        success: false,
        message: "Manager id is required",
      });
    }

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "Employee id is required",
      });
    }

    connection = await pool.promise().getConnection();

    // ---------------- CHECK ORGANIZATION ----------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------- CHECK MANAGER MEMBERSHIP ----------------

    const [managerMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, manager_id],
    );

    if (managerMember.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Manager is not a member of this organization",
      });
    }

    // ---------------- CHECK EMPLOYEE MEMBERSHIP ----------------

    const [employeeMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, employee_id],
    );

    if (employeeMember.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------- CHECK HANDOVER QUERY ----------------

    const [handoverQueries] = await connection.query(
      `
        SELECT
          hq.id,
          hq.employee_exit_process_id,
          hq.employee_id,
          hq.org_id,
          hq.team_id,
          hq.asset_id,
          hq.custom_task_name,
          hq.manager_id,
          hq.handover_status,
          hq.remarks,
          hq.handover_date,
          hq.created_at,
          hq.updated_at,
  
          ea.asset_name,
          ea.asset_type,
          ea.asset_summary,
          ea.asset_image_url,
  
          au.user_name AS employee_name,
          au.user_email AS employee_email,
  
          manager.user_name AS manager_name,
  
          ot.team_name
  
        FROM handover_query hq
  
        LEFT JOIN employee_assets ea
        ON hq.asset_id = ea.id
  
        LEFT JOIN apt_users au
        ON hq.employee_id = au.id
  
        LEFT JOIN apt_users manager
        ON hq.manager_id = manager.id
  
        LEFT JOIN org_teams ot
        ON hq.team_id = ot.id
  
        WHERE hq.org_id = ?
        AND hq.employee_id = ?
  
        ORDER BY hq.created_at DESC
        `,
      [org_id, employee_id],
    );

    if (handoverQueries.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No handover queries found for this employee",
      });
    }

    // ---------------- FORMAT RESPONSE ----------------

    const formattedQueries = handoverQueries.map((query) => ({
      handover_query_id: query.id,

      employee_exit_process_id: query.employee_exit_process_id,

      employee: {
        employee_id: query.employee_id,
        employee_name: query.employee_name,
        employee_email: query.employee_email,
      },

      team: query.team_id
        ? {
            team_id: query.team_id,
            team_name: query.team_name,
          }
        : null,

      asset: query.asset_id
        ? {
            asset_id: query.asset_id,
            asset_name: query.asset_name,
            asset_type: query.asset_type,
            asset_summary: query.asset_summary,
            asset_image_url: query.asset_image_url,
          }
        : null,

      custom_task_name: query.custom_task_name,

      manager: {
        manager_id: query.manager_id,
        manager_name: query.manager_name,
      },

      handover_status: query.handover_status,

      remarks: query.remarks,

      handover_date: query.handover_date,

      created_at: query.created_at,

      updated_at: query.updated_at,
    }));

    // ---------------- RETURN RESPONSE ----------------

    return res.status(200).json({
      success: true,
      message: "Employee exit process handover queries fetched successfully",

      total_queries: formattedQueries.length,

      data: formattedQueries,
    });
  } catch (error) {
    console.log(
      "Error in get_single_employee_exit_process_handover_query:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_employee_exit_process_handover_queries = async (
  req,
  res,
) => {
  let connection;

  try {
    const { org_id } = req;

    const { user_id: manager_id } = req.user;

    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "desc",
      sort_by = "created_at",
      handover_status = "",
      employee_id = "",
      team_id = "",
      custom_task_name = "",
    } = req.query;

    // ---------------- VALIDATIONS ----------------

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id is required",
      });
    }

    if (!manager_id) {
      return res.status(400).json({
        success: false,
        message: "Manager id is required",
      });
    }

    const validSortOrders = ["asc", "desc"];

    const validSortFields = [
      "created_at",
      "updated_at",
      "handover_date",
      "handover_status",
    ];

    if (!validSortOrders.includes(String(sort).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "sort must be asc or desc",
      });
    }

    if (!validSortFields.includes(sort_by)) {
      return res.status(400).json({
        success: false,
        message: `sort_by must be one of ${validSortFields.join(", ")}`,
      });
    }

    connection = await pool.promise().getConnection();

    // ---------------- CHECK ORGANIZATION ----------------

    const [organization] = await connection.query(
      `
        SELECT id
        FROM apt_organizations
        WHERE id = ?
        `,
      [org_id],
    );

    if (organization.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------- CHECK MANAGER MEMBERSHIP ----------------

    const [managerMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, manager_id],
    );

    if (managerMember.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Manager is not a member of this organization",
      });
    }

    // ---------------- PAGINATION ----------------

    const currentPage = Number(page) || 1;

    const currentLimit = Number(limit) || 10;

    const offset = (currentPage - 1) * currentLimit;

    // ---------------- BUILD FILTERS ----------------

    let whereConditions = `WHERE hq.org_id = ?`;

    let queryParams = [org_id];

    // SEARCH

    if (search) {
      whereConditions += `
          AND (
            au.user_name LIKE ?
            OR au.user_email LIKE ?
            OR ea.asset_name LIKE ?
            OR hq.custom_task_name LIKE ?
            OR hq.remarks LIKE ?
          )
        `;

      const searchValue = `%${search}%`;

      queryParams.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
      );
    }

    // HANDOVER STATUS

    if (handover_status) {
      whereConditions += ` AND hq.handover_status = ?`;

      queryParams.push(handover_status);
    }

    // EMPLOYEE ID

    if (employee_id) {
      whereConditions += ` AND hq.employee_id = ?`;

      queryParams.push(employee_id);
    }

    // TEAM ID

    if (team_id) {
      whereConditions += ` AND hq.team_id = ?`;

      queryParams.push(team_id);
    }

    // CUSTOM TASK NAME

    if (custom_task_name) {
      whereConditions += ` AND hq.custom_task_name LIKE ?`;

      queryParams.push(`%${custom_task_name}%`);
    }

    // ---------------- TOTAL COUNT ----------------

    const [countRows] = await connection.query(
      `
        SELECT COUNT(*) AS total
  
        FROM handover_query hq
  
        LEFT JOIN apt_users au
        ON hq.employee_id = au.id
  
        LEFT JOIN employee_assets ea
        ON hq.asset_id = ea.id
  
        ${whereConditions}
        `,
      queryParams,
    );

    const total_records = countRows[0].total;

    // ---------------- MAIN QUERY ----------------

    const [queries] = await connection.query(
      `
        SELECT
          hq.id,
          hq.employee_exit_process_id,
          hq.employee_id,
          hq.org_id,
          hq.team_id,
          hq.asset_id,
          hq.custom_task_name,
          hq.manager_id,
          hq.handover_status,
          hq.remarks,
          hq.handover_date,
          hq.created_at,
          hq.updated_at,
  
          au.user_name AS employee_name,
          au.user_email AS employee_email,
          au.user_phone AS employee_phone,
  
          manager.user_name AS manager_name,
  
          ot.team_name,
  
          ea.asset_name,
          ea.asset_type,
          ea.asset_summary,
          ea.asset_image_url
  
        FROM handover_query hq
  
        LEFT JOIN apt_users au
        ON hq.employee_id = au.id
  
        LEFT JOIN apt_users manager
        ON hq.manager_id = manager.id
  
        LEFT JOIN org_teams ot
        ON hq.team_id = ot.id
  
        LEFT JOIN employee_assets ea
        ON hq.asset_id = ea.id
  
        ${whereConditions}
  
        ORDER BY hq.${sort_by} ${sort}
  
        LIMIT ?
        OFFSET ?
        `,
      [...queryParams, currentLimit, offset],
    );

    // ---------------- FORMAT RESPONSE ----------------

    const formattedQueries = queries.map((query) => ({
      handover_query_id: query.id,

      employee_exit_process_id: query.employee_exit_process_id,

      employee: {
        employee_id: query.employee_id,
        employee_name: query.employee_name,
        employee_email: query.employee_email,
        employee_phone: query.employee_phone,
      },

      team: query.team_id
        ? {
            team_id: query.team_id,
            team_name: query.team_name,
          }
        : null,

      asset: query.asset_id
        ? {
            asset_id: query.asset_id,
            asset_name: query.asset_name,
            asset_type: query.asset_type,
            asset_summary: query.asset_summary,
            asset_image_url: query.asset_image_url,
          }
        : null,

      custom_task_name: query.custom_task_name,

      manager: {
        manager_id: query.manager_id,
        manager_name: query.manager_name,
      },

      handover_status: query.handover_status,

      remarks: query.remarks,

      handover_date: query.handover_date,

      created_at: query.created_at,

      updated_at: query.updated_at,
    }));

    // ---------------- RETURN RESPONSE ----------------

    return res.status(200).json({
      success: true,

      message: "Employee exit process handover queries fetched successfully",

      pagination: {
        total_records,
        current_page: currentPage,
        limit: currentLimit,
        total_pages: Math.ceil(total_records / currentLimit),
      },

      filters: {
        search,
        handover_status,
        employee_id,
        team_id,
        custom_task_name,
        sort,
        sort_by,
      },

      data: formattedQueries,
    });
  } catch (error) {
    console.log(
      "Error in get_all_employee_exit_process_handover_queries:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Get All Assets For Handover of an Employee ::
export const get_all_assets_for_handover_of_an_employee = async (req, res) => {
  
  let connection;
  try {
    const { org_id } = req;
    const { user_id: returned_to_id } = req.user;
    const { user_id: employee_id } = req.params;


    if (!org_id || !returned_to_id || !employee_id) {
      return res.status(400).json({
        success: false,
        message:
          "Organization id, current user, and employee id (param) are required",
      });
    }

    connection = await pool.promise().getConnection();

    const [returnedToMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
      `,
      [org_id, returned_to_id],
    );

    if (returnedToMember.length === 0) {
      return res.status(403).json({
        success: false,
        message:
          "You are not a member of this organization (handover recipient check failed)",
      });
    }

    let query = `
      SELECT ea.*
      FROM employee_assets ea
      
      WHERE ea.org_id = ?
        AND ea.employee_id = ?
        AND ea.returned_to_id = ?
    `;
    const sqlParams = [org_id, employee_id, returned_to_id, org_id];

   

    const [assets] = await connection.query(query, sqlParams);

    return res.status(200).json({
      success: true,
      message:
        assets.length === 0
          ? "No assets assigned to you for handover"
          : "Assets fetched successfully",
      data: assets,
    });
  } catch (error) {
    console.log("Error in get_all_assets_for_handover:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Get All Assets For Handover Notifications ::
export const get_all_assets_for_handover_notifications = async (req, res) => {
  let connection;
  try {
    const { org_id } = req;
    const { user_id: returned_to_id } = req.user;
    if (!org_id || !returned_to_id) {
      return res.status(400).json({
        success: false,
        message: "Organization id and current user are required",
      });
    }

    connection = await pool.promise().getConnection();

    // Check if returned to is valid member of the organization ::
    const [returnedToMember] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
      `,
      [org_id, returned_to_id],
    );

    if (returnedToMember.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Returned to is not a member of this organization",
      });
    }
    const query = `
      SELECT ea.*
      FROM employee_assets ea
      INNER JOIN employee_exit_process eep
        ON ea.employee_exit_process_id = eep.id
      WHERE ea.org_id = ?
        AND ea.returned_to_id = ?
    `;
    const [assets] = await connection.query(query, [org_id, returned_to_id]);

    return res.status(200).json({
      success: true,
      message:
        assets.length === 0
          ? "No assets found for handover"
          : "Assets fetched successfully",
      data: assets,
    });
  } catch (error) {
    console.log("Error in get_all_assets_for_handover:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const update_asset_handover_status = async (
  req,
  res,
) => {
  let connection;

  try {
    const { org_id } = req;

    const {
      user_id: returned_to_id,
    } = req.user;

    const { asset_id } = req.params;

    const { is_returned } = req.body;

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (
      !org_id ||
      !returned_to_id ||
      !asset_id ||
      is_returned === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Organization id, returned to id, asset id and handover status are required",
      });
    }

    connection =
      await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK IF RETURNED TO USER IS VALID MEMBER
    // ---------------------------------------------------

    const [member] = await connection.query(
      `
      SELECT *
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, returned_to_id],
    );

    if (member.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message:
          "You are not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // CHECK IF ASSET EXISTS
    // ---------------------------------------------------

    const [assets] = await connection.query(
      `
      SELECT *
      FROM employee_assets
      WHERE id = ?
      AND org_id = ?
      `,
      [asset_id, org_id],
    );

    if (assets.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    const asset = assets[0];

    // ---------------------------------------------------
    // CHECK IF ASSET IS ASSIGNED
    // TO CURRENT HANDOVER USER
    // ---------------------------------------------------

    if (
      Number(asset.returned_to_id) !==
      Number(returned_to_id)
    ) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message:
          "This asset is not assigned to you for handover",
      });
    }

    // ---------------------------------------------------
    // PREVENT DUPLICATE UPDATE
    // ---------------------------------------------------

    if (
      Number(asset.is_returned) ===
      Number(is_returned)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Asset handover status already updated",
      });
    }

    // ---------------------------------------------------
    // UPDATE ASSET HANDOVER STATUS
    // ---------------------------------------------------

    const [updateResult] =
      await connection.query(
        `
        UPDATE employee_assets
        SET
          is_returned = ?
        WHERE id = ?
        AND org_id = ?
        `,
        [
          is_returned,
          asset_id,
          org_id,
        ],
      );

    if (updateResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Failed to update asset handover status",
      });
    }

    // ---------------------------------------------------
    // SAVE ACTIVITY LOG
    // ---------------------------------------------------

    const updatedPayload = {
      asset_id,
      org_id,
      returned_to_id,
      is_returned,
    };

    const [activityResult] =
      await connection.query(
        INSERT_ACTIVITY_SQL,
        [
          returned_to_id,
          asset.employee_id,
          org_id,
          "UPDATE_ASSET_HANDOVER_STATUS",
          JSON.stringify(asset),
          JSON.stringify(updatedPayload),
          `Asset handover status updated by user ${returned_to_id}`,
        ],
      );

    if (activityResult.affectedRows < 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Failed to save activity log",
      });
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // RETURN SUCCESS RESPONSE
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,
      message:
        "Asset handover status updated successfully",
      data: {
        asset_id,
        is_returned,
      },
    });
  } catch (error) {
    console.log(
      "Error in update_asset_handover_status:",
      error,
    );

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};