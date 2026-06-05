export const get_left_side_bar_features_controller = async (req, res) => {
  try {
    const { left_side_features } = req;

    return res.status(200).json({
      success: true,
      message: "Left Side Bar Features Fetched Successfully",
      data: left_side_features ?? [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
