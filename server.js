import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import db from "./db/connect.js";
import authRoutes from "./routes/authRoutes.js";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use("/api/auth", authRoutes);

// User CRUD Operations Routes :: It Will Be Used By Admin Only And HR
app.use("/api/user", userRoutes);


app.listen(3000, () => {
  db.connect();
  console.log("Server is running on port 3000");
});
