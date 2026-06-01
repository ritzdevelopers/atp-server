import { pool } from "./connect.js";

/**
 * leave_quiry.leave_type must store org leave names (Medical, Casual, …),
 * not only ENUM('full_day','half_day','short_leave').
 */
export async function ensureLeaveQuirySchema() {
  const conn = await pool.promise().getConnection();
  try {
    const [columns] = await conn.query(
      `
      SELECT COLUMN_NAME, COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'leave_quiry'
        AND COLUMN_NAME IN ('leave_type', 'leave_type_id')
      `,
    );

    const byName = Object.fromEntries(
      columns.map((c) => [c.COLUMN_NAME, String(c.COLUMN_TYPE).toLowerCase()]),
    );

    if (byName.leave_type?.includes("enum")) {
      await conn.query(
        `ALTER TABLE leave_quiry MODIFY COLUMN leave_type VARCHAR(100) NOT NULL`,
      );
      console.log("[schema] leave_quiry.leave_type → VARCHAR(100)");
    }

    if (!byName.leave_type_id) {
      await conn.query(
        `ALTER TABLE leave_quiry ADD COLUMN leave_type_id INT NULL AFTER leave_type`,
      );
      console.log("[schema] leave_quiry.leave_type_id added");
    }
  } finally {
    conn.release();
  }
}
