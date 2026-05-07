import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import db from "./db/connect.js";
import authRoutes from "./routes/admin.auth.routes.js";
import userRoutes from "./routes/admin.controlled.routes.js"; 
import userRolesRoutes from "./routes/user.roles.route.js";
import registrationRoutes from "./routes/registration.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import organizationSettingsRoutes from "./routes/organization.settings.routes.js";
import employeesRoutes from "./routes/employees.routes.js";
import organizationFeaturesRoutes from "./routes/organization.features.routes.js";
import superAdminRoutes from "./routes/super-admin.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

// Register User First Time ::
app.use("/api/register", registrationRoutes);

// Authentication Routes
app.use("/api/auth", authRoutes);



// User CRUD Operations Routes :: It Will Be Used By Admin Only And HR
app.use("/api/user", userRoutes);

// User Roles Routes :: It Will Be Used By Admin Only
app.use("/api/user-roles", userRolesRoutes);

// Feature Access Controllers Routes ::
app.use("/api/organization-features", organizationFeaturesRoutes);

// Attendance Routes
app.use("/api/attendance", attendanceRoutes);

// Organization Settings Routes
app.use("/api/organization-settings", organizationSettingsRoutes);

// Employees Routes
app.use("/api/employees", employeesRoutes);


// Super Admin Handled Routes ::
app.use("/api/super-admin", superAdminRoutes);

app.listen(3000, () => {
  db.connect();
  console.log("Server is running on port 3000");
});