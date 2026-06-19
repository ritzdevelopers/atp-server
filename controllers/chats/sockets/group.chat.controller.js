import Message from "../../../models/msg.schema.js";
import Chat from "../../../models/chat.schema.js";
import {
  upload_media_service,
  inferMessageTypeFromMime,
} from "../../../services/private.chat.service.js";
import { get_group_chat_history_service } from "../../../services/get_group_chat_history.service.js";
import { seen_private_message_service } from "../../../services/seen_private_message.service.js";
import {
  assertGroupParticipant,
  emitToGroupParticipants,
  save_group_message_service,
} from "../../../services/group.chat.service.js";
import { pool } from "../../../db/connect.js";

async function fetchSenderName(senderId) {
  const connection = await pool.promise().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT user_name FROM apt_users WHERE id = ? LIMIT 1`,
      [Number(senderId)],
    );
    return rows[0]?.user_name ?? "Member";
  } finally {
    connection.release();
  }
}

async function enrichMessagePayload(message) {
  const payload = message.toObject ? message.toObject() : message;
  const senderName = await fetchSenderName(payload.sender);
  return {
    ...payload,
    sender_name: senderName,
  };
}

export const get_group_chat_history_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id, page, limit } = data;
    if (!chat_id || !user_id) {
      return socket.emit("error", {
        success: false,
        message: "Group ID and User ID are required",
      });
    }

    const result = await get_group_chat_history_service(chat_id, user_id, {
      page,
      limit,
    });

    const payload = {
      success: true,
      message: "Group Chat Found Successfully",
      data: result,
    };

    socket.emit("receive_group_chat_history", payload);

    for (const senderId of result.seen_update.sender_ids) {
      io.to(`user:${senderId}`).emit(
        "seen_group_message",
        result.seen_update,
      );
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const send_group_message_controller = async (io, socket, data) => {
  try {
    const { sender, company_id, chat_id, type, content, reply_to } = data;
    if (!sender || !company_id || !chat_id || !type || !content) {
      return socket.emit("error", {
        success: false,
        message: "Sender, company, group, type, and content are required",
      });
    }

    const { message, participants } = await save_group_message_service(
      {
        sender: Number(sender),
        company_id: Number(company_id),
        chat_id,
        type,
        content,
        reply_to: reply_to || null,
      },
      io,
    );

    let payload = await enrichMessagePayload(message);
    if (reply_to) {
      const populated = await Message.findById(message._id).populate(
        "reply_to",
      );
      payload = await enrichMessagePayload(populated);
    }

    emitToGroupParticipants(
      io,
      participants,
      chat_id,
      "receive_group_message",
      payload,
    );
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const send_group_media_controller = async (io, socket, data) => {
  try {
    const {
      sender,
      company_id,
      chat_id,
      type,
      attachments,
      content = "",
      reply_to,
    } = data;

    if (
      !sender ||
      !company_id ||
      !chat_id ||
      !Array.isArray(attachments) ||
      attachments.length === 0
    ) {
      return socket.emit("error", {
        success: false,
        message: "Sender, company, group, and attachments are required",
      });
    }

    const uploadedAttachments = await upload_media_service(attachments);
    const resolvedType =
      type ||
      inferMessageTypeFromMime(uploadedAttachments[0]?.mime_type ?? "");

    const { message, participants } = await save_group_message_service(
      {
        sender: Number(sender),
        company_id: Number(company_id),
        chat_id,
        type: resolvedType,
        content:
          String(content).trim() ||
          uploadedAttachments[0]?.file_name ||
          "Media",
        reply_to: reply_to || null,
        attachments: uploadedAttachments,
      },
      io,
    );

    const populated = await Message.findById(message._id).populate("reply_to");
    const payload = await enrichMessagePayload(populated);

    emitToGroupParticipants(
      io,
      participants,
      chat_id,
      "receive_group_media_message",
      payload,
    );
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const reply_to_group_message_controller = async (io, socket, data) => {
  try {
    const {
      chat_id,
      user_id,
      message_id,
      content,
      company_id,
      type = "text",
    } = data;
    const trimmedContent = String(content ?? "").trim();

    if (!chat_id || user_id == null || !message_id || !trimmedContent) {
      return socket.emit("error", {
        success: false,
        message: "Group ID, user ID, message ID, and content are required",
      });
    }

    const repliedMessage = await Message.findById(message_id);
    if (!repliedMessage || repliedMessage.is_deleted) {
      return socket.emit("error", {
        success: false,
        message: "Message not found",
      });
    }
    if (String(repliedMessage.chat_id) !== String(chat_id)) {
      return socket.emit("error", {
        success: false,
        message: "Message not found in this group",
      });
    }

    await assertGroupParticipant(chat_id, user_id);

    const { message, participants } = await save_group_message_service(
      {
        sender: Number(user_id),
        company_id: Number(company_id ?? repliedMessage.company_id),
        chat_id,
        type,
        content: trimmedContent,
        reply_to: message_id,
      },
      io,
    );

    const populated = await Message.findById(message._id).populate("reply_to");
    const payload = await enrichMessagePayload(populated);

    emitToGroupParticipants(
      io,
      participants,
      chat_id,
      "receive_group_reply_message",
      payload,
    );
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const edit_group_message_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id, new_content, message_id } = data;
    const trimmedContent = String(new_content ?? "").trim();

    if (!chat_id || user_id == null || !message_id) {
      return socket.emit("error", {
        success: false,
        message: "Group ID, user ID, and message ID are required",
      });
    }
    if (!trimmedContent) {
      return socket.emit("error", {
        success: false,
        message: "Message content cannot be empty",
      });
    }

    const chat = await assertGroupParticipant(chat_id, user_id);
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
        message: "Message not found in this group",
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

    const payload = await enrichMessagePayload(update_message);
    emitToGroupParticipants(
      io,
      chat.participants,
      chat_id,
      "receive_group_edited_message",
      payload,
    );
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const delete_group_message_controller = async (io, socket, data) => {
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
        message: "Group ID, user ID, and message ID are required",
      });
    }

    const actionId = Number(user_id);
    const chat = await assertGroupParticipant(chat_id, user_id);

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
    for (const message of updatedMessages) {
      const payload = message.toObject ? message.toObject() : message;
      emitToGroupParticipants(
        io,
        chat.participants,
        chat_id,
        "receive_group_deleted_message",
        payload,
      );
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};

export const seen_group_message_controller = async (io, socket, data) => {
  try {
    const { chat_id, user_id } = data;
    if (!chat_id || !user_id) {
      return socket.emit("error", {
        success: false,
        message: "Group ID and User ID are required",
      });
    }

    await assertGroupParticipant(chat_id, user_id);
    const result = await seen_private_message_service(chat_id, user_id);

    for (const senderId of result.sender_ids) {
      io.to(`user:${senderId}`).emit("seen_group_message", result);
    }
  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};
