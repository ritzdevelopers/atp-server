CREATE DATABASE IF NOT EXISTS rmw_sync;
USE rmw_sync;

-- =========================
-- USERS
-- =========================
CREATE TABLE apt_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_name VARCHAR(250) NOT NULL,
    user_email VARCHAR(350) UNIQUE NOT NULL,
    user_password VARCHAR(255) NOT NULL,
    user_phone VARCHAR(15) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================
-- ORGANIZATIONS
-- =========================
CREATE TABLE apt_organizations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    org_name VARCHAR(500) UNIQUE NOT NULL,
    owner_id INT NOT NULL,
    org_email VARCHAR(500) NOT NULL UNIQUE,
    org_phone VARCHAR(17) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (owner_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE
);

-- =========================
-- ROLES
-- =========================
CREATE TABLE apt_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(250) NOT NULL,
    org_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    UNIQUE(role_name, org_id)
);

-- =========================
-- FEATURES
-- =========================
CREATE TABLE apt_features (
    id INT PRIMARY KEY AUTO_INCREMENT,
    feature_name VARCHAR(255) NOT NULL UNIQUE,
    feature_val VARCHAR(300) NOT NULL UNIQUE
);

-- =========================
-- USER ROLES
-- =========================
CREATE TABLE apt_user_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    org_id INT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    FOREIGN KEY (role_id)
    REFERENCES apt_roles(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    UNIQUE(user_id, role_id, org_id)
);

