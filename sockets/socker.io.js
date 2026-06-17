import { register_private_chat_events } from "../events/private.chat.events.js";

export const register_socket_io = (io) => {
  io.on("connection", (socket) => { 
    register_private_chat_events(io, socket);
    socket.on("disconnect", () => {
      console.log("Socket Io Disconnected", socket.id);
    });
  });
};
