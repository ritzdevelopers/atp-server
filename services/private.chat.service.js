import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";

export const save_private_message_service = async (data, io, socket) => {
  const {
    sender,
    delivered_to,
    type,
    content,
    company_id,
    chat_id,
    chat_type,
  } = data;

  let new_chat_id;
  if (!chat_id) {
    // Create new chat ::
    const new_chat = await Chat.create({
      company_id,
      chat_type,
      participants: [sender, delivered_to],
    });
    new_chat_id = new_chat._id;
  } else {
    new_chat_id = chat_id;
  }
  const chat_room_sockets = await io.in(`chat:${new_chat_id}`).fetchSockets();
  const is_user_watching = chat_room_sockets.some(
    (socket_) => socket_.data.user_id === delivered_to,
  );
  let new_message;
  if (!is_user_watching) {
    new_message = await Message.create({
      sender,
      company_id,
      chat_id: new_chat_id,
      content,
      type,
      delivered_to: [delivered_to],
      seen_by:[],
    });
  } else {
    new_message = await Message.create({
      sender,
      company_id,
      chat_id: new_chat_id,
      content,
      type,
      delivered_to: [delivered_to],
      seen_by:[delivered_to],
    });
  }

  await Chat.findByIdAndUpdate(new_chat_id, {
    last_message: new_message._id,
    last_message_time: new Date(),
  });
  return new_message;
};