-- =========================
-- ROLE FEATURES
-- =========================
CREATE TABLE apt_role_features (
    id INT PRIMARY KEY AUTO_INCREMENT,

    role_id INT NOT NULL,
    feature_id INT NOT NULL,
    org_id INT NOT NULL,

    FOREIGN KEY (role_id)
    REFERENCES apt_roles(id)
    ON DELETE CASCADE,

    FOREIGN KEY (feature_id)
    REFERENCES apt_features(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    UNIQUE(role_id, feature_id, org_id)
);

-- =========================
-- USER FEATURE OVERRIDES
-- =========================
CREATE TABLE apt_user_feature_overrides (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    feature_id INT NOT NULL,
    org_id INT NOT NULL,

    is_allowed BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    FOREIGN KEY (feature_id)
    REFERENCES apt_features(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    UNIQUE(user_id, feature_id, org_id)
);

-- =========================
-- ORG FEATURE ACCESS
-- =========================
CREATE TABLE apt_org_feature_access (
    id INT PRIMARY KEY AUTO_INCREMENT,

    org_id INT NOT NULL,
    feature_id INT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (feature_id)
    REFERENCES apt_features(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- ORG MEMBERS
-- =========================
CREATE TABLE apt_org_members (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    UNIQUE(user_id, org_id)
);

-- =========================
-- USER ACTIVITY LOGS
-- =========================
CREATE TABLE apt_user_activity_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,

    performed_by INT NULL,
    affected_user_id INT NULL,
    org_id INT NULL,

    action_type VARCHAR(200),
    old_value JSON,
    new_value JSON,
    action_reason TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (performed_by)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (affected_user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE SET NULL
);

-- =========================
-- ATTENDANCE
-- =========================
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

    attendance_status ENUM(
        'present',
        'absent',
        'half_day',
        'late',
        'short_leave'
    ) DEFAULT 'absent',

    working_hours DECIMAL(6,2) DEFAULT 0,

    UNIQUE KEY unique_attendance (
        org_id,
        user_email,
        attendance_date
    ),

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- LEAVE QUERY
-- =========================
CREATE TABLE leave_quiry (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(100) NOT NULL,

    org_id INT NOT NULL,

    leave_type ENUM(
        'full_day',
        'half_day',
        'short_leave'
    ) NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,

    reason TEXT,

    status ENUM(
        'pending',
        'approved',
        'rejected'
    ) DEFAULT 'pending',

    approved_by INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (approved_by)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- HOLIDAYS
-- =========================
CREATE TABLE holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,

    org_id INT NOT NULL,

    holiday_name VARCHAR(100),
    holiday_date DATE NOT NULL,

    holiday_created_by_id INT NULL,
    holiday_created_by_name VARCHAR(150),

    UNIQUE KEY unique_holiday (
        org_id,
        holiday_date
    ),

    FOREIGN KEY (holiday_created_by_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- MANAGEMENT ACTIVITY LOG
-- =========================
CREATE TABLE management_activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,

    org_id INT NOT NULL,

    activity_type VARCHAR(200),
    activity_overview TEXT,

    performed_by INT NULL,
    performed_by_name VARCHAR(150),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (performed_by)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- SHIFTS
-- =========================
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
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY'
    ) DEFAULT 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY',

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    FOREIGN KEY (shift_created_by)
    REFERENCES apt_users(id)
    ON DELETE SET NULL
);

-- =========================
-- USER SHIFTS
-- =========================
CREATE TABLE user_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL,
    shift_id INT NOT NULL,
    org_id INT NOT NULL,

    user_assigned_by INT NULL,
    assigned_by_name VARCHAR(150) NULL,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (user_assigned_by)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (shift_id)
    REFERENCES shifts(id)
    ON DELETE CASCADE,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- LEAVE BALANCE
-- =========================
CREATE TABLE leave_balance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL,
    org_id INT NOT NULL,

    year INT,
    month INT,

    total_leaves INT DEFAULT 0,
    used_leaves INT DEFAULT 0,
    remaining_leaves INT DEFAULT 0,

    last_leave_update DATE,

    UNIQUE(user_id, org_id, year, month),

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

-- =========================
-- ORGANIZATION IPS
-- =========================
CREATE TABLE organization_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,

    org_id INT NOT NULL,

    ip_address VARCHAR(45) NOT NULL,

    ip_added_by_id INT NULL,
    ip_added_by_name VARCHAR(150),

    label VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    FOREIGN KEY (ip_added_by_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL
);

-- =========================
-- ATTENDANCE LOGS
-- =========================
CREATE TABLE attendance_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NULL,

    action_type ENUM(
        'check_in',
        'check_out',
        'manual_update'
    ),

    timestamp_time DATETIME DEFAULT CURRENT_TIMESTAMP,

    org_id INT NOT NULL,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE SET NULL,

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE
);

ADD COLUMN working_time INT;

-- ALTER TABLE attendance
-- ADD COLUMN working_time INT;

-- ALTER TABLE holidays
-- ADD COLUMN updated_at TIMESTAMP Default current_timestamp;



-- ALTER TABLE attendance
-- MODIFY attendance_status VARCHAR(50);

alter table leave_quiry add column updated_at timestamp default current_timestamp;


CREATE TABLE company_leave_sheet (
	id INT PRIMARY KEY AUTO_INCREMENT,
    org_id INT,
    user_id INT,
    leaves_per_month INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    foreign key (org_id) references apt_organizations(id),
    foreign key (user_id) references apt_users(id)
);

ALTER TABLE company_leave_sheet
ADD CONSTRAINT unique_user_org
UNIQUE (org_id, user_id);

alter table user_address rename column zipcode to zip_code;


CREATE TABLE user_docs (

    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,

    org_id INT NOT NULL,

    document_name VARCHAR(255),

    document_type VARCHAR(100),

    doc_url TEXT NOT NULL,

    public_id VARCHAR(255),

    resource_type VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP

);


CREATE TABLE ip_address_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    user_id INT NOT NULL,
    org_id INT NOT NULL,
    
    ip_address VARCHAR(45) NOT NULL,
    ip_label VARCHAR(150),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id)
);


ALTER TABLE ip_address_assignments
ADD COLUMN ip_id INT,
ADD CONSTRAINT fk_ip_assignment
FOREIGN KEY (ip_id)
REFERENCES organization_ips(id)
ON DELETE CASCADE;



CREATE TABLE employees_bank_info (
    id INT PRIMARY KEY AUTO_INCREMENT,

    account_holder_name VARCHAR(200) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    bank_name VARCHAR(250) NOT NULL,
    bank_branch VARCHAR(250) NOT NULL,

    ifsc_code VARCHAR(20) NOT NULL,
    uan_number VARCHAR(50),

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_bank_user
    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_employee_bank_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    CONSTRAINT unique_user_bank_account
    UNIQUE(user_id, org_id)
);



CREATE TABLE org_teams (
    id INT PRIMARY KEY AUTO_INCREMENT,

    org_id INT NOT NULL,
    admin_id INT NOT NULL,
    created_by INT NOT NULL,

    team_name VARCHAR(150) NOT NULL,
    team_info VARCHAR(350),

    total_number_of_members INT DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_team_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_team_admin
    FOREIGN KEY (admin_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_team_created_by
    FOREIGN KEY (created_by)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    CONSTRAINT unique_team_name_per_org
    UNIQUE(org_id, team_name)
);


CREATE TABLE team_members (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    team_id INT NOT NULL,
    org_id INT NOT NULL,

    joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    leave_date TIMESTAMP NULL DEFAULT NULL,



    CONSTRAINT fk_team_member_user
    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_team_member_team
    FOREIGN KEY (team_id)
    REFERENCES org_teams(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_team_member_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    CONSTRAINT unique_user_team
    UNIQUE(user_id, team_id)
);

ALTER TABLE team_members
ADD COLUMN added_by_id INT NULL,
ADD column added_by_name varchar(250),

ADD COLUMN removed_by_id INT NULL,
add column removed_by_name varchar(250),

ADD CONSTRAINT fk_team_member_added_by
FOREIGN KEY (added_by_id)
REFERENCES apt_users(id),

ADD CONSTRAINT fk_team_member_removed_by
FOREIGN KEY (removed_by_id)
REFERENCES apt_users(id);

CREATE TABLE user_external_info (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    emergency_contact_name VARCHAR(150) NOT NULL,

    emergency_number VARCHAR(20) NOT NULL,

    relation_blood_line ENUM(
        'father',
        'mother',
        'brother',
        'sister',
        'grandfather',
        'grandmother',
        'son',
        'daughter',
        'wife',
        'husband'
    ) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_external_user
    FOREIGN KEY (user_id)
    REFERENCES apt_users(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_external_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id)
    ON DELETE CASCADE,

    CONSTRAINT unique_user_external_info
    UNIQUE(user_id, org_id)
);


CREATE TABLE employee_references (
    id INT PRIMARY KEY AUTO_INCREMENT,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,

    referred_by_id INT NOT NULL,
    referred_by_name VARCHAR(200),

    referred_by_designation_id INT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_reference_employee
    FOREIGN KEY (employee_id)
    REFERENCES apt_users(id),

    CONSTRAINT fk_reference_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id),

    CONSTRAINT fk_reference_referred_by
    FOREIGN KEY (referred_by_id)
    REFERENCES apt_users(id),

    CONSTRAINT fk_reference_designation
    FOREIGN KEY (referred_by_designation_id)
    REFERENCES apt_roles(id)
    ON DELETE SET NULL,

    CONSTRAINT unique_employee_reference
    UNIQUE(employee_id, org_id)
);


CREATE TABLE employee_assets (
    id INT PRIMARY KEY AUTO_INCREMENT,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,

    asset_given_by_id INT NOT NULL,

    asset_name VARCHAR(250) NOT NULL,

    asset_summary VARCHAR(600),

    asset_type ENUM(
        'laptop',
        'mobile',
        'software',
        'email',
        'sim',
        'id_card',
        'monitor',
        'access_card',
        'other'
    ) NOT NULL,

    asset_image_url TEXT,

    asset_status ENUM(
        'active',
        'returned',
        'damaged',
        'lost'
    ) DEFAULT 'active',

    is_returned BOOLEAN DEFAULT FALSE,

    returned_to_id INT NULL,

    handover_date_time DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_asset_employee
    FOREIGN KEY (employee_id)
    REFERENCES apt_users(id),

    CONSTRAINT fk_asset_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id),

    CONSTRAINT fk_asset_given_by
    FOREIGN KEY (asset_given_by_id)
    REFERENCES apt_users(id),

    CONSTRAINT fk_asset_returned_to
    FOREIGN KEY (returned_to_id)
    REFERENCES apt_users(id)
);

ALTER TABLE leave_quiry 
ADD COLUMN team_id INT NULL;

ALTER TABLE leave_quiry
ADD CONSTRAINT lq_team_fk
FOREIGN KEY (team_id) REFERENCES org_teams(id);



CREATE TABLE attendance_related_queries (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    org_id INT NOT NULL,
    team_id INT,

    query_status ENUM(
        'pending',
        'approved',
        'rejected'
    ) DEFAULT 'pending',

    category ENUM(
        'forget_punch_in',
        'forget_punch_out',
        'late_punch_in'
    ) NOT NULL,

    query_message TEXT NOT NULL,

    attendance_date DATE NOT NULL,

    approved_by INT NULL,
    approved_by_name VARCHAR(200) NULL,

    admin_response TEXT NULL,

    resolved_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
    REFERENCES apt_users(id),

    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id),

    FOREIGN KEY (team_id)
    REFERENCES org_teams(id),

    FOREIGN KEY (approved_by)
    REFERENCES apt_users(id)
);