import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/admin.auth.routes.js";
import userRoutes from "./routes/admin.controlled.routes.js";
import userRolesRoutes from "./routes/user.roles.route.js";
import registrationRoutes from "./routes/registration.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import organizationSettingsRoutes from "./routes/organization.settings.routes.js";
import employeesRoutes from "./routes/employees.routes.js";
import organizationFeaturesRoutes from "./routes/organization.features.routes.js";
import superAdminRoutes from "./routes/super-admin.routes.js";
import attendanceHistoryRoutes from "./routes/attendance.history.routes.js";
import employeeDocumentsRoutes from "./routes/employee.documents.routes.js";
import employeeAssetsRoutes from "./routes/employee.assets.routes.js";
import employeeReferencesRoutes from "./routes/employee.references.routes.js";
import bankInfoRoutes from "./routes/bank.info.routes.js";
import orgTeamsRoutes from "./routes/org.teams.route.js";
import employeeExitRoutes from "./routes/employee.exit.routes.js";
import tasksRoutes from "./routes/tasks.route.js";
import leaveManagementRoutes from "./routes/leave.management.routes.js";
import employeeSalaryRoutes from "./routes/employee.salary.routes.js";
import { ensureLeaveQuirySchema } from "./db/ensureLeaveQuirySchema.js";
import subFeatureRoutes from "./routes/super_admin/route.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import taskManagemenRoutes from "./routes/tasks/taskManagement.route.js";
import chatApplicationRoutes from "./routes/chats/chats.route.js";
import biometricRoutes from "./routes/biometric.routes.js";
import mapUsersRoutes from "./routes/map.users.routes.js";
import { Server } from "socket.io";
import { createServer } from "http";
import { register_socket_io } from "./sockets/socker.io.js";
import { setSocketIo } from "./sockets/io.instance.js";
import connectMongo from "./db/connect_mongo.js";
import { ensureBiometricSchema } from "./db/ensureBiometricSchema.js";
import { startBiometricPoller } from "./services/biometric/biometricPoller.js";
import { getInAppBiometricSyncDecision } from "./config/biometricSyncGate.js";
import { isCloudDeployment } from "./services/biometric/localBiometricBridge.js";

import biometricSyncAgentRoutes from "./routes/biometric/biometric.routes.js";
import "./helper/auto_leave_assign.js";
import { startRegularizationAgent } from "./jobs/regularization.agent.js";
import { syncAgent } from "./jobs/sync.agent.js";
import syncEslRoutes from "./routes/sync/sync.attendance.routes.js";
import employeeLeaveManagementRoutes from "./routes/employee.leave.management.routes.js";
import regularizationRoutes from "./routes/regularization/regularization.routes.js";
import compOffManagementRoutes from "./routes/comp-off-management/comp-off-management.routes.js";
dotenv.config();

const app = express();
const socket_server = createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://atp-client.vercel.app",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "https://generalisable-ada-saturated.ngrok-free.dev"
];
const io = new Server(socket_server, {
  cors: {
    origin: allowedOrigins,
  },
});
register_socket_io(io);
setSocketIo(io);


app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (no Origin header) and explicitly allowed web origins.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json());

app.get("/", (req, res) => {
  res.redirect("http://localhost:3001");
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

// Attendance History Routes
app.use("/api/attendance-history", attendanceHistoryRoutes);

// Super Admin Handled Routes ::
app.use("/api/super-admin", superAdminRoutes);

// Cloud Routes ::
app.use("/api/employee-documents", employeeDocumentsRoutes);

// Employee assets (hardware / access assignments)
app.use("/api/employee-assets", employeeAssetsRoutes);

// Employee references (referrer per employee — UNIQUE employee_id + org_id)
app.use("/api/employee-references", employeeReferencesRoutes);

// Employee bank details (UNIQUE user_id + org_id)
app.use("/api/employee-bank-info", bankInfoRoutes);

// Organization teams (create, members, listing)
app.use("/api/org-teams", orgTeamsRoutes);

// Employee exit / offboarding workflows
app.use("/api/employee-exit", employeeExitRoutes);

app.use("/api/tasks-management", tasksRoutes);

// Leave Management Routes
app.use("/api/leave-management", leaveManagementRoutes);
app.use("/api/employee-leave-management", employeeLeaveManagementRoutes);

// Employee salary
app.use("/api/employee-salary", employeeSalaryRoutes);

// Sub Feature Routes
app.use("/api/sub-features", subFeatureRoutes);

// Employees Tasks Routes ::
app.use("/api/task-management", taskManagemenRoutes);

// Dashboard management (assign management/employee dashboard per employee)
app.use("/api/dashboard-management", dashboardRoutes);


// Chat Application Routes ::
app.use("/api/chat-application", chatApplicationRoutes);

// Biometric attendance sync
app.use("/api/biometric", biometricRoutes);

// Biometric attendance sync agent routes
app.use("/api/biometric-sync-agent", biometricSyncAgentRoutes);

// Map Users 
app.use("/api/map-users", mapUsersRoutes);

app.use("/api/sync-esl", syncEslRoutes);

// Regularization Routes
app.use("/api/regularization", regularizationRoutes);

// Comp Off Management Routes ::
app.use("/api/comp-off-management", compOffManagementRoutes);

socket_server.listen(3000, async () => {
  try {
    await ensureLeaveQuirySchema();
    await connectMongo();
    await ensureBiometricSchema();
    const syncDecision = getInAppBiometricSyncDecision();
    if (syncDecision.allowed) {
      if (syncDecision.mode === "direct" && !isCloudDeployment()) {
        startBiometricPoller();
      }
      syncAgent();
      console.log(
        `[startup] biometric sync: ${syncDecision.mode === "bridge" ? "local bridge" : "direct SQL"}`,
      );
    } else {
      console.log(`[startup] biometric sync skipped: ${syncDecision.reason}`);
    }
    startRegularizationAgent();
  } catch (err) {
    console.error("[startup] schema/migration failed:", err.message);
  }
  console.log("Server is running on port 3000");
});
