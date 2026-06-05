import errorHandling from "../../utils/error.handling.js";
import { pool } from "../../db/connect.js";

export const assign_sub_features_to_organization_controller = async (req, res) => {
    let connection;

    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        const { org_id, features_info } = req.body;

        if (
            !org_id ||
            !Array.isArray(features_info) ||
            features_info.length === 0
        ) {
            return errorHandling(
                connection,
                false,
                "Invalid Credentials",
                new Error("Invalid Request"),
                400
            );
        }

        // Check Organization
        const [organization_exists] = await connection.query(
            "SELECT id FROM apt_organizations WHERE id = ?",
            [org_id]
        );

        if (organization_exists.length === 0) {
            return errorHandling(
                connection,
                false,
                "Organization Not Found",
                new Error("Organization Not Found"),
                404
            );
        }

        for (const feature of features_info) {
            const { parent_feature_id, sub_features_id } = feature;

            if (
                !parent_feature_id ||
                !Array.isArray(sub_features_id) ||
                sub_features_id.length === 0
            ) {
                return errorHandling(
                    connection,
                    false,
                    "Invalid Feature Data",
                    new Error("Invalid Feature Data"),
                    400
                );
            }

            // Check Parent Feature
            const [parentFeature] = await connection.query(
                "SELECT id FROM apt_features WHERE id = ?",
                [parent_feature_id]
            );

            if (parentFeature.length === 0) {
                return errorHandling(
                    connection,
                    false,
                    "Parent Feature Not Found",
                    new Error("Parent Feature Not Found"),
                    404
                );
            }

            // Validate all sub-features at once
            const [validSubFeatures] = await connection.query(
                `
                SELECT id
                FROM apt_sub_features
                WHERE parent_feature_id = ?
                AND id IN (?)
                `,
                [parent_feature_id, sub_features_id]
            );

            if (validSubFeatures.length !== sub_features_id.length) {
                return errorHandling(
                    connection,
                    false,
                    "One Or More Sub Features Are Invalid",
                    new Error("Invalid Sub Features"),
                    404
                );
            }

            // Assign sub-features
            for (const sub_feature_id of sub_features_id) {
                await connection.query(
                    `
                    INSERT IGNORE INTO apt_org_sub_features_access
                    (
                        org_id,
                        sub_feature_id,
                        parent_feature_id
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                        org_id,
                        sub_feature_id,
                        parent_feature_id
                    ]
                );
            }
        }

        await connection.commit();

        return res.status(200).json({
            success: true,
            message: "Sub Features Assigned To Organization Successfully"
        });

    } catch (error) {

        if (connection) {
            await connection.rollback();
        }

        return errorHandling(
            connection,
            false,
            "Internal Server Error",
            error,
            500
        );

    } finally {

        if (connection) {
            connection.release();
        }
    }
};