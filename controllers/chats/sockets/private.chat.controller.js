import { save_private_message_service } from "../../../services/private.chat.service.js";

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

    const message = await save_private_message_service(data);

    socket.emit("receive_private_message", message);
    io.to(String(delivered_to)).emit("receive_private_message", message);

  } catch (error) {
    return socket.emit("error", {
      success: false,
      message: error.message,
    });
  }
};
