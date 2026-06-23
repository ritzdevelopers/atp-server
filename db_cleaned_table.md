CREATE DATABASE IF NOT EXISTS rmw_sync;
USE rmw_sync;

-- ============================================================================
-- LEVEL 1: BASE TABLES (No Foreign Key Dependencies)
-- ============================================================================

-- 1. USERS
CREATE TABLE apt_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_name VARCHAR(250) NOT NULL,
    user_email VARCHAR(350) UNIQUE NOT NULL,
    user_password VARCHAR(255) NOT NULL,
    user_phone VARCHAR(15) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. FEATURES
CREATE TABLE apt_features (
    id INT PRIMARY KEY AUTO_INCREMENT,
    feature_name VARCHAR(255) NOT NULL UNIQUE,
    feature_val VARCHAR(300) NOT NULL UNIQUE
);

-- 3. USER ADDRESS
CREATE TABLE user_address (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    zip_code VARCHAR(20), -- Corrected from zipcode to zip_code per your rename directive
    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE
);


-- ============================================================================
-- LEVEL 2: CORE ORGANIZATIONS & POLICIES
-- ============================================================================

-- 4. ORGANIZATIONS
CREATE TABLE apt_organizations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    org_name VARCHAR(500) UNIQUE NOT NULL,
    owner_id INT NOT NULL,
    org_email VARCHAR(500) NOT NULL UNIQUE,
    org_phone VARCHAR(17) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (owner_id) REFERENCES apt_users(id) ON DELETE CASCADE
);

-- 5. ROLES
CREATE TABLE apt_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(250) NOT NULL,
    org_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    UNIQUE(role_name, org_id)
);

-- 6. SHIFTS
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

    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_created_by) REFERENCES apt_users(id) ON DELETE SET NULL
);

-- 7. ORG TEAMS
CREATE TABLE org_teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    org_id INT NOT NULL,
    admin_id INT NOT NULL,
    created_by INT NOT NULL,
    team_name VARCHAR(150) NOT NULL,
    team_info VARCHAR(350),
    total_number_of_members INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_team_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_admin FOREIGN KEY (admin_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_created_by FOREIGN KEY (created_by) REFERENCES apt_users(id) ON DELETE CASCADE,
    CONSTRAINT unique_team_name_per_org UNIQUE(org_id, team_name)
);

-- 8. HOLIDAYS
CREATE TABLE holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    holiday_name VARCHAR(100),
    holiday_date DATE NOT NULL,
    holiday_created_by_id INT NULL,
    holiday_created_by_name VARCHAR(150),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_holiday (org_id, holiday_date),
    FOREIGN KEY (holiday_created_by_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 9. ORGANIZATION IPS
CREATE TABLE organization_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    ip_added_by_id INT NULL,
    ip_added_by_name VARCHAR(150),
    label VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (ip_added_by_id) REFERENCES apt_users(id) ON DELETE SET NULL
);


-- ============================================================================
-- LEVEL 3: MAPPINGS, MEMBERSHIPS & ACCESS CONTROL
-- ============================================================================

-- 10. USER ROLES
CREATE TABLE apt_user_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    org_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES apt_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    UNIQUE(user_id, role_id, org_id)
);

-- 11. ROLE FEATURES
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

-- 12. USER FEATURE OVERRIDES
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

-- 13. ORG FEATURE ACCESS
CREATE TABLE apt_org_feature_access (
    id INT PRIMARY KEY AUTO_INCREMENT,
    org_id INT NOT NULL,
    feature_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (feature_id) REFERENCES apt_features(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 14. ORG MEMBERS
CREATE TABLE apt_org_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    org_id INT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    UNIQUE(user_id, org_id)
);

-- 15. TEAM MEMBERS
CREATE TABLE team_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    team_id INT NOT NULL,
    org_id INT NOT NULL,
    joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    leave_date TIMESTAMP NULL DEFAULT NULL,
    added_by_id INT NULL,
    added_by_name VARCHAR(250),
    removed_by_id INT NULL,
    removed_by_name VARCHAR(250),

    CONSTRAINT fk_team_member_user FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_member_team FOREIGN KEY (team_id) REFERENCES org_teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_member_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_member_added_by FOREIGN KEY (added_by_id) REFERENCES apt_users(id),
    CONSTRAINT fk_team_member_removed_by FOREIGN KEY (removed_by_id) REFERENCES apt_users(id),
    CONSTRAINT unique_user_team UNIQUE(user_id, team_id)
);

