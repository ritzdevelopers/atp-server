import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const msg_schema = new Schema(
  {
    // MySQL user id
    sender: {
      type: Number,
      required: true,
      index: true,
    },
    company_id: {
      type: Number,
      required: true,
      index: true,
    },

    chat_id: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    content: {
      type: String,
      default: "",
      trim: true,
    },

    type: {
      type: String,
      enum: [
        "text",
        "image",
        "audio",
        "video",
        "file",
        "link",
        "location",
      ],
      default: "text",
    },

    attachments: [
      {
        url: {
          type: String,
        },

        file_name: {
          type: String,
        },

        mime_type: {
          type: String,
        },

        size: {
          type: Number,
        },
      },
    ],

    reply_to: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    delivered_to: [
      {
        type: Number,
      },
    ],

    seen_by: [
      {
        type: Number,
      },
    ],

    is_edited: {
      type: Boolean,
      default: false,
    },

    edited_at: {
      type: Date,
      default: null,
    },

    is_deleted: {
      type: Boolean,
      default: false,
    },

    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

msg_schema.index({
  company_id: 1,
  chat_id: 1,
  createdAt: -1,
});


msg_schema.index({
  sender: 1,
});


msg_schema.index({
  reply_to: 1,
});

const Message = models.Message || model("Message", msg_schema);

export default Message;