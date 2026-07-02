import user_role_checker from "./user_role_checker.js";
import check_team_lead from "./check_team_lead.js";

/** HR can always act; otherwise the org team reporting manager for this team. */
export async function canModerateTeamScopedRequest(
  connection,
  action_user_id,
  org_id,
  { employee_id, team_id } = {},
) {
  const isHr = await user_role_checker(connection, action_user_id, org_id, "hr");
  if (isHr) return true;
  if (team_id == null || employee_id == null) return false;
  return check_team_lead(
    connection,
    employee_id,
    action_user_id,
    org_id,
    team_id,
  );
}

export async function canModerateOrgWideAsHr(
  connection,
  action_user_id,
  org_id,
) {
  return user_role_checker(connection, action_user_id, org_id, "hr");
}
