import db from "../db/connect.js";

export const getAttendanceHistoryOfEmployeeController = async (req, res) => {
  try {
    const {
      userId,
      month,
      year,
      status,
      page = 1,
      limit = 10,
      sort = "DESC"
    } = req.query;
  
    let query = `
      SELECT 
        id AS attendance_id,
        attendance_date AS date,
        check_in,
        check_out,
        attendance_status AS status,
        working_time
      FROM attendance
      WHERE user_id = ?
    `;
  
    const values = [userId];
  
    if (month && year) {
      query += ` AND MONTH(attendance_date) = ? AND YEAR(attendance_date) = ?`;
      values.push(month, year);
    }
  
    if (status) {
      query += ` AND attendance_status = ?`;
      values.push(status);
    }
  
    query += ` ORDER BY attendance_date ${sort}`;
  
    const offset = (page - 1) * limit;
  
    query += ` LIMIT ? OFFSET ?`;
  
    values.push(Number(limit), Number(offset));
  
    const [rows] = await db.promise().query(query, values);
  
    res.status(200).json({
      success: true,
      page: Number(page),
      limit: Number(limit),
      data: rows
    });
  } catch (error) {
    console.log("Error in getAttendanceHistoryOfEmployeeController:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch attendance history",
    });
  }
};