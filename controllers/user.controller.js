import db, { pool } from "../db/connect.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import uploadToCloudinary, {
  destroyFromCloudinary,
} from "../config/cloudinary.js";

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
          if (
            !user ||
            (user.user_role_name !== "admin" && user.user_role_name !== "hr")
          ) {
            return res.status(401).json({ message: "Unauthorized" });
          }
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

    const {user_id: action_user_id} = user;
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

    // Fetch All Users Of The Organization Except Organization Owner
    const query = `
SELECT 
  apt_users.id AS id,
  apt_org_members.is_active AS is_active,
  apt_org_members.id AS org_member_id,
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
AND apt_users.id != ?
`;

    const [result] = await db.promise().query(query, [organization_id, organization_owner_id]);

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

export const add_user_address_controller = async (req, res) => {
  let connection;
  try {
    const {
      address_id,
      user_id,
      org_id,
      country,
      state,
      district,
      city,
      is_from_village,
      village_name,
      street,
      house_number,
      zip_code,
    } = req.body;
    const { user_id: action_user_id } = req.user || {};
    const isMissing = (value) =>
      value === undefined || value === null || String(value).trim() === "";
    const normalizedIsFromVillage =
      is_from_village === true ||
      is_from_village === 1 ||
      String(is_from_village).toLowerCase() === "true" ||
      String(is_from_village) === "1"
        ? 1
        : 0;

    // All Fields Are Required
    if (
      isMissing(user_id) ||
      isMissing(org_id) ||
      isMissing(country) ||
      isMissing(state) ||
      isMissing(district) ||
      isMissing(city) ||
      isMissing(is_from_village) ||
      (normalizedIsFromVillage === 1 && isMissing(village_name)) ||
      isMissing(street) ||
      isMissing(house_number) ||
      isMissing(zip_code)
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check If Action User Is Valid
    const action_user_check = "SELECT user_name from apt_users where id = ?";
    // Check If Action User Is Valid Member Of The Organization
    const action_user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    // Check Organization Is Valid
    const organization_check = "SELECT * from apt_organizations where id = ?";
    // Check If User Is Valid
    const user_check = "SELECT user_name from apt_users where id = ?";
    // Check If User Is Valid Member Of The Organization
    const user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    // Save Address In User Address Table -> user_address
    const save_address_query =
      "INSERT INTO user_address (user_id, org_id, country, state, district, city, is_from_village, village_name, street, house_number, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    // Save Activity In User Activity Logs Table -> apt_user_activity_logs
    const save_activity_query =
      "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";

    // Start Transaction ::
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [actionUserResult] = await connection.query(action_user_check, [
      action_user_id,
    ]);
    if (actionUserResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Action user not found" });
    }
    const action_user_name = actionUserResult[0].user_name;

    const [actionMemberResult] = await connection.query(
      action_user_member_check,
      [action_user_id, org_id],
    );
    if (actionMemberResult.length === 0) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "Action user is not a member of this organization" });
    }

    const [organizationResult] = await connection.query(organization_check, [
      org_id,
    ]);
    if (organizationResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [userResult] = await connection.query(user_check, [user_id]);
    if (userResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    const affected_user_name = userResult[0].user_name;

    const [userMemberResult] = await connection.query(user_member_check, [
      user_id,
      org_id,
    ]);
    if (userMemberResult.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "User is not a member of this organization" });
    }

    const normalizedVillageName =
      normalizedIsFromVillage === 1 ? String(village_name).trim() : null;

    const addressPayload = {
      user_id,
      org_id,
      country,
      state,
      district,
      city,
      is_from_village: normalizedIsFromVillage,
      village_name: normalizedVillageName,
      street,
      house_number,
      zip_code,
    };

    const [addressResult] = await connection.query(save_address_query, [
      user_id,
      org_id,
      country,
      state,
      district,
      city,
      normalizedIsFromVillage,
      normalizedVillageName,
      street,
      house_number,
      zip_code,
    ]);

    await connection.query(save_activity_query, [
      action_user_id,
      user_id,
      org_id,
      "ADD_USER_ADDRESS",
      null,
      JSON.stringify(addressPayload),
      `Address added for ${affected_user_name} by ${action_user_name}`,
    ]);

    await connection.commit();

    return res.status(201).json({
      message: "User address added successfully",
      data: {
        id: addressResult.insertId,
        ...addressPayload,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error adding user address: ", error);
    return res.status(500).json({ message: "Error adding user address" });
  } finally {
    if (connection) connection.release();
  }
};

export const update_user_address_controller = async (req, res) => {
  let connection;
  try {
    const {
      user_id,
      org_id,
      country,
      state,
      district,
      city,
      is_from_village,
      village_name,
      street,
      house_number,
      zip_code,
      address_id,
    } = req.body;
    const { user_id: action_user_id } = req.user || {};
    const isProvided = (value) => value !== undefined;
    const isMissing = (value) =>
      value === undefined || value === null || String(value).trim() === "";

    if (isMissing(user_id) || isMissing(org_id) || isMissing(address_id)) {
      return res
        .status(400)
        .json({ message: "address_id, user_id and org_id are required" });
    }

    const patchFields = {
      country,
      state,
      district,
      city,
      is_from_village,
      village_name,
      street,
      house_number,
      zip_code,
    };

    if (!Object.values(patchFields).some(isProvided)) {
      return res.status(400).json({
        message: "Provide at least one address field to update",
      });
    }

    // Check If Action User Is Valid
    const action_user_check = "SELECT user_name from apt_users where id = ?";
    // Check If Action User Is Valid Member Of The Organization
    const action_user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    // Check Organization Is Valid
    const organization_check = "SELECT * from apt_organizations where id = ?";
    // Check If User Is Valid
    const user_check = "SELECT user_name from apt_users where id = ?";
    // Check If User Is Valid Member Of The Organization
    const user_member_check =
      "SELECT * from apt_org_members where user_id = ? and org_id = ?";
    // Get Existing Address From User Address Table -> user_address
    const get_address_query =
      "SELECT * FROM user_address WHERE user_id = ? AND org_id = ? AND id = ? FOR UPDATE";
    // Update Address In User Address Table -> user_address
    const update_address_query = (sets) =>
      `UPDATE user_address SET ${sets.join(", ")} WHERE user_id = ? AND org_id = ? AND id = ?`;
    // Save Activity In User Activity Logs Table -> apt_user_activity_logs
    const save_activity_query =
      "INSERT INTO apt_user_activity_logs (performed_by, affected_user_id, org_id, action_type, old_value, new_value, action_reason) VALUES (?, ?, ?, ?, ?, ?, ?)";

    // Start Transaction ::
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const [actionUserResult] = await connection.query(action_user_check, [
      action_user_id,
    ]);
    if (actionUserResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Action user not found" });
    }
    const action_user_name = actionUserResult[0].user_name;

    const [actionMemberResult] = await connection.query(
      action_user_member_check,
      [action_user_id, org_id],
    );
    if (actionMemberResult.length === 0) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "Action user is not a member of this organization" });
    }

    const [organizationResult] = await connection.query(organization_check, [
      org_id,
    ]);
    if (organizationResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Organization not found" });
    }

    const [userResult] = await connection.query(user_check, [user_id]);
    if (userResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    const affected_user_name = userResult[0].user_name;

    const [userMemberResult] = await connection.query(user_member_check, [
      user_id,
      org_id,
    ]);
    if (userMemberResult.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "User is not a member of this organization" });
    }

    const [addressRows] = await connection.query(get_address_query, [
      user_id,
      org_id,
      address_id,
    ]);
    if (addressRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User address not found" });
    }
    const oldAddress = addressRows[0];

    const nextIsFromVillage = isProvided(is_from_village)
      ? is_from_village === true ||
        is_from_village === 1 ||
        String(is_from_village).toLowerCase() === "true" ||
        String(is_from_village) === "1"
        ? 1
        : 0
      : Number(oldAddress.is_from_village) === 1
        ? 1
        : 0;

    const nextVillageName =
      nextIsFromVillage === 1
        ? isProvided(village_name)
          ? String(village_name).trim()
          : oldAddress.village_name
        : null;

    if (nextIsFromVillage === 1 && isMissing(nextVillageName)) {
      await connection.rollback();
      return res.status(400).json({
        message: "village_name is required when is_from_village is true",
      });
    }

    const sets = [];
    const values = [];
    const changedPayload = {};

    const addUpdate = (column, value) => {
      sets.push(`${column} = ?`);
      values.push(value);
      changedPayload[column] = value;
    };

    if (isProvided(country)) addUpdate("country", country);
    if (isProvided(state)) addUpdate("state", state);
    if (isProvided(district)) addUpdate("district", district);
    if (isProvided(city)) addUpdate("city", city);
    if (isProvided(is_from_village)) {
      addUpdate("is_from_village", nextIsFromVillage);
      addUpdate("village_name", nextVillageName);
    } else if (isProvided(village_name)) {
      addUpdate("village_name", nextVillageName);
    }
    if (isProvided(street)) addUpdate("street", street);
    if (isProvided(house_number)) addUpdate("house_number", house_number);
    if (isProvided(zip_code)) addUpdate("zip_code", zip_code);

    if (sets.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "Provide at least one address field to update",
      });
    }

    values.push(user_id, org_id, address_id);
    const [updateResult] = await connection.query(
      update_address_query(sets),
      values,
    );
    if (!updateResult.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "User address not found" });
    }

    await connection.query(save_activity_query, [
      action_user_id,
      user_id,
      org_id,
      "UPDATE_USER_ADDRESS",
      JSON.stringify(oldAddress),
      JSON.stringify(changedPayload),
      `Address updated for ${affected_user_name} by ${action_user_name}`,
    ]);

    await connection.commit();

    return res.status(200).json({
      message: "User address updated successfully",
      data: {
        user_id,
        org_id,
        address_id,
        ...changedPayload,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error updating user address: ", error);
    return res.status(500).json({ message: "Error updating user address" });
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
        message: "External information not found for this user and organization",
      });
    }

    const previous = existingRows[0];

    const nextName =
      patchName !== undefined ? patchName : previous.emergency_contact_name;
    const nextNumber =
      patchNumber !== undefined ? patchNumber : previous.emergency_number;
    const nextRelation =
      patchRelation !== undefined ? patchRelation : previous.relation_blood_line;

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
        message: "External information not found for this user and organization",
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

