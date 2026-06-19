import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";

export async function assertGroupParticipant(chat_id, user_id) {
  const chat = await Chat.findOne({
    _id: chat_id,
    chat_type: "group",
    is_group_active: true,
    participants: { $in: [Number(user_id)] },
  });

  if (!chat) {
    throw new Error("Group not found or access denied");
  }

  return chat;
}

export const save_group_message_service = async (data, io) => {
  const {
    sender,
    company_id,
    chat_id,
    type,
    content,
    reply_to,
    attachments,
  } = data;

  const chat = await assertGroupParticipant(chat_id, sender);
  const senderId = Number(sender);
  const participants = (chat.participants ?? []).map(Number);
  const delivered_to = participants.filter((id) => id !== senderId);

  const group_room_sockets = await io.in(`group:${chat_id}`).fetchSockets();
  const watchingUserIds = new Set(
    group_room_sockets
      .map((socket_) => Number(socket_.data.user_id))
      .filter((id) => !Number.isNaN(id)),
  );

  const seen_by = delivered_to.filter((id) => watchingUserIds.has(id));

  const new_message = await Message.create({
    sender: senderId,
    company_id: Number(company_id),
    chat_id,
    content: content ?? "",
    type,
    delivered_to,
    seen_by,
    ...(reply_to ? { reply_to } : {}),
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
  });

  await Chat.findByIdAndUpdate(chat_id, {
    last_message: new_message._id,
    last_message_time: new Date(),
  });

  return { message: new_message, participants };
};

export function emitToGroupParticipants(io, participants, chat_id, event, payload) {
  const unique = [
    ...new Set(
      participants
        .map(Number)
        .filter((id) => !Number.isNaN(id)),
    ),
  ];

  for (const uid of unique) {
    io.to(`user:${uid}`).emit(event, payload);
  }
  io.to(`group:${chat_id}`).emit(event, payload);
}
