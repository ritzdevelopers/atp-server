import { pool } from "./connect.js";

export async function ensureBiometricSchema() {
  const conn = await pool.promise().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS biometric_employee_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        org_id INT NOT NULL,
        biometric_employee_code VARCHAR(100) NOT NULL,
        user_id INT NOT NULL,
        employee_name VARCHAR(250) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bio_map_org_code (org_id, biometric_employee_code),
        UNIQUE KEY uq_bio_map_org_user (org_id, user_id),
        FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS biometric_sync_state (
        id INT AUTO_INCREMENT PRIMARY KEY,
        org_id INT NOT NULL,
        source_table VARCHAR(200) NOT NULL,
        last_cursor_id BIGINT NOT NULL DEFAULT 0,
        last_synced_at DATETIME NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bio_sync_org_table (org_id, source_table),
        FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS biometric_sync_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        org_id INT NOT NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        status ENUM('success', 'partial', 'failed') NOT NULL DEFAULT 'success',
        tables_synced JSON NULL,
        records_imported INT NOT NULL DEFAULT 0,
        records_skipped INT NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS biometric_processed_punches (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        org_id INT NOT NULL,
        source_table VARCHAR(200) NOT NULL,
        source_row_id BIGINT NOT NULL,
        punch_fingerprint VARCHAR(255) NOT NULL,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bio_punch (org_id, source_table, source_row_id),
        UNIQUE KEY uq_bio_fingerprint (org_id, punch_fingerprint)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS biometric_live_punch_feed (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        org_id INT NOT NULL,
        device_log_id BIGINT NOT NULL,
        source_table VARCHAR(200) NOT NULL DEFAULT 'sync_agent',
        employee_code VARCHAR(100) NOT NULL,
        employee_name VARCHAR(250) NULL,
        user_id INT NULL,
        portal_user_name VARCHAR(250) NULL,
        punch_at DATETIME NOT NULL,
        punch_date DATE NOT NULL,
        direction VARCHAR(20) NOT NULL DEFAULT 'unknown',
        device_id VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bio_feed_log (org_id, source_table, device_log_id),
        KEY idx_bio_feed_org_date (org_id, punch_date, device_log_id),
        FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
      )
    `);
  } finally {
    conn.release();
  }
}