export const get_single_employee_controller = async (
  req,
  res,
) => {
  let connection;

  try {
    const { user_id, org_id: orgIdRaw } = req.query;

    const {
      user_id: action_user_id,
    } = req.user || {};

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

    const [actionMemberResult] =
      await connection.query(
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
        message:
          "Action user is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // CHECK EMPLOYEE MEMBERSHIP
    // ---------------------------------------------------

    const [employeeMemberResult] =
      await connection.query(
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
        message:
          "Employee is not a member of this organization",
      });
    }

    // ---------------------------------------------------
    // EMPLOYEE BASIC INFO
    // ---------------------------------------------------

    const [employeeInfo] =
      await connection.query(
        `
        SELECT
          user.id,
          user.user_name,
          user.user_email,
          user.user_phone,
          user.user_image,
          user.created_at,

          user_address.id AS address_id,
          user_address.country,
          user_address.state,
          user_address.district,
          user_address.city,
          user_address.is_from_village,
          user_address.village_name,
          user_address.street,
          user_address.house_number,
          user_address.zip_code,

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

        LEFT JOIN user_address
          ON user.id = user_address.user_id
          AND user_address.org_id = ?

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
        [
          org_id,
          org_id,
          org_id,
          org_id,
          org_id,
          org_id,
          org_id,
          org_id,
          user_id,
        ],
      );

    if (employeeInfo.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

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

    const [leaveBalance] =
      await connection.query(
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

    const [leaveQueries] =
      await connection.query(
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

    const [attendanceLogs] =
      await connection.query(
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

    const [attendanceQueries] =
      await connection.query(
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

    const [ipAssignments] =
      await connection.query(
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

    const [featureOverrides] =
      await connection.query(
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

    const [references] =
      await connection.query(
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
      message:
        "Employee details fetched successfully",
      data: normalizedData,
    });
  } catch (error) {
    console.error(
      "get_single_employee_controller:",
      error,
    );

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
export const create_user_reference_controller = async (req, res) => { }
export const update_user_reference_controller = async (req, res) => { } 
export const get_all_user_references_controller = async (req, res) => { }
export const get_single_user_reference_controller = async (req, res) => { }