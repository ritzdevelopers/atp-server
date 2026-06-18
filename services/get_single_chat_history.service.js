import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";
import { isValidObjectId } from "mongoose";

export const get_single_chat_history_service = async (
  chat_id,
  user_id,
  options = {},
) => {
  const actionId = Number(user_id);
  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 50);
  const skip = (page - 1) * limit;

  if (!isValidObjectId(chat_id)) {
    throw new Error("Invalid Chat Id");
  }

  const chat = await Chat.findOne({
    _id: chat_id,
    chat_type: "private",
    participants: { $in: [actionId] },
  });

  if (!chat) {
    throw new Error("Chat Not Found");
  }

  const otherParticipantId = chat.participants.find(
    (participant) => Number(participant) !== actionId,
  );

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

  for (const message of messages) {
    if (Number(message.sender) === actionId) continue;
    const seenBy = (message.seen_by ?? []).map(Number);
    if (!seenBy.includes(actionId)) {
      message.seen_by = [...seenBy, actionId];
    }
  }

  const serializedMessages = messages
    .map((message) => (message.toObject ? message.toObject() : message))
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
      participants: chat.participants,
      other_participant_id:
        otherParticipantId != null ? Number(otherParticipantId) : null,
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
