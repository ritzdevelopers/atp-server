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

const sharedMysqlOptions = {
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
};

function isRecoverableConnectionError(err) {
  if (!err) return false;
  const code = err.code;
  return (
    err.fatal === true ||
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR" ||
    code === "EPIPE"
  );
}

function attachPoolConnectionErrorHandler(connection) {
  connection.on("error", (err) => {
    console.error(
      "[mysql pool] connection error:",
      err.code || err.errno,
      err.message,
    );
  });
}

export const pool = mysql.createPool({
  ...connectionConfig,
  ...sharedMysqlOptions,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 25),
  // queueLimit 0 = unlimited queue (requests hang forever when pool is full).
  queueLimit: Number(process.env.DB_POOL_QUEUE_LIMIT || 50),
});

pool.on("connection", (connection) => {
  attachPoolConnectionErrorHandler(connection);
});

pool.on("error", (err) => {
  console.error("[mysql pool] pool error:", err.code || err.errno, err.message);
});


let underlyingConn = null;
let reconnectTimer = null;

function connectUnderlying(callback) {
  underlyingConn.connect((err) => {
    if (err) {
      console.error("[mysql] connect error:", err.message);
    } else {
      // console.log("Connected to database ✅");
    }
    if (typeof callback === "function") callback(err);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log("[mysql] reconnecting…");
    const previous = underlyingConn;
    try {
      previous?.destroy();
    } catch {
      /* ignore */
    }
    try {
      underlyingConn = createUnderlyingConnection();
      connectUnderlying((err) => {
        if (err) scheduleReconnect();
      });
    } catch (e) {
      console.error("[mysql] reconnect setup failed:", e.message);
      scheduleReconnect();
    }
  }, 2000);
}

function createUnderlyingConnection() {
  const conn = mysql.createConnection({
    ...connectionConfig,
    ...sharedMysqlOptions,
  });

  conn.on("error", (err) => {
    console.error(
      "[mysql] connection error:",
      err.code || err.errno,
      err.message,
    );
    if (isRecoverableConnectionError(err)) {
      scheduleReconnect();
    }
  });

  return conn;
}

underlyingConn = createUnderlyingConnection();
connectUnderlying();

/** Stable export; delegates to the current connection and survives reconnects. */
const db = new Proxy(
  {},
  {
    get(_target, prop) {
      const conn = underlyingConn;
      if (!conn) return undefined;
      const value = conn[prop];
      if (typeof value === "function") {
        return (...args) => value.apply(conn, args);
      }
      return value;
    },
  },
);

export default db;
