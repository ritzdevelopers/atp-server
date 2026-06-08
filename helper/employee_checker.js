
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

export { isEmployeeExists };