import { pool } from "../db/connect.js";
import uploadToCloudinary, {
  destroyFromCloudinary,
} from "../config/cloudinary.js";
import { isEmployeeExists } from "../helper/employee_checker.js";

/** Matches `employee_assets.asset_type` ENUM in db_tables.md */
const ASSET_TYPES = [
  "laptop",
  "mobile",
  "software",
  "email",
  "sim",
  "id_card",
  "monitor",
  "access_card",
  "other",
];

const ASSET_TYPE_SET = new Set(ASSET_TYPES);

const INSERT_ACTIVITY_SQL = `INSERT INTO apt_user_activity_logs
  (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

/**
 * Best-effort delete of Cloudinary uploads when DB fails mid-request.
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

function parseAssetsPayload(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Query: `page` (or `p`), `limit` (or `per_page`). */
function parsePagination(query) {
  const pageRaw = query?.page ?? query?.p;
  const limitRaw = query?.limit ?? query?.per_page;

  let page = Number(pageRaw);
  let limit = Number(limitRaw);

  if (!Number.isFinite(page) || page < 1) page = DEFAULT_PAGE;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function normalizeHandoverDt(value) {
  if (isBlank(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "INVALID";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Derive Cloudinary `public_id` + resource type from a stored `secure_url` (no DB column needed). */
function cloudinaryMetaFromStoredUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    const pathname = u.pathname;
    let resource_type = "image";
    if (pathname.includes("/raw/upload/")) resource_type = "raw";
    else if (pathname.includes("/video/upload/")) resource_type = "video";

    const marker = "/upload/";
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;

    let rest = pathname.slice(idx + marker.length);
    const segments = rest.split("/").filter(Boolean);

    let i = 0;
    while (i < segments.length && !/^v\d+$/i.test(segments[i])) {
      i += 1;
    }
    if (i < segments.length && /^v\d+$/i.test(segments[i])) {
      i += 1;
    }

    const pubParts = segments.slice(i);
    if (pubParts.length === 0) return null;

    const joined = pubParts.join("/");
    const withoutExt = joined.replace(/\.[^/.]+$/, "");
    const public_id = decodeURIComponent(withoutExt);

    if (!public_id) return null;
    return { public_id, resource_type };
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ status: number, body: object } | null>} Error envelope or null if OK.
 */
async function validateOrgAccess(performed_by, orgIdRaw) {
  if (!performed_by) {
    return {
      status: 401,
      body: { success: false, message: "Unauthorized" },
    };
  }
  if (isBlank(orgIdRaw)) {
    return {
      status: 400,
      body: { success: false, message: "org_id is required" },
    };
  }

  const org_id = String(orgIdRaw).trim();

  const [orgRows] = await pool.promise().query(
    "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
    [org_id],
  );
  if (!orgRows.length) {
    return {
      status: 404,
      body: { success: false, message: "Organization not found" },
    };
  }

  const [actorMember] = await pool.promise().query(
    "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
    [performed_by, org_id],
  );
  if (!actorMember.length) {
    return {
      status: 403,
      body: {
        success: false,
        message: "You are not a member of this organization",
      },
    };
  }

  return null;
}

function parseUpdatesPayload(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}


export const add_assets_controller = async (req, res) => {
  let connection;

  /** Successful Cloudinary uploads in this request — destroyed if the DB transaction fails. */
  const pendingCloudinaryAssets = [];

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    const assets = parseAssetsPayload(req.body?.assets);
    if (!assets || assets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Assets are required (non-empty JSON array)",
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const fileByField = new Map();
    for (const f of files) {
      if (f?.fieldname) fileByField.set(f.fieldname, f);
    }

    const prepared = [];

    for (let i = 0; i < assets.length; i++) {
      const row = assets[i];
      if (!row || typeof row !== "object") {
        return res.status(400).json({
          success: false,
          message: `assets[${i}] must be an object`,
        });
      }

      const employee_id = row.employee_id;
      const asset_name = isBlank(row.asset_name) ? "" : String(row.asset_name).trim();
      const asset_type = isBlank(row.asset_type)
        ? ""
        : String(row.asset_type).trim().toLowerCase();
      const asset_summary =
        row.asset_summary == null ? null : String(row.asset_summary).trim();
      const image_field = !isBlank(row.image_field)
        ? String(row.image_field).trim()
        : `asset_image_${i}`;

      if (isBlank(employee_id)) {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].employee_id is required`,
        });
      }

      if (isBlank(asset_name)) {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].asset_name is required`,
        });
      }

      if (asset_name.length > 250) {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].asset_name must be at most 250 characters`,
        });
      }

      if (!ASSET_TYPE_SET.has(asset_type)) {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].asset_type must be one of: ${ASSET_TYPES.join(", ")}`,
        });
      }

      if (asset_summary != null && asset_summary.length > 600) {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].asset_summary must be at most 600 characters`,
        });
      }

      const ho = normalizeHandoverDt(row.handover_date_time);
      if (ho === "INVALID") {
        return res.status(400).json({
          success: false,
          message: `assets[${i}].handover_date_time is not a valid date`,
        });
      }

      const [empRows] = await pool.promise().query(
        "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
        [employee_id],
      );
      if (!empRows.length) {
        return res.status(404).json({
          success: false,
          message: `assets[${i}]: employee user not found`,
        });
      }

      const [empMember] = await pool.promise().query(
        "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
        [employee_id, org_id],
      );
      if (!empMember.length) {
        return res.status(404).json({
          success: false,
          message: `assets[${i}]: employee is not a member of this organization`,
        });
      }

      /** Then Check If Assets Already Exist (active duplicate name + type per employee/org) */
      const [dup] = await pool.promise().query(
        `SELECT id FROM employee_assets
         WHERE employee_id = ? AND org_id = ?
           AND asset_name = ? AND asset_type = ?
           AND asset_status = 'active'
         LIMIT 1`,
        [employee_id, org_id, asset_name, asset_type],
      );
      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: `assets[${i}]: an active asset with this name and type already exists for this employee`,
        });
      }

      const imageFile = fileByField.get(image_field);
      prepared.push({
        employee_id,
        org_id,
        asset_given_by_id: performed_by,
        asset_name,
        asset_summary: asset_summary === "" ? null : asset_summary,
        asset_type,
        handover_date_time: ho,
        imageFile: imageFile || null,
        image_field,
      });
    }

    /** Upload images/PDFs to Cloudinary before DB transaction */
    const withUrls = [];
    for (const p of prepared) {
      let asset_image_url = null;
      let cloudMeta = null;

      if (p.imageFile?.buffer) {
        const result = await uploadToCloudinary(
          p.imageFile.buffer,
          "employee_assets",
          "auto",
        );

        pendingCloudinaryAssets.push({
          public_id: result.public_id,
          resource_type: result.resource_type || "image",
        });

        asset_image_url = result.secure_url;
        cloudMeta = {
          public_id: result.public_id,
          resource_type: result.resource_type || "image",
        };
      }

      withUrls.push({
        ...p,
        asset_image_url,
        cloudMeta,
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const inserted = [];

      for (const p of withUrls) {
        const [insertResult] = await connection.query(
          `INSERT INTO employee_assets
            (employee_id, org_id, asset_given_by_id, asset_name, asset_summary, asset_type,
             asset_image_url, asset_status, is_returned, returned_to_id, handover_date_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', FALSE, NULL, ?)`,
          [
            p.employee_id,
            p.org_id,
            p.asset_given_by_id,
            p.asset_name,
            p.asset_summary,
            p.asset_type,
            p.asset_image_url,
            p.handover_date_time,
          ],
        );

        if (!insertResult.affectedRows) {
          throw Object.assign(new Error("Failed to insert asset row"), {
            statusCode: 400,
          });
        }

        inserted.push({
          id: insertResult.insertId,
          employee_id: p.employee_id,
          asset_name: p.asset_name,
          asset_type: p.asset_type,
          asset_summary: p.asset_summary,
          asset_image_url: p.asset_image_url,
          handover_date_time: p.handover_date_time,
          image_field: p.image_field,
          cloudinary: p.cloudMeta,
        });
      }

      const activityPayload = {
        org_id,
        count: inserted.length,
        assets: inserted.map(({ cloudinary: _c, ...rest }) => rest),
      };

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        null,
        org_id,
        "ADD_EMPLOYEE_ASSETS",
        null,
        JSON.stringify(activityPayload),
        `Added ${inserted.length} employee asset record(s)`,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: "Assets added successfully",
        data: inserted,
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
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("add_assets_controller:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error adding assets"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

// Update Assets

export const update_assets_controller_using_patch = async (req, res) => {
  let connection;

  /** New uploads rolled back if DB fails before commit */
  const pendingCloudinaryAssets = [];

  /** Old Cloudinary assets removed only after successful commit */
  const cloudinaryDeleteAfterCommit = [];

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    const updates = parseUpdatesPayload(req.body?.updates);
    if (!updates || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "updates is required (non-empty JSON array)",
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const fileByField = new Map();
    for (const f of files) {
      if (f?.fieldname) fileByField.set(f.fieldname, f);
    }

    const prepared = [];

    for (let i = 0; i < updates.length; i++) {
      const row = updates[i];
      if (!row || typeof row !== "object") {
        return res.status(400).json({
          success: false,
          message: `updates[${i}] must be an object`,
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(row, "asset_status") ||
        Object.prototype.hasOwnProperty.call(row, "is_returned") ||
        Object.prototype.hasOwnProperty.call(row, "returned_to_id")
      ) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}]: asset_status, is_returned, and returned_to_id cannot be changed here; use the return endpoint`,
        });
      }

      const id = row.id;
      if (isBlank(id)) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].id is required`,
        });
      }

      const [existingRows] = await pool.promise().query(
        `SELECT id, employee_id, org_id, asset_given_by_id, asset_name, asset_summary, asset_type,
                asset_image_url, handover_date_time
         FROM employee_assets WHERE id = ? AND org_id = ? LIMIT 1`,
        [id, org_id],
      );

      if (!existingRows.length) {
        return res.status(404).json({
          success: false,
          message: `updates[${i}]: asset not found in this organization`,
        });
      }

      const existing = existingRows[0];

      let employee_id =
        row.employee_id != null && !isBlank(row.employee_id)
          ? row.employee_id
          : existing.employee_id;
      let asset_given_by_id =
        row.asset_given_by_id != null && !isBlank(row.asset_given_by_id)
          ? row.asset_given_by_id
          : existing.asset_given_by_id;
      let asset_name =
        row.asset_name != null
          ? String(row.asset_name).trim()
          : String(existing.asset_name).trim();
      let asset_summary =
        row.asset_summary !== undefined
          ? row.asset_summary == null || String(row.asset_summary).trim() === ""
            ? null
            : String(row.asset_summary).trim()
          : existing.asset_summary == null
            ? null
            : String(existing.asset_summary).trim();
      let asset_type =
        row.asset_type != null && !isBlank(row.asset_type)
          ? String(row.asset_type).trim().toLowerCase()
          : String(existing.asset_type).trim().toLowerCase();

      let handover_date_time;
      if (row.handover_date_time !== undefined) {
        handover_date_time = normalizeHandoverDt(row.handover_date_time);
      } else if (
        existing.handover_date_time != null &&
        existing.handover_date_time !== ""
      ) {
        const d = new Date(existing.handover_date_time);
        if (!Number.isNaN(d.getTime())) {
          const pad = (n) => String(n).padStart(2, "0");
          handover_date_time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        } else {
          handover_date_time = null;
        }
      } else {
        handover_date_time = null;
      }

      if (handover_date_time === "INVALID") {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].handover_date_time is not a valid date`,
        });
      }

      if (isBlank(asset_name)) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].asset_name cannot be empty`,
        });
      }

      if (asset_name.length > 250) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].asset_name must be at most 250 characters`,
        });
      }

      if (!ASSET_TYPE_SET.has(asset_type)) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].asset_type must be one of: ${ASSET_TYPES.join(", ")}`,
        });
      }

      if (asset_summary != null && asset_summary.length > 600) {
        return res.status(400).json({
          success: false,
          message: `updates[${i}].asset_summary must be at most 600 characters`,
        });
      }

      for (const [label, uid] of [
        ["employee_id", employee_id],
        ["asset_given_by_id", asset_given_by_id],
      ]) {
        const [uRows] = await pool.promise().query(
          "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
          [uid],
        );
        if (!uRows.length) {
          return res.status(404).json({
            success: false,
            message: `updates[${i}]: ${label} user not found`,
          });
        }
        const [mRows] = await pool.promise().query(
          "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
          [uid, org_id],
        );
        if (!mRows.length) {
          return res.status(404).json({
            success: false,
            message: `updates[${i}]: ${label} is not a member of this organization`,
          });
        }
      }

      const [dup] = await pool.promise().query(
        `SELECT id FROM employee_assets
         WHERE employee_id = ? AND org_id = ?
           AND asset_name = ? AND asset_type = ?
           AND asset_status = 'active'
           AND id <> ?
         LIMIT 1`,
        [employee_id, org_id, asset_name, asset_type, id],
      );
      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: `updates[${i}]: another active asset already uses this name and type for this employee`,
        });
      }

      const image_field = !isBlank(row.image_field)
        ? String(row.image_field).trim()
        : `asset_image_${i}`;
      const imageFile = fileByField.get(image_field);

      prepared.push({
        index: i,
        id,
        existing,
        employee_id,
        asset_given_by_id,
        asset_name,
        asset_summary,
        asset_type,
        handover_date_time,
        imageFile: imageFile || null,
        image_field,
      });
    }

    const withUrls = [];
    for (const p of prepared) {
      let asset_image_url = p.existing.asset_image_url;
      let replacedOldUrl = null;

      if (p.imageFile?.buffer) {
        replacedOldUrl = p.existing.asset_image_url || null;

        const result = await uploadToCloudinary(
          p.imageFile.buffer,
          "employee_assets",
          "auto",
        );

        pendingCloudinaryAssets.push({
          public_id: result.public_id,
          resource_type: result.resource_type || "image",
        });

        asset_image_url = result.secure_url;

        const oldMeta = replacedOldUrl
          ? cloudinaryMetaFromStoredUrl(String(replacedOldUrl))
          : null;
        if (oldMeta) {
          cloudinaryDeleteAfterCommit.push(oldMeta);
        }
      }

      withUrls.push({
        ...p,
        asset_image_url,
        replacedOldUrl,
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const updated = [];

      for (const p of withUrls) {
        const [updResult] = await connection.query(
          `UPDATE employee_assets SET
             employee_id = ?,
             asset_given_by_id = ?,
             asset_name = ?,
             asset_summary = ?,
             asset_type = ?,
             asset_image_url = ?,
             handover_date_time = ?
           WHERE id = ? AND org_id = ?`,
          [
            p.employee_id,
            p.asset_given_by_id,
            p.asset_name,
            p.asset_summary,
            p.asset_type,
            p.asset_image_url,
            p.handover_date_time,
            p.id,
            org_id,
          ],
        );

        if (!updResult.affectedRows) {
          throw Object.assign(new Error("Failed to update asset"), {
            statusCode: 400,
          });
        }

        updated.push({
          id: p.id,
          employee_id: p.employee_id,
          asset_given_by_id: p.asset_given_by_id,
          asset_name: p.asset_name,
          asset_type: p.asset_type,
          asset_summary: p.asset_summary,
          asset_image_url: p.asset_image_url,
          handover_date_time: p.handover_date_time,
          image_field: p.image_field,
        });
      }

      const oldSnapshot = prepared.map((x) => ({
        id: x.id,
        employee_id: x.existing.employee_id,
        asset_given_by_id: x.existing.asset_given_by_id,
        asset_name: x.existing.asset_name,
        asset_summary: x.existing.asset_summary,
        asset_type: x.existing.asset_type,
        asset_image_url: x.existing.asset_image_url,
        handover_date_time: x.existing.handover_date_time,
      }));

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        null,
        org_id,
        "UPDATE_EMPLOYEE_ASSETS",
        JSON.stringify({ org_id, assets: oldSnapshot }),
        JSON.stringify({ org_id, assets: updated }),
        `Updated ${updated.length} employee asset record(s)`,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      for (const meta of cloudinaryDeleteAfterCommit) {
        await destroyFromCloudinary(meta.public_id, meta.resource_type).catch(
          (err) =>
            console.error(
              "Cloudinary delete old asset image failed:",
              meta.public_id,
              err?.message || err,
            ),
        );
      }

      pendingCloudinaryAssets.length = 0;

      return res.status(200).json({
        success: true,
        message: "Assets updated successfully",
        data: updated,
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
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("update_assets_controller_using_patch:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error updating assets"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

export const return_assets_of_employee_controller_using_patch = async (req, res) => {
  let connection;

  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.body?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    let returnsPayload = req.body?.returns;
    if (typeof returnsPayload === "string") {
      try {
        returnsPayload = JSON.parse(returnsPayload);
      } catch {
        returnsPayload = null;
      }
    }

    if (!returnsPayload || !Array.isArray(returnsPayload) || returnsPayload.length === 0) {
      return res.status(400).json({
        success: false,
        message: "returns is required (non-empty JSON array)",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    try {
      const processed = [];
      const oldSnapshots = [];

      for (let i = 0; i < returnsPayload.length; i++) {
        const r = returnsPayload[i];
        if (!r || typeof r !== "object") {
          throw Object.assign(new Error(`returns[${i}] must be an object`), {
            statusCode: 400,
          });
        }

        const asset_id = r.asset_id ?? r.id;
        const returned_to_id = r.returned_to_id;

        if (isBlank(asset_id)) {
          throw Object.assign(new Error(`returns[${i}].asset_id is required`), {
            statusCode: 400,
          });
        }

        if (isBlank(returned_to_id)) {
          throw Object.assign(
            new Error(`returns[${i}].returned_to_id is required`),
            { statusCode: 400 },
          );
        }

        const [rows] = await connection.query(
          `SELECT id, employee_id, org_id, asset_status, is_returned, returned_to_id
           FROM employee_assets WHERE id = ? AND org_id = ? LIMIT 1`,
          [asset_id, org_id],
        );

        if (!rows.length) {
          throw Object.assign(new Error(`returns[${i}]: asset not found`), {
            statusCode: 404,
          });
        }

        const assetRow = rows[0];

        if (assetRow.asset_status === "returned" || assetRow.is_returned) {
          throw Object.assign(
            new Error(`returns[${i}]: asset is already marked returned`),
            { statusCode: 409 },
          );
        }

        const [rtUser] = await connection.query(
          "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
          [returned_to_id],
        );
        if (!rtUser.length) {
          throw Object.assign(
            new Error(`returns[${i}]: returned_to user not found`),
            { statusCode: 404 },
          );
        }

        const [rtMem] = await connection.query(
          "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
          [returned_to_id, org_id],
        );
        if (!rtMem.length) {
          throw Object.assign(
            new Error(
              `returns[${i}]: returned_to user is not a member of this organization`,
            ),
            { statusCode: 403 },
          );
        }

        oldSnapshots.push({
          id: assetRow.id,
          employee_id: assetRow.employee_id,
          asset_status: assetRow.asset_status,
          is_returned: assetRow.is_returned,
          returned_to_id: assetRow.returned_to_id,
        });

        const [upd] = await connection.query(
          `UPDATE employee_assets SET
             asset_status = 'returned',
             is_returned = TRUE,
             returned_to_id = ?
           WHERE id = ? AND org_id = ?`,
          [returned_to_id, asset_id, org_id],
        );

        if (!upd.affectedRows) {
          throw Object.assign(new Error(`returns[${i}]: update failed`), {
            statusCode: 400,
          });
        }

        processed.push({
          asset_id: Number(asset_id),
          employee_id: assetRow.employee_id,
          returned_to_id: Number(returned_to_id),
          asset_status: "returned",
        });
      }

      const [saveActivityResult] = await connection.query(INSERT_ACTIVITY_SQL, [
        performed_by,
        null,
        org_id,
        "RETURN_EMPLOYEE_ASSETS",
        JSON.stringify({ org_id, rows: oldSnapshots }),
        JSON.stringify({ org_id, rows: processed }),
        `Marked ${processed.length} asset(s) as returned`,
      ]);

      if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
        throw Object.assign(new Error("Failed to save activity log"), {
          statusCode: 400,
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,
        message: "Assets marked as returned successfully",
        data: processed,
      });
    } catch (innerErr) {
      await connection.rollback().catch((rErr) =>
        console.error("Transaction rollback failed:", rErr),
      );
      throw innerErr;
    }
  } catch (error) {
    const statusCode =
      error.statusCode &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
        ? Number(error.statusCode)
        : 500;

    if (statusCode >= 500) {
      console.error("return_assets_of_employee_controller_using_patch:", error);
    }

    if (!res.headersSent) {
      return res.status(statusCode).json({
        success: false,
        message:
          statusCode === 500
            ? "Error returning assets"
            : error.message || "Request failed",
      });
    }
  } finally {
    if (connection) connection.release();
  }
};

/** GET `/list?org_id=&page=&limit=` — organization assets (paginated) */
export const get_all_assets_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();
    const { page, limit, offset } = parsePagination(req.query);

    const [[countRow]] = await pool.promise().query(
      `SELECT COUNT(*) AS total FROM employee_assets WHERE org_id = ?`,
      [org_id],
    );
    const total = Number(countRow?.total ?? 0);
    const total_pages =
      total === 0 ? 0 : Math.ceil(total / limit);

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, asset_given_by_id, asset_name, asset_summary, asset_type,
              asset_image_url, asset_status, is_returned, returned_to_id, handover_date_time,
              created_at, updated_at
       FROM employee_assets WHERE org_id = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [org_id, limit, offset],
    );

    return res.status(200).json({
      success: true,
      message: "OK",
      data: Array.isArray(rows) ? rows : [],
      pagination: {
        page,
        limit,
        total,
        total_pages,
        has_next: total_pages > 0 && page < total_pages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("get_all_assets_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading assets",
    });
  }
};

/**
 * GET `/by-employee/:employee_user_id?org_id=&page=&limit=`
 * Assets assigned to one employee (`employee_assets.employee_id`) in the org.
 */
export const get_assets_by_user_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const orgIdRaw = req.query?.org_id;
    const employee_user_id = req.params?.employee_user_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(employee_user_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_user_id is required",
      });
    }

    const [empRows] = await pool.promise().query(
      "SELECT id FROM apt_users WHERE id = ? LIMIT 1",
      [employee_user_id],
    );
    if (!empRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employee user not found",
      });
    }

    const [empMember] = await pool.promise().query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? LIMIT 1",
      [employee_user_id, org_id],
    );
    if (!empMember.length) {
      return res.status(404).json({
        success: false,
        message: "User is not a member of this organization",
      });
    }

    const { page, limit, offset } = parsePagination(req.query);

    const [[countRow]] = await pool.promise().query(
      `SELECT COUNT(*) AS total FROM employee_assets
       WHERE org_id = ? AND employee_id = ?`,
      [org_id, employee_user_id],
    );
    const total = Number(countRow?.total ?? 0);
    const total_pages =
      total === 0 ? 0 : Math.ceil(total / limit);

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, asset_given_by_id, asset_name, asset_summary, asset_type,
              asset_image_url, asset_status, is_returned, returned_to_id, handover_date_time,
              created_at, updated_at
       FROM employee_assets
       WHERE org_id = ? AND employee_id = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [org_id, employee_user_id, limit, offset],
    );

    return res.status(200).json({
      success: true,
      message: "OK",
      data: Array.isArray(rows) ? rows : [],
      pagination: {
        page,
        limit,
        total,
        total_pages,
        has_next: total_pages > 0 && page < total_pages,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("get_assets_by_user_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading employee assets",
    });
  }
};

/** GET `/detail/:asset_id?org_id=` */
export const get_single_asset_controller = async (req, res) => {
  try {
    const { user_id: performed_by } = req.user || {};
    const asset_id = req.params?.asset_id;
    const orgIdRaw = req.query?.org_id;

    const accessErr = await validateOrgAccess(performed_by, orgIdRaw);
    if (accessErr) {
      return res.status(accessErr.status).json(accessErr.body);
    }

    const org_id = String(orgIdRaw).trim();

    if (isBlank(asset_id)) {
      return res.status(400).json({
        success: false,
        message: "asset_id is required",
      });
    }

    const [rows] = await pool.promise().query(
      `SELECT id, employee_id, org_id, asset_given_by_id, asset_name, asset_summary, asset_type,
              asset_image_url, asset_status, is_returned, returned_to_id, handover_date_time,
              created_at, updated_at
       FROM employee_assets WHERE id = ? AND org_id = ? LIMIT 1`,
      [asset_id, org_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OK",
      data: rows[0],
    });
  } catch (error) {
    console.error("get_single_asset_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading asset",
    });
  }
};


