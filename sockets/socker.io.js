import {
  register_private_chat_events,
  register_group_chat_events,
} from "../events/private.chat.events.js";
import UserActiveStatus from "../models/user_active_status.schema.js";

/** org_id -> user_id -> Set<socket_id> */
const onlineSocketsByOrg = new Map();

function addUserSocket(org_id, user_id, socketId) {
  const orgKey = String(org_id);
  const userKey = Number(user_id);

  if (!onlineSocketsByOrg.has(orgKey)) {
    onlineSocketsByOrg.set(orgKey, new Map());
  }

  const userMap = onlineSocketsByOrg.get(orgKey);
  if (!userMap.has(userKey)) {
    userMap.set(userKey, new Set());
  }

  const sockets = userMap.get(userKey);
  const wasOnline = sockets.size > 0;
  sockets.add(socketId);
  return !wasOnline;
}

function removeUserSocket(org_id, user_id, socketId) {
  const orgKey = String(org_id);
  const userKey = Number(user_id);
  const userMap = onlineSocketsByOrg.get(orgKey);
  if (!userMap) return true;

  const sockets = userMap.get(userKey);
  if (!sockets) return true;

  sockets.delete(socketId);
  if (sockets.size === 0) {
    userMap.delete(userKey);
    return true;
  }
  return false;
}

function getOnlineUserIds(org_id) {
  const userMap = onlineSocketsByOrg.get(String(org_id));
  if (!userMap) return [];
  return Array.from(userMap.keys());
}

async function saveLastActiveTime(user_id, org_id) {
  return UserActiveStatus.findOneAndUpdate(
    { user_id, org_id },
    { last_active_time: Date.now() },
    { upsert: true, returnDocument: "after" },
  );
}

export const register_socket_io = (io) => {
  io.on("connection", (socket) => {
    /*********************** Private Chat Events *******************/
    register_private_chat_events(io, socket);
    register_group_chat_events(io, socket);

    /*********************** User Active Status Events *******************/
    socket.on("user_active_status", (user_id, org_id) => {
      if (!user_id || !org_id) return;

      socket.data.user_id = user_id;
      socket.data.org_id = org_id;
      socket.join(`org:${org_id}`);

      const becameOnline = addUserSocket(org_id, user_id, socket.id);
      if (becameOnline) {
        io.to(`org:${org_id}`).emit("user_status_update", {
          user_id: Number(user_id),
          is_online: true,
        });
      }
    });

    socket.on("user_inactive_status", async (user_id, org_id) => {
      if (!user_id || !org_id) return;

      const wentOffline = removeUserSocket(org_id, user_id, socket.id);
      if (!wentOffline) return;

      const updated = await saveLastActiveTime(user_id, org_id);
      io.to(`org:${org_id}`).emit("user_status_update", {
        user_id: Number(user_id),
        is_online: false,
        last_active_time: updated?.last_active_time ?? new Date(),
      });
    });

    socket.on("get_all_active_users", async (user_id, org_id) => {
      if (!user_id || !org_id) return;

      socket.join(`org:${org_id}`);

      const onlineUserIds = new Set(getOnlineUserIds(org_id));
      const offlineRecords = await UserActiveStatus.find({ org_id });

      const payload = [];

      for (const uid of onlineUserIds) {
        payload.push({ user_id: uid, is_online: true });
      }

      for (const record of offlineRecords) {
        if (!onlineUserIds.has(record.user_id)) {
          payload.push({
            user_id: record.user_id,
            is_online: false,
            last_active_time: record.last_active_time,
          });
        }
      }

      socket.emit("all_active_users", payload);
    });

    /*********************** Disconnect Event *******************/
    socket.on("disconnect", async () => {
      const { user_id, org_id } = socket.data;
      if (user_id && org_id) {
        const wentOffline = removeUserSocket(org_id, user_id, socket.id);
        if (wentOffline) {
          const updated = await saveLastActiveTime(user_id, org_id);
          io.to(`org:${org_id}`).emit("user_status_update", {
            user_id: Number(user_id),
            is_online: false,
            last_active_time: updated?.last_active_time ?? new Date(),
          });
        }
      }
      console.log("Socket Io Disconnected", socket.id);
    });
  });
};
