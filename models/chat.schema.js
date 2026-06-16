import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const chat_schema = new Schema(
  {
    // Multi-tenant support
    company_id: {
      type: Number,
      required: true,
      index: true,
    },

    // private | group
    chat_type: {
      type: String,
      enum: ["private", "group"],
      default: "private",
    },

    group_name: {
      type: String,
      default: "",
      trim: true,
    },

    group_image: {
      type: String,
      default: "",
    },

    group_description: {
      type: String,
      default: "",
    },

    group_admins: [
      {
        type: Number,
      },
    ],
    is_group_active: {
      type: Boolean,
      default: true,
    },
    participants: [
      {
        type: Number,
        required: true,
      },
    ],

    last_message: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    last_message_time: {
      type: Date,
      default: Date.now,
    },

    is_archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

chat_schema.index({
  company_id: 1,
  last_message_time: -1,
});

// Fast participant lookup
chat_schema.index({
  participants: 1,
});

const Chat = models.Chat || model("Chat", chat_schema);

export default Chat;
