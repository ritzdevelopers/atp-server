import db from "../db/connect.js";

export const markAttendanceLogController = async (
    connection,
    user_id,
    org_id,
    attendance_id,
    ip_address,
  ) => {
    try {
      if (!org_id || !attendance_id || !user_id) {
        return {
          success: false,
          message: "org_id, attendance_id and user_id are required",
        };
      } 
      // Check is user valid member of the organization
      const [membership] = await connection.query(
        `SELECT id
         FROM apt_org_members
         WHERE user_id = ? AND org_id = ?`,
        [user_id, org_id]
      );
      if (membership.length === 0) {
        return {
          success: false,
          message: "User is not a member of the organization",
        };
      }
  
      // Check user
      const [user] = await connection.query(
        `SELECT user_email, user_name
         FROM apt_users
         WHERE id = ?`,
        [user_id]
      );
  
      if (user.length === 0) {
        return {
          success: false,
          message: "User not found",
        };
      }
  
      const { user_email, user_name } = user[0];
  
      // Check IP
      const [ip] = await connection.query(
        `SELECT id
         FROM organization_ips
         WHERE ip_address = ? AND org_id = ?`,
        [ip_address, org_id]
      );
  
      if (
        ip_address !== "biometric" &&
        ip_address !== "::1" &&
        ip_address !== "::ffff:127.0.0.1" &&
        ip.length === 0
      ) {
        return {
          success: false,
          message: "IP address not allowed to mark attendance",
        };
      }
  
      // Check attendance
      const [attendance_value] = await connection.query(
        `SELECT *
         FROM attendance
         WHERE id = ?`,
        [attendance_id]
      ); 
      
      if (attendance_value.length === 0) {
        return {
          success: false,
          message: "Attendance not found",
        };
      }
  
      // Get latest log
      const [logs] = await connection.query(
        `SELECT action_type
         FROM user_attendance_logs
         WHERE user_id = ?
         AND org_id = ?
         AND attendance_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [user_id, org_id, attendance_id]
      );
  
      // Toggle action
      let action_type = "ENTRY";
  
      if (logs.length > 0 && logs[0].action_type === "ENTRY") {
        action_type = "EXIT";
      }
  
      // Insert new log
      await connection.query(
        `INSERT INTO user_attendance_logs
        (user_id, user_email, user_name, attendance_id, org_id, action_type)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          user_email,
          user_name,
          attendance_id,
          org_id,
          action_type,
        ]
      );
  
      return {
        success: true,
        action_type,
        message: `Attendance marked as ${action_type}`,
      };
  
    } catch (error) {
      console.error(error);
  
      return {
        success: false,
        message: error.message || "Internal server error",
      };
    }
  };