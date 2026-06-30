import db, { pool } from "../db/connect.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import uploadToCloudinary, {
  destroyFromCloudinary,
} from "../config/cloudinary.js";
import { isEmployeeExists } from "../helper/employee_checker.js";

dotenv.config();

// If Organization ID and Role ID are provided, check if the role exists in the organization It Will use by Admin Or HR When They Are Creating Or Updating A User

const isValidRole = async (role_id, organization_id) => {
  try {
    if (!organization_id || !role_id) {
      return {
        data: null,
        status: 400,
        success: false,
        message: "Organization ID and Role ID are required",
      };
    }

    const check_role_exists_query =
      "SELECT * FROM apt_roles WHERE id = ? AND org_id = ?";

    const [result] = await db
      .promise()
      .query(check_role_exists_query, [role_id, organization_id]);

    if (result.length === 0) {
      return {
        data: null,
        status: 404,
        success: false,
        message: "Role not found",
      };
    }

    return {
      data: result[0],
      status: 200,
      success: true,
      message: "Role found",
    };
  } catch (error) {
    console.error("Error checking role exists: ", error);
    return {
      data: null,
      status: 500,
      success: false,
      message: "Error checking role exists",
    };
  }
};

// When New Admin Will Be Register So On That Time Organization ID Will Be Null

