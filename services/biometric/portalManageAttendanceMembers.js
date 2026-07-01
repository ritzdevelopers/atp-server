import { pool } from "../../db/connect.js";
import { isRmwEmailOnly, isRmwPortalEmail } from "./manageAttendanceOptions.js";

const ACTIVE_WITH_EMP_CODE_SQL = `
  AND om.is_active = 1
  AND om.emp_code IS NOT NULL
  AND TRIM(om.emp_code) != ''
`;

/**
 * Portal org members eligible for manage-attendance:
 * active members with a non-empty emp_code (one row per user_id).
 */
export async function fetchPortalManageAttendanceMembers(orgId) {
  const rmwEmailOnly = isRmwEmailOnly();
  const rmwEmailClause = rmwEmailOnly
    ? "AND LOWER(emp_info.user_email) LIKE '%@rmw.com'"
    : "";

  const [rows] = await pool.promise().query(
    `SELECT
       om.user_id,
       TRIM(om.emp_code) AS emp_code,
       om.is_active AS org_member_is_active,
       emp_info.id AS employee_id,
       emp_info.user_name AS employee_name,
       emp_info.user_email AS employee_email,
       emp_info.user_phone AS employee_phone,
       emp_info.user_image AS employee_profile_img,
       om.org_id AS org_id,
       COALESCE(apt_roles.role_name, 'employee') AS employee_designation,
       m.biometric_employee_code,
       s.end_time AS shift_end_time,
       s.late_after
     FROM apt_org_members om
     INNER JOIN apt_users emp_info ON emp_info.id = om.user_id
     LEFT JOIN biometric_employee_mappings m
       ON m.user_id = om.user_id AND m.org_id = om.org_id
     LEFT JOIN apt_user_roles
       ON apt_user_roles.user_id = om.user_id
       AND apt_user_roles.org_id = om.org_id
     LEFT JOIN apt_roles
       ON apt_roles.id = apt_user_roles.role_id
       AND apt_roles.org_id = om.org_id
     LEFT JOIN user_shifts us
       ON us.user_id = om.user_id AND us.org_id = om.org_id
     LEFT JOIN shifts s ON s.id = us.shift_id
     WHERE om.org_id = ?
       ${ACTIVE_WITH_EMP_CODE_SQL}
       ${rmwEmailClause}
     ORDER BY emp_info.user_name ASC, om.user_id ASC`,
    [orgId],
  );

  if (!rmwEmailOnly) return rows;

  return rows.filter((row) => isRmwPortalEmail(row.employee_email));
}

export async function countPortalManageAttendanceTotals(orgId) {
  const rmwEmailOnly = isRmwEmailOnly();
  const rmwEmailClause = rmwEmailOnly
    ? "AND LOWER(emp_info.user_email) LIKE '%@rmw.com'"
    : "";

  const [rows] = await pool.promise().query(
    `SELECT
       SUM(
         CASE
           WHEN om.is_active = 1
             AND om.emp_code IS NOT NULL
             AND TRIM(om.emp_code) != ''
           THEN 1 ELSE 0
         END
       ) AS active_total,
       SUM(CASE WHEN om.is_active = 0 THEN 1 ELSE 0 END) AS inactive_total
     FROM apt_org_members om
     INNER JOIN apt_users emp_info ON emp_info.id = om.user_id
     WHERE om.org_id = ?
       ${rmwEmailClause}`,
    [orgId],
  );

  let activeTotal = Number(rows[0]?.active_total || 0);
  const inactiveTotal = Number(rows[0]?.inactive_total || 0);

  if (rmwEmailOnly) {
    const members = await fetchPortalManageAttendanceMembers(orgId);
    activeTotal = members.length;
  }

  return { activeTotal, inactiveTotal };
}
