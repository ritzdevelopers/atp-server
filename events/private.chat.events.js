import {
  get_all_messages_controller,
  get_single_chat_history_controller,
  send_private_message_controller,
} from "../controllers/chats/sockets/private.chat.controller.js";
import { seen_private_message_controller } from "../controllers/chats/sockets/seen_private_message.controller.js";

export const register_private_chat_events = (io, socket) => {
  socket.on("join_user_room", (userId) => {
    if (userId == null || userId === "") return;
    socket.join(`user:${userId}`);
  });

  socket.on("join_chat_room", (chat_id, user_id) => {
    if (!chat_id || !user_id) return;
    socket.data.user_id = user_id;
    if (socket.data.current_chat_id) {
      socket.leave(`chat:${socket.data.current_chat_id}`);
    }
    socket.data.current_chat_id = chat_id;
    socket.join(`chat:${chat_id}`);
  });

  socket.on("leave_chat_room", (chat_id) => {
    if (!chat_id) return;
    socket.leave(`chat:${chat_id}`);
    if (socket.data.current_chat_id === chat_id) {
      socket.data.current_chat_id = null;
    }
  });

  socket.on("send_private_message", async (data) => {
    await send_private_message_controller(io, socket, data);
  });

  socket.on("get_single_chat_history", async (data) => {
    await get_single_chat_history_controller(io, socket, data);
  });

  socket.on("seen_private_message", async (data) => {
    await seen_private_message_controller(io, socket, data);
  });

  socket.on("get_all_messages", async (data) => {
    await get_all_messages_controller(io, socket, data);
  });
};
