import { save_private_message_service } from "../../../services/private.chat.service.js";
import { get_single_chat_history_service } from "../../../services/get_single_chat_history.service.js";
import {
  emit_chat_sidebar_updates,
  get_all_messages_service,
} from "../../../services/chat_sidebar.service.js";

export const send_private_message_controller = async (io, socket, data) => {
  try {
    const { sender, delivered_to, type, content, company_id, chat_type } = data;
    if (
      !sender ||
      !delivered_to ||
      !type ||
      !content ||
      !company_id ||
      !chat_type
    ) {
      return {
        success: false,
        message: "All fields are required",
      };
    }
        
    const message = await save_private_message_service(data, io, socket);
    const payload = message.toObject ? message.toObject() : message;

    socket.emit("receive_private_message", payload);
    io.to(`user:${delivered_to}`).emit("receive_private_message", payload);

    const chatId = String(payload.chat_id);
    await emit_chat_sidebar_updates(io, chatId, company_id, [
      sender,
      delivered_to,
    ]);
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};


export const get_single_chat_history_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id, page, limit } = data;
    if (!chat_id || !user_id) {
      return socket.emit("error", {
        success: false,
        message: "Chat ID and User ID are required",
      });
    }

    const result = await get_single_chat_history_service(chat_id, user_id, {
      page,
      limit,
    });

    const payload = {
      success: true,
      message: "Chat Found Successfully",
      data: result,
    };

    socket.emit("receive_single_chat_history", payload);
    io.to(`user:${user_id}`).emit("receive_single_chat_history", payload);

    for (const senderId of result.seen_update.sender_ids) {
      io.to(`user:${senderId}`).emit(
        "seen_private_message",
        result.seen_update,
      );
    }

    const companyId = result.chat?.company_id;
    if (companyId) {
      await emit_chat_sidebar_updates(io, chat_id, companyId, [user_id]);
      for (const senderId of result.seen_update.sender_ids) {
        await emit_chat_sidebar_updates(io, chat_id, companyId, [senderId]);
      }
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const get_all_messages_controller = async (io, socket, data) => {
  try {
    const { user_id, company_id, page, limit, sort, order } = data;
    if (!user_id || !company_id) {
      return socket.emit("error", {
        success: false,
        message: "User ID and Company ID are required",
      });
    }

    const result = await get_all_messages_service(user_id, company_id, {
      page,
      limit,
      sort,
      order,
    });

    const payload = {
      success: true,
      message: "All Chats Found Successfully",
      data: result.chats,
      pagination: result.pagination,
    };

    socket.emit("receive_all_messages", payload);
    io.to(`user:${user_id}`).emit("receive_all_messages", payload);
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};