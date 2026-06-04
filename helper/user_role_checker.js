const user_role_checker = async (connection, user_id, org_id, role) => {
  try {
    const query1 = `
        SELECT role_id FROM apt_user_roles WHERE user_id = ? AND org_id = ?
        `;
    const query2 = `
        SELECT role_name FROM apt_roles WHERE id = ? AND org_id = ?
        `;
    const [user_role] = await connection.query(query1, [user_id, org_id]);
    if (user_role.length === 0) {
      return false;
    }
    const [role_info] = await connection.query(query2, [
      user_role[0].role_id,
      org_id,
    ]);
    if (role_info.length === 0) {
      return false;
    }
    const role_name = role_info[0].role_name;
    
    return role_name === role;
  } catch (error) {
    console.error("Error in user_role_checker: ", error);
    return false;
  }
};

export default user_role_checker;
