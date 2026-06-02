import db from "../db/connect.js";

async function isEmployeeExists(user_id) {
  try {
    const [employee] = await db.promise().query(
      `SELECT * FROM apt_org_members WHERE user_id = ?`,
      [user_id],
    );
    return employee.length > 0;
  } catch (error) {
    console.error("Error in isEmployeeExists: ", error);
    return false;
  }
}

export { isEmployeeExists };