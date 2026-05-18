export const getSingleEmployeeFullInformationController = async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    // Check if employee exists
    const [employee] = await db.query(
      `SELECT user_name, user_email, user_phone, id, created_at, updated_at FROM apt_users WHERE id = ?`,
      [employeeId],
    );
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
