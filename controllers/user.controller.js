import db from "../db/connect.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

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
    
    const admin_id = user.user_id; 

    // Fetch Organization From apt_org_members
    const fetch_organization_query = "SELECT org_id FROM apt_org_members WHERE user_id = ?";
    const [organization_result] = await db.promise().query(fetch_organization_query, [admin_id]);
    if (organization_result.length === 0) {
      return res.status(404).json({ message: "Organization not found" });
    }
    const organization_id = organization_result[0].org_id;

      // If User Role Name Is HR Then Fetch All The Users Of The Organization Except Admin & HR
      let query = `
  SELECT 
    apt_users.id AS id,
    apt_org_members.id AS org_member_id,
    apt_user_roles.id AS user_role_assignment_id,
    apt_users.user_name,
    apt_users.user_email,
    apt_users.user_phone,
    apt_org_members.created_at,

    apt_user_roles.role_id,
    apt_roles.role_name,

    user_shifts.shift_id as user_shift_id,
    user_shifts.assigned_by_name as shift_assigned_by_name,


    shifts.shift_name as user_shift_name,
    shifts.start_time as user_shift_start_time,
    shifts.end_time as user_shift_end_time,
    shifts.working_days as user_shift_working_days,
    shifts.is_night_shift as is_night_shift

  FROM apt_org_members 
  INNER JOIN apt_users 
    ON apt_users.id = apt_org_members.user_id
  INNER JOIN apt_user_roles
    ON apt_user_roles.user_id = apt_users.id AND apt_user_roles.org_id = apt_org_members.org_id
  INNER JOIN apt_roles
    ON apt_roles.id = apt_user_roles.role_id AND apt_roles.org_id = apt_org_members.org_id
  LEFT JOIN user_shifts
    ON user_shifts.user_id = apt_users.id AND user_shifts.org_id = apt_org_members.org_id
  LEFT JOIN shifts
    ON shifts.id = user_shifts.shift_id AND shifts.org_id = apt_org_members.org_id
  WHERE apt_org_members.org_id = ?
`;

      db.query(query, [organization_id], (err, result) => {
        if (err) {
          console.error("Error fetching users: ", err);
          return res.status(500).json({ message: "Error fetching users" });
        }

        return res.status(200).json({
          message: "Users fetched successfully",
          users: result,
          
        });
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
