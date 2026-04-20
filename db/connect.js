import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();
console.log("db host", process.env.DB_HOST);
console.log("db user", process.env.DB_USER);
console.log("db password", process.env.DB_PASSWORD);
console.log("db name", process.env.DB_NAME);
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to database: ", err);
  } else {
    console.log("Connected to database ✅");
  }
});

export default db;