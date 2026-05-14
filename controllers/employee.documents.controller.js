import { pool } from "../db/connect.js";
import uploadToCloudinary from "../config/cloudinary.js";

export const uploadEmployeeDocumentsController = async (req, res) => {
  try {
    const files = req.files;
    const { user_id: actingUserId } = req.user;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    const employeeUserIdRaw = req.body?.employee_user_id;
    const orgIdRaw = req.body?.org_id;

    let docUserId = actingUserId;
    let org_id;

    if (
      employeeUserIdRaw != null &&
      String(employeeUserIdRaw).trim() !== "" &&
      String(employeeUserIdRaw).trim() !== String(actingUserId)
    ) {
      const employeeUserId = String(employeeUserIdRaw).trim();
      const orgId = orgIdRaw != null ? String(orgIdRaw).trim() : "";

      if (!orgId) {
        return res.status(400).json({
          success: false,
          message: "org_id is required when uploading documents for an employee",
        });
      }

      const [adminRows] = await pool.promise().query(
        `SELECT org_id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
        [actingUserId, orgId]
      );

      if (!adminRows.length) {
        return res.status(403).json({
          success: false,
          message: "You are not a member of this organization",
        });
      }

      const [empRows] = await pool.promise().query(
        `SELECT org_id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
        [employeeUserId, orgId]
      );

      if (!empRows.length) {
        return res.status(404).json({
          success: false,
          message: "Employee not found in this organization",
        });
      }

      docUserId = employeeUserId;
      org_id = orgId;
    } else {
      const [rows] = await pool.promise().query(
        `SELECT org_id FROM apt_org_members WHERE user_id = ? LIMIT 1`,
        [actingUserId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "User organization not found",
        });
      }

      org_id = rows[0].org_id;
    }

    const uploadedDocuments = [];

    const connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    try {
      for (const file of files) {
        const result = await uploadToCloudinary(
          file.buffer,
          "employee_documents",
          "auto"
        );

        const query = `
            INSERT INTO user_docs
            (
              user_id,
              org_id,
              document_name,
              document_type,
              doc_url,
              public_id,
              resource_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;

        const values = [
          docUserId,
          org_id,
          file.originalname,
          file.fieldname,
          result.secure_url,
          result.public_id,
          result.resource_type,
        ];

        await connection.query(query, values);

        uploadedDocuments.push({
          document_name: file.originalname,
          document_type: file.fieldname,
          url: result.secure_url,
          public_id: result.public_id,
          resource_type: result.resource_type,
        });
      }

      await connection.commit();
      connection.release();

      res.status(200).json({
        success: true,
        message: "Documents uploaded successfully",
        documents: uploadedDocuments,
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