-- 16. USER SHIFTS
CREATE TABLE user_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    shift_id INT NOT NULL,
    org_id INT NOT NULL,
    user_assigned_by INT NULL,
    assigned_by_name VARCHAR(150) NULL,

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (user_assigned_by) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 17. IP ADDRESS ASSIGNMENTS
CREATE TABLE ip_address_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    org_id INT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    ip_label VARCHAR(150),
    ip_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    CONSTRAINT fk_ip_assignment FOREIGN KEY (ip_id) REFERENCES organization_ips(id) ON DELETE CASCADE
);


-- ============================================================================
-- LEVEL 4: LOGGING & USER PROFILES
-- ============================================================================

-- 18. USER ACTIVITY LOGS
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

    FOREIGN KEY (performed_by) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (affected_user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE SET NULL
);

-- 19. MANAGEMENT ACTIVITY LOG
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

-- 20. USER DOCS
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 21. EMPLOYEES BANK INFO
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_bank_user FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_employee_bank_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    CONSTRAINT unique_user_bank_account UNIQUE(user_id, org_id)
);

-- 22. USER EXTERNAL INFO
CREATE TABLE user_external_info (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    org_id INT NOT NULL,
    emergency_contact_name VARCHAR(150) NOT NULL,
    emergency_number VARCHAR(20) NOT NULL,
    relation_blood_line ENUM(
        'father', 'mother', 'brother', 'sister', 'grandfather', 
        'grandmother', 'son', 'daughter', 'wife', 'husband'
    ) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_external_user FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_external_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    CONSTRAINT unique_user_external_info UNIQUE(user_id, org_id)
);

-- 23. EMPLOYEE REFERENCES
CREATE TABLE employee_references (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    org_id INT NOT NULL,
    referred_by_id INT NOT NULL,
    referred_by_name VARCHAR(200),
    referred_by_designation_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_reference_employee FOREIGN KEY (employee_id) REFERENCES apt_users(id),
    CONSTRAINT fk_reference_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    CONSTRAINT fk_reference_referred_by FOREIGN KEY (referred_by_id) REFERENCES apt_users(id),
    CONSTRAINT fk_reference_designation FOREIGN KEY (referred_by_designation_id) REFERENCES apt_roles(id) ON DELETE SET NULL,
    CONSTRAINT unique_employee_reference UNIQUE(employee_id, org_id)
);

-- 24. EMPLOYEE ASSETS
CREATE TABLE employee_assets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    org_id INT NOT NULL,
    asset_given_by_id INT NOT NULL,
    asset_name VARCHAR(250) NOT NULL,
    asset_summary VARCHAR(600),
    asset_type ENUM(
        'laptop', 'mobile', 'software', 'email', 'sim', 
        'id_card', 'monitor', 'access_card', 'other'
    ) NOT NULL,
    asset_image_url TEXT,
    asset_status ENUM('active', 'returned', 'damaged', 'lost') DEFAULT 'active',
    is_returned BOOLEAN DEFAULT FALSE,
    returned_to_id INT NULL,
    handover_date_time DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_asset_employee FOREIGN KEY (employee_id) REFERENCES apt_users(id),
    CONSTRAINT fk_asset_org FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    CONSTRAINT fk_asset_given_by FOREIGN KEY (asset_given_by_id) REFERENCES apt_users(id),
    CONSTRAINT fk_asset_returned_to FOREIGN KEY (returned_to_id) REFERENCES apt_users(id)
);


-- ============================================================================
-- LEVEL 5: TIME TRACKING, OPERATIONS & LIFECYCLE MANAGEMENT
-- ============================================================================

-- 25. ATTENDANCE
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
        'present', 'absent', 'half_day', 'late', 'short_leave'
    ) DEFAULT 'absent',
    working_hours DECIMAL(6,2) DEFAULT 0,
    working_time INT NULL, -- Incorporated from the standalone update

    UNIQUE KEY unique_attendance (org_id, user_email, attendance_date),
    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 26. LEAVE QUERY
