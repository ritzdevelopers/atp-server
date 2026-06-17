import { pool } from "../../../db/connect.js";
import { isEmployeeExists } from "../../../helper/employee_checker.js";
import Chat from "../../../models/chat.schema.js";
import Message from "../../../models/msg.schema.js";
import errorHandling from "../../../utils/error.handling.js";
import { isValidObjectId } from "mongoose";

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "last_message_time",
]);

function normalizeUserRow(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.user_name,
    email: user.user_email,
    profile_picture: user.user_image,
  };
}

async function fetchUsersMap(connection, userIds) {
  const uniqueIds = [
    ...new Set(
      userIds
        .filter((id) => id != null && id !== "")
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id)),
    ),
  ];

  if (uniqueIds.length === 0) return new Map();

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT id, user_name, user_email, user_image FROM apt_users WHERE id IN (${placeholders})`,
    uniqueIds,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.id), normalizeUserRow(row));
  }
  return map;
}

function formatLastMessagePreview(message) {
  if (!message) return "";
  const type = message.type || "text";
  if (type === "text") return message.content || "";
  return type;
}

function resolveLastMessageStatus(
  lastMessage,
  actionUserId,
  otherParticipantId,
) {
  if (!lastMessage) return "sent";

  const actionId = Number(actionUserId);
  const otherId = Number(otherParticipantId);
  const seenBy = (lastMessage.seen_by ?? []).map(Number);
  const deliveredTo = (lastMessage.delivered_to ?? []).map(Number);

  if (Number(lastMessage.sender) === actionId) {
    if (seenBy.includes(otherId)) return "seen";
    if (deliveredTo.includes(otherId)) return "delivered";
    return "sent";
  }

  if (seenBy.includes(actionId)) return "seen";
  return "delivered";
}

function normalizeReplyTo(replyToDoc, usersMap) {
  if (!replyToDoc) return null;

  if (typeof replyToDoc === "object" && replyToDoc._id) {
    return {
      _id: replyToDoc._id,
      content: replyToDoc.content ?? "",
      sender:
        usersMap.get(Number(replyToDoc.sender)) ?? { id: replyToDoc.sender },
      created_at: replyToDoc.createdAt ?? replyToDoc.created_at ?? null,
    };
  }

  return { _id: replyToDoc };
}

function normalizePrivateMessage(
  message,
  actionUserId,
  usersMap,
  options = {},
) {
  const { seenByViewerOnly = false } = options;
  const sender = usersMap.get(Number(message.sender));
  if (!sender) return null;

  const actionId = Number(actionUserId);
  const rawSeenBy = (message.seen_by ?? []).map(Number);
  const isOwnMessage = Number(message.sender) === actionId;
  const seenByForResponse = seenByViewerOnly
    ? isOwnMessage
      ? (message.delivered_to ?? [])
          .map(Number)
          .filter((userId) => rawSeenBy.includes(userId))
          .map((userId) => usersMap.get(userId))
          .filter(Boolean)
      : rawSeenBy.includes(actionId)
        ? [usersMap.get(actionId)].filter(Boolean)
        : []
    : rawSeenBy
        .map((userId) => usersMap.get(userId))
        .filter(Boolean);

  return {
    _id: message._id,
    sender,
    content: message.content ?? "",
    type: message.type ?? "text",
    attachments: message.attachments ?? [],
    reply_to: normalizeReplyTo(message.reply_to, usersMap),
    delivered_to: (message.delivered_to ?? [])
      .map((userId) => usersMap.get(Number(userId)))
      .filter(Boolean),
    seen_by: seenByForResponse,
    is_edited: Boolean(message.is_edited),
    edited_at: message.edited_at ?? null,
    created_at: message.createdAt ?? message.created_at ?? null,
    sent_by_me: Number(message.sender) === actionId,
  };
}

// Get My All Chats ::
export const get_my_all_chats = async (req, res) => {
  let connection;
  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      50,
    );
    const skip = (page - 1) * limit;
    const sortField = ALLOWED_SORT_FIELDS.has(req.query.sort)
      ? req.query.sort
      : "last_message_time";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
      );
    }

    const chats = await Chat.find({
      company_id,
      participants: { $in: [Number(action_user_id)] },
      chat_type: "private",
    })
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);

    if (!chats || chats.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No Chats Found",
        error: "No Chats Found",
      });
    }

    const actionId = Number(action_user_id);
    const otherParticipantIds = chats
      .map((chat) =>
        chat.participants.find(
          (participant) => Number(participant) !== actionId,
        ),
      )
      .filter((id) => id != null);

    const usersMap = await fetchUsersMap(connection, otherParticipantIds);

    const chatIds = chats.map((chat) => chat._id);
    const latestMessages = await Message.aggregate([
      {
        $match: {
          company_id,
          chat_id: { $in: chatIds },
          is_deleted: false,
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$chat_id",
          lastMessage: { $first: "$$ROOT" },
        },
      },
    ]);

    const lastMessageMap = new Map(
      latestMessages.map((entry) => [String(entry._id), entry.lastMessage]),
    );

    const all_chats = [];
    for (const chat of chats) {
      const otherParticipantId = chat.participants.find(
        (participant) => Number(participant) !== actionId,
      );

      if (otherParticipantId == null) continue;

      const participant = usersMap.get(Number(otherParticipantId));
      if (!participant) continue;

      const lastMessage = lastMessageMap.get(String(chat._id)) ?? null;

      all_chats.push({
        _id: chat._id,
        participant_info: {
          receiver_profile_img: participant.profile_picture,
          receiver_name: participant.name,
          receiver_email: participant.email,
          receiver_id: participant.id,
        },
        last_message: formatLastMessagePreview(lastMessage),
        last_message_status: resolveLastMessageStatus(
          lastMessage,
          actionId,
          otherParticipantId,
        ),
        last_message_time:
          lastMessage?.createdAt ??
          chat.last_message_time ??
          chat.createdAt ??
          null,
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "All Chats Found Successfully",
      data: all_chats,
      pagination: {
        page,
        limit,
        returned: all_chats.length,
      },
    });
  } catch (error) {
    console.error(error);
    if (connection) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Internal Server Error",
        new Error("Internal Server Error"),
        500,
      );
    }
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Get My Single Chat ::
export const get_my_single_chat = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { chat_id } = req.params;
    const page = Math.max(
      parseInt(req.query.page ?? req.query.messages_limit, 10) || 1,
      1,
    );
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      50,
    );
    const skip = (page - 1) * limit;
    const actionId = Number(action_user_id);

    if (!chat_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Chat Id Is Required",
        error: "Chat Id Is Required",
      });
    }

    if (!isValidObjectId(chat_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Chat Id",
        error: "Invalid Chat Id",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Employee Not Found",
        new Error("Employee Not Found"),
        404,
      );
    }

    const chat = await Chat.findOne({
      _id: chat_id,
      company_id,
      chat_type: "private",
      participants: { $in: [actionId] },
    });

    if (!chat) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Chat Not Found",
        error: "Chat Not Found",
      });
    }

    const otherParticipantId = chat.participants.find(
      (participant) => Number(participant) !== actionId,
    );

    const messages = await Message.find({
      company_id,
      chat_id,
      is_deleted: false,
    })
      .populate("reply_to")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Mark incoming messages as seen by the requesting user before building the response.
    await Message.updateMany(
      {
        company_id,
        chat_id,
        is_deleted: false,
        sender: { $ne: actionId },
      },
      {
        $addToSet: { seen_by: actionId },
      },
    );

    for (const message of messages) {
      if (Number(message.sender) === actionId) continue;
      const seenBy = (message.seen_by ?? []).map(Number);
      if (!seenBy.includes(actionId)) {
        message.seen_by = [...seenBy, actionId];
      }
    }

    const relatedUserIds = new Set([actionId]);
    if (otherParticipantId != null) {
      relatedUserIds.add(Number(otherParticipantId));
    }

    for (const message of messages) {
      relatedUserIds.add(Number(message.sender));
      for (const userId of message.delivered_to ?? []) {
        relatedUserIds.add(Number(userId));
      }
      if (message.reply_to?.sender) {
        relatedUserIds.add(Number(message.reply_to.sender));
      }
    }

    const usersMap = await fetchUsersMap(connection, [...relatedUserIds]);

    let participant_info = null;
    if (otherParticipantId != null) {
      const participant = usersMap.get(Number(otherParticipantId));
      if (participant) {
        participant_info = {
          receiver_profile_img: participant.profile_picture,
          receiver_name: participant.name,
          receiver_email: participant.email,
          receiver_id: participant.id,
        };
      }
    }

    const normalized_messages = [];
    for (const message of messages) {
      const normalized = normalizePrivateMessage(message, actionId, usersMap, {
        seenByViewerOnly: true,
      });
      if (normalized) normalized_messages.push(normalized);
    }

    // Fetched newest-first; return oldest-first for chat UI.
    normalized_messages.reverse();

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Chat Found Successfully",
      data: {
        _id: chat._id,
        participant_info,
        company_id: chat.company_id,
        created_at: chat.createdAt ?? chat.created_at ?? null,
        messages: normalized_messages,
      },
      pagination: {
        page,
        limit,
        returned: normalized_messages.length,
      },
    });
  } catch (error) {
    console.error(error);
    if (connection) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Internal Server Error",
        new Error("Internal Server Error"),
        500,
      );
    }
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Create New Chat ::