import db, { pool } from "../../db/connect.js";
import errorHandling from "../../utils/error.handling.js";

export const create_new_sub_feature_controller = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const {sub_feature_name, parent_feature_id, sub_feature_path} = req.body;

    if(!sub_feature_name || !parent_feature_id || !sub_feature_path) { 
        return errorHandling(connection, res, false, "Invalid Credentials", new Error("Invalid Request"), 400);
    }
    // --> 1: Check if Parent Feature Exists
    const [parent_feature_result] = await connection.query("SELECT * FROM apt_features WHERE id = ?", [parent_feature_id]);
    if(parent_feature_result.length === 0) {  
        return errorHandling(connection, res, false, "Parent Feature Not Found", new Error("Parent Feature Not Found"), 404);
    }
    // --> 2: Check if Sub Feature Already Exists ::
    const [sub_feature_result] = await connection.query(`
        SELECT * FROM apt_sub_features WHERE sub_feature_path = ?
        `, [sub_feature_path]);
    if(sub_feature_result.length > 0) {
        return errorHandling(connection, res, false, "Sub Feature Already Exists", new Error("Sub Feature Already Exists"), 400);
    }
    // --> 3: Create New Sub Feature
    const [new_sub_feature_result] = await connection.query(`
        INSERT INTO apt_sub_features (sub_feature_name, parent_feature_id, sub_feature_path) VALUES (?, ?, ?)
        `, [sub_feature_name, parent_feature_id, sub_feature_path]);
    await connection.commit();
    return res.status(201).json({
        success: true,
        message: "Sub Feature Created Successfully",
        data: new_sub_feature_result,
    });
  } catch (error) {
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if(connection) {
        connection.release();
    }
  }
};

export const update_sub_feature_controller = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const {id, sub_feature_name, parent_feature_id, sub_feature_path} = req.body;

    if(!id || !sub_feature_name || !parent_feature_id || !sub_feature_path) {
        return errorHandling(connection, res, false, "Invalid Credentials", new Error("Invalid Request"), 400);
    }
    // --> 1: Check if Sub Feature Exists
    const [existing_sub_feature] = await connection.query(
        "SELECT * FROM apt_sub_features WHERE id = ?",
        [id]
    );
    if(existing_sub_feature.length === 0) {
        return errorHandling(connection, res, false, "Sub Feature Not Found", new Error("Sub Feature Not Found"), 404);
    }
    // --> 2: Check if Parent Feature Exists
    const [parent_feature_result] = await connection.query(
        "SELECT * FROM apt_features WHERE id = ?",
        [parent_feature_id]
    );
    if(parent_feature_result.length === 0) {
        return errorHandling(connection, res, false, "Parent Feature Not Found", new Error("Parent Feature Not Found"), 404);
    }
    // --> 3: Check if Sub Feature Path Already Exists (excluding current record)
    const [duplicate_path_result] = await connection.query(`
        SELECT * FROM apt_sub_features WHERE sub_feature_path = ? AND id != ?
        `, [sub_feature_path, id]);
    if(duplicate_path_result.length > 0) {
        return errorHandling(connection, res, false, "Sub Feature Path Already Exists", new Error("Sub Feature Path Already Exists"), 400);
    }
    // --> 4: Update Sub Feature
    const [update_result] = await connection.query(`
        UPDATE apt_sub_features
        SET sub_feature_name = ?, parent_feature_id = ?, sub_feature_path = ?
        WHERE id = ?
        `, [sub_feature_name, parent_feature_id, sub_feature_path, id]);
    await connection.commit();
    return res.status(200).json({
        success: true,
        message: "Sub Feature Updated Successfully",
        data: update_result,
    });
  } catch (error) {
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if(connection) {
        connection.release();
    }
  }
};

export const get_all_sub_features_controller = async (req, res) => {
  try {
    const [sub_features] = await pool.promise().query(`
        SELECT
            sf.id,
            sf.sub_feature_name,
            sf.sub_feature_path,
            sf.parent_feature_id,
            f.feature_name,
            f.feature_val
        FROM apt_sub_features sf
        INNER JOIN apt_features f ON sf.parent_feature_id = f.id
        ORDER BY sf.id ASC
        `);
    return res.status(200).json({
        success: true,
        message: "Sub Features Fetched Successfully",
        data: sub_features,
    });
  } catch (error) {
    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error.message,
    });
  }
};
