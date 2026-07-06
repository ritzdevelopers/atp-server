import nodeCron from "node-cron";
import { pool } from "../db/connect.js";

const DEFAULT_MONTHLY_BALANCE = 2;

const CRON_EXPRESSION = "0 0 1 * *";

let cronTask = null;
let runInProgress = false;

function dateToLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Current monthly token window for auto-assignment.
 * valid_from = 1st of current month
 * valid_to   = last day of next calendar month
 */
export function monthlyRegularizationValidity(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();
  const valid_from = dateToLocalYmd(new Date(year, monthIndex, 1));
  const valid_to = dateToLocalYmd(new Date(year, monthIndex + 2, 0));
  return { valid_from, valid_to };
}

async function fetchAllOrganizations(connection) {
  const [rows] = await connection.query(
    `SELECT id, owner_id
     FROM apt_organizations
     ORDER BY id ASC`,
  );
  return rows;
}

async function fetchActiveEmployees(connection, orgId) {
  const [rows] = await connection.query(
    `SELECT user_id
     FROM apt_org_members
     WHERE org_id = ? AND is_active = 1`,
    [orgId],
  );
  return rows;
}

async function fetchEmployeeRegularizationBalance(connection, userId, orgId) {
  const [rows] = await connection.query(
    `SELECT id, balance, used,
      DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from,
      DATE_FORMAT(valid_to, '%Y-%m-%d') AS valid_to
     FROM regularization_balance
     WHERE user_id = ? AND org_id = ?
     LIMIT 1`,
    [userId, orgId],
  );
  return rows[0] ?? null;
}

async function upsertMonthlyRegularizationBalance(
  connection,
  { userId, orgId, balance, assignedBy, validFrom, validTo },
) {
  await connection.query(
    `INSERT INTO regularization_balance
      (user_id, org_id, balance, used, assigned_by, valid_from, valid_to)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       balance = VALUES(balance),
       used = 0,
       assigned_by = VALUES(assigned_by),
       valid_from = VALUES(valid_from),
       valid_to = VALUES(valid_to)`,
    [userId, orgId, balance, assignedBy, validFrom, validTo],
  );
}

function resolveBalanceFromPreviousRecord(existingRow) {
  if (!existingRow) return DEFAULT_MONTHLY_BALANCE;
  const previousBalance = Number(existingRow.balance);
  if (!Number.isInteger(previousBalance) || previousBalance < 0) {
    return DEFAULT_MONTHLY_BALANCE;
  }
  return previousBalance;
}

/**
 * Monthly rollover for all organizations and active employees.
 * 1. Fetch organizations
 * 2. Fetch active org members
 * 3. Read previous regularization_balance (if any)
 * 4. Carry forward previous balance or default to 2; reset used; set new month window
 */
export async function runMonthlyRegularizationAssignment(referenceDate = new Date()) {
  const period = monthlyRegularizationValidity(referenceDate);
  let connection;

  const stats = {
    organizations: 0,
    assigned: 0,
    skipped: 0,
    failed: 0,
    period,
  };

  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const organizations = await fetchAllOrganizations(connection);
    stats.organizations = organizations.length;

    for (const org of organizations) {
      const orgId = org.id;
      const assignedBy = org.owner_id;
      const employees = await fetchActiveEmployees(connection, orgId);

      for (const employee of employees) {
        const userId = employee.user_id;

        try {
          const existing = await fetchEmployeeRegularizationBalance(
            connection,
            userId,
            orgId,
          );

          if (existing?.valid_from === period.valid_from) {
            stats.skipped += 1;
            continue;
          }

          const balance = resolveBalanceFromPreviousRecord(existing);

          await upsertMonthlyRegularizationBalance(connection, {
            userId,
            orgId,
            balance,
            assignedBy,
            validFrom: period.valid_from,
            validTo: period.valid_to,
          });

          stats.assigned += 1;
        } catch (employeeError) {
          stats.failed += 1;
          console.error(
            `[regularizationAgent] user ${userId} org ${orgId}:`,
            employeeError.message || employeeError,
          );
        }
      }
    }

    await connection.commit();
    return { success: true, ...stats };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

export function startRegularizationAgent() {
  if (cronTask) return;

  console.log(
    `[regularizationAgent] scheduling monthly job (${CRON_EXPRESSION}, server local time)`,
  );

  cronTask = nodeCron.schedule(CRON_EXPRESSION, async () => {
    if (runInProgress) {
      console.log(
        "[regularizationAgent] previous run still in progress — skipping this tick",
      );
      return;
    }

    runInProgress = true;
    console.log("[regularizationAgent] monthly assignment started");

    try {
      const result = await runMonthlyRegularizationAssignment();
      console.log(
        `[regularizationAgent] done: ${result.assigned} assigned, ${result.skipped} skipped, ${result.failed} failed | validity ${result.period.valid_from} → ${result.period.valid_to}`,
      );
    } catch (error) {
      console.error("[regularizationAgent] failed:", error.message || error);
    } finally {
      runInProgress = false;
    }
  });
}

export function stopRegularizationAgent() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
