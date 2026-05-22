import { pool } from "../db/connect.js";

async function exit_process_handler(
  employee_id,
  org_id,
  assets_handover_data,
) {
  let connection;

  try {
    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!Array.isArray(assets_handover_data)) {
      await connection.rollback();
      return {
        success: false,
        message: "assets_handover_data must be an array",
      };
    }

    // No rows to update (e.g. employee has zero active unreturned assets)
    if (assets_handover_data.length === 0) {
      const [pendingRows] = await connection.query(
        `
        SELECT id
        FROM employee_assets
        WHERE employee_id = ?
        AND org_id = ?
        AND asset_status = 'active'
        AND is_returned = 0
        `,
        [employee_id, org_id],
      );
      if (pendingRows.length > 0) {
        await connection.rollback();
        return {
          success: false,
          message: "Provide handover assignments for all pending assets",
        };
      }

      await connection.commit();
      return {
        success: true,
        message: "No pending assets to hand over",
        data: [],
      };
    }

    // ---------------------------------------------------
    // LOOP THROUGH ALL ASSETS
    // ---------------------------------------------------

    for (const item of assets_handover_data) {
      const { asset_id, handover_to } = item;

      // ---------------------------------------------------
      // VALIDATE PAYLOAD
      // ---------------------------------------------------

      if (!asset_id || !handover_to) {
        await connection.rollback();

        return {
          success: false,
          message:
            "asset_id and handover_to are required",
        };
      }

      // ---------------------------------------------------
      // CHECK ASSET
      // ---------------------------------------------------

      const [assets] = await connection.query(
        `
        SELECT id
        FROM employee_assets
        WHERE id = ?
        AND asset_status = 'active'
        AND is_returned = 0
        AND employee_id = ?
        AND org_id = ?
        `,
        [asset_id, employee_id, org_id],
      );

      if (assets.length === 0) {
        await connection.rollback();

        return {
          success: false,
          message: `Asset ${asset_id} is invalid or already returned`,
        };
      }

      // ---------------------------------------------------
      // CHECK HANDOVER EMPLOYEE
      // ---------------------------------------------------

      const [employees] = await connection.query(
        `
        SELECT id
        FROM apt_org_members
        WHERE user_id = ?
        AND org_id = ?
        `,
        [handover_to, org_id],
      );

      if (employees.length === 0) {
        await connection.rollback();

        return {
          success: false,
          message: `Handover employee ${handover_to} not found`,
        };
      }

      // ---------------------------------------------------
      // UPDATE ASSET
      // ---------------------------------------------------

      const [updateResult] = await connection.query(
        `
        UPDATE employee_assets
        SET
          returned_to_id = ?
        WHERE id = ?
        `,
        [handover_to, asset_id],
      );

      if (updateResult.affectedRows < 1) {
        await connection.rollback();

        return {
          success: false,
          message: `Failed to update asset ${asset_id}`,
        };
      }
    }

    // ---------------------------------------------------
    // COMMIT TRANSACTION
    // ---------------------------------------------------

    await connection.commit();

    // ---------------------------------------------------
    // SUCCESS RESPONSE
    // ---------------------------------------------------

    return {
      success: true,
      message:
        "Assets handed over successfully",
      data: assets_handover_data,
    };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.log(error);

    return {
      success: false,
      message: error.message,
      data: null,
      status: 500,
    };
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

export default exit_process_handler;