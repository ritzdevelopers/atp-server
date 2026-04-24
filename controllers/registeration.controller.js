import db from "../db/connect.js";
import bcrypt from "bcryptjs";

export const user_register_controller = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
    // Check If User Already Exists ::
    const [user] = await db
      .promise()
      .query("SELECT * FROM apt_users WHERE user_email = ?", [email]);
    if (user.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash Password ::
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create User ::
    const [result] = await db
      .promise()
      .query(
        "INSERT INTO apt_users (user_name, user_email, user_password, user_phone) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, phone],
      );
    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to create user",
      });
    }
    return res.status(200).json({
      success: true,
      message: "User created successfully",
      user: result.insertId,
    });
  } catch (error) {
    console.log("Error in user_register_controller", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
