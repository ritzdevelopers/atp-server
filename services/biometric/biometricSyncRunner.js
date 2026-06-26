import getMssqlPool from "../../db/connect_mssql.js";
import { pool as mysqlPool } from "../../db/connect.js";
import {
  mapBiometricRow,
  buildPunchFingerprint,
  resolveBiometricIdColumn,
  resolveBiometricSourceTables,
} from "./esslTableResolver.js";
import { processBiometricPunch } from "./processBiometricPunch.js";
import { emitAttendanceLiveUpdate } from "../../events/attendance.events.js";

function toSafeCursorId(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

const BATCH_SIZE = toSafeCursorId(
  Number(process.env.BIOMETRIC_SYNC_BATCH_SIZE || 200) || 200,
) || 200;

let lastRunAt = null;
let lastRunStatus = "idle";
let lastRunError = null;
let isRunning = false;

function getDefaultOrgId() {
  return Number(process.env.BIOMETRIC_DEFAULT_ORG_ID || 0) || null;
}

function formatMysqlDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

async function getCursor(connection, orgId, sourceTable) {
  const [rows] = await connection.query(
    `SELECT last_cursor_id FROM biometric_sync_state
     WHERE org_id = ? AND source_table = ?
     LIMIT 1`,
    [orgId, sourceTable],
  );
  return toSafeCursorId(rows[0]?.last_cursor_id ?? 0);
}

async function initializeCursorIfNeeded(
  mssqlPool,
  mysqlConnection,
  orgId,
  sourceTable,
  idColumn,
  cursor,
) {
  const safeCursor = toSafeCursorId(cursor);
  if (safeCursor > 0) return safeCursor;
  if (String(process.env.BIOMETRIC_SYNC_SKIP_HISTORY || "true") !== "true") {
    return safeCursor;
  }

  const safeTable = sourceTable.replace(/]/g, "]]");
  const safeColumn = idColumn.replace(/]/g, "]]");
  const maxResult = await mssqlPool.request().query(`
    SELECT MAX([${safeColumn}]) AS maxId FROM [${safeTable}]
  `);
  const maxId = toSafeCursorId(maxResult.recordset[0]?.maxId ?? 0);
  if (maxId > 0) {
    await setCursor(mysqlConnection, orgId, sourceTable, maxId);
    console.log(
      `[biometric] initialized cursor for ${sourceTable} at ${maxId} (skipping history)`,
    );
    return maxId;
  }
  return safeCursor;
}

async function setCursor(connection, orgId, sourceTable, cursorId) {
  const safeId = toSafeCursorId(cursorId);
  if (safeId <= 0) return;

  await connection.query(
    `INSERT INTO biometric_sync_state (org_id, source_table, last_cursor_id, last_synced_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       last_cursor_id = GREATEST(last_cursor_id, VALUES(last_cursor_id)),
       last_synced_at = NOW()`,
    [orgId, sourceTable, safeId],
  );
}

async function isPunchProcessed(connection, orgId, sourceTable, rowId, fingerprint) {
  const [rows] = await connection.query(
    `SELECT id FROM biometric_processed_punches
     WHERE org_id = ? AND source_table = ? AND source_row_id = ?
     LIMIT 1`,
    [orgId, sourceTable, rowId],
  );
  if (rows.length > 0) return true;

  const [fpRows] = await connection.query(
    `SELECT id FROM biometric_processed_punches
     WHERE org_id = ? AND punch_fingerprint = ?
     LIMIT 1`,
    [orgId, fingerprint],
  );
  return fpRows.length > 0;
}

async function markPunchProcessed(connection, orgId, sourceTable, rowId, fingerprint) {
  await connection.query(
    `INSERT IGNORE INTO biometric_processed_punches
     (org_id, source_table, source_row_id, punch_fingerprint)
     VALUES (?, ?, ?, ?)`,
    [orgId, sourceTable, rowId, fingerprint],
  );
}

