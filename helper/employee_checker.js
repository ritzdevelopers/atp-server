async function isEmployeeExists(connection, user_id, org_id) {
  try {
    const [employee] = await connection.query(
      `SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`,
      [user_id, org_id],
    );
    return employee.length > 0;
  } catch (error) {
    console.error("Error in isEmployeeExists: ", error);
    return false;
  }
}

async function isTeamExists(
  connection,
  user_id,
  org_id,
  team_id,
  reporting_manager,
) {
  try {
    // Check if the team exists in the database
    const [team_status] = await connection.query(
      `
      SELECT * FROM org_teams WHERE id = ? AND org_id = ? AND admin_id = ?
      `,
      [team_id, org_id, reporting_manager],
    );
    if (team_status.length === 0) {
      return false;
    }
    // Check user team membership ::
    const [member_status] = await connection.query(
      `
        SELECT *  FROM team_members WHERE user_id = ?  AND team_id = ? AND org_id = ?
        `,
      [user_id, team_id, org_id],
    );
    if (member_status.length === 0) {
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error in isTeamExists: ", error);
    return false;
  }
}

async function getEmployeeName(connection, user_id, org_id) {
  try {
    // Check If Employee Active Member Of The Organization ::
    const [employee] = await connection.query(
      `SELECT * FROM apt_org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`,
      [user_id, org_id],
    );
    if (employee.length === 0) {
      return {
        success: false,
        name: null,
      };
    }

    // Get Employee Name and Return It ::
    const [employee_name] = await connection.query(
      `
      SELECT user_name FROM apt_users WHERE id = ?
      `,
      [employee[0].user_id],
    );
    if (employee_name.length === 0) {
      return {
        success: false,
        name: null,
      };
    }
    return {
      success: true,
      name: employee_name[0].user_name,
    };
  } catch (error) {
    console.error("Error in getEmployeeName: ", error);
    return {
      success: false,
      name: null,
    };
  }
}

export { isEmployeeExists, isTeamExists, getEmployeeName };
