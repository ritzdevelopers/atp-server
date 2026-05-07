import db, { pool } from "../db/connect.js";


export const create_feature_controller = async (req, res) => {

  const connection = await pool.promise().getConnection();

  try {

    await connection.beginTransaction();

    const {
      feature_name,
      feature_val,
    } = req.body;

    // Validate Input
    if (!feature_name || !feature_val) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid Credentials",
        message: "feature_name and feature_val are required",
      });
    }

    // Check Duplicate Feature
    const [existingFeature] = await connection.query(
      `
      SELECT id 
      FROM apt_features
      WHERE feature_val = ?
      `,
      [feature_val]
    );

    if (existingFeature.length > 0) {

      await connection.rollback();

      return res.status(409).json({
        success: false,
        error: "Feature Already Exists",
        message: "Feature already exists",
      });
    }

    // Create Feature
    const [featureResult] = await connection.query(
      `
      INSERT INTO apt_features
      (feature_name, feature_val)
      VALUES (?, ?)
      `,
      [feature_name, feature_val]
    );

    // Insert Failed
    if (featureResult.affectedRows === 0) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        error: "Failed To Create Feature",
        message: "Failed To Create Feature",
      });
    }

    // Commit Transaction
    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Feature Created Successfully",

      data: {
        feature_id: featureResult.insertId,
        feature_name,
        feature_val,
      },
    });

  } catch (error) {

    await connection.rollback();

    console.log(
      "Error in create_feature_controller:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Try Again Later",
    });

  } finally {

    connection.release();
  }
};

export const assign_features_to_an_organization_controller = async (
  req,
  res
) => {

  const connection = await pool.promise().getConnection();

  try {

    await connection.beginTransaction();

    const {
      org_id,
      feature_ids,
    } = req.body;

    // Validate Input
    if (
      !org_id ||
      !feature_ids ||
      !Array.isArray(feature_ids) ||
      feature_ids.length === 0
    ) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid Credentials",
        message: "org_id and feature_ids are required",
      });
    }

    // Check Organization Exists
    const [organization] = await connection.query(
      `
      SELECT id
      FROM apt_organizations
      WHERE id = ?
      `,
      [org_id]
    );

    if (organization.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        success: false,
        error: "Organization Not Found",
        message: "Organization Not Found",
      });
    }

    // Validate Features
    const [features] = await connection.query(
      `
      SELECT id
      FROM apt_features
      WHERE id IN (?)
      `,
      [feature_ids]
    );

    if (features.length !== feature_ids.length) {

      await connection.rollback();

      return res.status(404).json({
        success: false,
        error: "Invalid Features",
        message: "Some features do not exist",
      });
    }

    // Check Existing Assigned Features
    const [existingAssignments] = await connection.query(
      `
      SELECT feature_id
      FROM apt_org_feature_access
      WHERE org_id = ?
      AND feature_id IN (?)
      `,
      [org_id, feature_ids]
    );

    const existingFeatureIds = existingAssignments.map(
      (item) => item.feature_id
    );

    // Filter Only New Features
    const newFeatureIds = feature_ids.filter(
      (id) => !existingFeatureIds.includes(id)
    );

    if (newFeatureIds.length === 0) {

      await connection.rollback();

      return res.status(409).json({
        success: false,
        error: "Features Already Assigned",
        message: "All features are already assigned",
      });
    }

    // Bulk Insert Into apt_org_feature_access
    const orgFeatureValues = newFeatureIds.map(
      (feature_id) => [
        org_id,
        feature_id,
      ]
    );

    const [orgFeatureResult] = await connection.query(
      `
      INSERT INTO apt_org_feature_access
      (org_id, feature_id)
      VALUES ?
      `,
      [orgFeatureValues]
    );

    if (orgFeatureResult.affectedRows === 0) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        error: "Failed To Assign Features",
        message: "Failed To Assign Features To Organization",
      });
    }

    // Get Owner Role
    const [ownerRole] = await connection.query(
      `
      SELECT id
      FROM apt_roles
      WHERE role_name = 'owner'
      AND org_id = ?
      `,
      [org_id]
    );

    if (ownerRole.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        success: false,
        error: "Owner Role Not Found",
        message: "Owner Role Not Found",
      });
    }

    const owner_role_id = ownerRole[0].id;

    // Check Existing Role Features
    const [existingRoleFeatures] = await connection.query(
      `
      SELECT feature_id
      FROM apt_role_features
      WHERE role_id = ?
      AND org_id = ?
      AND feature_id IN (?)
      `,
      [owner_role_id, org_id, newFeatureIds]
    );

    const existingRoleFeatureIds = existingRoleFeatures.map(
      (item) => item.feature_id
    );

    // Filter New Role Features
    const roleFeatureIds = newFeatureIds.filter(
      (id) => !existingRoleFeatureIds.includes(id)
    );

    // Assign Features To Owner Role
    if (roleFeatureIds.length > 0) {

      const roleFeatureValues = roleFeatureIds.map(
        (feature_id) => [
          owner_role_id,
          feature_id,
          org_id,
        ]
      );

      const [roleFeatureResult] = await connection.query(
        `
        INSERT INTO apt_role_features
        (role_id, feature_id, org_id)
        VALUES ?
        `,
        [roleFeatureValues]
      );

      if (roleFeatureResult.affectedRows === 0) {

        await connection.rollback();

        return res.status(400).json({
          success: false,
          error: "Failed To Assign Role Features",
          message: "Failed To Assign Features To Owner Role",
        });
      }
    }

    // Commit Transaction
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Features Assigned Successfully",

      data: {
        organization_id: org_id,

        assigned_feature_ids: newFeatureIds,

        total_features_assigned:
          newFeatureIds.length,

        owner_role_id,
      },
    });

  } catch (error) {

    await connection.rollback();

    console.log(
      "Error in assign_features_to_an_organization_controller:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Try Again Later",
    });

  } finally {

    connection.release();
  }
};

export const get_all_the_organizations_controller = async (req, res) => {
  try {
    // Get All Organizations
    const [organizations] = await db.promise().query("SELECT id, org_name, org_email, org_phone FROM apt_organizations");
    if(!organizations || organizations.length === 0) {
      return res.status(400).json({
        error: "No Organizations Found",
        message: "No Organizations Found",
        success: false,
      });
    }
    return res.status(200).json({
      success: true,
      message: "Organizations Fetched Successfully",
      data: organizations,
    });
  } catch (error) {
    console.log("Error in get_all_the_organizations_controller: ", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
}

export const get_all_the_features_controller = async (req, res) => {
  try {
    // Get All Features
    const [features] = await db.promise().query("SELECT id, feature_name, feature_val FROM apt_features");
    if(!features || features.length === 0) {
      return res.status(400).json({
        error: "No Features Found",
        message: "No Features Found",
        success: false,
      });
    }
    return res.status(200).json({
      success: true,
      message: "Features Fetched Successfully",
      data: features,
    });
  } catch (error) {
    console.log("Error in get_all_the_features_controller: ", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Try again later",
      success: false,
    });
  }
}