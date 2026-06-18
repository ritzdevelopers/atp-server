import { seen_private_message_service } from "../../../services/seen_private_message.service.js";
import { emit_chat_sidebar_updates } from "../../../services/chat_sidebar.service.js";
import Chat from "../../../models/chat.schema.js";

export const seen_private_message_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id } = data;
    if (!chat_id || !user_id) {
      return socket.emit("error", {
        success: false,
        message: "Chat ID and User ID are required",
      });
    }

    const result = await seen_private_message_service(chat_id, user_id);

    for (const senderId of result.sender_ids) {
      io.to(`user:${senderId}`).emit("seen_private_message", result);
    }

    const chat = await Chat.findById(chat_id).select("company_id participants");
    if (chat?.company_id) {
      await emit_chat_sidebar_updates(io, chat_id, chat.company_id, [user_id]);
      for (const senderId of result.sender_ids) {
        await emit_chat_sidebar_updates(io, chat_id, chat.company_id, [
          senderId,
        ]);
      }
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

