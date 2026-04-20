import db from "../db/connect.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const user_register_controller = async (req, res) => {
  try {
    const { name, email, password, phone, user_role_id, organization_id } =
      req.body;

    if (!name || !email || !password || !phone || !user_role_id) {
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
          const fetch_org_id = "SELECT id FROM apt_organizations WHERE id = ?";
          db.query(fetch_org_id, [organization_id], (err, result) => {
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
            const query =
              "INSERT INTO apt_users (user_name, user_email, user_password, user_phone, orgId) VALUES (?, ?, ?, ?, ?)";
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
                "INSERT INTO apt_user_roles (user_id, role_id) VALUES (?, ?)";

              db.query(
                register_user_role_query,
                [user_id, user_role_id],
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
                  db.commit((err) => {
                    if (err) {
                      console.error("Error committing transaction: ", err);
                      return db.rollback(() => {
                        return res
                          .status(500)
                          .json({ message: "Error committing transaction" });
                      });
                    }
                    return res.status(201).json({
                      message: "User registered successfully",
                    });
                  });
                },
              );
            });
          });
        } else {
          // Case :: 2 -> Organization ID is not provided
          const query =
            "INSERT INTO apt_users (user_name, user_email, user_password, user_phone, orgId) VALUES (?, ?, ?, ?, ?)";
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

            const user_id = result.insertId;

            const register_user_role_query =
              "INSERT INTO apt_user_roles (user_id, role_id) VALUES (?, ?)";

            db.query(
              register_user_role_query,
              [user_id, user_role_id],
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
                db.commit((err) => {
                  if (err) {
                    console.error("Error committing transaction: ", err);
                    return db.rollback(() => {
                      return res
                        .status(500)
                        .json({ message: "Error committing transaction" });
                    });
                  }
                  return res.status(201).json({
                    message: "User registered successfully",
                  });
                });
              },
            );
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

    db.query(check_user_exists_query, [email], async (err, result) => {
      if (err) {
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
      db.query(fetch_user_role_query, [user.id], (err, result) => {
        if (err) {
          console.error("Error fetching user role: ", err);
          return res.status(500).json({ message: "Error fetching user role" });
        }

        if (result.length === 0) {
          return res.status(404).json({ message: "User role not found" });
        }

        const user_role = result[0];
        const user_role_id = user_role.role_id;

        // Fetch User Role Name
        const fetch_user_role_name_query =
          "SELECT * FROM apt_roles WHERE id = ?";
        db.query(fetch_user_role_name_query, [user_role_id], (err, result) => {
          if (err) {
            console.error("Error fetching user role name: ", err);
            return res
              .status(500)
              .json({ message: "Error fetching user role name" });
          }
          if (result.length === 0) {
            return res
              .status(404)
              .json({ message: "User role name not found" });
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
        });
      });
    });
  } catch (error) {
    console.error("Error logging in user: ", error);
    res.status(500).json({ message: "Error logging in user" });
  }
};

export const admin_get_me_controller = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    return res.status(200).json({ message: "User fetched successfully", user });
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
    if (user.user_role_name !== "admin") {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const admin_id = user.user_role_id;

    // Fetch Organization ID Using admin_id
    const fetch_organization_id_query =
      "SELECT * from apt_organizations where owner_id = ?";

    db.query(fetch_organization_id_query, [admin_id], (err, result) => {
      if (err) {
        console.error("Error fetching organization id: ", err);
        return res
          .status(500)
          .json({ message: "Error fetching organization id" });
      }
      if (result.length === 0) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const organization_id = result[0].id;

      // Fetch All Users Using Organization ID

      const fetch_all_users_query = "SELECT * from apt_users where orgId = ?";
      db.query(fetch_all_users_query, [organization_id], (err, result) => {
        if (err) {
          console.error("Error fetching all users: ", err);
          return res.status(500).json({ message: "Error fetching all users" });
        }
        if (result.length === 0) {
          return res.status(404).json({ message: "Users not found" });
        }
       
        // I want to send all the users with their roles 
        console.log(result);
      });
    });
  } catch (error) {
    console.error("Error fetching users: ", error);
    res.status(500).json({ message: "Error fetching users" });
  }
};

// const user_for_token = {
//     user_id: user.id,
//     user_email: user.user_email,
//     user_role_id: user_role_id,
//     user_role_name: user_role_name,
//   };