CREATE TABLE leave_quiry (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(100) NOT NULL,
    org_id INT NOT NULL,
    team_id INT NULL, -- Consolidated inline
    -- Store assigned leave type name (Medical, Casual, etc.)
    leave_type VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- Consolidated inline

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE,
    CONSTRAINT lq_team_fk FOREIGN KEY (team_id) REFERENCES org_teams(id)
);

-- 27. LEAVE BALANCE
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
    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 28. ATTENDANCE LOGS
CREATE TABLE attendance_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action_type ENUM('check_in', 'check_out', 'manual_update'),
    timestamp_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    org_id INT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES apt_users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id) ON DELETE CASCADE
);

-- 29. COMPANY LEAVE SHEET
CREATE TABLE company_leave_sheet (
    id INT PRIMARY KEY AUTO_INCREMENT,
    org_id INT,
    user_id INT,
    leaves_per_month INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (user_id) REFERENCES apt_users(id),
    CONSTRAINT unique_user_org UNIQUE (org_id, user_id)
);

-- 30. ATTENDANCE RELATED QUERIES
CREATE TABLE attendance_related_queries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    org_id INT NOT NULL,
    team_id INT,
    query_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    category ENUM('forget_punch_in', 'forget_punch_out', 'late_punch_in') NOT NULL,
    query_message TEXT NOT NULL,
    attendance_date DATE NOT NULL,
    approved_by INT NULL,
    approved_by_name VARCHAR(200) NULL,
    admin_response TEXT NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (team_id) REFERENCES org_teams(id),
    FOREIGN KEY (approved_by) REFERENCES apt_users(id)
);

-- 31. EMPLOYEE EXIT PROCESS
CREATE TABLE employee_exit_process (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    org_id INT NOT NULL,
    team_id INT,
    action_type ENUM('resignation', 'termination') NOT NULL,
    action_reason TEXT NOT NULL,
    application_status ENUM('pending', 'approved', 'rejected', 'in_progress') DEFAULT 'pending',
    exit_date DATE NULL,
    last_working_day DATE NULL,
    action_performed_by INT NULL,
    response_by_id INT NULL,
    response_message TEXT NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (team_id) REFERENCES org_teams(id),
    FOREIGN KEY (action_performed_by) REFERENCES apt_users(id),
    FOREIGN KEY (response_by_id) REFERENCES apt_users(id)
);

-- 32. HANDOVER QUERY
CREATE TABLE handover_query (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    org_id INT NOT NULL,
    team_id INT,
    asset_id INT NULL,
    custom_task_name VARCHAR(250) NULL,
    manager_id INT NOT NULL,
    handover_status ENUM('pending', 'handover_completed', 'damaged', 'missing') DEFAULT 'pending',
    remarks TEXT NULL,
    handover_date DATETIME NULL,
    employee_exit_process_id INT NULL, -- Consolidated inline
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (team_id) REFERENCES org_teams(id),
    FOREIGN KEY (manager_id) REFERENCES apt_users(id),
    FOREIGN KEY (asset_id) REFERENCES employee_assets(id),
    CONSTRAINT emp_ex_pr_frgn_key FOREIGN KEY (employee_exit_process_id) REFERENCES employee_exit_process(id)
);


CREATE TABLE organization_address (
    id INT AUTO_INCREMENT PRIMARY KEY,

    org_id INT NOT NULL,
    org_owner_id INT NOT NULL,

    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,

    zip_code VARCHAR(20),
    address_line TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_org_address_org
    FOREIGN KEY (org_id)
    REFERENCES apt_organizations(id),

    CONSTRAINT fk_org_address_owner
    FOREIGN KEY (org_owner_id)
    REFERENCES apt_users(id)
);


CREATE TABLE leave_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    leave_type_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE employee_leave_balance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    leave_type_id INT NOT NULL,

    total_leaves INT DEFAULT 0,
    used_leaves INT DEFAULT 0,
    remaining_leaves INT DEFAULT 0,

    FOREIGN KEY (leave_type_id)
    REFERENCES leave_types(id)
);

