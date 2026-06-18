import Message from "../models/msg.schema.js";

export const seen_private_message_service = async (chat_id, user_id) => {
  const viewerId = Number(user_id);

  const unreadMessages = await Message.find({
    chat_id,
    is_deleted: false,
    sender: { $ne: viewerId },
    seen_by: { $ne: viewerId },
  }).select("_id sender");

  if (unreadMessages.length === 0) {
    return {
      chat_id: String(chat_id),
      seen_by: viewerId,
      message_ids: [],
      sender_ids: [],
    };
  }

  await Message.updateMany(
    {
      chat_id,
      is_deleted: false,
      sender: { $ne: viewerId },
    },
    {
      $addToSet: { seen_by: viewerId },
    },
  );

  const message_ids = unreadMessages.map((message) => String(message._id));
  const sender_ids = [
    ...new Set(unreadMessages.map((message) => Number(message.sender))),
  ];

  return {
    chat_id: String(chat_id),
    seen_by: viewerId,
    message_ids,
    sender_ids,
  };
};
