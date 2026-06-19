import { save_private_message_service, upload_media_service, inferMessageTypeFromMime } from "../../../services/private.chat.service.js";
import { get_single_chat_history_service } from "../../../services/get_single_chat_history.service.js";
import {
  emit_chat_sidebar_updates,
  get_all_messages_service,
} from "../../../services/chat_sidebar.service.js";
import Message from "../../../models/msg.schema.js";
import Chat from "../../../models/chat.schema.js";

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

export const edit_chat_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id, new_content, message_id } = data;
    const trimmedContent = String(new_content ?? "").trim();

    if (!chat_id || user_id == null || !message_id) {
      return socket.emit("error", {
        success: false,
        message: "Chat ID, user ID, and message ID are required",
      });
    }
    if (!trimmedContent) {
      return socket.emit("error", {
        success: false,
        message: "Message content cannot be empty",
      });
    }

    const find_message = await Message.findById(message_id);
    if (!find_message || find_message.is_deleted) {
      return socket.emit("error", {
        success: false,
        message: "Message not found",
      });
    }
    if (Number(find_message.sender) !== Number(user_id)) {
      return socket.emit("error", {
        success: false,
        message: "You are not authorized to edit this message",
      });
    }
    if (String(find_message.chat_id) !== String(chat_id)) {
      return socket.emit("error", {
        success: false,
        message: "Message not found in this chat",
      });
    }
    if (find_message.type !== "text") {
      return socket.emit("error", {
        success: false,
        message: "Only text messages can be edited",
      });
    }

    const update_message = await Message.findByIdAndUpdate(
      message_id,
      {
        content: trimmedContent,
        is_edited: true,
        edited_at: new Date(),
        seen_by: [Number(user_id)],
      },
      { new: true },
    );

    const payload = update_message.toObject
      ? update_message.toObject()
      : update_message;

    const notifyUserIds = new Set([
      Number(payload.sender),
      ...(payload.delivered_to ?? []).map(Number),
    ]);

    for (const uid of notifyUserIds) {
      if (Number.isNaN(uid)) continue;
      io.to(`user:${uid}`).emit("receive_edited_message", payload);
    }

    const chat = await Chat.findById(chat_id);
    if (chat && String(chat.last_message) === String(message_id)) {
      await emit_chat_sidebar_updates(io, chat_id, chat.company_id, [
        ...notifyUserIds,
      ]);
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};


