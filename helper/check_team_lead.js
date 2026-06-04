const check_team_lead = async (
    connection,
    member_id,
    team_lead_id,
    org_id,
    team_id
) => {
    try {
        const [team_member] = await connection.query(
            `
            SELECT 1
            FROM team_members
            WHERE user_id = ?
            AND org_id = ?
            AND team_id = ?
            LIMIT 1
            `,
            [member_id, org_id, team_id]
        );

        if (team_member.length === 0) {
            return false;
        }

        const [team_lead] = await connection.query(
            `
            SELECT 1
            FROM org_teams
            WHERE id = ?
            AND org_id = ?
            AND admin_id = ?
            LIMIT 1
            `,
            [team_id, org_id, team_lead_id]
        );

        if (team_lead.length === 0) {
            return false;
        }

        return true;
    } catch (error) {
        console.error("Error in check_team_lead:", error);
        return false;
    }
};

export default check_team_lead;