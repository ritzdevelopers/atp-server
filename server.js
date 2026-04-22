import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import db from "./db/connect.js";
import authRoutes from "./routes/admin.auth.routes.js";
import userRoutes from "./routes/admin.controlled.routes.js";
import organizationRoutes from "./routes/organization.route.js";
import userRolesRoutes from "./routes/user.roles.route.js";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});


// Authentication Routes
app.use("/api/auth", authRoutes);

// User CRUD Operations Routes :: It Will Be Used By Admin Only And HR
app.use("/api/user", userRoutes);

// Organization Routes :: It Will Be Used By Admin Only
app.use("/api/organization", organizationRoutes);

// User Roles Routes :: It Will Be Used By Admin Only
app.use("/api/user-roles", userRolesRoutes);


app.listen(3000, () => {
  db.connect();
  console.log("Server is running on port 3000");
});