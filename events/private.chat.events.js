import {
  delete_message_controller,
  edit_chat_controller,
  get_all_messages_controller,
  get_single_chat_history_controller,
  reply_to_message_controller,
  send_media_controller,
  send_private_message_controller,
} from "../controllers/chats/sockets/private.chat.controller.js";
import {
  delete_group_message_controller,
  edit_group_message_controller,
  get_group_chat_history_controller,
  reply_to_group_message_controller,
  seen_group_message_controller,
  send_group_media_controller,
  send_group_message_controller,
} from "../controllers/chats/sockets/group.chat.controller.js";
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

  socket.on("reply_to_message", async (data) => {
    await reply_to_message_controller(io, socket, data);
  });

  socket.on("edit_chat", async (data) => {
    await edit_chat_controller(io, socket, data);
  });

  socket.on("delete_message", async (data) => {
    await delete_message_controller(io, socket, data);
  });

  socket.on("typing_indicator", (data) => {
    const { chat_id, user_id, receiver_id } = data;
    if (!chat_id || !user_id || !receiver_id) return;
    socket
      .to(`user:${receiver_id}`)
      .emit("typing_indicator", { chat_id, user_id, typing: true });
  });

  socket.on("typing_stop", (data) => {
    const { chat_id, user_id, receiver_id } = data;
    if (!chat_id || !user_id || !receiver_id) return;
    socket
      .to(`user:${receiver_id}`)
      .emit("typing_stop", { chat_id, user_id, typing: false });
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

  socket.on("send_media", async (data) => {
    await send_media_controller(io, socket, data);
  });
};

export const register_group_chat_events = (io, socket) => {
  socket.on("join_group_chat", (group_id, user_id) => {
    if (!group_id || !user_id) return;
    socket.data.user_id = user_id;
    if (socket.data.current_group_id) {
      socket.leave(`group:${socket.data.current_group_id}`);
    }
    socket.data.current_group_id = group_id;
    socket.join(`group:${group_id}`);
  });

  socket.on("leave_group_chat", (group_id) => {
    if (!group_id) return;
    socket.leave(`group:${group_id}`);
    if (socket.data.current_group_id === group_id) {
      socket.data.current_group_id = null;
    }
  });

  socket.on("reply_to_group_message", async (data) => {
    await reply_to_group_message_controller(io, socket, data);
  });

  socket.on("edit_group_message", async (data) => {
    await edit_group_message_controller(io, socket, data);
  });

  socket.on("delete_group_message", async (data) => {
    await delete_group_message_controller(io, socket, data);
  });

  socket.on("group_typing_indicator", (data) => {
    const { chat_id, user_id, user_name } = data;
    if (!chat_id || !user_id) return;
    socket
      .to(`group:${chat_id}`)
      .emit("group_typing_indicator", { chat_id, user_id, user_name, typing: true });
  });

  socket.on("group_typing_stop", (data) => {
    const { chat_id, user_id } = data;
    if (!chat_id || !user_id) return;
    socket
      .to(`group:${chat_id}`)
      .emit("group_typing_stop", { chat_id, user_id, typing: false });
  });

  socket.on("get_group_chat_history", async (data) => {
    await get_group_chat_history_controller(io, socket, data);
  });

  socket.on("seen_group_message", async (data) => {
    await seen_group_message_controller(io, socket, data);
  });

  socket.on("send_group_message", async (data) => {
    await send_group_message_controller(io, socket, data);
  });

  socket.on("send_group_media", async (data) => {
    await send_group_media_controller(io, socket, data);
  });
};
