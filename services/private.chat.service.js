import Chat from "../models/chat.schema.js";
import Message from "../models/msg.schema.js";
import uploadToCloudinary, {
  destroyFromCloudinary,
} from "../config/cloudinary.js";

const CHAT_MEDIA_FOLDER = "chat_media";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function decodeAttachmentBuffer(data) {
  if (!data) return null;
  const base64 =
    typeof data === "string" && data.includes(",")
      ? data.split(",")[1]
      : String(data);
  const buffer = Buffer.from(base64, "base64");
  return buffer.length ? buffer : null;
}

function resolveCloudinaryResourceType(mimeType = "") {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "video";
  return "auto";
}

export function inferMessageTypeFromMime(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

export const upload_media_service = async (attachments) => {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new Error("At least one attachment is required");
  }

  const uploaded = [];
  const pendingCloudinaryAssets = [];

  try {
    for (const file of attachments) {
      const mimeType = String(
        file.mime_type || file.mimetype || "application/octet-stream",
      );
      const fileName = String(file.file_name || file.name || "file");
      const buffer = decodeAttachmentBuffer(
        file.data || file.base64 || file.content,
      );

      if (!buffer) {
        throw new Error(`Invalid file data for ${fileName}`);
      }

      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`${fileName} exceeds the 15MB size limit`);
      }

      const result = await uploadToCloudinary(
        buffer,
        CHAT_MEDIA_FOLDER,
        resolveCloudinaryResourceType(mimeType),
      );

      pendingCloudinaryAssets.push({
        public_id: result.public_id,
        resource_type: result.resource_type || "image",
      });

      uploaded.push({
        url: result.secure_url,
        file_name: fileName,
        mime_type: mimeType,
        size: Number(file.size) || buffer.length,
      });
    }

    return uploaded;
  } catch (error) {
    for (const asset of pendingCloudinaryAssets) {
      await destroyFromCloudinary(asset.public_id, asset.resource_type).catch(
        () => {},
      );
    }
    throw error;
  }
};

export const save_private_message_service = async (data, io, socket) => {
  const {
    sender,
    delivered_to,
    type,
    content,
    company_id,
    chat_id,
    chat_type,
    reply_to,
    attachments,
  } = data;

  let new_chat_id;
  if (!chat_id) {
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

  const messageFields = {
    sender,
    company_id,
    chat_id: new_chat_id,
    content: content ?? "",
    type,
    delivered_to: [delivered_to],
    ...(reply_to ? { reply_to } : {}),
    ...(Array.isArray(attachments) && attachments.length
      ? { attachments }
      : {}),
  };

  const new_message = await Message.create({
    ...messageFields,
    seen_by: is_user_watching ? [delivered_to] : [],
  });

  await Chat.findByIdAndUpdate(new_chat_id, {
    last_message: new_message._id,
    last_message_time: new Date(),
  });

  return new_message;
};
