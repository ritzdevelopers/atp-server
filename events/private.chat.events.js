import {
  delete_message_controller,
  edit_chat_controller,
  get_all_messages_controller,
  get_single_chat_history_controller,
  reply_to_message_controller,
  send_media_controller,
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

  /* *********************** Reply to Message *********************** */
  socket.on("reply_to_message", async (data) => {
    await reply_to_message_controller(io, socket, data);
  });

  /* *********************** Edit Chat *********************** */
  socket.on("edit_chat", async (data) => {
    await edit_chat_controller(io, socket, data);
  });

  /* *********************** Delete Chat *********************** */
  socket.on("delete_message", async (data) => {
    await delete_message_controller(io, socket, data);
  });
  /*------------------ Typing Indicator Events ------------------*/
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

  /*------------------ Private Message Controller ------------------*/
  socket.on("send_private_message", async (data) => {
    await send_private_message_controller(io, socket, data);
  });

  /*------------------ Single Chat History Controller ------------------*/
  socket.on("get_single_chat_history", async (data) => {
    await get_single_chat_history_controller(io, socket, data);
  });

  /*------------------ Seen Private Message Controller ------------------*/
  socket.on("seen_private_message", async (data) => {
    await seen_private_message_controller(io, socket, data);
  });

  /*------------------ All Messages Controller ------------------*/
  socket.on("get_all_messages", async (data) => {
    await get_all_messages_controller(io, socket, data);
  });

  /*------------------ Send Media *PDF/Files/Images/Videos ------------------*/
  socket.on("send_media", async (data) => { 
    await send_media_controller(io, socket, data);
  });
};
