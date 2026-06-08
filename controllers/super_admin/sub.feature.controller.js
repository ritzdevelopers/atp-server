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

export const assign_sub_features_to_an_organization_controller = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { org_id, features_info } = req.body;

    if (!org_id || !Array.isArray(features_info) || features_info.length === 0) {
      return errorHandling(connection, res, false, "Invalid Credentials", new Error("Invalid Request"), 400);
    }

    // features_info = [
    //   {
    //     parent_feature_id: Number,
    //     sub_features_ids: [Number],
    //   }
    // ]

    const [organization_exists] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (organization_exists.length === 0) {
      return errorHandling(connection, res, false, "Organization Not Found", new Error("Organization Not Found"), 404);
    }

    for (const feature of features_info) {
      const { parent_feature_id, sub_features_ids } = feature;

      if (
        !parent_feature_id ||
        !Array.isArray(sub_features_ids) ||
        sub_features_ids.length === 0
      ) {
        return errorHandling(connection, res, false, "Invalid Feature Data", new Error("Invalid Feature Data"), 400);
      }

      const [parentFeature] = await connection.query(
        "SELECT id FROM apt_features WHERE id = ?",
        [parent_feature_id],
      );
      if (parentFeature.length === 0) {
        return errorHandling(connection, res, false, "Parent Feature Not Found", new Error("Parent Feature Not Found"), 404);
      }

      const [orgParentFeature] = await connection.query(
        "SELECT feature_id FROM apt_org_feature_access WHERE org_id = ? AND feature_id = ?",
        [org_id, parent_feature_id],
      );
      if (orgParentFeature.length === 0) {
        return errorHandling(
          connection,
          res,
          false,
          "Parent Feature Not Assigned To Organization",
          new Error("Parent Feature Not Assigned To Organization"),
          400,
        );
      }

      const [validSubFeatures] = await connection.query(
        `
        SELECT id
        FROM apt_sub_features
        WHERE parent_feature_id = ?
          AND id IN (?)
        `,
        [parent_feature_id, sub_features_ids],
      );
      if (validSubFeatures.length !== sub_features_ids.length) {
        return errorHandling(
          connection,
          res,
          false,
          "One Or More Sub Features Are Invalid",
          new Error("Invalid Sub Features"),
          404,
        );
      }

      for (const sub_feature_id of sub_features_ids) {
        await connection.query(
          `
          INSERT IGNORE INTO apt_org_sub_features_access
          (org_id, sub_feature_id, parent_feature_id)
          VALUES (?, ?, ?)
          `,
          [org_id, sub_feature_id, parent_feature_id],
        );
      }
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Sub Features Assigned To Organization Successfully",
    });
  } catch (error) {
    return errorHandling(connection, res, false, "Internal Server Error", error, 500);
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
