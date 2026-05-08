import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();

function buildConnectionConfig() {
  const rawHost = process.env.DB_HOST ?? "";

  const explicitPort =
    process.env.DB_PORT != null &&
    String(process.env.DB_PORT).trim() !== ""
      ? Number(process.env.DB_PORT)
      : null;

  const defaultPort = explicitPort ?? 3306;

  if (rawHost.startsWith("mysql://")) {
    const u = new URL(rawHost.replace(/^mysql:\/\//, "http://"));

    const dbFromPath = u.pathname.replace(/^\//, "").split("/")[0];

    return {
      host: u.hostname,
      port: explicitPort ?? (u.port ? Number(u.port) : defaultPort),

      user:
        process.env.DB_USER ||
        decodeURIComponent(u.username || ""),

      password:
        process.env.DB_PASSWORD ||
        decodeURIComponent(u.password || ""),

      database:
        process.env.DB_NAME || dbFromPath,

      ssl: {
        rejectUnauthorized: false,
      },
    };
  }

  return {
    host: rawHost,
    port: defaultPort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,

    ssl: {
      rejectUnauthorized: false,
    },
  };
}

const connectionConfig = buildConnectionConfig();

console.log(connectionConfig);

const db = mysql.createConnection(connectionConfig);

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