import db, { pool } from "../db/connect.js";
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

export const create_org_team_controller = async (req, res) => {
  let connection;

  try {
    const { org_id } = req;
    const { user_id: created_by } = req.user;

    const {
      admin_id,
      team_name,
      team_info = null,
      team_members = [],
    } = req.body;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !created_by) {
      return res.status(400).json({
        success: false,
        message: "org_id and created_by are required",
      });
    }

    if (!admin_id || !team_name) {
      return res.status(400).json({
        success: false,
        message: "admin_id and team_name are required",
      });
    }

    if (!Array.isArray(team_members)) {
      return res.status(400).json({
        success: false,
        message: "team_members must be an array",
      });
    }

    const normalizedTeamName = String(team_name).trim().toLowerCase();

    if (!normalizedTeamName) {
      return res.status(400).json({
        success: false,
        message: "team_name cannot be empty",
      });
    }

    // Remove duplicate members
    const uniqueTeamMembers = [...new Set(team_members)];

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------- CHECK ORGANIZATION ----------------

    const [organization] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------- CHECK CREATOR MEMBERSHIP ----------------

    const [teamCreator] = await connection.query(
      `
      SELECT 
        au.id,
        au.user_name,
        au.user_email
      FROM apt_org_members aom
      INNER JOIN apt_users au
        ON au.id = aom.user_id
      WHERE aom.org_id = ?
      AND aom.user_id = ?
      `,
      [org_id, created_by],
    );

    if (teamCreator.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const team_creator_name = teamCreator[0].user_name;

    // ---------------- CHECK ADMIN MEMBERSHIP ----------------

    const [adminMember] = await connection.query(
      `
      SELECT id
      FROM apt_org_members
      WHERE org_id = ?
      AND user_id = ?
      `,
      [org_id, admin_id],
    );

    if (adminMember.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Admin user is not a member of this organization",
      });
    }

    // ---------------- CHECK TEAM EXISTS ----------------

    const [existingTeam] = await connection.query(
      `
      SELECT id
      FROM org_teams
      WHERE org_id = ?
      AND LOWER(team_name) = ?
      `,
      [org_id, normalizedTeamName],
    );

    if (existingTeam.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Team already exists",
      });
    }

    // ---------------- VALIDATE TEAM MEMBERS ----------------

    const validMembers = [];

    for (const member_id of uniqueTeamMembers) {
      if (Number(member_id) === Number(admin_id)) {
        continue;
      }
      const [member] = await connection.query(
        `
        SELECT user_id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
        [org_id, member_id],
      );

      if (member.length > 0) {
        validMembers.push(member_id);
      }
    }

    // ---------------- CREATE TEAM ----------------

    const totalMembers = validMembers.length + 1;

    const [teamResult] = await connection.query(
      `
      INSERT INTO org_teams
      (
        org_id,
        admin_id,
        created_by,
        team_name,
        team_info,
        total_number_of_members
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        org_id,
        admin_id,
        created_by,
        normalizedTeamName,
        team_info,
        totalMembers,
      ],
    );

    if (!teamResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to create team",
      });
    }

    const team_id = teamResult.insertId;

    // ---------------- ADD TEAM MEMBERS ----------------
    // Add Admin to Team Members
    // ---------------- ADD TEAM MEMBERS ----------------
    // Add Admin to Team Members
    const [adminMemberInsertResult] = await connection.query(
      `
      INSERT INTO team_members
      (
        user_id,
        team_id,
        org_id,
        joined_date,
        leave_date,
        added_by_id,
        added_by_name
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        admin_id,
        team_id,
        org_id,
        new Date(),
        null,
        created_by,
        team_creator_name,
      ],
    );

    if (!adminMemberInsertResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to add admin to team",
      });
    }

    if (validMembers.length > 0) {
      const memberValues = validMembers.map((memberId) => [
        memberId,
        team_id,
        org_id,
        new Date(),
        null,
        created_by,
        team_creator_name,
      ]);

      const [memberInsertResult] = await connection.query(
        `
        INSERT INTO team_members
        (
          user_id,
          team_id,
          org_id,
          joined_date,
          leave_date,
          added_by_id,
          added_by_name
        )
        VALUES ?
        `,
        [memberValues],
      );

      if (!memberInsertResult.affectedRows) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Failed to add team members",
        });
      }
    }

    // ---------------- SAVE ACTIVITY ----------------

    const activityPayload = {
      team_id,
      admin_id,
      team_name: normalizedTeamName,
      total_members: totalMembers,
      members: validMembers,
      admin_counted: true,
    };

    const activityReason = `Team ${normalizedTeamName} created successfully`;

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      created_by,
      admin_id,
      org_id,
      "CREATE_ORG_TEAM",
      null,
      JSON.stringify(activityPayload),
      activityReason,
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

    return res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: {
        team_id,
        org_id,
        admin_id,
        created_by,
        team_name: normalizedTeamName,
        team_info,
        total_members: totalMembers,
        members: validMembers,
      },
    });
  } catch (error) {
    console.error("Error creating org team:", error);

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

// ======================================================
export const update_org_team_controller = async (req, res) => {
  let connection;

  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;

    const { team_id, new_admin_id, team_name, team_info } = req.body;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    if (!team_id) {
      return res.status(400).json({
        success: false,
        message: "team_id is required",
      });
    }

    // At least one patch field required
    if (
      new_admin_id === undefined &&
      team_name === undefined &&
      team_info === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide at least one field: new_admin_id, team_name, or team_info",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------- CHECK ACTION USER ----------------

    const [actionUser] = await connection.query(
      `
        SELECT 
          au.id,
          au.user_name
        FROM apt_org_members aom
        INNER JOIN apt_users au
          ON au.id = aom.user_id
        WHERE aom.org_id = ?
        AND aom.user_id = ?
        `,
      [org_id, action_user_id],
    );

    if (actionUser.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const action_user_name = actionUser[0].user_name;

    // ---------------- CHECK TEAM ----------------

    const [teamRows] = await connection.query(
      `
        SELECT
          id,
          admin_id,
          team_name,
          team_info,
          total_number_of_members
        FROM org_teams
        WHERE id = ?
        AND org_id = ?
        `,
      [team_id, org_id],
    );

    if (teamRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const existingTeam = teamRows[0];

    // ---------------- OLD ADMIN ----------------

    const [oldAdminRows] = await connection.query(
      `
        SELECT id, user_name
        FROM apt_users
        WHERE id = ?
        `,
      [existingTeam.admin_id],
    );

    const old_admin_name =
      oldAdminRows.length > 0 ? oldAdminRows[0].user_name : null;

    // ---------------- HANDLE NEW ADMIN ----------------

    let final_admin_id = existingTeam.admin_id;
    let new_admin_name = old_admin_name;

    if (
      new_admin_id !== undefined &&
      Number(new_admin_id) !== Number(existingTeam.admin_id)
    ) {
      // Check new admin exists in organization
      const [newAdminMember] = await connection.query(
        `
          SELECT 
            au.id,
            au.user_name
          FROM apt_org_members aom
          INNER JOIN apt_users au
            ON au.id = aom.user_id
          WHERE aom.org_id = ?
          AND aom.user_id = ?
          `,
        [org_id, new_admin_id],
      );

      if (newAdminMember.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "New admin is not a member of this organization",
        });
      }

      // Check new admin is part of team
      const [teamAdminCheck] = await connection.query(
        `
          SELECT id
          FROM team_members
          WHERE user_id = ?
          AND team_id = ?
          AND org_id = ?
          AND leave_date IS NULL
          `,
        [new_admin_id, team_id, org_id],
      );

      if (teamAdminCheck.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "New admin must be an active member of the team",
        });
      }

      final_admin_id = new_admin_id;
      new_admin_name = newAdminMember[0].user_name;
    }

    // ---------------- HANDLE TEAM NAME ----------------

    let final_team_name = existingTeam.team_name;

    if (team_name !== undefined && String(team_name).trim() !== "") {
      final_team_name = String(team_name).trim().toLowerCase();

      // Check duplicate team name
      const [duplicateTeam] = await connection.query(
        `
          SELECT id
          FROM org_teams
          WHERE org_id = ?
          AND team_name = ?
          AND id != ?
          `,
        [org_id, final_team_name, team_id],
      );

      if (duplicateTeam.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Team name already exists",
        });
      }
    }

    // ---------------- HANDLE TEAM INFO ----------------

    let final_team_info = existingTeam.team_info;

    if (team_info !== undefined) {
      final_team_info = String(team_info).trim();
    }

    // ---------------- UPDATE TEAM ----------------

    const [updateResult] = await connection.query(
      `
        UPDATE org_teams
        SET
          admin_id = ?,
          team_name = ?,
          team_info = ?
        WHERE id = ?
        AND org_id = ?
        `,
      [final_admin_id, final_team_name, final_team_info, team_id, org_id],
    );

    if (!updateResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to update team",
      });
    }

    // ---------------- ACTIVITY LOG ----------------

    const oldPayload = {
      admin_id: existingTeam.admin_id,
      admin_name: old_admin_name,
      team_name: existingTeam.team_name,
      team_info: existingTeam.team_info,
    };

    const newPayload = {
      admin_id: final_admin_id,
      admin_name: new_admin_name,
      team_name: final_team_name,
      team_info: final_team_info,
    };

    const activityReason = `Team updated by ${action_user_name}`;

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_user_id,
      final_admin_id,
      org_id,
      "UPDATE_ORG_TEAM",
      JSON.stringify(oldPayload),
      JSON.stringify(newPayload),
      activityReason,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: {
        team_id,
        admin_id: final_admin_id,
        admin_name: new_admin_name,
        team_name: final_team_name,
        team_info: final_team_info,
      },
    });
  } catch (error) {
    console.error("Error updating org team:", error);

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

// ======================================================
// ADD MEMBER TO ORG TEAM CONTROLLER
// ======================================================

export const add_member_to_org_team_controller = async (req, res) => {
  let connection;

  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;

    const { team_id, member_user_id } = req.body;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    if (!team_id || !member_user_id) {
      return res.status(400).json({
        success: false,
        message: "team_id and member_user_id are required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------- CHECK ORGANIZATION ----------------

    const [organization] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );

    if (organization.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // ---------------- CHECK ACTION USER MEMBERSHIP ----------------

    const [actionMember] = await connection.query(
      `
      SELECT 
        au.user_name
      FROM apt_org_members aom
      INNER JOIN apt_users au
        ON au.id = aom.user_id
      WHERE aom.org_id = ?
      AND aom.user_id = ?
      `,
      [org_id, action_user_id],
    );

    if (actionMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const action_user_name = actionMember[0].user_name;

    // ---------------- CHECK TEAM EXISTS ----------------

    const [team] = await connection.query(
      `
      SELECT id, team_name, total_number_of_members
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

    // ---------------- CHECK MEMBER EXISTS ----------------

    const [member] = await connection.query(
      `
      SELECT 
        au.id,
        au.user_name
      FROM apt_org_members aom
      INNER JOIN apt_users au
        ON au.id = aom.user_id
      WHERE aom.org_id = ?
      AND aom.user_id = ?
      `,
      [org_id, member_user_id],
    );

    if (member.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Member is not part of this organization",
      });
    }

    const member_name = member[0].user_name;

    // ---------------- CHECK IF MEMBER ALREADY EXISTS IN TEAM ----------------

    const [existingMember] = await connection.query(
      `
      SELECT id
      FROM team_members
      WHERE user_id = ?
      AND team_id = ?
      AND org_id = ?
      AND leave_date IS NULL
      `,
      [member_user_id, team_id, org_id],
    );

    if (existingMember.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Member already exists in the team",
      });
    }

    // ---------------- INSERT TEAM MEMBER ----------------

    const [insertResult] = await connection.query(
      `
      INSERT INTO team_members
      (
        user_id,
        team_id,
        org_id,
        joined_date,
        leave_date,
        added_by_id,
        added_by_name
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        member_user_id,
        team_id,
        org_id,
        new Date(),
        null,
        action_user_id,
        action_user_name,
      ],
    );

    if (!insertResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to add member to team",
      });
    }

    // ---------------- UPDATE TEAM MEMBER COUNT ----------------

    await connection.query(
      `
      UPDATE org_teams
      SET total_number_of_members = total_number_of_members + 1
      WHERE id = ?
      `,
      [team_id],
    );

    // ---------------- SAVE ACTIVITY ----------------

    const activityPayload = {
      team_id,
      member_user_id,
      member_name,
      added_by: action_user_name,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_user_id,
      member_user_id,
      org_id,
      "ADD_MEMBER_TO_TEAM",
      null,
      JSON.stringify(activityPayload),
      `Added ${member_name} to team`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Member added to team successfully",
      data: {
        team_id,
        member_user_id,
        member_name,
      },
    });
  } catch (error) {
    console.error("Error adding member to team:", error);

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

// ======================================================
// REMOVE MEMBER FROM ORG TEAM CONTROLLER
// ======================================================

export const remove_member_from_org_team_controller = async (req, res) => {
  let connection;

  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;

    const { team_id, member_user_id } = req.body;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    if (!team_id || !member_user_id) {
      return res.status(400).json({
        success: false,
        message: "team_id and member_user_id are required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------- CHECK ACTION USER ----------------

    const [actionMember] = await connection.query(
      `
      SELECT 
        au.user_name
      FROM apt_org_members aom
      INNER JOIN apt_users au
        ON au.id = aom.user_id
      WHERE aom.org_id = ?
      AND aom.user_id = ?
      `,
      [org_id, action_user_id],
    );

    if (actionMember.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    const action_user_name = actionMember[0].user_name;

    // ---------------- CHECK TEAM ----------------

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

    // ---------------- CHECK TEAM MEMBER ----------------

    const [teamMember] = await connection.query(
      `
      SELECT 
        tm.id,
        au.user_name
      FROM team_members tm
      INNER JOIN apt_users au
        ON au.id = tm.user_id
      WHERE tm.user_id = ?
      AND tm.team_id = ?
      AND tm.org_id = ?
      AND tm.leave_date IS NULL
      `,
      [member_user_id, team_id, org_id],
    );

    if (teamMember.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Member not found in this team",
      });
    }

    const member_name = teamMember[0].user_name;
    const team_member_id = teamMember[0].id;

    // ---------------- REMOVE TEAM MEMBER ----------------

    const [removeResult] = await connection.query(
      `
      UPDATE team_members
      SET
        leave_date = ?,
        removed_by_id = ?,
        removed_by_name = ?
      WHERE id = ?
      `,
      [new Date(), action_user_id, action_user_name, team_member_id],
    );

    if (!removeResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to remove member from team",
      });
    }

    // ---------------- UPDATE TEAM COUNT ----------------

    await connection.query(
      `
      UPDATE org_teams
      SET total_number_of_members =
      CASE
        WHEN total_number_of_members > 0
        THEN total_number_of_members - 1
        ELSE 0
      END
      WHERE id = ?
      `,
      [team_id],
    );

    // ---------------- SAVE ACTIVITY ----------------

    const activityPayload = {
      team_id,
      member_user_id,
      member_name,
      removed_by: action_user_name,
    };

    const [activityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
      action_user_id,
      member_user_id,
      org_id,
      "REMOVE_MEMBER_FROM_TEAM",
      JSON.stringify({
        team_member_id,
        team_id,
        member_user_id,
      }),
      JSON.stringify(activityPayload),
      `Removed ${member_name} from team`,
    ]);

    if (!activityResult.affectedRows) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Member removed from team successfully",
      data: {
        team_id,
        member_user_id,
        member_name,
      },
    });
  } catch (error) {
    console.error("Error removing member from team:", error);

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

export const get_all_org_team_members_controller = async (req, res) => {
  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    // ---------------- CHECK USER MEMBERSHIP ----------------

    const [actionUser] = await db.promise().query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, action_user_id],
    );

    if (actionUser.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------- FETCH TEAMS WITH MEMBERS ----------------

    const [rows] = await db.promise().query(
      `
        SELECT
          ot.id AS team_id,
          ot.team_name,
          ot.team_info,
          ot.total_number_of_members,
          ot.admin_id,
  
          admin_user.user_name AS admin_name,
  
          tm.id AS team_member_id,
          tm.user_id,
          tm.joined_date,
          tm.leave_date,
          tm.added_by_id,
          tm.added_by_name,
          tm.removed_by_id,
          tm.removed_by_name,
  
          au.user_name,
          au.user_email,
          au.user_phone
  
        FROM org_teams ot
  
        LEFT JOIN apt_users admin_user
          ON admin_user.id = ot.admin_id
  
        LEFT JOIN team_members tm
          ON ot.id = tm.team_id
          AND tm.leave_date IS NULL
  
        LEFT JOIN apt_users au
          ON au.id = tm.user_id
  
        WHERE ot.org_id = ?
  
        ORDER BY ot.id DESC
        `,
      [org_id],
    );

    // ---------------- GROUP DATA ----------------

    const groupedTeams = {};

    for (const row of rows) {
      if (!groupedTeams[row.team_id]) {
        groupedTeams[row.team_id] = {
          team_id: row.team_id,
          team_name: row.team_name,
          team_info: row.team_info,
          total_number_of_members: row.total_number_of_members,
          admin_id: row.admin_id,
          admin_name: row.admin_name,
          members: [],
        };
      }

      // Add member only if exists
      if (row.user_id) {
        groupedTeams[row.team_id].members.push({
          team_member_id: row.team_member_id,
          user_id: row.user_id,
          user_name: row.user_name,
          user_email: row.user_email,
          user_phone: row.user_phone,
          joined_date: row.joined_date,
          leave_date: row.leave_date,
          added_by_id: row.added_by_id,
          added_by_name: row.added_by_name,
          removed_by_id: row.removed_by_id,
          removed_by_name: row.removed_by_name,
        });
      }
    }

    // Org members who are not in any active team in this org (for onboarding / add flows)
    const [users] = await db.promise().query(
      `
      SELECT
        au.id,
        au.user_name,
        au.user_email,
        au.user_phone
      FROM apt_org_members aom
      INNER JOIN apt_users au
        ON au.id = aom.user_id
      WHERE aom.org_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM team_members tm
          WHERE tm.org_id = aom.org_id
            AND tm.user_id = aom.user_id
            AND tm.leave_date IS NULL
        )
      ORDER BY au.user_name ASC
      `,
      [org_id],
    );

    const users_not_in_teams = users.map((user) => ({
      user_id: user.id,
      user_name: user.user_name,
      user_email: user.user_email,
      user_phone: user.user_phone,
    }));

    return res.status(200).json({
      success: true,
      message: "All organization teams fetched successfully",
      data: {
        teams: Object.values(groupedTeams),
        users_not_in_teams,
      },
    });
  } catch (error) {
    console.error("Error getting all org team members:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const get_single_org_team_member_controller = async (req, res) => {
  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;

    // ---------------- VALIDATIONS ----------------

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    // ---------------- CHECK MEMBERSHIP ----------------

    const [actionUser] = await db.promise().query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ?
        AND user_id = ?
        `,
      [org_id, action_user_id],
    );

    if (actionUser.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // ---------------- GET USER TEAM ----------------

    const [team] = await db.promise().query(
      `
        SELECT team_id
        FROM team_members
        WHERE user_id = ?
        AND org_id = ?
        AND leave_date IS NULL
        `,
      [action_user_id, org_id],
    );

    if (team.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found in any active team",
      });
    }

    const team_id = team[0].team_id;

    // ---------------- FETCH TEAM WITH MEMBERS (same shape as get-team/:id) ----------------

    const [rows] = await db.promise().query(
      `
        SELECT
          ot.id AS team_id,
          ot.team_name,
          ot.team_info,
          ot.total_number_of_members,
          ot.admin_id,
          ot.created_at,
          ot.updated_at,
          ot.created_by,

          creator.user_name AS created_by_name,
          admin.user_name AS admin_name,

          tm.id AS team_member_id,
          tm.user_id,
          au.user_name,
          au.user_email,
          au.user_phone,
          tm.joined_date,
          tm.leave_date,
          tm.added_by_id,
          tm.added_by_name,
          tm.removed_by_id,
          tm.removed_by_name

        FROM org_teams ot

        LEFT JOIN apt_users admin
          ON admin.id = ot.admin_id

        LEFT JOIN apt_users creator
          ON creator.id = ot.created_by

        LEFT JOIN team_members tm
          ON tm.team_id = ot.id
          AND tm.leave_date IS NULL

        LEFT JOIN apt_users au
          ON au.id = tm.user_id

        WHERE ot.id = ?
          AND ot.org_id = ?
        `,
      [team_id, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const head = rows[0];

    const members = [];
    for (const row of rows) {
      if (row.user_id != null) {
        members.push({
          team_member_id: row.team_member_id,
          user_id: row.user_id,
          user_name: row.user_name,
          user_email: row.user_email,
          user_phone: row.user_phone,
          joined_date: row.joined_date,
          leave_date: row.leave_date,
          added_by_id: row.added_by_id,
          added_by_name: row.added_by_name,
          removed_by_id: row.removed_by_id,
          removed_by_name: row.removed_by_name,
        });
      }
    }

    const adminMembership = members.find(
      (m) => Number(m.user_id) === Number(head.admin_id),
    );

    const formattedTeam = {
      team_id: head.team_id,
      team_name: head.team_name,
      team_info: head.team_info,
      total_number_of_members: head.total_number_of_members,
      admin_id: head.admin_id,
      admin_name: head.admin_name,
      created_at: head.created_at,
      updated_at: head.updated_at,
      created_by: head.created_by,
      created_by_name: head.created_by_name ?? null,
      admin_joined_date: adminMembership?.joined_date ?? null,
      admin_added_by_id: adminMembership?.added_by_id ?? null,
      admin_added_by_name: adminMembership?.added_by_name ?? null,
      is_admin: Number(head.admin_id) === Number(action_user_id),

      members,
    };

    return res.status(200).json({
      success: true,
      message: "Team fetched successfully",
      data: formattedTeam,
    });
  } catch (error) {
    console.error("Error getting single org team member:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const get_single_org_team_controller = async (req, res) => {
  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;
    const { team_id } = req.params;

    // Validate Inputs
    if (!team_id) {
      return res.status(400).json({
        success: false,
        message: "team_id is required",
      });
    }

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    // Check Action User Membership
    const [member] = await db.promise().query(
      `
        SELECT id
        FROM apt_org_members
        WHERE org_id = ? AND user_id = ?
        `,
      [org_id, action_user_id],
    );

    if (member.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this organization",
      });
    }

    // Fetch team + active members (leave filter on JOIN so empty rosters still return)
    const [rows] = await db.promise().query(
      `
        SELECT
          ot.id AS team_id,
          ot.team_name,
          ot.team_info,
          ot.total_number_of_members,
          ot.admin_id,
          ot.created_at,
          ot.updated_at,
          ot.created_by,

          creator.user_name AS created_by_name,
          admin.user_name AS admin_name,

          tm.id AS team_member_id,
          tm.user_id,
          au.user_name,
          au.user_email,
          au.user_phone,
          tm.joined_date,
          tm.leave_date,
          tm.added_by_id,
          tm.added_by_name,
          tm.removed_by_id,
          tm.removed_by_name

        FROM org_teams ot

        LEFT JOIN apt_users admin
          ON admin.id = ot.admin_id

        LEFT JOIN apt_users creator
          ON creator.id = ot.created_by

        LEFT JOIN team_members tm
          ON tm.team_id = ot.id
          AND tm.leave_date IS NULL

        LEFT JOIN apt_users au
          ON au.id = tm.user_id

        WHERE ot.id = ?
          AND ot.org_id = ?
        `,
      [team_id, org_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const head = rows[0];

    const members = [];
    for (const row of rows) {
      if (row.user_id != null) {
        members.push({
          team_member_id: row.team_member_id,
          user_id: row.user_id,
          user_name: row.user_name,
          user_email: row.user_email,
          user_phone: row.user_phone,
          joined_date: row.joined_date,
          leave_date: row.leave_date,
          added_by_id: row.added_by_id,
          added_by_name: row.added_by_name,
          removed_by_id: row.removed_by_id,
          removed_by_name: row.removed_by_name,
        });
      }
    }

    const adminMembership = members.find(
      (m) => Number(m.user_id) === Number(head.admin_id),
    );

    const formattedTeam = {
      team_id: head.team_id,
      team_name: head.team_name,
      team_info: head.team_info,
      total_number_of_members: head.total_number_of_members,
      admin_id: head.admin_id,
      admin_name: head.admin_name,
      created_at: head.created_at,
      updated_at: head.updated_at,
      created_by: head.created_by,
      created_by_name: head.created_by_name ?? null,
      admin_joined_date: adminMembership?.joined_date ?? null,
      admin_added_by_id: adminMembership?.added_by_id ?? null,
      admin_added_by_name: adminMembership?.added_by_name ?? null,
      members,
    };

    return res.status(200).json({
      success: true,
      message: "Team fetched successfully",
      data: formattedTeam,
    });
  } catch (error) {
    console.error("Error getting single org team:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

function parseActivityJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function activityRowMatchesTeam(row, teamIdNum) {
  const n = Number(teamIdNum);
  if (Number.isNaN(n)) return false;
  for (const key of ["new_value", "old_value"]) {
    const o = parseActivityJson(row[key]);
    if (o && o.team_id != null && Number(o.team_id) === n) return true;
  }
  return false;
}

/** Recent org activity rows for this team (from apt_user_activity_logs). */
export const get_team_activity_feed_controller = async (req, res) => {
  try {
    const { org_id } = req;
    const { user_id: action_user_id } = req.user;
    const { team_id } = req.params;

    if (!org_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "org_id and action_user_id are required",
      });
    }

    if (!team_id) {
      return res.status(400).json({
        success: false,
        message: "team_id is required",
      });
    }

    const [memberOk] = await db.promise().query(
      `
      SELECT 1
      FROM team_members
      WHERE team_id = ?
        AND org_id = ?
        AND user_id = ?
        AND leave_date IS NULL
      LIMIT 1
      `,
      [team_id, org_id, action_user_id],
    );

    if (memberOk.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not an active member of this team",
      });
    }

    const TEAM_ACTIONS = [
      "CREATE_ORG_TEAM",
      "UPDATE_ORG_TEAM",
      "ADD_MEMBER_TO_TEAM",
      "REMOVE_MEMBER_FROM_TEAM",
    ];

    const [exitProcessRows] = await db.promise().query(
      `
      SELECT
        ee.id,
        ee.employee_id,
        ee.action_type,
        ee.exit_date,
        ee.last_working_day,
        au.user_name AS employee_name,
        au.user_email AS employee_email,
        ap.user_name AS action_performed_by_name
      FROM employee_exit_process ee
      LEFT JOIN apt_users au ON au.id = ee.employee_id
      LEFT JOIN apt_users ap ON ap.id = ee.action_performed_by
      WHERE ee.team_id = ?
        AND ee.org_id = ?
        AND ee.application_status = 'in_progress'
      ORDER BY ee.updated_at DESC
      `,
      [team_id, org_id],
    );

    const exit_processes_reports = Array.isArray(exitProcessRows)
      ? exitProcessRows.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          action_type: row.action_type ?? null,
          exit_date: row.exit_date ?? null,
          last_working_day: row.last_working_day ?? null,
          employee_name: row.employee_name ?? null,
          employee_email: row.employee_email ?? null,
          action_performed_by_name: row.action_performed_by_name ?? null,
        }))
      : [];
    const [rows] = await db.promise().query(
      `
      SELECT
        l.id,
        l.performed_by,
        l.affected_user_id,
        l.action_type,
        l.old_value,
        l.new_value,
        l.action_reason,
        l.created_at,
        
        p.user_name AS performed_by_name,
        a.user_name AS affected_user_name
      FROM apt_user_activity_logs l
      LEFT JOIN apt_users p ON p.id = l.performed_by
      LEFT JOIN apt_users a ON a.id = l.affected_user_id
      WHERE l.org_id = ?
        AND l.action_type IN (?, ?, ?, ?)
      ORDER BY l.created_at DESC
      LIMIT 120
      `,
      [org_id, ...TEAM_ACTIONS],
    );

    const [leaveQueries] = await db.promise().query(
      `
      SELECT
        lq.id,
        lq.user_id,
        lq.user_name,
        lq.user_email,
        lq.org_id,
        lq.leave_type,
        lq.start_date,
        lq.end_date,
        lq.reason,
        lq.status,
        lq.team_id,
        lq.created_at,
        lq.updated_at,
        au.user_phone AS user_phone
      FROM leave_quiry lq
      LEFT JOIN apt_users au ON au.id = lq.user_id
      WHERE lq.team_id = ? AND lq.org_id = ?
      ORDER BY lq.created_at DESC
      LIMIT 80
      `,
      [team_id, org_id],
    );

    const leave_queries = Array.isArray(leaveQueries)
      ? leaveQueries.map((query) => ({
          id: query.id,
          user_id: query.user_id,
          user_name: query.user_name,
          user_email: query.user_email,
          user_phone: query.user_phone ?? null,
          org_id: query.org_id,
          leave_type: query.leave_type,
          start_date: query.start_date,
          end_date: query.end_date,
          reason: query.reason,
          status: query.status,
          team_id: query.team_id,
          created_at: query.created_at,
          updated_at: query.updated_at ?? null,
        }))
      : [];
    const teamIdNum = Number(team_id);
    const filtered = rows.filter((r) => activityRowMatchesTeam(r, teamIdNum));

    const notifications = filtered.slice(0, 50).map((r) => ({
      id: r.id,
      action_type: r.action_type,
      action_reason: r.action_reason,
      created_at: r.created_at,
      performed_by_name: r.performed_by_name,
      affected_user_name: r.affected_user_name,
    }));

    return res.status(200).json({
      success: true,
      message: "Team activity loaded",
      data: {
        notifications,
        leave_queries,
        exit_processes_reports,
      },
    });
  } catch (error) {
    console.error("Error getting team activity feed:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const get_team_member_exit_process_reports_controller = async (
  req,
  res,
) => {
  try {
    const { org_id } = req;
    const { user_id: manager_id } = req.user;
    const { employee_id } = req.params;

    if (!org_id || !manager_id || !employee_id) {
      return res.status(400).json({
        success: false,
        message:
          "org_id, manager_id and employee_id are required",
      });
    }

    // ---------------------------------------------------
    // GET EXIT PROCESS REPORTS
    // ---------------------------------------------------

    const query = `
      SELECT
        ep.*,

        org.user_id AS member_user_id,

        ut.joined_date AS team_joining_date,
        ut.team_id AS team_id,

        tm.team_name AS team_name,
        tm.admin_id AS team_admin_id,

        hq.id AS handover_query_id,
        hq.asset_id,
        hq.custom_task_name,
        hq.handover_status,
        hq.remarks,
        hq.handover_date,
        hq.created_at AS handover_created_at,

        user.user_name AS employee_name,
        user.user_email AS employee_email,
        user.user_phone AS employee_phone

      FROM employee_exit_process ep

      INNER JOIN apt_org_members org
      ON org.org_id = ep.org_id
      AND org.user_id = ep.employee_id

      INNER JOIN team_members ut
      ON ut.user_id = ep.employee_id
      AND ut.org_id = ep.org_id
      AND ut.team_id = ep.team_id

      INNER JOIN org_teams tm
      ON tm.id = ut.team_id
      AND tm.org_id = ut.org_id

      LEFT JOIN handover_query hq
      ON hq.employee_id = ep.employee_id
      AND hq.org_id = ep.org_id
      AND hq.team_id = ep.team_id

      INNER JOIN apt_users user
      ON user.id = ep.employee_id

      WHERE ep.employee_id = ?
      AND ep.org_id = ?
    `;

    const [rows] = await db
      .promise()
      .query(query, [employee_id, org_id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exit process reports not found",
      });
    }

    // ---------------------------------------------------
    // FORMAT RESPONSE
    // ---------------------------------------------------

    const formattedData = {
      exit_process: {
        exit_process_id: rows[0].id,
        employee_id: rows[0].employee_id,
        employee_name: rows[0].employee_name,
        employee_email: rows[0].employee_email,
        employee_phone: rows[0].employee_phone,

        org_id: rows[0].org_id,

        team_id: rows[0].team_id,
        team_name: rows[0].team_name,
        team_admin_id: rows[0].team_admin_id,

        application_status:
          rows[0].application_status,

        response_message:
          rows[0].response_message,

        resolved_at: rows[0].resolved_at,

        created_at: rows[0].created_at,

        updated_at: rows[0].updated_at ?? null,

        action_type: rows[0].action_type ?? null,
        action_reason: rows[0].action_reason ?? null,
        exit_date: rows[0].exit_date ?? null,
        last_working_day: rows[0].last_working_day ?? null,

        team_joining_date:
          rows[0].team_joining_date,
      },

      handover_queries: (() => {
        const byId = new Map();
        for (const item of rows) {
          const hid = item.handover_query_id;
          if (hid == null || byId.has(hid)) continue;
          byId.set(hid, {
            handover_query_id: hid,
            asset_id: item.asset_id ?? null,
            custom_task_name: item.custom_task_name ?? null,
            handover_status: item.handover_status ?? null,
            remarks: item.remarks ?? null,
            handover_date: item.handover_date ?? null,
            created_at: item.handover_created_at ?? null,
          });
        }
        return [...byId.values()];
      })(),
    };

    return res.status(200).json({
      success: true,
      message:
        "Exit process reports fetched successfully",
      data: formattedData,
    });
  } catch (error) {
    console.error(
      "Error getting team member exit process reports:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};