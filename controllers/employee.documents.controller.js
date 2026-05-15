import { pool } from "../db/connect.js";
import uploadToCloudinary, {
  destroyFromCloudinary,
} from "../config/cloudinary.js";

/**
 * Best-effort delete of Cloudinary assets uploaded during a failed request.
 * @param {{ public_id: string, resource_type?: string }[]} assets
 */
async function destroyUploadedAssets(assets) {
  for (const a of assets) {
    if (a?.public_id == null || String(a.public_id).trim() === "") continue;
    await destroyFromCloudinary(
      a.public_id,
      a.resource_type || "image",
    ).catch((err) =>
      console.error(
        "Cloudinary rollback cleanup failed:",
        a.public_id,
        err?.message || err,
      ),
    );
  }
}

 
async function resolveDocTarget(req) {
  const { user_id: actingUserId } = req.user;
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
      return {
        error: {
          status: 400,
          body: {
            success: false,
            message:
              "org_id is required when adding or updating documents for another user",
          },
        },
      };
    }

    const [adminRows] = await pool
      .promise()
      .query(
        `SELECT org_id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
        [actingUserId, orgId],
      );

    if (!adminRows.length) {
      return {
        error: {
          status: 403,
          body: {
            success: false,
            message: "You are not a member of this organization",
          },
        },
      };
    }

    const [empRows] = await pool
      .promise()
      .query(
        `SELECT org_id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1`,
        [employeeUserId, orgId],
      );

    if (!empRows.length) {
      return {
        error: {
          status: 404,
          body: {
            success: false,
            message: "Employee not found in this organization",
          },
        },
      };
    }

    docUserId = employeeUserId;
    org_id = orgId;
  } else {
    const [rows] = await pool
      .promise()
      .query(`SELECT org_id FROM apt_org_members WHERE user_id = ? LIMIT 1`, [
        actingUserId,
      ]);

    if (!rows.length) {
      return {
        error: {
          status: 404,
          body: {
            success: false,
            message: "User organization not found",
          },
        },
      };
    }

    org_id = rows[0].org_id;
  }

  return { docUserId, org_id };
}

const INSERT_ACTIVITY_SQL = `INSERT INTO apt_user_activity_logs
  (performed_by, affected_user_id, action_type, old_value, new_value, action_reason, org_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

export const uploadEmployeeDocumentsController = async (req, res) => {
  let connection;

  /** Successful Cloudinary uploads in this request — destroyed if the DB transaction fails. */
  const pendingCloudinaryAssets = [];

  try {
    const files = req.files;
    const { user_id: actingUserId } = req.user;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    const target = await resolveDocTarget(req);
    if (target.error) {
      return res.status(target.error.status).json(target.error.body);
    }

    const { docUserId, org_id } = target;

    const uploadedDocuments = [];

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      for (const file of files) {
        const result = await uploadToCloudinary(
          file.buffer,
          "employee_documents",
          "auto",
        );

        pendingCloudinaryAssets.push({
          public_id: result.public_id,
          resource_type: result.resource_type || "image",
        });

        await connection.query(
          `INSERT INTO user_docs
            (user_id, org_id, document_name, document_type, doc_url, public_id, resource_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            docUserId,
            org_id,
            file.originalname,
            file.fieldname,
            result.secure_url,
            result.public_id,
            result.resource_type,
          ],
        );

        uploadedDocuments.push({
          document_name: file.originalname,
          document_type: file.fieldname,
          url: result.secure_url,
          public_id: result.public_id,
          resource_type: result.resource_type,
        });
      }

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        actingUserId,
        docUserId,
        "UPLOAD_EMPLOYEE_DOCUMENTS",
        null,
        JSON.stringify(uploadedDocuments),
        "Uploaded Employee Documents",
        org_id,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity"), {
          statusCode: 400,
          code: "ACTIVITY_LOG_FAILED",
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,
        message: "Documents uploaded successfully",
        documents: uploadedDocuments,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    await destroyUploadedAssets(pendingCloudinaryAssets);

    const statusCode =
      error.statusCode && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("uploadEmployeeDocumentsController:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? error.message
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

 
export const updateEmployeeDocumentsController = async (req, res) => {
  let connection;
 
  const newAssetForRollback = [];

  let oldPublicId;
  let oldResourceType = "image";
  let committed = false;

  try {
    const file = req.file;
    const { user_id: actingUserId } = req.user;

    if (!file || !file.buffer) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded (use multipart field name: file)",
      });
    }

    const documentIdRaw = req.body?.document_id;

    if (
      documentIdRaw == null ||
      String(documentIdRaw).trim() === "" ||
      Number.isNaN(Number(documentIdRaw))
    ) {
      return res.status(400).json({
        success: false,
        message: "document_id is required",
      });
    }

    const documentId = Number(documentIdRaw);

    const target = await resolveDocTarget(req);
    if (target.error) {
      return res.status(target.error.status).json(target.error.body);
    }

    const { docUserId, org_id } = target;

    const [existingRows] = await pool.promise().query(
      `SELECT id, public_id, resource_type, document_type, user_id, org_id
       FROM user_docs
       WHERE id = ? AND user_id = ? AND org_id = ?
       LIMIT 1`,
      [documentId, docUserId, org_id],
    );

    if (!existingRows.length) {
      return res.status(404).json({
        success: false,
        message: "Document not found for this user and organization",
      });
    }

    const existing = existingRows[0];
    oldPublicId = existing.public_id;
    oldResourceType = existing.resource_type || "image";

    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(
        file.buffer,
        "employee_documents",
        "auto",
      );
    } catch (cloudErr) {
      console.error(cloudErr);
      return res.status(500).json({
        success: false,
        message: cloudErr.message || "Failed to upload new file",
      });
    }

    newAssetForRollback.push({
      public_id: uploadResult.public_id,
      resource_type: uploadResult.resource_type || "image",
    });

    const newUrl = uploadResult.secure_url;
    const newPublicId = uploadResult.public_id;
    const newResourceType = uploadResult.resource_type || "image";

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const [updateResult] = await connection.query(
        `UPDATE user_docs
         SET document_name = ?,
             doc_url = ?,
             public_id = ?,
             resource_type = ?
         WHERE id = ? AND user_id = ? AND org_id = ?`,
        [
          file.originalname,
          newUrl,
          newPublicId,
          newResourceType,
          documentId,
          docUserId,
          org_id,
        ],
      );

      if (!updateResult || updateResult.affectedRows < 1) {
        throw Object.assign(new Error("Document could not be updated"), {
          statusCode: 404,
        });
      }

      const newValuePayload = {
        id: documentId,
        user_id: docUserId,
        org_id: org_id,
        document_name: file.originalname,
        document_type: existing.document_type,
        url: newUrl,
        public_id: newPublicId,
        resource_type: newResourceType,
      };

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        actingUserId,
        docUserId,
        "UPDATE_EMPLOYEE_DOCUMENTS",
        JSON.stringify(existing),
        JSON.stringify(newValuePayload),
        "Updated Employee Documents",
        org_id,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity"), {
          statusCode: 400,
        });
      }

      await connection.commit();
      committed = true;

      return res.status(200).json({
        success: true,
        message: "Document updated successfully",
        document: newValuePayload,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    if (!committed) {
      await destroyUploadedAssets(newAssetForRollback);
    }

    const statusCode =
      error.statusCode && Number(error.statusCode) >= 400 && Number(error.statusCode) < 600
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("updateEmployeeDocumentsController:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
        success: false,
        message:
          statusCode === 500
            ? error.message
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) {
      connection.release();
    }

    if (committed && oldPublicId && String(oldPublicId).trim() !== "") {
      await destroyFromCloudinary(
        String(oldPublicId).trim(),
        oldResourceType || "image",
      ).catch((err) =>
        console.error(
          "Could not delete previous Cloudinary asset:",
          err?.message || err,
        ),
      );
    }
  }
};

export const deleteEmployeeDocumentsController = async (req, res) => {
  let connection;
  let committed = false;
  /** Cloudinary assets removed only after a successful DB commit */
  const cloudAssetsToRemove = [];

  try {
    const { user_id: actingUserId } = req.user;

    const deleteAll =
      req.body?.delete_all === true ||
      req.body?.delete_all === "true" ||
      req.body?.delete_all === 1 ||
      req.body?.delete_all === "1";

    const target = await resolveDocTarget({
      ...req,
      body: {
        ...req.body,
        employee_user_id: req.body?.employee_user_id ?? req.body?.user_id,
      },
    });

    if (target.error) {
      return res.status(target.error.status).json(target.error.body);
    }

    const { docUserId, org_id } = target;

    let rowsToDelete = [];

    if (deleteAll) {
      const [rows] = await pool.promise().query(
        `SELECT id, public_id, resource_type, document_name, document_type, doc_url, user_id, org_id
         FROM user_docs
         WHERE user_id = ? AND org_id = ?`,
        [docUserId, org_id],
      );
      rowsToDelete = rows;
      if (!rowsToDelete.length) {
        return res.status(404).json({
          success: false,
          message: "No documents found for this user in the organization",
        });
      }
    } else {
      const rawIds = req.body?.document_ids;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "document_ids must be a non-empty array, or set delete_all to true to remove every document for this user",
        });
      }

      const normalizedIds = [
        ...new Set(
          rawIds
            .map((id) => Number(id))
            .filter((n) => !Number.isNaN(n) && n > 0),
        ),
      ];

      if (!normalizedIds.length) {
        return res.status(400).json({
          success: false,
          message: "document_ids must contain valid numeric ids",
        });
      }

      const placeholders = normalizedIds.map(() => "?").join(", ");
      const [rows] = await pool.promise().query(
        `SELECT id, public_id, resource_type, document_name, document_type, doc_url, user_id, org_id
         FROM user_docs
         WHERE user_id = ? AND org_id = ? AND id IN (${placeholders})`,
        [docUserId, org_id, ...normalizedIds],
      );

      if (rows.length !== normalizedIds.length) {
        return res.status(404).json({
          success: false,
          message:
            "One or more documents were not found for this user and organization",
        });
      }

      rowsToDelete = rows;
    }

    for (const row of rowsToDelete) {
      if (row.public_id && String(row.public_id).trim() !== "") {
        cloudAssetsToRemove.push({
          public_id: row.public_id,
          resource_type: row.resource_type || "image",
        });
      }
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const deleteIds = rowsToDelete.map((r) => r.id);
      const delPlaceholders = deleteIds.map(() => "?").join(", ");

      const [deleteResult] = await connection.query(
        `DELETE FROM user_docs
         WHERE user_id = ? AND org_id = ? AND id IN (${delPlaceholders})`,
        [docUserId, org_id, ...deleteIds],
      );

      if (
        !deleteResult ||
        deleteResult.affectedRows < 1 ||
        deleteResult.affectedRows !== rowsToDelete.length
      ) {
        throw Object.assign(
          new Error("Could not delete documents — try again or refresh the list"),
          { statusCode: 409 },
        );
      }

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        actingUserId,
        docUserId,
        "DELETE_EMPLOYEE_DOCUMENTS",
        JSON.stringify(rowsToDelete),
        null,
        deleteAll
          ? "Deleted all employee documents for this user"
          : `Deleted ${rowsToDelete.length} employee document(s)`,
        org_id,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity"), {
          statusCode: 400,
        });
      }

      await connection.commit();
      committed = true;

      return res.status(200).json({
        success: true,
        message: deleteAll
          ? "All documents deleted successfully"
          : "Documents deleted successfully",
        deleted_count: rowsToDelete.length,
        deleted_ids: rowsToDelete.map((r) => r.id),
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    const statusCode =
      error.statusCode && Number(error.statusCode) >= 400 && Number(error.statusCode) < 600
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("deleteEmployeeDocumentsController:", error);
    }

    if (!res.headersSent) {
      return res
        .status(statusCode >= 400 && statusCode < 600 ? statusCode : 500)
        .json({
          success: false,
          message:
            statusCode === 500
              ? error.message
              : error.message || "Request failed",
        });
    }
  } finally {
    if (connection) {
      connection.release();
    }

    if (committed && cloudAssetsToRemove.length) {
      await destroyUploadedAssets(cloudAssetsToRemove);
    }
  }
};

/**
 * List documents for one org member — returns only `id`, `doc_url`, `document_type`.
 * Use path param `user_id`. For another user (not the actor), pass `org_id` as a query string.
 * Self: `/user/:user_id/documents` where `:user_id` is the actor (org is resolved from membership).
 */
export const getSingleUserAllDocumentsController = async (req, res) => {
  try {
    const rawUserId = req.params?.user_id;

    if (rawUserId == null || String(rawUserId).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "user_id is required in the URL",
      });
    }

    const target = await resolveDocTarget({
      ...req,
      body: {
        ...req.body,
        employee_user_id: String(rawUserId).trim(),
        org_id: req.query?.org_id ?? req.body?.org_id,
      },
    });

    if (target.error) {
      return res.status(target.error.status).json(target.error.body);
    }

    const { docUserId, org_id } = target;

    const [rows] = await pool.promise().query(
      `SELECT id, doc_url, document_type
       FROM user_docs
       WHERE user_id = ? AND org_id = ?
       ORDER BY id ASC`,
      [docUserId, org_id],
    );

    return res.status(200).json({
      success: true,
      message: "Documents fetched successfully",
      documents: Array.isArray(rows) ? rows : [],
    });
  } catch (error) {
    console.error("getSingleUserAllDocumentsController:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
};