ALTER TABLE user_address
DROP COLUMN address_line1,
DROP COLUMN address_line2;

ALTER TABLE user_address
ADD COLUMN district VARCHAR(100) NULL,
ADD COLUMN is_from_village BOOLEAN DEFAULT FALSE,
ADD COLUMN village_name VARCHAR(255) NULL,
ADD COLUMN street VARCHAR(255) NULL,
ADD COLUMN house_number VARCHAR(100) NULL;

ALTER TABLE user_address
ADD COLUMN org_id INT,
ADD CONSTRAINT user_org_fk
FOREIGN KEY (org_id)
REFERENCES apt_organizations(id);



CREATE TABLE leave_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    leave_type_name VARCHAR(100) NOT NULL,

    CONSTRAINT uq_leave_type UNIQUE (org_id, leave_type_name),

    CONSTRAINT fk_leave_type_org
        FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id)
);

 
CREATE TABLE employee_leave_balance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    leave_type_id INT NOT NULL,

    total_leaves INT DEFAULT 0,
    used_leaves INT DEFAULT 0,
    remaining_leaves INT DEFAULT 0,

    FOREIGN KEY (leave_type_id)
    REFERENCES leave_types(id)
); 

ALTER TABLE apt_users
ADD COLUMN user_image TEXT;

CREATE TABLE employee_salary (
    id INT AUTO_INCREMENT PRIMARY KEY,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,

    basic_salary DECIMAL(10,2) DEFAULT 0,
    house_rent_allowance DECIMAL(10,2) DEFAULT 0,
    special_allowance DECIMAL(10,2) DEFAULT 0,
    convey DECIMAL(10,2) DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_salary_employee
        FOREIGN KEY (employee_id)
        REFERENCES apt_users(id),

    CONSTRAINT fk_salary_org
        FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id)
);

ALTER TABLE employee_salary
ADD CONSTRAINT unique_employee_salary
UNIQUE (employee_id, org_id);

CREATE TABLE employee_salary (
    id INT AUTO_INCREMENT PRIMARY KEY,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,

    basic_salary DECIMAL(10,2) DEFAULT 0,
    house_rent_allowance DECIMAL(10,2) DEFAULT 0,
    special_allowance DECIMAL(10,2) DEFAULT 0,
    convey DECIMAL(10,2) DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_salary_employee
        FOREIGN KEY (employee_id)
        REFERENCES apt_users(id),

    CONSTRAINT fk_salary_org
        FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id)
);

ALTER TABLE employee_salary
ADD CONSTRAINT unique_employee_salary
UNIQUE (employee_id, org_id);




CREATE TABLE user_attendance_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NOT NULL,
    attendance_id INT NOT NULL,
    org_id INT NOT NULL,
	user_name varchar(50),
    user_email varchar(50),
    action_type ENUM('ENTRY', 'EXIT') NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES apt_users(id),

    FOREIGN KEY (attendance_id)
        REFERENCES attendance(id),

    FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id),

    INDEX idx_user (user_id),
    INDEX idx_org (org_id),
    INDEX idx_attendance (attendance_id),
    INDEX idx_created_at (created_at)
);


CREATE TABLE apt_sub_features(
	id int primary key auto_increment,
    sub_feature_name varchar(100),
    parent_feature_id int not null,
    sub_feature_path varchar(110),
    
    foreign key (parent_feature_id) references apt_features(id)
);

CREATE TABLE apt_org_sub_features_access (
	id int primary key auto_increment,
    org_id int not null,
    sub_feature_id int,
    parent_feature_id int not null,
    
    
    foreign key (org_id) references apt_organizations(id),
    foreign key (sub_feature_id) references apt_sub_features(id),
    foreign key (parent_feature_id) references apt_features(id),
	UNIQUE(org_id, sub_feature_id)
);

CREATE TABLE org_employee_feature_access (
	id int primary key auto_increment,
    employee_id int not null,
    org_id int not null,
    feature_id int,
	access_permission boolean default 0, 
    
    foreign key (employee_id) references apt_users(id),
    foreign key (org_id) references apt_organizations(id),
    foreign key (feature_id) references apt_features(id),
    UNIQUE(employee_id, feature_id)
    
);

