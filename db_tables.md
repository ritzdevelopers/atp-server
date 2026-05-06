use rmw_sync;

 CREATE TABLE apt_features (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     feature_name VARCHAR(255) NOT NULL UNIQUE,
     feature_val VARCHAR(300) NOT NULL UNIQUE
 );

 CREATE TABLE apt_role_features (
     id INT PRIMARY KEY AUTO_INCREMENT,
     role_id INT NOT NULL,
     feature_id INT NOT NULL,
     org_id INT NOT NULL,
     FOREIGN KEY (role_id) REFERENCES apt_roles(id) ON DELETE CASCADE,
     FOREIGN KEY (feature_id) REFERENCES apt_features(id) ON DELETE CASCADE,
     FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
     UNIQUE(role_id, feature_id, org_id)
 );

CREATE TABLE apt_user_feature_overrides (
	id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    feature_id INT NOT NULL,
    org_id INT NOT NULL,
    is_allowed BOOLEAN NOT NULL DEFAULT TRUE,
	FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES apt_features(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    UNIQUE(user_id, feature_id, org_id)
);

 CREATE TABLE apt_org_feature_access (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     org_id INT NOT NULL,
     feature_id INT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (feature_id) REFERENCES apt_features(id) ON DELETE CASCADE,
     FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
 );

 CREATE TABLE apt_users (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     user_name VARCHAR(250) NOT NULL,
     user_email VARCHAR(350) UNIQUE NOT NULL,
 	user_password VARCHAR(255) NOT NULL,
     user_phone VARCHAR(15) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 );
 CREATE TABLE apt_organizations (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     org_name VARCHAR(500) UNIQUE NOT NULL,
     owner_id INT NOT NULL,
     org_email VARCHAR(500) NOT NULL UNIQUE,
     org_phone VARCHAR(17) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (owner_id) REFERENCES apt_users(id)
 ); 


 CREATE TABLE apt_roles (
 	   id INT PRIMARY KEY AUTO_INCREMENT,
     role_name VARCHAR(250) NOT NULL,
     org_id INT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
     UNIQUE(role_name, org_id)
 );
 CREATE TABLE apt_user_roles (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     user_id INT NOT NULL,
     role_id INT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
     FOREIGN KEY (role_id) REFERENCES apt_roles(id),
     org_id INT NOT NULL,
 	FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
 	UNIQUE(user_id, role_id, org_id)
 );
 CREATE TABLE apt_user_activity_logs (
 	id INT PRIMARY KEY AUTO_INCREMENT,
     performed_by INT,
     affected_user_id INT,
     action_type  VARCHAR(200),
     old_value JSON,
     new_value JSON,
     action_reason TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 	FOREIGN KEY (performed_by) REFERENCES apt_users(id) ON DELETE SET NULL,
     FOREIGN KEY (affected_user_id) REFERENCES apt_users(id) ON DELETE SET NULL
 );
 CREATE TABLE apt_org_members (
     id INT PRIMARY KEY AUTO_INCREMENT,
     user_id INT NOT NULL,
     org_id INT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
     FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
     UNIQUE(user_id, org_id)
 );




ALTER TABLE apt_user_activity_logs ADD COLUMN org_id INT;
ALTER TABLE apt_user_activity_logs 
ADD CONSTRAINT fk_org_id 
FOREIGN KEY (org_id) REFERENCES apt_organizations(id);




use rmw_sync;

CREATE TABLE attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(100) NOT NULL,
    user_role_name VARCHAR(100) NOT NULL,

    org_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    
    check_in DATETIME DEFAULT NULL,
    check_out DATETIME DEFAULT NULL,

    attendance_status ENUM('present', 'absent', 'half_day', 'late', 'short_leave') DEFAULT 'absent',
    working_hours DECIMAL(6,2) DEFAULT 0,

    UNIQUE KEY unique_attendance (org_id, user_email, attendance_date),

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

CREATE TABLE leave_quiry (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL, 
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(100) NOT NULL,

    org_id INT NOT NULL,

    leave_type ENUM('full_day', 'half_day', 'short_leave') NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,

    reason TEXT,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',

    approved_by INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);


CREATE TABLE holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    holiday_name VARCHAR(100),
    holiday_date DATE NOT NULL,
    holiday_created_by_id INT NULL,
    holiday_created_by_name VARCHAR(150),

    UNIQUE KEY unique_holiday (org_id, holiday_date),
    
    FOREIGN KEY (holiday_created_by_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);
CREATE TABLE management_activity_log (
	id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    activity_type VARCHAR(200),
    activity_overview TEXT,
    performed_by INT NULL,
    performed_by_name VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (performed_by) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

CREATE TABLE shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,

    shift_name VARCHAR(50),
    start_time TIME,
    end_time TIME,

    late_after TIME,
    half_day_hours TIME,
    short_leave_hours TIME,
    is_night_shift BOOLEAN DEFAULT FALSE,
    shift_created_by INT NULL,
    shift_creator_name VARCHAR(150) NULL,
    
    working_days SET(
      'MONDAY','TUESDAY','WEDNESDAY',
      'THURSDAY','FRIDAY','SATURDAY','SUNDAY'
    ) DEFAULT 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY',

    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_created_by) REFERENCES apt_users(id) ON DELETE CASCADE
);

CREATE TABLE user_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    shift_id INT,
    org_id INT,
    user_assigned_by INT NULL,
    assigned_by_name VARCHAR(150) NULL,
    
    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (user_assigned_by) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
);

CREATE TABLE leave_balance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT,
    org_id INT,

    year INT,
    month INT,

    total_leaves INT DEFAULT 0,
    used_leaves INT DEFAULT 0,
    remaining_leaves INT DEFAULT 0,

    last_leave_update DATE,

    UNIQUE(user_id, org_id, year, month),

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL
);

CREATE TABLE organization_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,

    org_id INT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    ip_added_by_id INT NULL,
    ip_added_by_name VARCHAR(150),

    label VARCHAR(100), -- Office Wifi, Branch A etc

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (ip_added_by_id) REFERENCES apt_users(id) ON DELETE SET NULL
);

CREATE TABLE attendance_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action_type ENUM('check_in', 'check_out', 'manual_update'),
    timestamp_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    org_id INT
);