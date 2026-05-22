import { pool } from "../db/connect.js";

async function exit_confirmation(employee_id, org_id) {
  let connection;

  try {
    connection = await pool.promise().getConnection();

    // ---------------------------------------------------
    // CHECK ALL EMPLOYEE ASSETS
    // ---------------------------------------------------

    const [assets] = await connection.query(
        `
        SELECT
          employee_assets.*,
      
          handover_user.id AS handover_to_id,
          handover_user.user_name AS handover_to_name,
          handover_user.user_email AS handover_to_email,
          handover_user.user_phone AS handover_to_phone,
      
          handover_query.manager_id AS manager_id,

          manager_info.user_name AS manager_name,
          manager_info.user_email AS manager_email,
          manager_info.user_phone AS manager_phone
      
        FROM employee_assets
      
        LEFT JOIN apt_users AS handover_user
        ON handover_user.id = employee_assets.returned_to_id
      
        LEFT JOIN handover_query 
        ON handover_query.employee_id = employee_assets.employee_id
       
        LEFT JOIN apt_users AS manager_info
        ON manager_info.id = handover_query.manager_id

        WHERE employee_assets.employee_id = ?
        AND employee_assets.org_id = ?
        `,
        [employee_id, org_id],
      );

    // ---------------------------------------------------
    // IF NO ASSETS FOUND
    // ---------------------------------------------------

    if (assets.length === 0) {
      return {
        success: true,
        message: "Assets not found",
        data: null,
        status: 404,
      };
    }

    // ---------------------------------------------------
    // CHECK PENDING ASSETS
    // ---------------------------------------------------

    const handover_assets_not_done = assets.filter(
      (asset) => asset.is_returned === 0,
    );

    if (handover_assets_not_done.length > 0) {
      return {
        success: false,
        message: "Assets not returned",
        data: handover_assets_not_done,
        status: 400,
      };
    }

    // ---------------------------------------------------
    // CHECK HANDOVER QUERIES
    // ---------------------------------------------------

    const [handover_query] = await connection.query(
      `
      SELECT *
      FROM handover_query
      WHERE employee_id = ?
      AND org_id = ?
      `,
      [employee_id, org_id],
    );

    // ---------------------------------------------------
    // IF NO HANDOVER QUERY FOUND
    // ---------------------------------------------------

    if (handover_query.length === 0) {
      return {
        success: true,
        message: "Handover query not found",
        data: null,
        status: 404,
      };
    }

    // ---------------------------------------------------
    // CHECK INCOMPLETE HANDOVER QUERIES
    // ---------------------------------------------------

    const handover_query_not_completed =
      handover_query.filter(
        (query) =>
          query.handover_status !==
          "handover_completed",
      );

    if (handover_query_not_completed.length > 0) {
      return {
        success: false,
        message: "Handover query not completed",
        data: handover_query_not_completed,
        status: 400,
      };
    }

    // ---------------------------------------------------
    // SUCCESS
    // ---------------------------------------------------

    return {
      success: true,
      message: "Exit confirmation successful",
      data: {
        total_assets: assets.length,
        total_handover_queries:
          handover_query.length,
      },
      status: 200,
    };
  } catch (error) {
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

export default exit_confirmation;