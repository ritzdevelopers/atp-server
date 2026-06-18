import { pool } from "../db/connect.js";
import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";

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

function buildChatListItem(
  chat,
  actionId,
  usersMap,
  lastMessage,
  unreadCount,
) {
  const otherParticipantId = chat.participants.find(
    (participant) => Number(participant) !== actionId,
  );

  if (otherParticipantId == null) return null;

  const participant = usersMap.get(Number(otherParticipantId));
  if (!participant) return null;

  return {
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
    unread_count: unreadCount ?? 0,
  };
}

async function getUnreadCountMap(company_id, chatIds, actionId) {
  if (chatIds.length === 0) return new Map();

  const unreadCounts = await Message.aggregate([
    {
      $match: {
        company_id,
        chat_id: { $in: chatIds },
        is_deleted: false,
        sender: { $ne: actionId },
        seen_by: { $ne: actionId },
      },
    },
    {
      $group: {
        _id: "$chat_id",
        unread_count: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    unreadCounts.map((entry) => [String(entry._id), entry.unread_count]),
  );
}

export async function get_chat_sidebar_item_service(chat_id, user_id, company_id) {
  let connection;
  try {
    const actionId = Number(user_id);
    const chat = await Chat.findOne({
      _id: chat_id,
      company_id,
      chat_type: "private",
      participants: { $in: [actionId] },
    });

    if (!chat) return null;

    const otherParticipantId = chat.participants.find(
      (participant) => Number(participant) !== actionId,
    );

    connection = await pool.promise().getConnection();
    const usersMap = await fetchUsersMap(connection, [
      actionId,
      otherParticipantId,
    ]);

    const lastMessage = await Message.findOne({
      company_id,
      chat_id,
      is_deleted: false,
    }).sort({ createdAt: -1 });

    const unreadCount = await Message.countDocuments({
      company_id,
      chat_id,
      is_deleted: false,
      sender: { $ne: actionId },
      seen_by: { $ne: actionId },
    });

    return buildChatListItem(
      chat,
      actionId,
      usersMap,
      lastMessage,
      unreadCount,
    );
  } finally {
    if (connection) connection.release();
  }
}

export async function emit_chat_sidebar_updates(
  io,
  chat_id,
  company_id,
  userIds,
) {
  const uniqueUserIds = [
    ...new Set(
      userIds
        .filter((id) => id != null && id !== "")
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id)),
    ),
  ];

  for (const userId of uniqueUserIds) {
    const item = await get_chat_sidebar_item_service(
      chat_id,
      userId,
      company_id,
    );
    if (!item) continue;

    io.to(`user:${userId}`).emit("receive_chat_list_update", {
      success: true,
      data: item,
    });
  }
}

export async function get_all_messages_service(
  user_id,
  company_id,
  options = {},
) {
  let connection;
  try {
    const actionId = Number(user_id);
    const page = Math.max(parseInt(options.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 50);
    const skip = (page - 1) * limit;
    const sortField = ALLOWED_SORT_FIELDS.has(options.sort)
      ? options.sort
      : "last_message_time";
    const sortOrder = options.order === "asc" ? 1 : -1;

    connection = await pool.promise().getConnection();

    const chats = await Chat.find({
      company_id,
      participants: { $in: [actionId] },
      chat_type: "private",
    })
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit);

    if (!chats || chats.length === 0) {
      return {
        chats: [],
        pagination: { page, limit, returned: 0 },
      };
    }

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

    const unreadCountMap = await getUnreadCountMap(company_id, chatIds, actionId);

    const all_chats = [];
    for (const chat of chats) {
      const lastMessage = lastMessageMap.get(String(chat._id)) ?? null;
      const unreadCount = unreadCountMap.get(String(chat._id)) ?? 0;
      const item = buildChatListItem(
        chat,
        actionId,
        usersMap,
        lastMessage,
        unreadCount,
      );
      if (item) all_chats.push(item);
    }

    return {
      chats: all_chats,
      pagination: {
        page,
        limit,
        returned: all_chats.length,
      },
    };
  } finally {
    if (connection) connection.release();
  }
}
