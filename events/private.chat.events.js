import { send_private_message_controller } from "../controllers/chats/sockets/private.chat.controller.js";
    
export const register_private_chat_events = (io, socket) => {
  socket.on("join_user_room", (userId) => {
    if (userId == null || userId === "") return;
    socket.join(String(userId));
  });

  socket.on("send_private_message", async (data) => {
    await send_private_message_controller(io, socket, data);
  });
};