async function syncTable(orgId, sourceTable, mssqlPool, mysqlConnection) {
  const idColumn = await resolveBiometricIdColumn(mssqlPool, sourceTable);
  const safeTable = sourceTable.replace(/]/g, "]]");
  const safeColumn = idColumn.replace(/]/g, "]]");
  let cursor = toSafeCursorId(
    await initializeCursorIfNeeded(
      mssqlPool,
      mysqlConnection,
      orgId,
      sourceTable,
      idColumn,
      await getCursor(mysqlConnection, orgId, sourceTable),
    ),
  );

  const result = await mssqlPool.request().query(`
    SELECT TOP (${BATCH_SIZE}) *
    FROM [${safeTable}]
    WHERE [${safeColumn}] > ${cursor}
    ORDER BY [${safeColumn}] ASC
  `);

  let imported = 0;
  let skipped = 0;
  let maxId = cursor;

  for (const row of result.recordset) {
    const mapped = mapBiometricRow(row, sourceTable);
    if (!mapped.source_row_id || !Number.isFinite(mapped.source_row_id)) {
      skipped += 1;
      continue;
    }

    maxId = Math.max(maxId, toSafeCursorId(mapped.source_row_id));
    const fingerprint = buildPunchFingerprint(mapped);

    const already = await isPunchProcessed(
      mysqlConnection,
      orgId,
      sourceTable,
      mapped.source_row_id,
      fingerprint,
    );
    if (already) {
      skipped += 1;
      continue;
    }

    if (!mapped.employee_code) {
      await markPunchProcessed(
        mysqlConnection,
        orgId,
        sourceTable,
        mapped.source_row_id,
        fingerprint,
      );
      skipped += 1;
      continue;
    }

    const [mapCheck] = await mysqlConnection.query(
      `SELECT user_id FROM biometric_employee_mappings
       WHERE org_id = ? AND UPPER(biometric_employee_code) = UPPER(?)
       LIMIT 1`,
      [orgId, mapped.employee_code],
    );
    if (mapCheck.length === 0) {
      await markPunchProcessed(
        mysqlConnection,
        orgId,
        sourceTable,
        mapped.source_row_id,
        fingerprint,
      );
      skipped += 1;
      continue;
    }

    await mysqlConnection.beginTransaction();
    try {
      const outcome = await processBiometricPunch(mysqlConnection, orgId, mapped);
      await markPunchProcessed(
        mysqlConnection,
        orgId,
        sourceTable,
        mapped.source_row_id,
        fingerprint,
      );
      await mysqlConnection.commit();

      if (outcome.skipped) {
        skipped += 1;
      } else {
        imported += 1;
        if (outcome.event) emitAttendanceLiveUpdate(outcome.event);
      }
    } catch (err) {
      await mysqlConnection.rollback();
      console.error(
        `[biometric] punch failed (${sourceTable}#${mapped.source_row_id}):`,
        err.message,
      );
      skipped += 1;
    }
  }

  if (maxId > cursor) {
    await setCursor(mysqlConnection, orgId, sourceTable, maxId);
  }

  return { imported, skipped, fetched: result.recordset.length, lastCursor: maxId };
}

export function getBiometricSyncStatus() {
  return {
    enabled: String(process.env.BIOMETRIC_SYNC_ENABLED || "false") === "true",
    is_running: isRunning,
    last_run_at: lastRunAt,
    last_run_status: lastRunStatus,
    last_run_error: lastRunError,
    interval_ms: Number(process.env.BIOMETRIC_SYNC_INTERVAL_MS || 5000),
    default_org_id: getDefaultOrgId(),
  };
}

export async function runBiometricSync(orgIdOverride = null) {
  const orgId = orgIdOverride ?? getDefaultOrgId();
  if (!orgId) {
    throw new Error("BIOMETRIC_DEFAULT_ORG_ID is not configured");
  }

  if (isRunning) {
    return { ok: false, message: "Sync already in progress" };
  }

  isRunning = true;
  const startedAt = new Date();
  let mysqlConnection;

  try {
    const mssqlPool = await getMssqlPool();
    mysqlConnection = await mysqlPool.promise().getConnection();
    const tables = await resolveBiometricSourceTables();

    let totalImported = 0;
    let totalSkipped = 0;
    const tableResults = [];

    for (const table of tables) {
      try {
        const result = await syncTable(orgId, table, mssqlPool, mysqlConnection);
        totalImported += result.imported;
        totalSkipped += result.skipped;
        tableResults.push({ table, ...result });
      } catch (err) {
        console.error(`[biometric] table sync failed (${table}):`, err.message);
        tableResults.push({ table, error: err.message });
      }
    }

    const status =
      tableResults.some((t) => t.error) && totalImported > 0
        ? "partial"
        : tableResults.every((t) => t.error)
          ? "failed"
          : "success";

    await mysqlConnection.query(
      `INSERT INTO biometric_sync_logs
       (started_at, finished_at, status, tables_synced, records_imported, records_processed, error_message)
       VALUES (?, NOW(), ?, ?, ?, ?, ?)`,
      [
        formatMysqlDateTime(startedAt),
        status,
        JSON.stringify(tableResults),
        totalImported,
        totalSkipped,
        null,
      ],
    );

    lastRunAt = new Date().toISOString();
    lastRunStatus = status;
    lastRunError = null;

    return {
      ok: true,
      status,
      org_id: orgId,
      tables: tableResults,
      records_imported: totalImported,
      records_skipped: totalSkipped,
    };
  } catch (err) {
    lastRunAt = new Date().toISOString();
    lastRunStatus = "failed";
    lastRunError = err.message;

    if (mysqlConnection) {
      try {
        await mysqlConnection.query(
          `INSERT INTO biometric_sync_logs
           (started_at, finished_at, status, records_imported, records_processed, error_message)
           VALUES (?, NOW(), 'failed', 0, 0, ?)`,
          [formatMysqlDateTime(startedAt), err.message],
        );
      } catch {
        /* ignore log failure */
      }
    }

    throw err;
  } finally {
    if (mysqlConnection) mysqlConnection.release();
    isRunning = false;
  }
}