CREATE TABLE org_employee_sub_features_access (
	id int primary key auto_increment,
    employee_id int,
    org_id int,
    feature_id int,
    sub_feature_id int,
    access_permission boolean default 0,
    
    foreign key (employee_id) references apt_users(id),
    foreign key (org_id) references apt_organizations(id),
    foreign key (feature_id) references apt_features(id),
    foreign key (sub_feature_id) references apt_sub_features(id),
    
    UNIQUE(employee_id, sub_feature_id)
);

ALTER TABLE org_employee_sub_features_access ADD COLUMN feature_access VARCHAR(250);


CREATE TABLE dashboard_management (
    id INT PRIMARY KEY AUTO_INCREMENT,

    employee_id INT,
    org_id INT,

    dashboard_type ENUM('management', 'employee')
    DEFAULT 'employee',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_employee_org (
        employee_id,
        org_id
    ),

    FOREIGN KEY (employee_id)
        REFERENCES apt_users(id),

    FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id)
);

ALTER TABLE holidays ADD COLUMN end_date date;



CREATE TABLE previous_company_references (
    id INT PRIMARY KEY AUTO_INCREMENT,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,

    previous_company_name VARCHAR(255) NOT NULL,
    company_email VARCHAR(255),

    employee_code VARCHAR(100),
    designation VARCHAR(150),

    employment_start_date DATE,
    employment_end_date DATE,

    person_name VARCHAR(250) NOT NULL,

    person_role ENUM(
        'hr',
        'reporting_manager'
    ) NOT NULL,

    person_contact_number1 VARCHAR(20) NOT NULL,
    person_contact_number2 VARCHAR(20),

    person_contact_email VARCHAR(255) NOT NULL,

    verification_status ENUM(
        'pending',
        'in_progress',
        'verified',
        'failed',
        'unable_to_contact'
    ) DEFAULT 'pending',

    verification_notes TEXT,

    verification_by_id INT,
    verification_by_name VARCHAR(250),

    verified_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id)
        REFERENCES apt_users(id),

    FOREIGN KEY (org_id)
        REFERENCES apt_organizations(id),

    FOREIGN KEY (verification_by_id)
        REFERENCES apt_users(id)
);

ALTER TABLE user_address ADD COLUMN address_type enum('current', 'permanent') not null;

CREATE TABLE employee_tasks(
    id INT PRIMARY KEY AUTO_INCREMENT,

    employee_id INT NOT NULL,
    org_id INT NOT NULL,
    team_id INT,

    assigned_by INT NOT NULL,
    reporting_manager INT NOT NULL,

    task_title VARCHAR(255) NOT NULL,
    task_description TEXT,

    task_priority ENUM(
        'high',
        'medium',
        'low'
    ) DEFAULT 'medium',

    task_status ENUM(
        'pending',
        'in-progress',
        'delay',
        'completed'
    ) DEFAULT 'pending',

    complete_status ENUM(
        'pending',
        'approved',
        'rejected'
    ) DEFAULT 'pending',

    task_start_date DATETIME,
    task_deadline DATETIME,

    employee_completed_at DATETIME,
    manager_remarks TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (team_id) REFERENCES org_teams(id),
    FOREIGN KEY (assigned_by) REFERENCES apt_users(id),
    FOREIGN KEY (reporting_manager) REFERENCES apt_users(id)
);

CREATE TABLE leave_scheduler (
    id INT PRIMARY KEY AUTO_INCREMENT,

    user_id INT NOT NULL,
    org_id INT NOT NULL,

    leave_type_id INT NOT NULL,

    allocation_frequency ENUM(
        'monthly',
        'quarterly',
        'half_yearly',
        'yearly'
    ) NOT NULL,

    leaves_per_cycle INT NOT NULL,

    carry_forward BOOLEAN DEFAULT FALSE,

    max_carry_forward INT DEFAULT 0,

    next_allocation_date DATE NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES apt_users(id),
    FOREIGN KEY (org_id) REFERENCES apt_organizations(id),
    FOREIGN KEY (leave_type_id) references leave_types(id)
);

ALTER TABLE leave_scheduler REMOVE  mark_done;