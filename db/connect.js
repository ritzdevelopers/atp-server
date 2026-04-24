import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();
console.log("db host", process.env.DB_HOST);
console.log("db user", process.env.DB_USER);
console.log("db password", process.env.DB_PASSWORD);
console.log("db name", process.env.DB_NAME);

const connectionConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
};

/** Single connection — used by existing controllers (e.g. callback transactions). */
const db = mysql.createConnection(connectionConfig);

/**
 * Pool for `await pool.promise().getConnection()` — required for proper transaction
 * isolation; do not use `db.promise()` for multi-statement transactions.
 */
export const pool = mysql.createPool({
  ...connectionConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to database: ", err);
  } else {
    console.log("Connected to database ✅");
  }
});

export default db;
