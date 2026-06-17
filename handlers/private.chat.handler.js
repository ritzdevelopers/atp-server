import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";

export const create_private_chat = async (data) => {
  try {
    const {
      sender,
      delivered_to,
      type,
      content,
      company_id,
      chat_id,
      chat_type,
    } = data;
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
    const new_message = await Message.create({
      sender,
      company_id,
      chat_id: new_chat_id,
      content,
      type,
      delivered_to: [delivered_to],
    });
    await Chat.findByIdAndUpdate(new_chat_id, {
      last_message: new_message._id,
      last_message_time: new Date(),
    });
    return {
      success: true,
      message: "Message sent successfully",
      data: new_message,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};