export const delete_message_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id, message_id, message_ids } = data;
    const requestedIds = [
      ...new Set(
        (Array.isArray(message_ids)
          ? message_ids
          : message_id
            ? [message_id]
            : []
        )
          .map(String)
          .filter(Boolean),
      ),
    ];

    if (!chat_id || user_id == null || requestedIds.length === 0) {
      return socket.emit("error", {
        success: false,
        message: "Chat ID, user ID, and message ID are required",
      });
    }

    const actionId = Number(user_id);
    const chat = await Chat.findById(chat_id);
    if (!chat) {
      return socket.emit("error", {
        success: false,
        message: "Chat not found",
      });
    }

    const messages = await Message.find({
      _id: { $in: requestedIds },
      chat_id,
      sender: actionId,
      is_deleted: false,
    });

    if (!messages.length) {
      return socket.emit("error", {
        success: false,
        message: "No messages found to delete",
      });
    }

    if (messages.length !== requestedIds.length) {
      return socket.emit("error", {
        success: false,
        message: "Some messages could not be deleted",
      });
    }

    const deletableIds = messages.map((message) => message._id);
    const deletedAt = new Date();

    await Message.updateMany(
      { _id: { $in: deletableIds } },
      {
        $set: {
          is_deleted: true,
          deleted_at: deletedAt,
        },
      },
    );

    const deletedLastMessage = deletableIds.some(
      (id) => String(chat.last_message) === String(id),
    );

    if (deletedLastMessage) {
      const latestMessage = await Message.findOne({
        company_id: chat.company_id,
        chat_id,
        is_deleted: false,
      })
        .sort({ createdAt: -1 })
        .select("_id createdAt");

      await Chat.findByIdAndUpdate(chat_id, {
        last_message: latestMessage?._id ?? null,
        last_message_time:
          latestMessage?.createdAt ?? chat.createdAt ?? deletedAt,
      });
    }

    const updatedMessages = await Message.find({ _id: { $in: deletableIds } });
    const allNotifyUserIds = new Set();

    for (const message of updatedMessages) {
      const payload = message.toObject ? message.toObject() : message;
      const notifyUserIds = new Set([
        Number(payload.sender),
        ...(payload.delivered_to ?? []).map(Number),
      ]);

      for (const uid of notifyUserIds) {
        if (Number.isNaN(uid)) continue;
        allNotifyUserIds.add(uid);
        io.to(`user:${uid}`).emit("receive_deleted_message", payload);
      }
    }

    if (chat.company_id) {
      await emit_chat_sidebar_updates(io, chat_id, chat.company_id, [
        ...allNotifyUserIds,
      ]);
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const reply_to_message_controller = async (io, socket, data) => {
  try {
    const {
      chat_id,
      user_id,
      message_id,
      content,
      delivered_to,
      company_id,
      chat_type = "private",
      type = "text",
    } = data;
    const trimmedContent = String(content ?? "").trim();

    if (
      user_id == null ||
      !message_id ||
      !trimmedContent ||
      !delivered_to ||
      !company_id
    ) {
      return socket.emit("error", {
        success: false,
        message:
          "User ID, message ID, content, recipient, and company ID are required",
      });
    }

    const repliedMessage = await Message.findById(message_id);
    if (!repliedMessage || repliedMessage.is_deleted) {
      return socket.emit("error", {
        success: false,
        message: "Message not found",
      });
    }

    const resolvedChatId = chat_id ?? String(repliedMessage.chat_id);
    if (String(repliedMessage.chat_id) !== String(resolvedChatId)) {
      return socket.emit("error", {
        success: false,
        message: "Message not found in this chat",
      });
    }

    const chat = await Chat.findById(resolvedChatId);
    if (!chat) {
      return socket.emit("error", {
        success: false,
        message: "Chat not found",
      });
    }

    const actionId = Number(user_id);
    const recipientId = Number(delivered_to);
    const participants = (chat.participants ?? []).map(Number);

    if (!participants.includes(actionId)) {
      return socket.emit("error", {
        success: false,
        message: "You are not a participant in this chat",
      });
    }
    if (!participants.includes(recipientId)) {
      return socket.emit("error", {
        success: false,
        message: "Invalid recipient",
      });
    }

    const newMessage = await save_private_message_service(
      {
        sender: actionId,
        delivered_to: recipientId,
        type,
        content: trimmedContent,
        company_id: Number(company_id),
        chat_id: resolvedChatId,
        chat_type,
        reply_to: message_id,
      },
      io,
      socket,
    );

    const populated = await Message.findById(newMessage._id).populate(
      "reply_to",
    );
    const payload = populated.toObject ? populated.toObject() : populated;

    const notifyUserIds = new Set([actionId, recipientId]);
    for (const uid of notifyUserIds) {
      if (Number.isNaN(uid)) continue;
      io.to(`user:${uid}`).emit("receive_reply_message", payload);
    }

    await emit_chat_sidebar_updates(io, resolvedChatId, Number(company_id), [
      actionId,
      recipientId,
    ]);
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};


export const send_media_controller = async (io, socket, data) => {
  try {
    const {
      sender,
      company_id,
      chat_id,
      type,
      attachments,
      delivered_to,
      chat_type = "private",
      content = "",
      reply_to,
    } = data;

    if (
      !sender ||
      !company_id ||
      !delivered_to ||
      !Array.isArray(attachments) ||
      attachments.length === 0
    ) {
      return socket.emit("error", {
        success: false,
        message:
          "Sender, company, recipient, and at least one attachment are required",
      });
    }

    const uploadedAttachments = await upload_media_service(attachments);
    const resolvedType =
      type ||
      inferMessageTypeFromMime(uploadedAttachments[0]?.mime_type ?? "");

    const allowedTypes = [
      "text",
      "image",
      "audio",
      "video",
      "file",
      "link",
      "location",
    ];
    if (!allowedTypes.includes(resolvedType)) {
      return socket.emit("error", {
        success: false,
        message: "Unsupported media type",
      });
    }

    const message = await save_private_message_service(
      {
        sender: Number(sender),
        delivered_to: Number(delivered_to),
        type: resolvedType,
        content:
          String(content).trim() ||
          uploadedAttachments[0]?.file_name ||
          "Media",
        company_id: Number(company_id),
        chat_id: chat_id || null,
        chat_type,
        reply_to: reply_to || null,
        attachments: uploadedAttachments,
      },
      io,
      socket,
    );

    const payload = message.toObject ? message.toObject() : message;
    const notifyUserIds = new Set([
      Number(payload.sender),
      Number(delivered_to),
    ]);

    for (const uid of notifyUserIds) {
      if (Number.isNaN(uid)) continue;
      io.to(`user:${uid}`).emit("receive_media_message", payload);
    }

    await emit_chat_sidebar_updates(io, String(payload.chat_id), company_id, [
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