import { getSocketIo } from "../sockets/io.instance.js";

export function emitAttendanceLiveUpdate(payload) {
  const io = getSocketIo();
  if (!io || !payload?.org_id) return false;

  const enriched = {
    ...payload,
    emitted_at: new Date().toISOString(),
  };

  io.to(`org:${payload.org_id}`).emit("attendance_live_update", enriched);
  return true;
}