export const get_handover_assets_assigned_to_me = async (req, res) =>{
  let connection = null;
  try {
        const {user_id: my_id} = req.user;
        const org_id = req.org_id;
        if (!org_id) {
          return res.status(400).json({
            success: false,
            message: "Organization id is required",
          });
        }
        connection = await pool.promise().getConnection();
        if (!(await isEmployeeExists(connection, my_id, org_id))) {
          return res.status(404).json({
            success: false,
            message: "You are not a employee of this organization",
          });
        }
        const [handover_assets] = await connection.query(`
          SELECT
            hq.*,
            ea.asset_name,
            ea.asset_type,
            ea.asset_summary
          FROM handover_query hq
          LEFT JOIN employee_assets ea
            ON hq.asset_id = ea.id
            AND ea.org_id = hq.org_id
          WHERE hq.org_id = ? AND hq.manager_id = ?
          ORDER BY hq.updated_at DESC
          `, [org_id, my_id]);
        if(!handover_assets.length) {
          return res.status(200).json({
            success: true,
            message: "No handover items assigned to you",
            data: { assets: [], custom_tasks: [] },
          });
        }
        //id, employee_id, org_id, team_id, asset_id, custom_task_name, manager_id, handover_status,remarks, handover_date, employee_exit_process_id, created_at, updated_at
       let all_assets = [];
       let all_custom_tasks = [];
       for(let asset of handover_assets) {
          if(!asset.custom_task_name || asset.custom_task_name === null || asset.custom_task_name === undefined || asset.custom_task_name === '') { 
            all_assets.push({
              id: asset.id,
              employee_id: asset.employee_id,
              organization_id: asset.org_id,
              team_id: asset.team_id || null,
              asset_id: asset.asset_id,
              asset_name: asset.asset_name ?? null,
              asset_type: asset.asset_type ?? null,
              asset_summary: asset.asset_summary ?? null,
              handover_status: asset.handover_status,
              remarks: asset.remarks || null,
              handover_date: asset.handover_date,
              employee_exit_process_id: asset.employee_exit_process_id,
              created_at: asset.created_at,
              updated_at: asset.updated_at,
            });
          } else {
            all_custom_tasks.push({
              id: asset.id,
              employee_id: asset.employee_id,
              organization_id: asset.org_id,
              team_id: asset.team_id || null,
              custom_task_name: asset.custom_task_name,
              handover_date: asset.handover_date,
              employee_exit_process_id: asset.employee_exit_process_id,
              created_at: asset.created_at,
              updated_at: asset.updated_at,
              remarks: asset.remarks || null,
              handover_status: asset.handover_status,
            });
          }
       }
       const normalized_handover_assets = {
        assets: all_assets,
        custom_tasks: all_custom_tasks,
       };
        return res.status(200).json({
          success: true,
          message: "OK",
          data: normalized_handover_assets,
        });
  } catch (error) {
    console.error("get_handover_assets_assigned_to_me:", error);
    return res.status(500).json({
      success: false,
      message: "Error loading handover assets assigned to me",
    });
  } finally {
    if (connection) connection.release();
  }
}