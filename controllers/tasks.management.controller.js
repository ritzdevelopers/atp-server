import db from "../db/connect.js";

export const get_all_tasks = async (req, res) => {
  try {
    const { org_id } = req;

    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }
    const query = `
    SELECT * FROM tasks where org_id = ?
    `;
    const [rows] = await db.query(query, [org_id]);
  } catch (error) {
    console.log("Error in get_all_tasks", error);
    return res.status(500).json({
      success: false,
      message: "Error in get_all_tasks",
      error: error.message,
    });
  }
};

export const create_tasks = async (req, res) => {
  try {
    const { org_id } = req;
    // const {title, description, }
    const query = `
    INSERT INTO employees_tasks 
    `;
  } catch (error) {
    console.log("Error in create_tasks", error);
    return res.status(500).json({
      success: false,
      message: "Error in create_tasks",
      error: error.message,
    });
  }
};

export const update_task = async (req, res) => {
  try {
    const { org_id } = req;
    const {task_id, title, description, task_duration, task_status} = req.body;
    
    
    const query = `
     UPDATE employees_tasks SET title = ? , description = ?, task_duration = ?, task_status = ?,
    `;
  } catch (error) {
    console.log("Error in update_task", error);
    return res.status(500).json({
      success: false,
      message: "Error in update_task",
      error: error.message,
    });
  }
};

export const delete_task = async (req, res) => {
  try {
    const { org_id } = req;
  } catch (error) {
    console.log("Error in delete_task", error);
    return res.status(500).json({
      message: "Error in delete_task",
      error: error.message,
      success: false,
    });
  }
};
