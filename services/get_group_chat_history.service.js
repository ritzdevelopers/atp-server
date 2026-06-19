import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";
import { pool } from "../db/connect.js";
import { isValidObjectId } from "mongoose";

async function fetchUsersMap(userIds) {
  const uniqueIds = [
    ...new Set(
      userIds
        .filter((id) => id != null && id !== "")
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id)),
    ),
  ];

  if (!uniqueIds.length) return new Map();

  const connection = await pool.promise().getConnection();
  try {
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const [rows] = await connection.query(
      `SELECT id, user_name, user_image FROM apt_users WHERE id IN (${placeholders})`,
      uniqueIds,
    );
    const map = new Map();
    for (const row of rows) {
      map.set(Number(row.id), {
        name: row.user_name,
        profile: row.user_image,
      });
    }
    return map;
  } finally {
    connection.release();
  }
}

function normalizeReplyTo(replyToDoc, usersMap) {
  if (!replyToDoc) return null;
  if (typeof replyToDoc === "object" && replyToDoc._id) {
    const senderId = Number(replyToDoc.sender);
    const senderInfo = usersMap.get(senderId);
    return {
      _id: replyToDoc._id,
      content: replyToDoc.content ?? "",
      sender: senderId,
      sender_name: senderInfo?.name ?? "Member",
      type: replyToDoc.type ?? "text",
      created_at: replyToDoc.createdAt ?? replyToDoc.created_at ?? null,
    };
  }
  return { _id: replyToDoc };
}

export const get_group_chat_history_service = async (
  chat_id,
  user_id,
  options = {},
) => {
  const actionId = Number(user_id);
  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 50);
  const skip = (page - 1) * limit;

  if (!isValidObjectId(chat_id)) {
    throw new Error("Invalid Group Id");
  }

  const chat = await Chat.findOne({
    _id: chat_id,
    chat_type: "group",
    is_group_active: true,
    participants: { $in: [actionId] },
  });

  if (!chat) {
    throw new Error("Group Not Found");
  }

  const unreadMessages = await Message.find({
    company_id: chat.company_id,
    chat_id,
    is_deleted: false,
    sender: { $ne: actionId },
    seen_by: { $ne: actionId },
  }).select("_id sender");

  await Message.updateMany(
    {
      company_id: chat.company_id,
      chat_id,
      is_deleted: false,
      sender: { $ne: actionId },
    },
    {
      $addToSet: { seen_by: actionId },
    },
  );

  const messages = await Message.find({
    company_id: chat.company_id,
    chat_id,
    is_deleted: false,
  })
    .populate("reply_to")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const relatedUserIds = new Set([actionId, ...(chat.participants ?? [])]);
  for (const message of messages) {
    relatedUserIds.add(Number(message.sender));
    if (message.reply_to?.sender) {
      relatedUserIds.add(Number(message.reply_to.sender));
    }
  }

  const usersMap = await fetchUsersMap([...relatedUserIds]);

  const serializedMessages = messages
    .map((message) => {
      const obj = message.toObject ? message.toObject() : message;
      const senderId = Number(obj.sender);
      const senderInfo = usersMap.get(senderId);
      return {
        ...obj,
        sender_name: senderInfo?.name ?? "Member",
        sender_profile: senderInfo?.profile ?? null,
        reply_to: normalizeReplyTo(obj.reply_to, usersMap),
      };
    })
    .reverse();

  const message_ids = unreadMessages.map((message) => String(message._id));
  const sender_ids = [
    ...new Set(unreadMessages.map((message) => Number(message.sender))),
  ];

  return {
    chat: {
      _id: String(chat._id),
      company_id: chat.company_id,
      chat_type: chat.chat_type,
      group_name: chat.group_name,
      group_image: chat.group_image,
      participants: chat.participants,
      created_at: chat.createdAt ?? chat.created_at ?? null,
    },
    messages: serializedMessages,
    pagination: {
      page,
      limit,
      returned: serializedMessages.length,
    },
    seen_update: {
      chat_id: String(chat_id),
      seen_by: actionId,
      message_ids,
      sender_ids,
    },
  };
};