export const user_register_controller = async (req, res) => {
  try {
    const { name, email, password, phone, user_role_id, organization_id } =
      req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.beginTransaction((err) => {
      if (err) {
        console.error("Transaction error: ", err);
        return db.rollback(() => {
          return res.status(500).json({ message: "Transaction error" });
        });
      }
      const check_user_exists_query =
        "SELECT * FROM apt_users WHERE user_email = ?";

      db.query(check_user_exists_query, [email], (err, result) => {
        if (err) {
          console.error("Error checking user exists: ", err);
          return db.rollback(() => {
            return res
              .status(500)
              .json({ message: "Error checking user exists" });
          });
        }

        if (result.length > 0) {
          return db.rollback(() => {
            return res.status(409).json({ message: "User already exists" });
          });
        }
        // Only runs if user does NOT exist

        // Case :: 1 -> Organization ID is provided
        if (organization_id) {
          // User Checking
          const user = req.user;

          const performed_by = user.user_id;

          const fetch_org_id = "SELECT id FROM apt_organizations WHERE id = ?";
          db.query(fetch_org_id, [organization_id], async (err, result) => {
            if (err) {
              console.error("Error fetching organization: ", err);
              return db.rollback(() => {
                return res
                  .status(500)
                  .json({ message: "Error fetching organization" });
              });
            }
            if (result.length === 0) {
              return db.rollback(() => {
                return res
                  .status(404)
                  .json({ message: "Organization not found" });
              });
            }
            const orgId = result[0].id;

            const role_exists = await isValidRole(user_role_id, orgId);

            if (!role_exists || !role_exists?.success) {
              return db.rollback(() => {
                return res.status(400).json({ message: role_exists?.message });
              });
            }
            const role_id = role_exists?.data?.id;

            if (role_id !== user_role_id) {
              return db.rollback(() => {
                return res.status(400).json({ message: "Invalid role ID" });
              });
            }

            const query =
              "INSERT INTO apt_users (user_name, user_email, user_password, user_phone) VALUES (?, ?, ?, ?)";
            const values = [name, email, hashedPassword, phone, orgId];

            db.query(query, values, (err, result) => {
              if (err) {
                console.error("Error registering user: ", err);
                return db.rollback(() => {
                  return res
                    .status(500)
                    .json({ message: "Error registering user" });
                });
              }

              const user_id = result.insertId;

              const register_user_role_query =
                "INSERT INTO apt_user_roles (user_id, role_id, org_id) VALUES (?, ?, ?)";

              db.query(
                register_user_role_query,
                [user_id, user_role_id, orgId],
                (err, result) => {
                  // If Err Rollback User Registration
                  if (err) {
                    console.error("Error registering user role: ", err);
                    return db.rollback(() => {
                      return res
                        .status(500)
                        .json({ message: "Error registering user role" });
                    });
                  }

                  // Register User To Organization
                  const register_user_to_organization_query = `INSERT INTO apt_org_members (user_id, org_id) VALUES (?, ?)`;
                  db.query(
                    register_user_to_organization_query,
                    [user_id, orgId],
                    (err, result) => {
                      if (err) {
                        console.error(
                          "Error registering user to organization: ",
                          err,
                        );
                        return db.rollback(() => {
                          return res.status(500).json({
                            message: "Error registering user to organization",
                          });
                        });
                      }
                    },
                  );

                  // Save This Whole Activity ::
                  const save_activity = `INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, action_type, old_value, new_value, action_reason, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;

                  db.query(
                    save_activity,
                    [
                      performed_by,
                      user_id,
                      "CREATE_USER",
                      JSON.stringify(null),
                      JSON.stringify({
                        name,
                        email,
                        phone,
                        role_id: user_role_id,
                        org_id: orgId,
                      }),
                      "Created New User",
                      orgId,
                    ],
                    (err, result) => {
                      if (err) {
                        console.error("Error saving activity: ", err);
                        return db.rollback(() => {
                          return res
                            .status(500)
                            .json({ message: "Error saving activity" });
                        });
                      }

                      db.commit((err) => {
                        if (err) {
                          console.error("Error committing transaction: ", err);
                          return db.rollback(() => {
                            return res.status(500).json({
                              message: "Error committing transaction",
                            });
                          });
                        }
                        return res.status(201).json({
                          message: "User registered successfully",
                          user_id,
                          data: {
                            user_id,
                            org_id: orgId,
                          },
                        });
                      });
                    },
                  );
                },
              );
            });
          });
        } else {
          // Case :: 2 -> Organization ID is not provided
          const query =
            "INSERT INTO apt_users (user_name, user_email, user_password, user_phone, org_id) VALUES (?, ?, ?, ?, ?)";
          const values = [name, email, hashedPassword, phone, null];

          db.query(query, values, (err, result) => {
            if (err) {
              console.error("Error registering user: ", err);
              return db.rollback(() => {
                return res
                  .status(500)
                  .json({ message: "Error registering user" });
              });
            }

            // const user_id = result.insertId;

            // const register_user_role_query =
            //   "INSERT INTO apt_user_roles (user_id, role_id) VALUES (?, ?)";

            // db.query(
            //   register_user_role_query,
            //   [user_id, user_role_id],
            //   (err, result) => {
            //     // If Err Rollback User Registration
            //     if (err) {
            //       console.error("Error registering user role: ", err);
            //       return db.rollback(() => {
            //         return res
            //           .status(500)
            //           .json({ message: "Error registering user role" });
            //       });
            //     }
            //     db.commit((err) => {
            //       if (err) {
            //         console.error("Error committing transaction: ", err);
            //         return db.rollback(() => {
            //           return res
            //             .status(500)
            //             .json({ message: "Error committing transaction" });
            //         });
            //       }
            //       return res.status(201).json({
            //         message: "User registered successfully",
            //       });
            //     });
            //   },
            // );

            db.commit((err) => {
              if (err) {
                console.error("Error committing transaction: ", err);
                return db.rollback(() => {
                  return res
                    .status(500)
                    .json({ message: "Error committing transaction" });
                });
              }
              return res
                .status(201)
                .json({ message: "User registered successfully" });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error("Error registering user: ", error);
    res.status(500).json({ message: "Error registering user" });
  }
};

export const user_login_controller = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const check_user_exists_query =
      "SELECT * FROM apt_users WHERE user_email = ?";

    let result;
    try {
      [result] = await db.promise().query(check_user_exists_query, [email]);
    } catch (err) {
      console.error("Error checking user exists: ", err);
      return res.status(500).json({ message: "Error checking user exists" });
    }

    if (result.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result[0];
    const is_password_valid = await bcrypt.compare(
      password,
      user.user_password,
    );
    if (!is_password_valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Fetch User Role ID
    const fetch_user_role_query =
      "SELECT * FROM apt_user_roles WHERE user_id = ?";
    try {
      [result] = await db.promise().query(fetch_user_role_query, [user.id]);
    } catch (err) {
      console.error("Error fetching user role: ", err);
      return res
        .status(500)
        .json({ message: "Error fetching user role", user_id: user.id });
    }

    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "User role not found", user_id: user.id });
    }

    const user_role = result[0];
    const user_role_id = user_role.role_id;

    // Fetch User Role Name
    const fetch_user_role_name_query = "SELECT * FROM apt_roles WHERE id = ?";
    try {
      [result] = await db
        .promise()
        .query(fetch_user_role_name_query, [user_role_id]);
    } catch (err) {
      console.error("Error fetching user role name: ", err);
      return res.status(500).json({
        message: "Error fetching user role name",
        user_id: user.id,
      });
    }

    if (result.length === 0) {
      return res.status(404).json({
        message: "User role name not found",
        user_id: user.id,
      });
    }

    const user_role_name = result[0].role_name;

    const user_for_token = {
      user_id: user.id,
      user_email: user.user_email,
      user_role_id: user_role_id,
      user_role_name: user_role_name,
    };
    const token = jwt.sign(user_for_token, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });
    return res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("Error logging in user: ", error);
    return res.status(500).json({ message: "Error logging in user" });
  }
};

export const admin_get_me_controller = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (user.user_role_name !== "admin") {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const user_id = user.user_id;

    // Check Admin Organization ID Using User ID
    const [rows] = await db
      .promise()
      .query("SELECT orgId FROM apt_users WHERE id = ?", [user_id]);

    if (rows.length === 0) {
      return res.status(200).json({
        message: "User Fetched But Organization Is Not Registered",
        user,
        organization_id: null,
      });
    }
    const organization_id = rows[0].orgId;

    return res
      .status(200)
      .json({ message: "User fetched successfully", user, organization_id });
  } catch (error) {
    console.error("Error fetching user: ", error);
    res.status(500).json({ message: "Error fetching user" });
  }
};

export const get_all_users_controller = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { user_id: action_user_id } = user;
    if (!action_user_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Fetch Organization From apt_org_members
    const fetch_organization_query =
      "SELECT org_id FROM apt_org_members WHERE user_id = ?";
    const [organization_result] = await db
      .promise()
      .query(fetch_organization_query, [action_user_id]);
    if (organization_result.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }
    const organization_id = organization_result[0].org_id;

    // Fetch Organization Owner ID
    const fetch_organization_owner_id_query =
      "SELECT owner_id FROM apt_organizations WHERE id = ?";
    const [organization_owner_id_result] = await db
      .promise()
      .query(fetch_organization_owner_id_query, [organization_id]);
    if (organization_owner_id_result.length === 0) {
      return res.status(404).json({ message: "Organization owner not found" });
    }
    const organization_owner_id = organization_owner_id_result[0].owner_id;

    // Fetch all org users except the organization owner and the requesting user
    const query = `
SELECT 
  apt_users.id AS id,
  apt_org_members.is_active AS is_active,
  apt_org_members.id AS org_member_id,
  apt_org_members.emp_code as emp_code,
  apt_user_roles.id AS user_role_assignment_id,

  apt_users.user_name,
  apt_users.user_email,
  apt_users.user_phone,
  apt_users.user_image,
  apt_org_members.created_at,

  apt_user_roles.role_id,
  apt_roles.role_name,

  user_shifts.shift_id AS user_shift_id,
  user_shifts.assigned_by_name AS shift_assigned_by_name,

  shifts.shift_name AS user_shift_name,
  shifts.start_time AS user_shift_start_time,
  shifts.end_time AS user_shift_end_time,
  shifts.working_days AS user_shift_working_days,
  shifts.is_night_shift AS is_night_shift,

  user_ip_assignments.assigned_ips AS assigned_ips,

  employee_exit_process.action_type AS exit_process_action_type,
  employee_exit_process.application_status AS exit_process_application_status,

  emp_team.team_id as employee_team_id

FROM apt_org_members

INNER JOIN apt_users 
ON apt_users.id = apt_org_members.user_id

INNER JOIN apt_user_roles
ON apt_user_roles.user_id = apt_users.id
AND apt_user_roles.org_id = apt_org_members.org_id

INNER JOIN apt_roles
ON apt_roles.id = apt_user_roles.role_id
AND apt_roles.org_id = apt_org_members.org_id

LEFT JOIN user_shifts
ON user_shifts.user_id = apt_users.id
AND user_shifts.org_id = apt_org_members.org_id

LEFT JOIN shifts
ON shifts.id = user_shifts.shift_id
AND shifts.org_id = apt_org_members.org_id

LEFT JOIN (
  SELECT
    ia.user_id,
    ia.org_id,

    JSON_ARRAYAGG(
      JSON_OBJECT(
        'ip_id', ia.ip_id,
        'ip_address', ia.ip_address,
        'ip_label', ia.ip_label
      )
    ) AS assigned_ips

  FROM ip_address_assignments ia

  GROUP BY ia.user_id, ia.org_id
) user_ip_assignments

ON user_ip_assignments.user_id = apt_users.id
AND user_ip_assignments.org_id = apt_org_members.org_id

LEFT JOIN employee_exit_process
ON employee_exit_process.employee_id = apt_users.id
AND employee_exit_process.org_id = apt_org_members.org_id

LEFT JOIN team_members emp_team 
ON emp_team.user_id = apt_users.id
AND emp_team.org_id = apt_org_members.org_id

WHERE apt_org_members.org_id = ?
AND apt_users.id <> ?
AND apt_users.id <> ?
`;

    const [result] = await db
      .promise()
      .query(query, [organization_id, organization_owner_id, action_user_id]);

    return res.status(200).json({
      message: "Users fetched successfully",
      users: result,
    });
  } catch (error) {
    console.error("Error fetching users: ", error);
    res.status(500).json({ message: "Error fetching users" });
  }
};

export const update_user_role_controller = async (req, res) => {
  try {
    const { user_id, organization_id, new_role_id } = req.body;
    if (!user_id || !organization_id || !new_role_id) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const action_user = req.user;
    if (
      !action_user ||
      (action_user.user_role_name !== "admin" &&
        action_user.user_role_name !== "hr")
    ) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const action_user_id = action_user.user_id;

    // Transaction Begins ::
    db.beginTransaction((err) => {
      if (err) {
        console.error("Transaction error: ", err);
        return res.status(500).json({ message: "Transaction error" });
      }

      // Check If Organization Is Valid
      const organization_check =
        "SELECT id, owner_id from apt_organizations where id = ?";
      db.query(organization_check, [organization_id], (err, result) => {
        if (err) {
          console.error("Error checking organization exists: ", err);
          return db.rollback(() => {
            return res
              .status(500)
              .json({ message: "Error checking organization exists" });
          });
        }

        if (result.length === 0) {
          return db.rollback(() => {
            return res.status(404).json({ message: "Organization not found" });
          });
        }
        const organization_owner_id = result[0].owner_id;

        // For now no one can't change or update the role of organization owner
        if (organization_owner_id === user_id) {
          return db.rollback(() => {
            return res.status(403).json({
              message:
                "You are not authorized to update the role of organization owner",
            });
          });
        }

        // Check If Action User Is Valid Member Of The Organization
        const action_user_is_member_of_organization_check =
          "SELECT user_id from apt_org_members where user_id = ? and org_id = ?";
        db.query(
          action_user_is_member_of_organization_check,
          [action_user_id, organization_id],
          (err, result) => {
            if (err) {
              console.error(
                "Error checking action user is member of organization: ",
                err,
              );
              return db.rollback(() => {
                return res.status(500).json({
                  message:
                    "Error checking action user is member of organization",
                });
              });
            }

            if (result.length === 0) {
              return db.rollback(() => {
                return res.status(404).json({
                  message: "Action user is not a member of the organization",
                });
              });
            }
            if (result[0].user_id !== action_user_id) {
              return db.rollback(() => {
                return res.status(403).json({
                  message: "You are not authorized to update this user",
                });
              });
            }

            // Check If the user is member of the organization
            const user_is_member_of_organization_check =
              "SELECT user_id from apt_org_members where user_id = ? and org_id = ?";
            db.query(
              user_is_member_of_organization_check,
              [user_id, organization_id],
              (err, result) => {
                if (err) {
                  console.error(
                    "Error checking user is member of organization: ",
                    err,
                  );
                  return db.rollback(() => {
                    return res.status(500).json({
                      message: "Error checking user is member of organization",
                    });
                  });
                }
                if (result.length === 0) {
                  return db.rollback(() => {
                    return res.status(404).json({
                      message: "User is not a member of the organization",
                    });
                  });
                }

                // check if new role id is valid
                const new_role_id_is_valid_check =
                  "SELECT id, role_name from apt_roles where id = ? and org_id = ?";
                db.query(
                  new_role_id_is_valid_check,
                  [new_role_id, organization_id],
                  (err, result) => {
                    if (err) {
                      console.error(
                        "Error checking new role id is valid: ",
                        err,
                      );
                      return db.rollback(() => {
                        return res.status(500).json({
                          message: "Error checking new role id is valid",
                        });
                      });
                    }
                    if (result.length === 0) {
                      return db.rollback(() => {
                        return res
                          .status(404)
                          .json({ message: "New role id is not valid" });
                      });
                    }

                    // if role name is admin so then return an err
                    if (
                      result[0].role_name === "admin" ||
                      result[0].role_name === "Admin"
                    ) {
                      return db.rollback(() => {
                        return res.status(403).json({
                          message:
                            "You are not authorized to update the role of admin",
                        });
                      });
                    }

                    // Assign New Role To The User
                    const assign_new_role_to_user_query =
                      "UPDATE apt_user_roles SET role_id = ? WHERE user_id = ? and org_id = ?";
                    db.query(
                      assign_new_role_to_user_query,
                      [new_role_id, user_id, organization_id],
                      (err, result) => {
                        if (err) {
                          console.error(
                            "Error assigning new role to user: ",
                            err,
                          );
                          return db.rollback(() => {
                            return res.status(500).json({
                              message: "Error assigning new role to user",
                            });
                          });
                        }
                        if (result.affectedRows === 0) {
                          return db.rollback(() => {
                            return res.status(404).json({
                              message: "New role not assigned to user",
                            });
                          });
                        }
                        return db.commit(() => {
                          return res.status(200).json({
                            message: "New role assigned to user successfully",
                          });
                        });
                      },
                    );
                  },
                );
              },
            );
          },
        );
      });
    });
  } catch (error) {
    console.error("Error updating user role: ", error);
    res.status(500).json({ message: "Error updating user role" });
  }
};
//
export const update_user_name_email_phone_password_controller1 = async (
  req,
  res,
) => {
  try {
    const { user_id, name, email, phone, password } = req.body;
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = req.user;
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const admin_id = user.user_id;
    const user_role_name = user.user_role_name;

    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }
    if (user_role_name === "hr") {
      db.beginTransaction((err) => {
        if (err) {
          console.error("Transaction error: ", err);
          return res.status(500).json({ message: "Transaction error" });
        }
        const organization_check =
          "SELECT id from apt_organizations where owner_id = ?";
        db.query(organization_check, [admin_id], (err, result) => {
          if (err) {
            console.error("Error checking organization exists: ", err);
            return db.rollback(() => {
              return res
                .status(500)
                .json({ message: "Error checking organization exists" });
            });
          }
          if (result.length === 0) {
            return db.rollback(() => {
              return res
                .status(404)
                .json({ message: "Organization not found" });
            });
          }
          const organization_id = result[0].id;

          // Check If User Is Member Of The Organization
          const user_is_member_of_organization_check =
            "SELECT user_id from apt_org_members where user_id = ? and org_id = ?";
          db.query(
            user_is_member_of_organization_check,
            [user_id, organization_id],
            (err, result) => {
              if (err) {
                console.error(
                  "Error checking user is member of organization: ",
                  err,
                );
                return db.rollback(() => {
                  return res.status(500).json({
                    message: "Error checking user is member of organization",
                  });
                });
              }
              if (result.length === 0) {
                return db.rollback(() => {
                  return res.status(404).json({
                    message: "User is not a member of the organization",
                  });
                });
              }

              const member_user_id = result[0].user_id;
              if (member_user_id !== user_id) {
                return db.rollback(() => {
                  return res.status(403).json({
                    message: "You are not authorized to update this user",
                  });
                });
              }

              const target_role_query =
                "SELECT apt_roles.role_name as user_role_name FROM apt_user_roles JOIN apt_roles ON apt_roles.id = apt_user_roles.role_id WHERE apt_user_roles.user_id = ?";
              db.query(target_role_query, [member_user_id], (err, result) => {
                if (err) {
                  return db.rollback(() => {
                    return res
                      .status(500)
                      .json({ message: "Error checking target user role" });
                  });
                }
                if (result.length === 0) {
                  return db.rollback(() => {
                    return res
                      .status(404)
                      .json({ message: "User role not found" });
                  });
                }

                const targetRole = result[0].user_role_name;
                if (targetRole === "admin" || targetRole === "hr") {
                  return db.rollback(() => {
                    return res
                      .status(403)
                      .json({ message: "HR cannot update admin or HR users" });
                  });
                }

                // Update If Name Is Provided Or Email Is Provided Or Phone Is Provided Or Password Is Provided
                let fields = [];
                let values = [];

                if (name) {
                  fields.push("user_name = ?");
                  values.push(name);
                }
                if (email) {
                  fields.push("user_email = ?");
                  values.push(email);
                }
                if (phone) {
                  fields.push("user_phone = ?");
                  values.push(phone);
                }
                if (password) {
                  fields.push("user_password = ?");
                  values.push(hashedPassword);
                }

                if (fields.length === 0) {
                  return db.rollback(() => {
                    return res
                      .status(400)
                      .json({ message: "Nothing to update" });
                  });
                }

                const query = `UPDATE apt_users SET ${fields.join(", ")} WHERE id = ?`;
                values.push(user_id);

                db.query(query, values, (err, result) => {
                  if (err) {
                    return db.rollback(() => {
                      return res
                        .status(500)
                        .json({ message: "Error updating user" });
                    });
                  }

                  const save_activity =
                    "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, action_type, old_value, new_value, action_reason, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)";
                  const oldValue = {
                    user_name: user.user_name,
                    user_email: user.user_email,
                    user_phone: user.user_phone,
                  };
                  const newValue = {
                    user_name: name || user.user_name,
                    user_email: email || user.user_email,
                    user_phone: phone || user.user_phone,
                    password_updated: Boolean(password),
                  };

                  db.query(
                    save_activity,
                    [
                      admin_id,
                      user_id,
                      "UPDATE_USER_DETAILS",
                      JSON.stringify(oldValue),
                      JSON.stringify(newValue),
                      "Updated User Details",
                      organization_id,
                    ],
                    (err) => {
                      if (err) {
                        return db.rollback(() => {
                          return res
                            .status(500)
                            .json({ message: "Error saving activity" });
                        });
                      }

                      return db.commit(() => {
                        return res.status(200).json({
                          message: "User updated successfully",
                          affectedRows: result.affectedRows,
                        });
                      });
                    },
                  );
                });
              });
            },
          );
        });
      });
    } else {
      db.beginTransaction((err) => {
        if (err) {
          console.error("Transaction error: ", err);
          return res.status(500).json({ message: "Transaction error" });
        }
        const organization_check =
          "SELECT id from apt_organizations where owner_id = ?";
        db.query(organization_check, [admin_id], (err, result) => {
          if (err) {
            console.error("Error checking organization exists: ", err);
            return db.rollback(() => {
              return res
                .status(500)
                .json({ message: "Error checking organization exists" });
            });
          }
          if (result.length === 0) {
            return db.rollback(() => {
              return res
                .status(404)
                .json({ message: "Organization not found" });
            });
          }
          const organization_id = result[0].id;

          // Check If User Is Valid
          const user_check =
            "SELECT * from apt_users where id = ? and orgID = ?";
          db.query(user_check, [user_id, organization_id], (err, result) => {
            if (err) {
              console.error("Error checking user exists: ", err);
              return db.rollback(() => {
                return res
                  .status(500)
                  .json({ message: "Error checking user exists" });
              });
            }
            if (result.length === 0) {
              return db.rollback(() => {
                return res.status(404).json({ message: "User not found" });
              });
            }
            const user = result[0];
            if (!user) {
              return db.rollback(() => {
                return res.status(404).json({ message: "User not found" });
              });
            }

            // Update If Name Is Provided  Or Email Is Provided Or Phone Is Provided Or Password Is Provided
            let fields = [];
            let values = [];

            if (name) {
              fields.push("user_name = ?");
              values.push(name);
            }
            if (email) {
              fields.push("user_email = ?");
              values.push(email);
            }
            if (phone) {
              fields.push("user_phone = ?");
              values.push(phone);
            }
            if (password) {
              fields.push("user_password = ?");
              values.push(hashedPassword);
            }

            if (fields.length === 0) {
              return db.rollback(() => {
                return res.status(400).json({ message: "Nothing to update" });
              });
            }

            const query = `UPDATE apt_users SET ${fields.join(", ")} WHERE id = ?`;
            values.push(user_id);

            db.query(query, values, (err, result) => {
              if (err) {
                return db.rollback(() => {
                  return res
                    .status(500)
                    .json({ message: "Error updating user" });
                });
              }
              return db.commit(() => {
                return res.status(200).json({
                  message: "User updated successfully",
                  affectedRows: result.affectedRows,
                });
              });
            });
          });
        });
      });
    }
  } catch (error) {
    console.error("Error updating user name email phone password: ", error);
    res
      .status(500)
      .json({ message: "Error updating user name email phone password" });
  }
};

// Update USer Name, Email, Phone, Password ::
export const update_user_name_email_phone_password_controller = async (
  req,
  res,
) => {
  try {
    const { user_id, name, email, phone, password, org_id } = req.body;

    if (!user_id || !org_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = req.user;
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const action_user_id = user.user_id;

    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Transaction Block ::
    db.beginTransaction((err) => {
      if (err) {
        console.error("Transaction error: ", err);
        return db.rollback(() => {
          return res.status(500).json({ message: "Transaction error" });
        });
      }

      // Check If Organization and Admin Is Valid
      const organization_check =
        "SELECT id, owner_id  from apt_organizations where id = ?";
      db.query(organization_check, [org_id], (err, result) => {
        if (err) {
          console.error("Error checking organization exists: ", err);
          return db.rollback(() => {
            return res
              .status(500)
              .json({ message: "Error checking organization exists" });
          });
        }

        if (result.length === 0) {
          return db.rollback(() => {
            return res.status(404).json({ message: "Organization not found" });
          });
        }
        const organization_id = result[0].id;

        const admin_id = result[0].owner_id;

        // Check If User Is Valid Member Of The Organization
        const user_check =
          "SELECT user_id from apt_org_members where user_id = ? and org_id = ?";
        db.query(user_check, [user_id, organization_id], (err, result) => {
          if (err) {
            console.error(
              "Error checking user is member of organization: ",
              err,
            );
            return db.rollback(() => {
              return res.status(500).json({
                message: "Error checking user is member of organization",
              });
            });
          }
          if (result.length === 0) {
            return db.rollback(() => {
              return res
                .status(404)
                .json({ message: "User is not a member of the organization" });
            });
          }
          const member_user_id = result[0].user_id;
          // if (member_user_id !== user_id) {
          //   return db.rollback(() => {
          //     return res.status(403).json({
          //       message: "You are not authorized to update this user",
          //     });
          //   });
          // }

          // Assign Values To Update ::
          let fields = [];
          let values = [];
          if (name) {
            fields.push("user_name = ?");
            values.push(name);
          }
          if (email) {
            fields.push("user_email = ?");
            values.push(email);
          }
          if (phone) {
            fields.push("user_phone = ?");
            values.push(phone);
          }
          if (password) {
            fields.push("user_password = ?");
            values.push(hashedPassword);
          }

          if (fields.length === 0) {
            return db.rollback(() => {
              return res.status(400).json({ message: "Nothing to update" });
            });
          }
          const get_old_user =
            "SELECT user_name, user_email, user_phone FROM apt_users WHERE id = ?";
          const oldValue = get_old_user[0];

          const newValue = {
            user_name: name || oldValue.user_name,
            user_email: email || oldValue.user_email,
            user_phone: phone || oldValue.user_phone,
            password_updated: Boolean(password),
          };
          // HR Cannot Update Admin
          let update_query = `UPDATE apt_users SET ${fields.join(", ")} WHERE id = ? AND id != ?`;

          values.push(user_id);
          values.push(admin_id);

          db.query(update_query, values, (err, result) => {
            if (err) {
              return db.rollback(() => {
                return res.status(500).json({ message: "Error updating user" });
              });
            }
            if (result.affectedRows === 0) {
              return db.rollback(() => {
                return res.status(404).json({
                  message: "Cannot update organization owner or user not found",
                });
              });
            }

            // Save This Whole Activity ::
            const save_activity = `INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, action_type, old_value, new_value, action_reason, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.query(
              save_activity,
              [
                action_user_id,
                user_id,
                "UPDATE_USER_DETAILS",
                JSON.stringify(oldValue),
                JSON.stringify(newValue),
                "Updated User Details",
                organization_id,
              ],
              (err) => {
                if (err) {
                  return db.rollback(() => {
                    return res
                      .status(500)
                      .json({ message: "Error saving activity" });
                  });
                }
                return db.commit(() => {
                  return res.status(200).json({
                    message: "User updated successfully",
                    affectedRows: result.affectedRows,
                  });
                });
              },
            );
          });
        });
      });
    });
  } catch (error) {
    console.log("Error updating user name email phone password: ", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Future Implementaion Note:: HR Can't Delete Admin and Another HR
export const delete_user_controller = async (req, res) => {
  try {
    const { user_id, org_id } = req.body;
    if (!user_id || !org_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = req.user;
    if (
      !user ||
      (user.user_role_name !== "admin" && user.user_role_name !== "hr")
    ) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const action_user_id = user.user_id;
    // Check If Organization and Admin Is Valid
    db.beginTransaction((err) => {
      if (err) {
        console.error("Transaction error: ", err);
        return db.rollback(() => {
          return res.status(500).json({ message: "Transaction error" });
        });
      }
      const organization_check =
        "SELECT id, owner_id from apt_organizations where id = ?";
      db.query(organization_check, [org_id], (err, result) => {
        if (err) {
          console.error("Error checking organization exists: ", err);
          return db.rollback(() => {
            return res
              .status(500)
              .json({ message: "Error checking organization exists" });
          });
        }
        if (result.length === 0) {
          return db.rollback(() => {
            return res.status(404).json({ message: "Organization not found" });
          });
        }
        const organization_id = result[0].id;
        const admin_id = result[0].owner_id;
        // Check If User Is Valid Member Of The Organization
        const user_check =
          "SELECT user_id from apt_org_members where user_id = ? and org_id = ?";
        db.query(user_check, [user_id, organization_id], (err, result) => {
          if (err) {
            console.error(
              "Error checking user is member of organization: ",
              err,
            );
            return db.rollback(() => {
              return res.status(500).json({
                message: "Error checking user is member of organization",
              });
            });
          }
          if (result.length === 0) {
            return db.rollback(() => {
              return res
                .status(404)
                .json({ message: "User is not a member of the organization" });
            });
          }
          // Get All The User Information For Activity Log ::
          const get_user_information =
            "SELECT id, user_name, user_email, user_phone FROM apt_users WHERE id = ?";
          db.query(get_user_information, [user_id], (err, result) => {
            if (err) {
              return db.rollback(() => {
                return res
                  .status(500)
                  .json({ message: "Error getting user information" });
              });
            }
            if (result.length === 0) {
              return db.rollback(() => {
                return res.status(404).json({ message: "User not found" });
              });
            }
            const user_information = result[0];
            // Save This Whole Activity ::
            const save_activity = `INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, action_type, old_value, new_value, action_reason, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.query(
              save_activity,
              [
                action_user_id,
                user_id,
                "DELETE_USER",
                JSON.stringify(user_information),
                JSON.stringify({}),
                "Deleted User",
                organization_id,
              ],
              (err) => {
                if (err) {
                  console.log("Error saving activity: ", err);
                  return db.rollback(() => {
                    return res
                      .status(500)
                      .json({ message: "Error saving activity" });
                  });
                }
                // Delete User
                const delete_user_query =
                  "DELETE from apt_users where id = ? AND id != ?";
                db.query(
                  delete_user_query,
                  [user_id, admin_id],
                  (err, result) => {
                    if (err) {
                      console.error("Error deleting user: ", err);
                      return db.rollback(() => {
                        return res
                          .status(500)
                          .json({ message: "Error deleting user" });
                      });
                    }
                    if (result.affectedRows === 0) {
                      return db.rollback(() => {
                        return res.status(404).json({
                          message:
                            "Cannot delete organization owner or user not found",
                        });
                      });
                    }

                    return db.commit(() => {
                      return res.status(200).json({
                        message: "User deleted successfully",
                        affectedRows: result.affectedRows,
                      });
                    });
                  },
                );
              },
            );
          });
        });
      });
    });
  } catch (error) {
    console.error("Error deleting user: ", error);
    res.status(500).json({ message: "Error deleting user" });
  }
};

// Delete Users :: It Will Handle By Admin Only ::
export const delete_users_controller = async (req, res) => {
  try {
    const { user_ids, organization_id } = req.body; // user_ids = [1, 2, 3]
    const normalizedUserIds = Array.isArray(user_ids)
      ? user_ids.filter((id) => id !== null && id !== undefined && id !== "")
      : [user_ids].filter((id) => id !== null && id !== undefined && id !== "");
    const normalizedOrganizationId = Array.isArray(organization_id)
      ? organization_id[0]
      : organization_id;

    if (normalizedUserIds.length === 0 || !normalizedOrganizationId) {
      return res
        .status(400)
        .json({ message: "User IDs and organization ID are required" });
    }
    const user = req.user;
    if (!user || user.user_role_name !== "admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const hr_id = user.user_id;

    // Check If Organization and HR Is Valid
    db.beginTransaction((err) => {
      if (err) {
        console.error("Transaction error: ", err);
        return db.rollback(() => {
          return res.status(500).json({ message: "Transaction error" });
        });
      }
      // HR Validation Check :: If HR Is Valid Then Only Delete The Users
      const hr_check = "SELECT * from apt_users where id = ? and orgID = ?";
      db.query(hr_check, [hr_id, normalizedOrganizationId], (err, result) => {
        if (err) {
          console.error("Error checking hr exists: ", err);
          return db.rollback(() => {
            return res
              .status(500)
              .json({ message: "Error checking hr exists" });
          });
        }
        if (result.length === 0) {
          return db.rollback(() => {
            return res.status(404).json({ message: "HR not found" });
          });
        }
        const hr = result[0];
        if (!hr) {
          return db.rollback(() => {
            return res.status(404).json({ message: "HR not found" });
          });
        }
        // Check Is HR Is Valid Role :: If Not Then Rollback

        const hr_val =
          "SELECT apt_users.id, apt_roles.role_name as user_role_name FROM apt_users JOIN apt_user_roles ON apt_user_roles.user_id = apt_users.id JOIN apt_roles ON apt_roles.id = apt_user_roles.role_id WHERE apt_users.id = ? AND apt_roles.role_name = 'hr'";
        db.query(hr_val, [hr_id], (err, result) => {
          if (err) {
            console.error("Error checking hr role: ", err);
            return db.rollback(() => {
              return res
                .status(500)
                .json({ message: "Error checking hr role" });
            });
          }
          if (result.length === 0) {
            return db.rollback(() => {
              return res.status(404).json({ message: "HR not found" });
            });
          }
          const hr_role = result[0];
          if (!hr_role) {
            return db.rollback(() => {
              return res.status(404).json({ message: "HR not found" });
            });
          }
          if (hr_role.user_role_name !== "hr") {
            return db.rollback(() => {
              return res.status(403).json({ message: "Unauthorized" });
            });
          }
          // Get Deleting User Details :: name, email, phone, role_id
          const deleting_users_details =
            "SELECT apt_users.id, user_name, user_email, user_phone, apt_user_roles.role_id FROM apt_users JOIN apt_user_roles ON apt_user_roles.user_id = apt_users.id WHERE apt_users.id in (?)";
          db.query(
            deleting_users_details,
            [normalizedUserIds],
            (err, result) => {
              if (err) {
                console.error("Error getting deleting users details: ", err);
                return db.rollback(() => {
                  return res
                    .status(500)
                    .json({ message: "Error getting deleting users details" });
                });
              }
              if (result.length === 0) {
                return db.rollback(() => {
                  return res
                    .status(404)
                    .json({ message: "Deleting users not found" });
                });
              }
              const deleting_users_details = result;

              // Delete Users :: And Save This Whole Activity ::
              const delete_users_query = `DELETE u
FROM apt_users u
JOIN apt_user_roles ur ON ur.user_id = u.id
JOIN apt_roles r ON r.id = ur.role_id
WHERE u.id IN (?) 
AND u.orgID = ?
AND r.role_name NOT IN ('admin', 'hr')`;
              db.query(
                delete_users_query,
                [normalizedUserIds, normalizedOrganizationId],
                (err, result) => {
                  if (err) {
                    console.error("Error deleting users: ", err);
                    return db.rollback(() => {
                      return res
                        .status(500)
                        .json({ message: "Error deleting users" });
                    });
                  }

                  // Save one activity row for each deleted user.
                  const save_activity = `INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, action_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)`;
                  let activityIndex = 0;
                  const saveNextActivity = () => {
                    if (activityIndex >= normalizedUserIds.length) {
                      db.commit((err) => {
                        if (err) {
                          console.error("Error committing transaction: ", err);
                          return db.rollback(() => {
                            return res.status(500).json({
                              message: "Error committing transaction",
                            });
                          });
                        }
                        return res.status(200).json({
                          message: "Users deleted successfully",
                          affectedRows: result.affectedRows,
                        });
                      });
                      return;
                    }

                    const currentUserId = normalizedUserIds[activityIndex];
                    db.query(
                      save_activity,
                      [
                        hr_id,
                        currentUserId,
                        "DELETE_USERS",
                        JSON.stringify(
                          deleting_users_details.find(
                            (userDetail) => userDetail.id === currentUserId,
                          ) || {},
                        ),
                        JSON.stringify({ deleted_user_id: currentUserId }),
                      ],
                      (err) => {
                        if (err) {
                          console.error("Error saving activity: ", err);
                          return db.rollback(() => {
                            return res
                              .status(500)
                              .json({ message: "Error saving activity" });
                          });
                        }
                        activityIndex += 1;
                        saveNextActivity();
                      },
                    );
                  };

                  saveNextActivity();
                },
              );
            },
          );
        });
      });
    });
  } catch (error) {
    console.error("Error deleting users: ", error);
    res.status(500).json({ message: "Error deleting users" });
  }
};

const ADDRESS_TYPE_VALUES = ["current", "permanent"];

const USER_ADDRESS_ACTIVITY_SQL =
  "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";

function isBlankAddressValue(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function normalizeAddressType(value, fieldLabel) {
  if (isBlankAddressValue(value)) {
    return { error: `${fieldLabel} is required` };
  }
  const normalized = String(value).trim().toLowerCase();
  if (!ADDRESS_TYPE_VALUES.includes(normalized)) {
    return {
      error: `${fieldLabel} must be one of: ${ADDRESS_TYPE_VALUES.join(", ")}`,
    };
  }
  return { data: normalized };
}

function validateSingleAddressEntry(raw, indexLabel) {
  const prefix = indexLabel ? `${indexLabel}: ` : "";

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${prefix}address entry must be a valid object` };
  }

  const typeResult = normalizeAddressType(
    raw.address_type,
    `${prefix}address_type`,
  );
  if (typeResult.error) return typeResult;

  const requiredFields = [
    ["country", 100],
    ["state", 100],
    ["district", 100],
    ["city", 100],
    ["street", 255],
    ["house_number", 100],
    ["zip_code", 20],
  ];

  for (const [field, maxLen] of requiredFields) {
    if (isBlankAddressValue(raw[field])) {
      return { error: `${prefix}${field} is required` };
    }
    if (String(raw[field]).trim().length > maxLen) {
      return {
        error: `${prefix}${field} must be at most ${maxLen} characters`,
      };
    }
  }

  const is_from_village =
    raw.is_from_village === true ||
    raw.is_from_village === 1 ||
    String(raw.is_from_village).toLowerCase() === "true";

  let village_name = null;
  if (is_from_village) {
    if (isBlankAddressValue(raw.village_name)) {
      return {
        error: `${prefix}village_name is required when is_from_village is true`,
      };
    }
    village_name = String(raw.village_name).trim();
    if (village_name.length > 255) {
      return {
        error: `${prefix}village_name must be at most 255 characters`,
      };
    }
  } else if (
    raw.village_name !== undefined &&
    raw.village_name !== null &&
    String(raw.village_name).trim() !== ""
  ) {
    village_name = String(raw.village_name).trim();
    if (village_name.length > 255) {
      return {
        error: `${prefix}village_name must be at most 255 characters`,
      };
    }
  }

  return {
    data: {
      address_type: typeResult.data,
      country: String(raw.country).trim(),
      state: String(raw.state).trim(),
      district: String(raw.district).trim(),
      city: String(raw.city).trim(),
      is_from_village,
      village_name,
      street: String(raw.street).trim(),
      house_number: String(raw.house_number).trim(),
      zip_code: String(raw.zip_code).trim(),
    },
  };
}

/**
 * Ensures exactly two addresses with different types:
 * one permanent and one current (field values may be identical).
 */
function validateAddressTypePair(types, contextLabel = "") {
  const prefix = contextLabel ? `${contextLabel}: ` : "";

  if (!Array.isArray(types) || types.length !== 2) {
    return {
      error: `${prefix}Exactly 2 addresses are required (one permanent and one current)`,
    };
  }

  const permanentCount = types.filter((type) => type === "permanent").length;
  const currentCount = types.filter((type) => type === "current").length;

  if (permanentCount === 2) {
    return {
      error: `${prefix}An employee cannot have two permanent addresses. Provide one permanent and one current address.`,
    };
  }

  if (currentCount === 2) {
    return {
      error: `${prefix}An employee cannot have two current addresses. Provide one permanent and one current address.`,
      warning:
        "Duplicate current address is not allowed. Assign one permanent and one current address only.",
    };
  }

  if (permanentCount !== 1 || currentCount !== 1) {
    return {
      error: `${prefix}Address types must be one permanent and one current.`,
    };
  }

  return { data: { permanentCount, currentCount } };
}

/**
 * Validates add-address payload.
 * Rules:
 * - Exactly 2 addresses
 * - One must be `permanent`, one must be `current`
 * - Address field values may be the same; types cannot be the same
 */
function validateAddressInfoPayload(raw) {
  if (!Array.isArray(raw)) {
    return { error: "address_info must be an array of exactly 2 addresses" };
  }
  if (raw.length !== 2) {
    return { error: "address_info must contain exactly 2 addresses" };
  }

  const firstResult = validateSingleAddressEntry(raw[0], "Address 1");
  if (firstResult.error) return firstResult;

  const secondResult = validateSingleAddressEntry(raw[1], "Address 2");
  if (secondResult.error) return secondResult;

  const typeCheck = validateAddressTypePair(
    [firstResult.data.address_type, secondResult.data.address_type],
    "address_info",
  );
  if (typeCheck.error) return typeCheck;

  return {
    data: [firstResult.data, secondResult.data],
  };
}

export const add_user_address_controller = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user || {};
    const org_id = req.org_id;
    const { address_info, employee_id } = req.body;

    if (!action_user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (isBlankAddressValue(org_id)) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    if (isBlankAddressValue(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    const payloadResult = validateAddressInfoPayload(address_info);
    if (payloadResult.error) {
      return res.status(400).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const addressRows = payloadResult.data;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    const [orgResult] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
      [org_id],
    );
    if (!orgResult.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [existingAddresses] = await connection.query(
      `SELECT id, address_type
       FROM user_address
       WHERE user_id = ? AND org_id = ?
       ORDER BY id ASC`,
      [employee_id, org_id],
    );

    if (existingAddresses.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "Employee addresses already exist for this organization. Use update instead.",
      });
    }

    const insertSql = `INSERT INTO user_address (
        user_id,
        org_id,
        address_type,
        country,
        state,
        district,
        city,
        is_from_village,
        village_name,
        street,
        house_number,
        zip_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const savedAddresses = [];

    for (const row of addressRows) {
      const [insertResult] = await connection.query(insertSql, [
        employee_id,
        org_id,
        row.address_type,
        row.country,
        row.state,
        row.district,
        row.city,
        row.is_from_village ? 1 : 0,
        row.village_name,
        row.street,
        row.house_number,
        row.zip_code,
      ]);

      if (!insertResult?.affectedRows) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Failed to save employee address",
        });
      }

      const [createdRows] = await connection.query(
        `SELECT
          id,
          user_id,
          org_id,
          address_type,
          country,
          state,
          district,
          city,
          is_from_village,
          village_name,
          street,
          house_number,
          zip_code
        FROM user_address
        WHERE id = ?
        LIMIT 1`,
        [insertResult.insertId],
      );

      savedAddresses.push(createdRows[0]);
    }

    const activityPayload = {
      employee_id: Number(employee_id),
      org_id: Number(org_id),
      addresses: savedAddresses,
    };

    const [saveActivityResult] = await connection.query(
      USER_ADDRESS_ACTIVITY_SQL,
      [
        action_user_id,
        employee_id,
        org_id,
        "ADD_USER_ADDRESS",
        null,
        JSON.stringify(activityPayload),
        "Employee permanent and current addresses added",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Employee addresses saved successfully",
      data: {
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        addresses: savedAddresses,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("add_user_address_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

function normalizeAddressId(raw, indexLabel) {
  const prefix = indexLabel ? `${indexLabel}: ` : "";
  const addressId = raw?.address_id ?? raw?.id;
  if (isBlankAddressValue(addressId)) {
    return { error: `${prefix}address_id is required` };
  }
  return { data: Number(addressId) };
}

function validateUpdateAddressEntry(raw, indexLabel) {
  const prefix = indexLabel ? `${indexLabel}: ` : "";
  const idResult = normalizeAddressId(raw, indexLabel);
  if (idResult.error) return idResult;

  const fieldResult = validateSingleAddressEntry(raw, indexLabel);
  if (fieldResult.error) return fieldResult;

  return {
    data: {
      address_id: idResult.data,
      ...fieldResult.data,
    },
  };
}

function normalizeAddressUpdatePayload(address_info, address_idBody) {
  if (address_info == null) {
    return { error: "address_info is required" };
  }

  let items;
  if (Array.isArray(address_info)) {
    items = address_info;
  } else if (typeof address_info === "object") {
    if (
      !isBlankAddressValue(address_idBody) &&
      isBlankAddressValue(address_info.address_id) &&
      isBlankAddressValue(address_info.id)
    ) {
      return {
        error:
          "address_info must be an array of exactly 2 addresses for update",
      };
    }
    items = [address_info];
  } else {
    return { error: "address_info must be an object or array" };
  }

  if (items.length !== 2) {
    return { error: "address_info must contain exactly 2 addresses" };
  }

  const normalized = [];
  const seenIds = new Set();

  for (let i = 0; i < items.length; i += 1) {
    const label = `Address ${i + 1}`;
    const result = validateUpdateAddressEntry(items[i], label);
    if (result.error) return result;

    if (seenIds.has(result.data.address_id)) {
      return { error: "Duplicate address_id in address_info" };
    }
    seenIds.add(result.data.address_id);
    normalized.push(result.data);
  }

  const typeCheck = validateAddressTypePair(
    normalized.map((row) => row.address_type),
    "address_info",
  );
  if (typeCheck.error) return typeCheck;

  return { data: normalized };
}

function normalizeStoredAddressType(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase();
}

/**
 * Simulates final address types after updates and enforces:
 * - exactly 2 addresses total
 * - one permanent and one current (types must differ)
 */
function validateProjectedAddressTypes(existingRows, updates) {
  const projected = new Map(
    existingRows.map((row) => [
      Number(row.id),
      normalizeStoredAddressType(row.address_type),
    ]),
  );

  for (const update of updates) {
    projected.set(Number(update.address_id), update.address_type);
  }

  if (projected.size !== 2) {
    return {
      error:
        "Employee must have exactly 2 addresses (one permanent and one current).",
    };
  }

  const typeCheck = validateAddressTypePair([...projected.values()]);
  if (typeCheck.error) {
    return {
      error: typeCheck.error,
      warning: typeCheck.warning ?? undefined,
    };
  }

  return typeCheck;
}

export const update_user_address_controller = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user || {};
    const org_id = req.org_id;
    const { address_info, employee_id, address_id: addressIdBody } = req.body;

    if (!action_user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (isBlankAddressValue(org_id)) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    if (isBlankAddressValue(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    const payloadResult = normalizeAddressUpdatePayload(
      address_info,
      addressIdBody,
    );
    if (payloadResult.error) {
      return res.status(400).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const updates = payloadResult.data;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    const [existingRows] = await connection.query(
      `SELECT
        id,
        user_id,
        org_id,
        address_type,
        country,
        state,
        district,
        city,
        is_from_village,
        village_name,
        street,
        house_number,
        zip_code
      FROM user_address
      WHERE user_id = ? AND org_id = ?
      ORDER BY id ASC
      FOR UPDATE`,
      [employee_id, org_id],
    );

    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No employee addresses found. Use add address first.",
      });
    }

    if (existingRows.length !== 2) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "Employee must have exactly 2 saved addresses before update. Contact support if records are inconsistent.",
      });
    }

    const existingById = new Map(existingRows.map((row) => [Number(row.id), row]));

    for (const update of updates) {
      if (!existingById.has(Number(update.address_id))) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Address ${update.address_id} not found for this employee`,
        });
      }
    }

    const updateIds = new Set(updates.map((row) => Number(row.address_id)));
    for (const row of existingRows) {
      if (!updateIds.has(Number(row.id))) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Both saved addresses must be included in address_info when updating.",
        });
      }
    }

    const projectedValidation = validateProjectedAddressTypes(
      existingRows,
      updates,
    );
    if (projectedValidation.error) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: projectedValidation.error,
        warning: projectedValidation.warning ?? undefined,
      });
    }

    const updateSql = `UPDATE user_address SET
      address_type = ?,
      country = ?,
      state = ?,
      district = ?,
      city = ?,
      is_from_village = ?,
      village_name = ?,
      street = ?,
      house_number = ?,
      zip_code = ?
    WHERE id = ? AND user_id = ? AND org_id = ?`;

    const oldSnapshots = [];
    const updatedAddresses = [];

    for (const update of updates) {
      const existing = existingById.get(Number(update.address_id));

      oldSnapshots.push({
        id: existing.id,
        address_type: existing.address_type,
        country: existing.country,
        state: existing.state,
        district: existing.district,
        city: existing.city,
        is_from_village: existing.is_from_village,
        village_name: existing.village_name,
        street: existing.street,
        house_number: existing.house_number,
        zip_code: existing.zip_code,
      });

      const [updateResult] = await connection.query(updateSql, [
        update.address_type,
        update.country,
        update.state,
        update.district,
        update.city,
        update.is_from_village ? 1 : 0,
        update.village_name,
        update.street,
        update.house_number,
        update.zip_code,
        update.address_id,
        employee_id,
        org_id,
      ]);

      if (!updateResult?.affectedRows) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Failed to update address ${update.address_id}`,
        });
      }

      const [updatedRows] = await connection.query(
        `SELECT
          id,
          user_id,
          org_id,
          address_type,
          country,
          state,
          district,
          city,
          is_from_village,
          village_name,
          street,
          house_number,
          zip_code
        FROM user_address
        WHERE id = ?
        LIMIT 1`,
        [update.address_id],
      );

      updatedAddresses.push(updatedRows[0]);
    }

    const [saveActivityResult] = await connection.query(
      USER_ADDRESS_ACTIVITY_SQL,
      [
        action_user_id,
        employee_id,
        org_id,
        "UPDATE_USER_ADDRESS",
        JSON.stringify(oldSnapshots),
        JSON.stringify(updatedAddresses),
        "Both employee addresses updated",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    const [allAddresses] = await connection.query(
      `SELECT
        id,
        user_id,
        org_id,
        address_type,
        country,
        state,
        district,
        city,
        is_from_village,
        village_name,
        street,
        house_number,
        zip_code
      FROM user_address
      WHERE user_id = ? AND org_id = ?
      ORDER BY id ASC`,
      [employee_id, org_id],
    );

    return res.status(200).json({
      success: true,
      message: "Employee addresses updated successfully",
      data: {
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        updated: updatedAddresses,
        addresses: allAddresses,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("update_user_address_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const get_single_user_address_controller = async (req, res) => {
  try {
    const { user_id, org_id } = req.params;
    const { user_id: action_user_id, user_role_name } = req.user || {};

    if (!user_id || !org_id || !action_user_id) {
      return res.status(400).json({
        message: "user_id and org_id are required",
      });
    }

    const action_user_check = "SELECT user_name from apt_users where id = ?";
    const action_user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    const organization_check = "SELECT * from apt_organizations where id = ?";
    const user_check = "SELECT user_name from apt_users where id = ?";
    const user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    const get_address_query =
      "SELECT * FROM user_address WHERE user_id = ? AND org_id = ? ORDER BY id DESC";

    const [actionUserResult] = await db
      .promise()
      .query(action_user_check, [action_user_id]);
    if (actionUserResult.length === 0) {
      return res.status(404).json({ message: "Action user not found" });
    }

    const [actionMemberResult] = await db
      .promise()
      .query(action_user_member_check, [action_user_id, org_id]);
    if (actionMemberResult.length === 0) {
      return res
        .status(403)
        .json({ message: "Action user is not a member of this organization" });
    }

    const canReadOtherUser =
      user_role_name === "admin" || user_role_name === "hr";
    if (String(action_user_id) !== String(user_id) && !canReadOtherUser) {
      return res
        .status(403)
        .json({ message: "You can only view your own addresses" });
    }

    const [organizationResult] = await db
      .promise()
      .query(organization_check, [org_id]);
    if (organizationResult.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const [userResult] = await db.promise().query(user_check, [user_id]);
    if (userResult.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const [userMemberResult] = await db
      .promise()
      .query(user_member_check, [user_id, org_id]);
    if (userMemberResult.length === 0) {
      return res
        .status(404)
        .json({ message: "User is not a member of this organization" });
    }

    const [addresses] = await db
      .promise()
      .query(get_address_query, [user_id, org_id]);

    return res.status(200).json({
      message: "User addresses fetched successfully",
      data: addresses,
    });
  } catch (error) {
    console.error("Error getting single user address: ", error);
    return res
      .status(500)
      .json({ message: "Error getting single user address" });
  }
};

export const assign_ip_address_to_user_controller = async (req, res) => {
  let connection;
  try {
    const { employee_id, ip_id } = req.body;
    const { org_id } = req;
    const { user_id: action_user_id } = req.user || {};

    // Validate Required Fields
    if (!employee_id || !ip_id) {
      return res.status(400).json({
        message: "employee_id and ip_id are required",
      });
    }

    // Validate Organization & Action User
    if (!action_user_id || !org_id) {
      return res.status(400).json({
        message: "action_user_id and org_id are required",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    // Check If Employee Exists
    const [employeeResult] = await connection.query(
      "SELECT id FROM apt_users WHERE id = ?",
      [employee_id],
    );
    console.log("employeeResult", employeeResult);
    if (employeeResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // Check If Employee Belongs To Organization
    const [employeeMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ? AND is_active = 1",
      [employee_id, org_id],
    );

    if (employeeMemberResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Employee is not a member of this organization",
      });
    }

    // Check If IP Exists In Organization
    const [ipAddressResult] = await connection.query(
      `SELECT id, ip_address, label AS ip_label 
       FROM organization_ips 
       WHERE org_id = ? AND id = ?`,
      [org_id, ip_id],
    );

    if (ipAddressResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "IP address not found",
      });
    }

    const { ip_address, ip_label } = ipAddressResult[0];

    // Check If IP Already Assigned
    const [ipAddressAssignmentResult] = await connection.query(
      `SELECT id 
       FROM ip_address_assignments 
       WHERE user_id = ? AND ip_id = ?`,
      [employee_id, ip_id],
    );

    if (ipAddressAssignmentResult.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "IP address is already assigned to the employee",
      });
    }

    // Assign IP To Employee
    const [assignIpAddressResult] = await connection.query(
      `INSERT INTO ip_address_assignments 
      (user_id, org_id, ip_address, ip_label, ip_id) 
      VALUES (?, ?, ?, ?, ?)`,
      [employee_id, org_id, ip_address, ip_label, ip_id],
    );

    if (!assignIpAddressResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        message: "Failed to assign IP address to employee",
      });
    }

    const save_activity_query =
      "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const [saveActivityResult] = await connection.query(save_activity_query, [
      action_user_id,
      employee_id,
      org_id,
      "ASSIGN_IP_ADDRESS",
      null,
      JSON.stringify({ ip_id, ip_address, ip_label }),
      "IP address assigned to employee",
    ]);

    if (!saveActivityResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "IP address assigned successfully",
      data: {
        assignment_id: assignIpAddressResult.insertId,
        employee_id,
        ip_id,
        ip_address,
        ip_label,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error assigning IP address to user:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const unassign_ip_address_from_user_controller = async (req, res) => {
  let connection;
  try {
    const { employee_id, ip_id } = req.body;
    const { org_id } = req;
    const { user_id: action_user_id } = req.user || {};

    // Validate Required Fields
    if (!employee_id || !ip_id) {
      return res.status(400).json({
        message: "employee_id and ip_id are required",
      });
    }

    // Validate Organization & Action User
    if (!action_user_id || !org_id) {
      return res.status(400).json({
        message: "action_user_id and org_id are required",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    // Check If Employee Exists
    const [employeeResult] = await connection.query(
      "SELECT id FROM apt_users WHERE id = ?",
      [employee_id],
    );

    if (employeeResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // Check If Employee Belongs To Organization
    const [employeeMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [employee_id, org_id],
    );

    if (employeeMemberResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Employee is not a member of this organization",
      });
    }

    // Check If IP Exists In Organization
    const [ipAddressResult] = await connection.query(
      `SELECT id, ip_address, label AS ip_label 
       FROM organization_ips 
       WHERE org_id = ? AND id = ?`,
      [org_id, ip_id],
    );

    if (ipAddressResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "IP address not found",
      });
    }

    // Check assignment exists for this employee, IP, and org
    const [assignmentRows] = await connection.query(
      `SELECT id, ip_address, ip_label 
       FROM ip_address_assignments 
       WHERE user_id = ? AND ip_id = ? AND org_id = ?`,
      [employee_id, ip_id, org_id],
    );

    if (assignmentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "IP address is not assigned to the employee",
      });
    }

    const assignmentRecord = assignmentRows[0];

    const [deleteResult] = await connection.query(
      `DELETE FROM ip_address_assignments 
       WHERE id = ? AND user_id = ? AND org_id = ?`,
      [assignmentRecord.id, employee_id, org_id],
    );

    if (!deleteResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        message: "Failed to unassign IP address from employee",
      });
    }

    const save_activity_query =
      "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const [saveActivityResult] = await connection.query(save_activity_query, [
      action_user_id,
      employee_id,
      org_id,
      "UNASSIGN_IP_ADDRESS",
      JSON.stringify({
        assignment_id: assignmentRecord.id,
        ip_id,
        ip_address: assignmentRecord.ip_address,
        ip_label: assignmentRecord.ip_label,
      }),
      null,
      "IP address unassigned from employee",
    ]);

    if (!saveActivityResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "IP address unassigned successfully",
      data: {
        assignment_id: assignmentRecord.id,
        employee_id,
        ip_id,
        ip_address: assignmentRecord.ip_address,
        ip_label: assignmentRecord.ip_label,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error unassigning IP address from user:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

/** Allowed values for `user_external_info.relation_blood_line` (must match DB ENUM). */
const RELATION_BLOOD_LINE_VALUES = [
  "father",
  "mother",
  "brother",
  "sister",
  "grandfather",
  "grandmother",
  "son",
  "daughter",
  "wife",
  "husband",
];

function normalizeRelationBloodLine(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const s = String(value).trim().toLowerCase();
  return RELATION_BLOOD_LINE_VALUES.includes(s) ? s : null;
}

const EXTERNAL_INFO_ACTIVITY_SQL =
  "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";

const PERSON_ROLE_VALUES = ["hr", "reporting_manager"];

const VERIFICATION_STATUS_VALUES = [
  "pending",
  "in_progress",
  "verified",
  "failed",
  "unable_to_contact",
];

function normalizeVerificationStatus(value) {
  if (isBlankValue(value)) return null;
  const normalized = String(value).trim().toLowerCase();
  return VERIFICATION_STATUS_VALUES.includes(normalized) ? normalized : null;
}

function resolveVerifiedAtForStatus(status) {
  if (
    status === "verified" ||
    status === "failed" ||
    status === "unable_to_contact"
  ) {
    return new Date();
  }
  return null;
}

function isBlankValue(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function normalizeOptionalString(value, maxLen, fieldLabel) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (s.length > maxLen) {
    return {
      error: `${fieldLabel} must be at most ${maxLen} characters`,
    };
  }
  return s;
}

function parseOptionalDate(value, fieldLabel) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { error: `${fieldLabel} must be a valid date` };
  }
  return d.toISOString().slice(0, 10);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

/**
 * Validates one previous-company reference payload from the frontend.
 *
 * Expected shape (single object or array item):
 * {
 *   previous_company_name: string;
 *   company_email?: string;
 *   employee_code?: string;
 *   designation?: string;
 *   employment_start_date?: string;
 *   employment_end_date?: string;
 *   person_name: string;
 *   person_role: "hr" | "reporting_manager";
 *   person_contact_number1: string;
 *   person_contact_number2?: string;
 *   person_contact_email: string;
 * }
 */
function validateBackgroundVerificationInfo(raw, indexLabel = "") {
  const prefix = indexLabel ? `${indexLabel}: ` : "";

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error: `${prefix}background_verification_info must be a valid object`,
    };
  }

  if (isBlankValue(raw.previous_company_name)) {
    return { error: `${prefix}previous_company_name is required` };
  }
  if (isBlankValue(raw.person_name)) {
    return { error: `${prefix}person_name is required` };
  }
  if (isBlankValue(raw.person_role)) {
    return { error: `${prefix}person_role is required` };
  }
  if (isBlankValue(raw.person_contact_number1)) {
    return { error: `${prefix}person_contact_number1 is required` };
  }
  if (isBlankValue(raw.person_contact_email)) {
    return { error: `${prefix}person_contact_email is required` };
  }

  const previous_company_name = String(raw.previous_company_name).trim();
  if (previous_company_name.length > 255) {
    return {
      error: `${prefix}previous_company_name must be at most 255 characters`,
    };
  }

  const person_name = String(raw.person_name).trim();
  if (person_name.length > 250) {
    return {
      error: `${prefix}person_name must be at most 250 characters`,
    };
  }

  const person_role = String(raw.person_role).trim().toLowerCase();
  if (!PERSON_ROLE_VALUES.includes(person_role)) {
    return {
      error: `${prefix}person_role must be one of: ${PERSON_ROLE_VALUES.join(", ")}`,
    };
  }

  const person_contact_number1 = String(raw.person_contact_number1).trim();
  if (person_contact_number1.length > 20) {
    return {
      error: `${prefix}person_contact_number1 must be at most 20 characters`,
    };
  }

  let person_contact_number2 = null;
  if (!isBlankValue(raw.person_contact_number2)) {
    person_contact_number2 = String(raw.person_contact_number2).trim();
    if (person_contact_number2.length > 20) {
      return {
        error: `${prefix}person_contact_number2 must be at most 20 characters`,
      };
    }
  }

  const person_contact_email = String(raw.person_contact_email).trim();
  if (person_contact_email.length > 255) {
    return {
      error: `${prefix}person_contact_email must be at most 255 characters`,
    };
  }
  if (!isValidEmail(person_contact_email)) {
    return {
      error: `${prefix}person_contact_email must be a valid email address`,
    };
  }

  let company_email = null;
  if (!isBlankValue(raw.company_email)) {
    company_email = String(raw.company_email).trim();
    if (company_email.length > 255) {
      return {
        error: `${prefix}company_email must be at most 255 characters`,
      };
    }
    if (!isValidEmail(company_email)) {
      return { error: `${prefix}company_email must be a valid email address` };
    }
  }

  const employee_codeResult = normalizeOptionalString(
    raw.employee_code,
    100,
    `${prefix}employee_code`,
  );
  if (
    employee_codeResult &&
    typeof employee_codeResult === "object" &&
    "error" in employee_codeResult
  ) {
    return employee_codeResult;
  }

  const designationResult = normalizeOptionalString(
    raw.designation,
    150,
    `${prefix}designation`,
  );
  if (
    designationResult &&
    typeof designationResult === "object" &&
    "error" in designationResult
  ) {
    return designationResult;
  }

  const employment_start_date = parseOptionalDate(
    raw.employment_start_date,
    `${prefix}employment_start_date`,
  );
  if (
    employment_start_date &&
    typeof employment_start_date === "object" &&
    "error" in employment_start_date
  ) {
    return employment_start_date;
  }

  const employment_end_date = parseOptionalDate(
    raw.employment_end_date,
    `${prefix}employment_end_date`,
  );
  if (
    employment_end_date &&
    typeof employment_end_date === "object" &&
    "error" in employment_end_date
  ) {
    return employment_end_date;
  }

  if (
    employment_start_date &&
    employment_end_date &&
    employment_end_date < employment_start_date
  ) {
    return {
      error: `${prefix}employment_end_date cannot be before employment_start_date`,
    };
  }

  return {
    data: {
      previous_company_name,
      company_email,
      employee_code: employee_codeResult,
      designation: designationResult,
      employment_start_date,
      employment_end_date,
      person_name,
      person_role,
      person_contact_number1,
      person_contact_number2,
      person_contact_email,
    },
  };
}

function normalizeBackgroundVerificationPayload(raw) {
  if (raw == null) {
    return { error: "background_verification_info is required" };
  }

  const items = Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) {
    return { error: "background_verification_info cannot be empty" };
  }

  const normalized = [];
  for (let i = 0; i < items.length; i += 1) {
    const label = items.length > 1 ? `Record ${i + 1}` : "";
    const result = validateBackgroundVerificationInfo(items[i], label);
    if (result.error) return result;
    normalized.push(result.data);
  }

  return { data: normalized };
}

// User External Information Routes ::

// Add user external information controller ::
export const add_user_external_information_controller = async (req, res) => {
  let connection;
  try {
    const {
      user_id,
      org_id,
      emergency_contact_name,
      emergency_number,
      relation_blood_line,
    } = req.body;
    const { user_id: action_user_id } = req.user || {};

    const isMissing = (v) =>
      v === undefined || v === null || String(v).trim() === "";

    if (!action_user_id) {
      return res.status(400).json({
        success: false,
        message: "action_user_id is required",
      });
    }

    if (isMissing(user_id) || isMissing(org_id)) {
      return res.status(400).json({
        success: false,
        message: "user_id and org_id are required",
      });
    }

    if (
      isMissing(emergency_contact_name) ||
      isMissing(emergency_number) ||
      isMissing(relation_blood_line)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "emergency_contact_name, emergency_number, and relation_blood_line are required",
      });
    }

    const relationNorm = normalizeRelationBloodLine(relation_blood_line);
    if (!relationNorm) {
      return res.status(400).json({
        success: false,
        message: `relation_blood_line must be one of: ${RELATION_BLOOD_LINE_VALUES.join(", ")}`,
      });
    }

    const contactName = String(emergency_contact_name).trim();
    const contactNumber = String(emergency_number).trim();
    if (contactName.length > 150) {
      return res.status(400).json({
        success: false,
        message: "emergency_contact_name must be at most 150 characters",
      });
    }
    if (contactNumber.length > 20) {
      return res.status(400).json({
        success: false,
        message: "emergency_number must be at most 20 characters",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [employeeResult] = await connection.query(
      "SELECT id FROM apt_users WHERE id = ?",
      [user_id],
    );
    if (employeeResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const [employeeMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (employeeMemberResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User is not a member of this organization",
      });
    }

    const [actionMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [action_user_id, org_id],
    );
    if (actionMemberResult.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [orgResult] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (orgResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [existingExternal] = await connection.query(
      "SELECT id FROM user_external_info WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (existingExternal.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "External information already exists for this user in this organization. Use update instead.",
      });
    }

    const [insertResult] = await connection.query(
      `INSERT INTO user_external_info 
        (user_id, org_id, emergency_contact_name, emergency_number, relation_blood_line)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, org_id, contactName, contactNumber, relationNorm],
    );

    if (!insertResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save external information",
      });
    }

    const newPayload = {
      id: insertResult.insertId,
      user_id,
      org_id,
      emergency_contact_name: contactName,
      emergency_number: contactNumber,
      relation_blood_line: relationNorm,
    };

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        user_id,
        org_id,
        "ADD_USER_EXTERNAL_INFO",
        null,
        JSON.stringify(newPayload),
        "User external emergency contact added",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "External information saved successfully",
      data: newPayload,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("add_user_external_information_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Update user external information controller ::
export const update_user_external_information_controller = async (req, res) => {
  let connection;
  try {
    const {
      user_id,
      org_id,
      emergency_contact_name,
      emergency_number,
      relation_blood_line,
    } = req.body;
    const { user_id: action_user_id } = req.user || {};

    const isMissing = (v) =>
      v === undefined || v === null || String(v).trim() === "";

    if (!action_user_id) {
      return res.status(400).json({
        success: false,
        message: "action_user_id is required",
      });
    }

    if (isMissing(user_id) || isMissing(org_id)) {
      return res.status(400).json({
        success: false,
        message: "user_id and org_id are required",
      });
    }

    const patchName =
      emergency_contact_name !== undefined && emergency_contact_name !== null
        ? String(emergency_contact_name).trim()
        : undefined;
    const patchNumber =
      emergency_number !== undefined && emergency_number !== null
        ? String(emergency_number).trim()
        : undefined;
    let patchRelation = undefined;
    if (relation_blood_line !== undefined && relation_blood_line !== null) {
      const r = normalizeRelationBloodLine(relation_blood_line);
      if (!r) {
        return res.status(400).json({
          success: false,
          message: `relation_blood_line must be one of: ${RELATION_BLOOD_LINE_VALUES.join(", ")}`,
        });
      }
      patchRelation = r;
    }

    const hasPatch =
      patchName !== undefined ||
      patchNumber !== undefined ||
      patchRelation !== undefined;

    if (!hasPatch) {
      return res.status(400).json({
        success: false,
        message:
          "Provide at least one of: emergency_contact_name, emergency_number, relation_blood_line",
      });
    }

    if (patchName !== undefined && patchName === "") {
      return res.status(400).json({
        success: false,
        message: "emergency_contact_name cannot be empty when provided",
      });
    }
    if (patchNumber !== undefined && patchNumber === "") {
      return res.status(400).json({
        success: false,
        message: "emergency_number cannot be empty when provided",
      });
    }
    if (patchName !== undefined && patchName.length > 150) {
      return res.status(400).json({
        success: false,
        message: "emergency_contact_name must be at most 150 characters",
      });
    }
    if (patchNumber !== undefined && patchNumber.length > 20) {
      return res.status(400).json({
        success: false,
        message: "emergency_number must be at most 20 characters",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [employeeResult] = await connection.query(
      "SELECT id FROM apt_users WHERE id = ?",
      [user_id],
    );
    if (employeeResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const [employeeMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (employeeMemberResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User is not a member of this organization",
      });
    }

    const [actionMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [action_user_id, org_id],
    );
    if (actionMemberResult.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [orgResult] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (orgResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [existingRows] = await connection.query(
      `SELECT id, user_id, org_id, emergency_contact_name, emergency_number, relation_blood_line
       FROM user_external_info WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message:
          "External information not found for this user and organization",
      });
    }

    const previous = existingRows[0];

    const nextName =
      patchName !== undefined ? patchName : previous.emergency_contact_name;
    const nextNumber =
      patchNumber !== undefined ? patchNumber : previous.emergency_number;
    const nextRelation =
      patchRelation !== undefined
        ? patchRelation
        : previous.relation_blood_line;

    const [updateResult] = await connection.query(
      `UPDATE user_external_info SET
        emergency_contact_name = ?,
        emergency_number = ?,
        relation_blood_line = ?
       WHERE user_id = ? AND org_id = ?`,
      [nextName, nextNumber, nextRelation, user_id, org_id],
    );

    if (!updateResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to update external information",
      });
    }

    const updatedPayload = {
      id: previous.id,
      user_id,
      org_id,
      emergency_contact_name: nextName,
      emergency_number: nextNumber,
      relation_blood_line: nextRelation,
    };

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        user_id,
        org_id,
        "UPDATE_USER_EXTERNAL_INFO",
        JSON.stringify(previous),
        JSON.stringify(updatedPayload),
        "User external emergency contact updated",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "External information updated successfully",
      data: updatedPayload,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("update_user_external_information_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

// Delete user external information controller ::
export const delete_user_external_information_controller = async (req, res) => {
  let connection;
  try {
    const { user_id, org_id } = req.body;
    const { user_id: action_user_id } = req.user || {};

    const isMissing = (v) =>
      v === undefined || v === null || String(v).trim() === "";

    if (!action_user_id) {
      return res.status(400).json({
        success: false,
        message: "action_user_id is required",
      });
    }

    if (isMissing(user_id) || isMissing(org_id)) {
      return res.status(400).json({
        success: false,
        message: "user_id and org_id are required",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [employeeResult] = await connection.query(
      "SELECT id FROM apt_users WHERE id = ?",
      [user_id],
    );
    if (employeeResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const [employeeMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );
    if (employeeMemberResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User is not a member of this organization",
      });
    }

    const [actionMemberResult] = await connection.query(
      "SELECT id FROM apt_org_members WHERE user_id = ? AND org_id = ?",
      [action_user_id, org_id],
    );
    if (actionMemberResult.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [orgResult] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ?",
      [org_id],
    );
    if (orgResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const [existingRows] = await connection.query(
      `SELECT id, user_id, org_id, emergency_contact_name, emergency_number, relation_blood_line
       FROM user_external_info WHERE user_id = ? AND org_id = ?`,
      [user_id, org_id],
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message:
          "External information not found for this user and organization",
      });
    }

    const previous = existingRows[0];

    const [deleteResult] = await connection.query(
      "DELETE FROM user_external_info WHERE user_id = ? AND org_id = ?",
      [user_id, org_id],
    );

    if (!deleteResult.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to delete external information",
      });
    }

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        user_id,
        org_id,
        "DELETE_USER_EXTERNAL_INFO",
        JSON.stringify(previous),
        null,
        "User external emergency contact deleted",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "External information deleted successfully",
      data: { deleted_id: previous.id, user_id, org_id },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("delete_user_external_information_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const get_single_employee_controller = async (req, res) => {
  let connection;

  try {
    const { user_id, org_id: orgIdRaw } = req.query;

    const { user_id: action_user_id } = req.user || {};

    const org_id = Number(orgIdRaw);

    // ---------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------

    if (!action_user_id) {
      return res.status(400).json({
        success: false,
        message: "action_user_id is required",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    if (!Number.isFinite(org_id) || org_id <= 0) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    connection = await pool.promise().getConnection();

    await connection.beginTransaction();

    // ---------------------------------------------------
    // CHECK ACTION USER MEMBERSHIP
    // ---------------------------------------------------

    const [actionMemberResult] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE user_id = ?
        AND org_id = ?
        `,
      [action_user_id, org_id],
    );

    if (actionMemberResult.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // CHECK EMPLOYEE MEMBERSHIP
    // ---------------------------------------------------

    const [employeeMemberResult] = await connection.query(
      `
        SELECT id
        FROM apt_org_members
        WHERE user_id = ?
        AND org_id = ?
        `,
      [user_id, org_id],
    );

    if (employeeMemberResult.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // EMPLOYEE BASIC INFO
    // ---------------------------------------------------

    const [employeeInfo] = await connection.query(
      `
        SELECT
          user.id,
          user.user_name,
          user.user_email,
          user.user_phone,
          user.user_image,
          user.created_at,

          user_external_info.emergency_contact_name,
          user_external_info.emergency_number,
          user_external_info.relation_blood_line,

          employees_bank_info.account_holder_name,
          employees_bank_info.bank_name,
          employees_bank_info.bank_branch,
          employees_bank_info.account_number,
          employees_bank_info.ifsc_code,
          employees_bank_info.uan_number,

          shifts.id AS shift_id,
          shifts.shift_name,
          shifts.start_time,
          shifts.end_time,
          shifts.working_days,
          shifts.is_night_shift,
          om.emp_code as emp_code,

          apt_user_roles.role_id,
          apt_roles.role_name

        FROM apt_users AS user

        INNER JOIN apt_org_members AS om
          ON om.user_id = user.id
          AND om.org_id = ?

        LEFT JOIN apt_user_roles
          ON apt_user_roles.user_id = user.id
          AND apt_user_roles.org_id = ?

        LEFT JOIN apt_roles
          ON apt_roles.id = apt_user_roles.role_id
          AND apt_roles.org_id = ?

        LEFT JOIN user_external_info
          ON user.id = user_external_info.user_id
          AND user_external_info.org_id = ?

        LEFT JOIN employees_bank_info
          ON user.id = employees_bank_info.user_id
          AND employees_bank_info.org_id = ?

        LEFT JOIN user_shifts
          ON user.id = user_shifts.user_id
          AND user_shifts.org_id = ?

        LEFT JOIN shifts
          ON user_shifts.shift_id = shifts.id
          AND shifts.org_id = ?

        WHERE user.id = ?
        LIMIT 1
        `,
      [org_id, org_id, org_id, org_id, org_id, org_id, org_id, user_id],
    );

    if (employeeInfo.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // ---------------------------------------------------
    // EMPLOYEE ADDRESSES
    // ---------------------------------------------------

    const [addresses] = await connection.query(
      `
        SELECT
          id,
          id AS address_id,
          user_id,
          org_id,
          address_type,
          country,
          state,
          district,
          city,
          is_from_village,
          village_name,
          street,
          house_number,
          zip_code
        FROM user_address
        WHERE user_id = ?
        AND org_id = ?
        ORDER BY FIELD(address_type, 'permanent', 'current'), id ASC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // EMPLOYEE DOCUMENTS
    // ---------------------------------------------------

    const [documents] = await connection.query(
      `
      SELECT *
      FROM user_docs
      WHERE user_id = ?
      AND org_id = ?
      ORDER BY created_at DESC
      `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // EMPLOYEE ASSETS
    // ---------------------------------------------------

    const [assets] = await connection.query(
      `
      SELECT *
      FROM employee_assets
      WHERE employee_id = ?
      AND org_id = ?
      ORDER BY created_at DESC
      `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // LEAVE BALANCE
    // ---------------------------------------------------

    const [leaveBalance] = await connection.query(
      `
        SELECT *
        FROM leave_balance
        WHERE user_id = ?
        AND org_id = ?
        ORDER BY year DESC, month DESC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // LEAVE QUERIES
    // ---------------------------------------------------

    const [leaveQueries] = await connection.query(
      `
        SELECT *
        FROM leave_quiry
        WHERE user_id = ?
        AND org_id = ?
        ORDER BY created_at DESC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // ATTENDANCE LOGS
    // ---------------------------------------------------

    const [attendanceLogs] = await connection.query(
      `
        SELECT *
        FROM attendance_logs
        WHERE user_id = ?
        AND org_id = ?
        ORDER BY timestamp_time DESC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // ATTENDANCE RELATED QUERIES
    // ---------------------------------------------------

    const [attendanceQueries] = await connection.query(
      `
        SELECT *
        FROM attendance_related_queries
        WHERE user_id = ?
        AND org_id = ?
        ORDER BY created_at DESC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // IP ASSIGNMENTS
    // ---------------------------------------------------

    const [ipAssignments] = await connection.query(
      `
        SELECT
          ip_address_assignments.*,
          organization_ips.label AS org_ip_label,
          organization_ips.ip_address AS org_ip_address

        FROM ip_address_assignments

        LEFT JOIN organization_ips
          ON ip_address_assignments.ip_id = organization_ips.id

        WHERE ip_address_assignments.user_id = ?
        AND ip_address_assignments.org_id = ?
        ORDER BY ip_address_assignments.created_at DESC
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // FEATURE OVERRIDES
    // ---------------------------------------------------

    const [featureOverrides] = await connection.query(
      `
        SELECT
          aufo.*,
          apt_features.feature_name,
          apt_features.feature_val
        FROM apt_user_feature_overrides aufo
        LEFT JOIN apt_features
          ON apt_features.id = aufo.feature_id
        WHERE aufo.user_id = ?
        AND aufo.org_id = ?
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // EMPLOYEE REFERENCES
    // ---------------------------------------------------

    const [references] = await connection.query(
      `
        SELECT
          er.*,

          ref_user.user_name AS referred_by_name,
          ref_user.user_email AS referred_by_email,
          ref_user.user_phone AS referred_by_phone

        FROM employee_references er

        LEFT JOIN apt_users AS ref_user
          ON er.referred_by_id = ref_user.id

        WHERE er.employee_id = ?
        AND er.org_id = ?
        `,
      [user_id, org_id],
    );

    // ---------------------------------------------------
    // NORMALIZED RESPONSE
    // ---------------------------------------------------

    const normalizedData = {
      user_info: employeeInfo[0],

      addresses: addresses || [],

      documents: documents || [],

      assets: assets || [],

      leave_balance: leaveBalance || [],

      leave_queries: leaveQueries || [],

      attendance_logs: attendanceLogs || [],

      attendance_related_queries: attendanceQueries || [],

      ip_assignments: ipAssignments || [],

      feature_overrides: featureOverrides || [],

      references: references || [],
    };

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Employee details fetched successfully",
      data: normalizedData,
    });
  } catch (error) {
    console.error("get_single_employee_controller:", error);

    if (connection) {
      await connection.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/** Derive Cloudinary `public_id` + resource type from a stored `secure_url`. */
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

// Update my profile image controller ::
export const update_my_profile_image_controller = async (req, res) => {
  let newPublicId = null;
  let newResourceType = "image";
  let oldPublicId = null;
  let oldResourceType = "image";
  let dbUpdated = false;

  try {
    const { user_id } = req.user;
    const { file } = req;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!file || !file.buffer) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded (use multipart field name: file)",
      });
    }

    const [userRows] = await db
      .promise()
      .query(`SELECT id, user_image FROM apt_users WHERE id = ? LIMIT 1`, [
        user_id,
      ]);

    if (!userRows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const existingUrl = userRows[0].user_image;
    const oldMeta = cloudinaryMetaFromStoredUrl(
      existingUrl != null ? String(existingUrl) : "",
    );
    if (oldMeta) {
      oldPublicId = oldMeta.public_id;
      oldResourceType = oldMeta.resource_type || "image";
    }

    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(
        file.buffer,
        "user_profile_images",
        "image",
      );
    } catch (cloudErr) {
      console.error("Profile image Cloudinary upload failed:", cloudErr);
      return res.status(500).json({
        success: false,
        message: cloudErr.message || "Failed to upload image",
      });
    }

    newPublicId = uploadResult.public_id;
    newResourceType = uploadResult.resource_type || "image";
    const newUrl = uploadResult.secure_url;

    const [updateResult] = await db
      .promise()
      .query(`UPDATE apt_users SET user_image = ? WHERE id = ?`, [
        newUrl,
        user_id,
      ]);

    if (!updateResult || updateResult.affectedRows < 1) {
      await destroyFromCloudinary(newPublicId, newResourceType).catch((err) =>
        console.error(
          "Cloudinary rollback after failed profile update:",
          err?.message || err,
        ),
      );
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    dbUpdated = true;

    return res.status(200).json({
      success: true,
      message: "Profile image updated successfully",
      user_image: newUrl,
    });
  } catch (error) {
    console.error("update_my_profile_image_controller:", error);

    if (!dbUpdated && newPublicId) {
      await destroyFromCloudinary(newPublicId, newResourceType).catch((err) =>
        console.error(
          "Cloudinary rollback after profile image error:",
          err?.message || err,
        ),
      );
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (
      dbUpdated &&
      oldPublicId &&
      newPublicId &&
      oldPublicId !== newPublicId
    ) {
      await destroyFromCloudinary(oldPublicId, oldResourceType).catch((err) =>
        console.error(
          "Could not delete previous profile image from Cloudinary:",
          err?.message || err,
        ),
      );
    }
  }
};

// User Reference Controller ::
export const create_user_background_verification_controller = async (
  req,
  res,
) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user || {};
    const org_id = req.org_id;
    const { employee_id, background_verification_info } = req.body;

    if (!action_user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (isBlankValue(org_id)) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    if (isBlankValue(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    const payloadResult = normalizeBackgroundVerificationPayload(
      background_verification_info,
    );
    if (payloadResult.error) {
      return res.status(400).json({
        success: false,
        message: payloadResult.error,
      });
    }

    const referenceRows = payloadResult.data;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [orgResult] = await connection.query(
      "SELECT id FROM apt_organizations WHERE id = ? LIMIT 1",
      [org_id],
    );
    if (!orgResult.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const insertSql = `INSERT INTO previous_company_references (
        employee_id,
        org_id,
        previous_company_name,
        company_email,
        employee_code,
        designation,
        employment_start_date,
        employment_end_date,
        person_name,
        person_role,
        person_contact_number1,
        person_contact_number2,
        person_contact_email,
        verification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`;

    const savedReferences = [];

    for (const row of referenceRows) {
      const [insertResult] = await connection.query(insertSql, [
        employee_id,
        org_id,
        row.previous_company_name,
        row.company_email,
        row.employee_code,
        row.designation,
        row.employment_start_date,
        row.employment_end_date,
        row.person_name,
        row.person_role,
        row.person_contact_number1,
        row.person_contact_number2,
        row.person_contact_email,
      ]);

      if (!insertResult?.affectedRows) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Failed to save previous company reference",
        });
      }

      const [createdRows] = await connection.query(
        `SELECT
          id,
          employee_id,
          org_id,
          previous_company_name,
          company_email,
          employee_code,
          designation,
          employment_start_date,
          employment_end_date,
          person_name,
          person_role,
          person_contact_number1,
          person_contact_number2,
          person_contact_email,
          verification_status,
          verification_notes,
          verification_by_id,
          verification_by_name,
          verified_at,
          created_at,
          updated_at
        FROM previous_company_references
        WHERE id = ?
        LIMIT 1`,
        [insertResult.insertId],
      );

      savedReferences.push(createdRows[0]);
    }

    const activityPayload = {
      employee_id: Number(employee_id),
      org_id: Number(org_id),
      references: savedReferences,
    };

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        employee_id,
        org_id,
        "ADD_PREVIOUS_COMPANY_REFERENCE",
        null,
        JSON.stringify(activityPayload),
        savedReferences.length === 1
          ? "Previous company reference added for background verification"
          : `${savedReferences.length} previous company references added for background verification`,
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message:
        savedReferences.length === 1
          ? "Previous company reference saved successfully"
          : `${savedReferences.length} previous company references saved successfully`,
      data: {
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        references: savedReferences,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("create_user_background_verification_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const update_user_reference_controller = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user || {};
    const org_id = req.org_id;
    const {
      employee_id,
      reference_id: referenceIdBody,
      id: referenceIdAlt,
      background_verification_info,
    } = req.body;
    const reference_id = referenceIdBody ?? referenceIdAlt;

    if (!action_user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (isBlankValue(org_id)) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    if (isBlankValue(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    if (isBlankValue(reference_id)) {
      return res.status(400).json({
        success: false,
        message: "reference_id is required",
      });
    }

    if (background_verification_info == null) {
      return res.status(400).json({
        success: false,
        message: "background_verification_info is required",
      });
    }

    const validationResult = validateBackgroundVerificationInfo(
      background_verification_info,
    );
    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: validationResult.error,
      });
    }

    const patch = validationResult.data;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [existingRows] = await connection.query(
      `SELECT
        id,
        employee_id,
        org_id,
        previous_company_name,
        company_email,
        employee_code,
        designation,
        employment_start_date,
        employment_end_date,
        person_name,
        person_role,
        person_contact_number1,
        person_contact_number2,
        person_contact_email,
        verification_status,
        verification_notes,
        verification_by_id,
        verification_by_name,
        verified_at,
        created_at,
        updated_at
      FROM previous_company_references
      WHERE id = ? AND employee_id = ? AND org_id = ?
      LIMIT 1`,
      [reference_id, employee_id, org_id],
    );

    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Previous company reference not found for this employee",
      });
    }

    const existing = existingRows[0];

    const [updateResult] = await connection.query(
      `UPDATE previous_company_references SET
        previous_company_name = ?,
        company_email = ?,
        employee_code = ?,
        designation = ?,
        employment_start_date = ?,
        employment_end_date = ?,
        person_name = ?,
        person_role = ?,
        person_contact_number1 = ?,
        person_contact_number2 = ?,
        person_contact_email = ?
      WHERE id = ? AND employee_id = ? AND org_id = ?`,
      [
        patch.previous_company_name,
        patch.company_email,
        patch.employee_code,
        patch.designation,
        patch.employment_start_date,
        patch.employment_end_date,
        patch.person_name,
        patch.person_role,
        patch.person_contact_number1,
        patch.person_contact_number2,
        patch.person_contact_email,
        reference_id,
        employee_id,
        org_id,
      ],
    );

    if (!updateResult?.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to update previous company reference",
      });
    }

    const [updatedRows] = await connection.query(
      `SELECT
        id,
        employee_id,
        org_id,
        previous_company_name,
        company_email,
        employee_code,
        designation,
        employment_start_date,
        employment_end_date,
        person_name,
        person_role,
        person_contact_number1,
        person_contact_number2,
        person_contact_email,
        verification_status,
        verification_notes,
        verification_by_id,
        verification_by_name,
        verified_at,
        created_at,
        updated_at
      FROM previous_company_references
      WHERE id = ?
      LIMIT 1`,
      [reference_id],
    );

    const updatedReference = updatedRows[0];

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        employee_id,
        org_id,
        "UPDATE_PREVIOUS_COMPANY_REFERENCE",
        JSON.stringify(existing),
        JSON.stringify(updatedReference),
        "Previous company reference updated",
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Previous company reference updated successfully",
      data: {
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        reference: updatedReference,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("update_user_reference_controller:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const update_employee_background_verification_status_controller = async (
  req,
  res,
) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user || {};
    const org_id = req.org_id;
    const { employee_id, verification_info } = req.body;

    if (!action_user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (isBlankValue(org_id)) {
      return res.status(400).json({
        success: false,
        message: "org_id is required",
      });
    }

    if (isBlankValue(employee_id)) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    if (
      verification_info == null ||
      typeof verification_info !== "object" ||
      Array.isArray(verification_info)
    ) {
      return res.status(400).json({
        success: false,
        message: "verification_info is required",
      });
    }

    const verification_id =
      verification_info.verification_id ?? verification_info.reference_id;

    if (isBlankValue(verification_id)) {
      return res.status(400).json({
        success: false,
        message: "verification_info.verification_id is required",
      });
    }

    const nextStatus = normalizeVerificationStatus(
      verification_info.verification_status,
    );
    if (!nextStatus) {
      return res.status(400).json({
        success: false,
        message: `verification_info.verification_status must be one of: ${VERIFICATION_STATUS_VALUES.join(", ")}`,
      });
    }

    let verification_notes = null;
    if (
      verification_info.verification_notes !== undefined &&
      verification_info.verification_notes !== null
    ) {
      verification_notes = String(verification_info.verification_notes).trim();
      if (verification_notes === "") {
        verification_notes = null;
      }
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found in this organization",
      });
    }

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Action user is not a member of this organization",
      });
    }

    const [actionUserRows] = await connection.query(
      `SELECT id, user_name FROM apt_users WHERE id = ? LIMIT 1`,
      [action_user_id],
    );
    if (!actionUserRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Action user not found",
      });
    }

    const verification_by_id = Number(action_user_id);
    const verification_by_name =
      actionUserRows[0].user_name != null &&
      String(actionUserRows[0].user_name).trim() !== ""
        ? String(actionUserRows[0].user_name).trim()
        : null;

    const [existingRows] = await connection.query(
      `SELECT
        id,
        employee_id,
        org_id,
        previous_company_name,
        verification_status,
        verification_notes,
        verification_by_id,
        verification_by_name,
        verified_at,
        created_at,
        updated_at
      FROM previous_company_references
      WHERE id = ? AND employee_id = ? AND org_id = ?
      LIMIT 1`,
      [verification_id, employee_id, org_id],
    );

    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Previous company reference not found for this employee",
      });
    }

    const existing = existingRows[0];
    const currentStatus = normalizeVerificationStatus(
      existing.verification_status,
    );

    if (currentStatus === nextStatus) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `Verification status is already set to ${nextStatus}`,
      });
    }

    const verified_at = resolveVerifiedAtForStatus(nextStatus);

    const [updateResult] = await connection.query(
      `UPDATE previous_company_references SET
        verification_status = ?,
        verification_notes = ?,
        verification_by_id = ?,
        verification_by_name = ?,
        verified_at = ?
      WHERE id = ? AND employee_id = ? AND org_id = ?`,
      [
        nextStatus,
        verification_notes,
        verification_by_id,
        verification_by_name,
        verified_at,
        verification_id,
        employee_id,
        org_id,
      ],
    );

    if (!updateResult?.affectedRows) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to update verification status",
      });
    }

    const [updatedRows] = await connection.query(
      `SELECT
        id,
        employee_id,
        org_id,
        previous_company_name,
        company_email,
        employee_code,
        designation,
        employment_start_date,
        employment_end_date,
        person_name,
        person_role,
        person_contact_number1,
        person_contact_number2,
        person_contact_email,
        verification_status,
        verification_notes,
        verification_by_id,
        verification_by_name,
        verified_at,
        created_at,
        updated_at
      FROM previous_company_references
      WHERE id = ?
      LIMIT 1`,
      [verification_id],
    );

    const updatedReference = updatedRows[0];

    const [saveActivityResult] = await connection.query(
      EXTERNAL_INFO_ACTIVITY_SQL,
      [
        action_user_id,
        employee_id,
        org_id,
        "UPDATE_PREVIOUS_COMPANY_VERIFICATION_STATUS",
        JSON.stringify({
          id: existing.id,
          verification_status: currentStatus,
          verification_notes: existing.verification_notes,
          verification_by_id: existing.verification_by_id,
          verification_by_name: existing.verification_by_name,
          verified_at: existing.verified_at,
        }),
        JSON.stringify({
          id: updatedReference.id,
          verification_status: updatedReference.verification_status,
          verification_notes: updatedReference.verification_notes,
          verification_by_id: updatedReference.verification_by_id,
          verification_by_name: updatedReference.verification_by_name,
          verified_at: updatedReference.verified_at,
        }),
        `Verification status changed from ${currentStatus} to ${nextStatus}`,
      ],
    );

    if (!saveActivityResult || saveActivityResult.affectedRows < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed to save activity log",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Verification status updated successfully",
      data: {
        employee_id: Number(employee_id),
        org_id: Number(org_id),
        reference: updatedReference,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(
      "update_employee_background_verification_status_controller:",
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const get_all_user_references_controller = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const {
      status,
      limit,
      joining_date,
      employee_name,
      previous_company_name,
      person_role,
      is_ascending,
      employee_id,
    } = req.query;
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Action user not found",
      });
    }

    let query = `
    SELECT pcr.*,
    employee.user_name as employee_name,
    verificator.user_name as verificator_name,
    membership_info.created_at as member_since
    FROM previous_company_references as pcr
    LEFT JOIN apt_users as employee
      ON pcr.employee_id = employee.id
    LEFT JOIN apt_users as verificator
      ON pcr.verification_by_id = verificator.id
    LEFT JOIN apt_org_members as membership_info
      ON employee.id = membership_info.user_id
      AND membership_info.org_id = pcr.org_id
    WHERE pcr.org_id = ?
    `;
    const params = [org_id];

    if (status) {
      const normalizedStatus = normalizeVerificationStatus(status);
      if (!normalizedStatus) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${VERIFICATION_STATUS_VALUES.join(", ")}`,
        });
      }
      query += ` AND pcr.verification_status = ?`;
      params.push(normalizedStatus);
    }

    if (person_role) {
      const normalizedRole = String(person_role).trim().toLowerCase();
      if (!PERSON_ROLE_VALUES.includes(normalizedRole)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `person_role must be one of: ${PERSON_ROLE_VALUES.join(", ")}`,
        });
      }
      query += ` AND pcr.person_role = ?`;
      params.push(normalizedRole);
    }

    if (employee_name && String(employee_name).trim()) {
      query += ` AND employee.user_name LIKE ?`;
      params.push(`%${String(employee_name).trim()}%`);
    }

    if (previous_company_name && String(previous_company_name).trim()) {
      query += ` AND pcr.previous_company_name LIKE ?`;
      params.push(`%${String(previous_company_name).trim()}%`);
    }

    if (employee_id && String(employee_id).trim()) {
      query += ` AND pcr.employee_id = ?`;
      params.push(Number(employee_id));
    }

    if (joining_date) {
      query += ` AND DATE(membership_info.created_at) = ?`;
      params.push(joining_date);
    }

    const sortDir =
      String(is_ascending || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    query += ` ORDER BY pcr.created_at ${sortDir}`;

    if (limit) {
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
      query += ` LIMIT ?`;
      params.push(parsedLimit);
    }

    const [results] = await connection.query(query, params);
    await connection.commit();

    const groupedMap = new Map();

    for (const row of results) {
      const empId = Number(row.employee_id);
      if (!Number.isFinite(empId)) continue;

      if (!groupedMap.has(empId)) {
        groupedMap.set(empId, {
          id: empId,
          employee_id: empId,
          org_id: row.org_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          employee_name: row.employee_name ?? null,
          member_since: row.member_since ?? null,
          references: [],
        });
      }

      const group = groupedMap.get(empId);

      if (
        row.created_at &&
        (!group.created_at || new Date(row.created_at) < new Date(group.created_at))
      ) {
        group.created_at = row.created_at;
      }
      if (
        row.updated_at &&
        (!group.updated_at || new Date(row.updated_at) > new Date(group.updated_at))
      ) {
        group.updated_at = row.updated_at;
      }

      group.references.push({
        id: row.id,
        previous_company_name: row.previous_company_name,
        company_email: row.company_email ?? null,
        employee_code: row.employee_code ?? null,
        designation: row.designation ?? null,
        employment_start_date: row.employment_start_date ?? null,
        employment_end_date: row.employment_end_date ?? null,
        person_name: row.person_name,
        person_role: row.person_role,
        person_contact_number1: row.person_contact_number1,
        person_contact_number2: row.person_contact_number2 ?? null,
        person_contact_email: row.person_contact_email,
        verification_status: row.verification_status,
        verification_notes: row.verification_notes ?? null,
        verification_by_id: row.verification_by_id ?? null,
        verification_by_name: row.verification_by_name ?? null,
        verified_at: row.verified_at ?? null,
        verificator_name: row.verificator_name ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }

    const groupedData = Array.from(groupedMap.values()).map((group) => ({
      ...group,
      total_references_count: group.references.length,
    }));

    groupedData.sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return sortDir === "ASC" ? aTime - bTime : bTime - aTime;
    });

    return res.status(200).json({
      success: true,
      message: groupedData.length
        ? "References fetched successfully"
        : "No references found",
      data: groupedData,
    });
  } catch (error) {
    console.error("get_all_user_references_controller:", error);
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};

export const get_single_user_reference_controller = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user;
    const { org_id } = req;
    const { employee_id, reference_id } = req.params;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Action user not found",
      });
    }

    if (!(await isEmployeeExists(connection, employee_id, org_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const query = `
    SELECT pcr.*,
    employee.user_name as employee_name,
    employee.user_email as employee_email,
    employee.user_phone as employee_phone,
    employee.created_at as employee_joining_date,
    employee.user_image as employee_image,
    employee.id as employee_id,
    verificator.user_name as verificator_name,
    verificator.user_email as verificator_email,
    verificator.user_phone as verificator_phone,
    verificator.created_at as verificator_joining_date,
    verificator.user_image as verificator_image,
    verificator.id as verificator_id,
    membership_info.created_at as member_since
    FROM previous_company_references as pcr
    LEFT JOIN apt_users as employee
      ON pcr.employee_id = employee.id
    LEFT JOIN apt_users as verificator
      ON pcr.verification_by_id = verificator.id
    LEFT JOIN apt_org_members as membership_info
      ON employee.id = membership_info.user_id
      AND membership_info.org_id = pcr.org_id
    WHERE pcr.org_id = ?
    AND pcr.employee_id = ?
    AND pcr.id = ?
    `;
    const params = [org_id, employee_id, reference_id];
    const [results] = await connection.query(query, params);

    if (!results.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Reference not found",
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Reference fetched successfully",
      data: results[0],
    });
  } catch (error) {
    console.error("get_single_user_reference_controller:", error);
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (connection) connection.release();
  }
};