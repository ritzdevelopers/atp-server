import { pool } from "../db/connect.js";
import { isEmployeeExists } from "../helper/employee_checker.js";
import activity_tracker from "../helper/activity_tracking.js";

export const assign_handover_manager = async (req, res) => {
  let connection;

  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_by_user_id } = req.user;
    const { exit_process_id: employee_exit_process_id } = req.params;
    const { org_id } = req;

    const {
      manager_id,
      team_id,
      asset_id,
      remarks,
      handover_date,
      employee_id,
    } = req.body;

    if (
      !employee_exit_process_id ||
      !employee_id ||
      !manager_id ||
      !asset_id ||
      !handover_date
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (!(await isEmployeeExists(action_by_user_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Action user not found",
      });
    }

    if (!(await isEmployeeExists(employee_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

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
      return res.status(404).json({
        success: false,
        message: "Manager not found in this organization",
      });
    }

    const [exitProcess] = await connection.query(
      `
      SELECT id, org_id, employee_id, team_id
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
        message: "Employee exit process not found",
      });
    }

    const exit_process_data = exitProcess[0];

    if (Number(exit_process_data.org_id) !== Number(org_id)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid organization",
      });
    }

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

    const [assetRows] = await connection.query(
      `
      SELECT id, asset_name, returned_to_id
      FROM employee_assets
      WHERE id = ?
      AND employee_id = ?
      AND org_id = ?
      AND asset_status = 'active'
      AND is_returned = 0
      `,
      [asset_id, employee_id, org_id],
    );

    if (assetRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    const asset = assetRows[0];
    const asset_name = asset.asset_name ?? `Asset #${asset_id}`;
    const returned_to_id = asset.returned_to_id;

    if (returned_to_id) {
      const [assignedManager] = await connection.query(
        `
        SELECT user_name
        FROM apt_users
        WHERE id = ?
        `,
        [returned_to_id],
      );

      const managerName =
        assignedManager.length > 0
          ? assignedManager[0].user_name
          : "another manager";

      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Asset already assigned to ${managerName}`,
      });
    }

    const [existingHandover] = await connection.query(
      `
      SELECT id
      FROM handover_query
      WHERE employee_exit_process_id = ?
      AND asset_id = ?
      `,
      [employee_exit_process_id, asset_id],
    );

    if (existingHandover.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Handover manager already assigned for this asset",
      });
    }

    const resolvedTeamId =
      team_id ?? exit_process_data.team_id ?? null;

    const [insertResult] = await connection.query(
      `
      INSERT INTO handover_query
      (
        employee_id,
        org_id,
        team_id,
        asset_id,
        manager_id,
        handover_status,
        remarks,
        handover_date,
        employee_exit_process_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        employee_id,
        org_id,
        resolvedTeamId,
        asset_id,
        manager_id,
        "pending",
        remarks || null,
        handover_date,
        employee_exit_process_id,
      ],
    );

    if (!insertResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to assign handover manager",
      });
    }

    const [updateAssetResult] = await connection.query(
      `
      UPDATE employee_assets
      SET returned_to_id = ?
      WHERE id = ?
      AND employee_id = ?
      AND org_id = ?
      AND asset_status = 'active'
      AND is_returned = 0
      `,
      [manager_id, asset_id, employee_id, org_id],
    );

    if (updateAssetResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to assign asset custody to manager",
      });
    }

    const [action_by_user_info] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [action_by_user_id],
    );
    const action_by_user_name =
      action_by_user_info[0]?.user_name ?? "Unknown";

    const [managerInfo] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [manager_id],
    );
    const manager_name = managerInfo[0]?.user_name ?? `User #${manager_id}`;

    const [employeeInfo] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [employee_id],
    );
    const employee_name =
      employeeInfo[0]?.user_name ?? `User #${employee_id}`;

    await activity_tracker(
      connection,
      action_by_user_id,
      action_by_user_name,
      `Assigned handover manager ${manager_name} to asset ${asset_name} for employee ${employee_name}`,
      org_id,
      "ASSIGN_HANDOVER_MANAGER",
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Handover manager assigned successfully",
      data: {
        handover_query_id: insertResult.insertId,
        asset_id: Number(asset_id),
        manager_id: Number(manager_id),
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("assign_handover_manager:", error);

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

export const update_assigned_handover_manager = async (req, res) => {
  let connection;

  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_by_user_id } = req.user;
    const { exit_process_id: employee_exit_process_id } = req.params;
    const { org_id } = req;

    const {
      manager_id,
      team_id,
      asset_id,
      remarks,
      handover_date,
      employee_id,
    } = req.body;

    if (
      !employee_exit_process_id ||
      !employee_id ||
      !manager_id ||
      !asset_id
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (!(await isEmployeeExists(action_by_user_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Action user not found",
      });
    }

    if (!(await isEmployeeExists(employee_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

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
      return res.status(404).json({
        success: false,
        message: "Manager not found in this organization",
      });
    }

    const [exitProcess] = await connection.query(
      `
      SELECT id, org_id, employee_id, team_id
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
        message: "Employee exit process not found",
      });
    }

    const exit_process_data = exitProcess[0];

    if (Number(exit_process_data.org_id) !== Number(org_id)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid organization",
      });
    }

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

    const [assetRows] = await connection.query(
      `
      SELECT id, asset_name, returned_to_id
      FROM employee_assets
      WHERE id = ?
      AND employee_id = ?
      AND org_id = ?
      AND asset_status = 'active'
      AND is_returned = 0
      `,
      [asset_id, employee_id, org_id],
    );

    if (assetRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    const asset = assetRows[0];
    const asset_name = asset.asset_name ?? `Asset #${asset_id}`;

    const [existingHandover] = await connection.query(
      `
      SELECT id, manager_id, handover_status
      FROM handover_query
      WHERE employee_exit_process_id = ?
      AND asset_id = ?
      AND employee_id = ?
      AND org_id = ?
      `,
      [employee_exit_process_id, asset_id, employee_id, org_id],
    );

    if (existingHandover.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message:
          "No handover assignment found for this asset. Use assign handover manager first.",
      });
    }

    const handoverRow = existingHandover[0];
    const previous_manager_id = handoverRow.manager_id;

    if (Number(previous_manager_id) === Number(manager_id)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "This manager is already assigned for this asset",
      });
    }

    if (!asset.returned_to_id) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Asset has no handover manager assigned yet",
      });
    }

    const resolvedTeamId =
      team_id ?? exit_process_data.team_id ?? null;

    const [updateHandoverResult] = await connection.query(
      `
      UPDATE handover_query
      SET
        manager_id = ?,
        team_id = ?,
        remarks = COALESCE(?, remarks),
        handover_date = COALESCE(?, handover_date)
      WHERE id = ?
      AND employee_exit_process_id = ?
      AND asset_id = ?
      AND employee_id = ?
      AND org_id = ?
      `,
      [
        manager_id,
        resolvedTeamId,
        remarks ?? null,
        handover_date ?? null,
        handoverRow.id,
        employee_exit_process_id,
        asset_id,
        employee_id,
        org_id,
      ],
    );

    if (updateHandoverResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to update handover manager",
      });
    }

    const [updateAssetResult] = await connection.query(
      `
      UPDATE employee_assets
      SET returned_to_id = ?
      WHERE id = ?
      AND employee_id = ?
      AND org_id = ?
      AND asset_status = 'active'
      AND is_returned = 0
      `,
      [manager_id, asset_id, employee_id, org_id],
    );

    if (updateAssetResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to update asset custody to the new manager",
      });
    }

    const [action_by_user_info] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [action_by_user_id],
    );
    const action_by_user_name =
      action_by_user_info[0]?.user_name ?? "Unknown";

    const [newManagerRow] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [manager_id],
    );
    const [prevManagerRow] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [previous_manager_id],
    );
    const new_manager_name =
      newManagerRow[0]?.user_name ?? `User #${manager_id}`;
    const previous_manager_name =
      prevManagerRow[0]?.user_name ?? `User #${previous_manager_id}`;

    const [employeeInfo] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ?`,
      [employee_id],
    );
    const employee_name =
      employeeInfo[0]?.user_name ?? `User #${employee_id}`;

    await activity_tracker(
      connection,
      action_by_user_id,
      action_by_user_name,
      `Updated handover manager for asset ${asset_name} of employee ${employee_name} from ${previous_manager_name} to ${new_manager_name}`,
      org_id,
      "UPDATE_ASSIGNED_HANDOVER_MANAGER",
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Handover manager updated successfully",
      data: {
        handover_query_id: handoverRow.id,
        asset_id: Number(asset_id),
        previous_manager_id: Number(previous_manager_id),
        manager_id: Number(manager_id),
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("update_assigned_handover_manager:", error);

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